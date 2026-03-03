import { sessions } from "../ws/sessions.js";
import { db } from "../db.js";
import { workflowRun } from "../schema.js";
import { eq } from "drizzle-orm";
import { runPipeline } from "./pipeline.js";
import type { LLMConfig } from "./llm.js";
import type { ScreenObservation } from "./loop.js";

export interface WorkflowStep {
  goal: string;
  app?: string;
  maxSteps?: number;
  formData?: Record<string, string>;
  retries?: number; // max retry attempts on failure (default: 0 = no retry)
  exhaustIsSuccess?: boolean; // treat maxSteps exhaustion as success (for open-ended browsing)
}

export interface RunWorkflowOptions {
  runId: string;
  deviceId: string;
  persistentDeviceId?: string;
  userId: string;
  name: string;
  steps: WorkflowStep[];
  llmConfig: LLMConfig;
  signal: AbortSignal;
}

function buildGoal(step: WorkflowStep): string {
  let goal = step.goal;
  if (step.formData && Object.keys(step.formData).length > 0) {
    const lines = Object.entries(step.formData)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join("\n");
    goal += `\n\nFORM DATA TO FILL:\n${lines}\n\nFind each field on screen and enter the corresponding value.`;
  }
  return goal;
}

export async function runWorkflowServer(options: RunWorkflowOptions): Promise<void> {
  const { runId, deviceId, persistentDeviceId, userId, name, steps, llmConfig, signal } = options;
  const stepResults: Array<{ goal: string; success: boolean; stepsUsed: number; sessionId?: string; resolvedBy?: string; error?: string; observations?: ScreenObservation[] }> = [];

  /** Send a JSON message to the device WebSocket (if still connected) */
  const sendToDevice = (msg: Record<string, unknown>) => {
    const d = sessions.getDevice(deviceId) ?? sessions.getDeviceByPersistentId(persistentDeviceId ?? "");
    if (!d) return;
    try { d.ws.send(JSON.stringify(msg)); } catch { /* disconnected */ }
  };

  // Notify device so it hides the overlay / shows running state
  sendToDevice({ type: "goal_started", goal: `Workflow: ${name}` });

  sessions.notifyDashboard(userId, {
    type: "workflow_started",
    runId,
    name,
    wfType: "workflow",
    totalSteps: steps.length,
  } as any);

  for (let i = 0; i < steps.length; i++) {
    if (signal.aborted) {
      await db.update(workflowRun).set({ status: "stopped", completedAt: new Date() }).where(eq(workflowRun.id, runId));
      sessions.notifyDashboard(userId, { type: "workflow_stopped", runId } as any);
      sendToDevice({ type: "goal_completed", success: false, stepsUsed: 0 });
      return;
    }

    const step = steps[i];
    const effectiveGoal = buildGoal(step);

    sessions.notifyDashboard(userId, {
      type: "workflow_step_start",
      runId,
      stepIndex: i,
      goal: step.goal,
    } as any);

    const maxRetries = step.retries ?? 0;
    let stepSuccess = false;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal.aborted) break;

      // Dismiss any leftover sheets/keyboards/dialogs before starting the step
      try {
        await sessions.sendCommand(deviceId, { type: "back" });
        await new Promise((r) => setTimeout(r, 500));
      } catch { /* ignore */ }

      // Launch app on each attempt (fresh state for retries)
      if (step.app) {
        try {
          await sessions.sendCommand(deviceId, { type: "launch", packageName: step.app });
          await new Promise((r) => setTimeout(r, 2000));
        } catch (err) {
          console.warn(`[Workflow] Failed to launch ${step.app}: ${err}`);
        }
      }

      try {
        const result = await runPipeline({
          deviceId,
          persistentDeviceId,
          userId,
          goal: effectiveGoal,
          llmConfig,
          maxSteps: step.maxSteps,
          signal,
        });

        const isSuccess = result.success ||
          (step.exhaustIsSuccess && result.stepsUsed >= (step.maxSteps ?? 30));
        if (isSuccess) {
          stepResults.push({ goal: step.goal, success: true, stepsUsed: result.stepsUsed, sessionId: result.sessionId, resolvedBy: result.resolvedBy, observations: result.observations });
          stepSuccess = true;
          break; // Success — move to next step
        }

        // Failed — log attempt and retry if attempts remain
        if (attempt < maxRetries) {
          console.log(`[Workflow] Step ${i} attempt ${attempt + 1}/${maxRetries + 1} failed, retrying...`);
          sessions.notifyDashboard(userId, {
            type: "workflow_step_retry",
            runId, stepIndex: i,
            attempt: attempt + 1,
            maxRetries: maxRetries + 1,
            stepsUsed: result.stepsUsed,
          } as any);
        } else {
          // All retries exhausted
          stepResults.push({ goal: step.goal, success: false, stepsUsed: result.stepsUsed, sessionId: result.sessionId, resolvedBy: result.resolvedBy, observations: result.observations });
        }
      } catch (err) {
        if (attempt < maxRetries) {
          console.log(`[Workflow] Step ${i} attempt ${attempt + 1}/${maxRetries + 1} threw error, retrying...`);
          sessions.notifyDashboard(userId, {
            type: "workflow_step_retry",
            runId, stepIndex: i,
            attempt: attempt + 1,
            maxRetries: maxRetries + 1,
            stepsUsed: 0,
          } as any);
        } else {
          stepResults.push({ goal: step.goal, success: false, stepsUsed: 0, error: String(err) });
        }
      }
    }

    // Update DB and check result
    await db.update(workflowRun).set({
      currentStep: i + 1,
      stepResults: stepResults,
    }).where(eq(workflowRun.id, runId));

    sessions.notifyDashboard(userId, {
      type: "workflow_step_done",
      runId,
      stepIndex: i,
      success: stepSuccess,
      stepsUsed: stepResults[stepResults.length - 1]?.stepsUsed ?? 0,
    } as any);

    if (!stepSuccess) {
      await db.update(workflowRun).set({
        status: "failed",
        stepResults,
        completedAt: new Date(),
      }).where(eq(workflowRun.id, runId));

      sessions.notifyDashboard(userId, {
        type: "workflow_completed",
        runId,
        success: false,
        stepResults,
      } as any);
      sendToDevice({ type: "goal_completed", success: false, stepsUsed: stepResults.reduce((sum, r) => sum + r.stepsUsed, 0) });
      return;
    }
  }

  // All steps completed successfully
  await db.update(workflowRun).set({
    status: "completed",
    stepResults,
    completedAt: new Date(),
  }).where(eq(workflowRun.id, runId));

  sessions.notifyDashboard(userId, {
    type: "workflow_completed",
    runId,
    success: true,
    stepResults,
  } as any);
  sendToDevice({ type: "goal_completed", success: true, stepsUsed: stepResults.reduce((sum, r) => sum + r.stepsUsed, 0) });
}
