import { sessions } from "../ws/sessions.js";
import { db } from "../db.js";
import { workflowRun } from "../schema.js";
import { eq } from "drizzle-orm";
import { runPipeline } from "./pipeline.js";
import { activeSessions } from "./active-sessions.js";
import type { LLMConfig } from "./llm.js";
import type { ScreenObservation } from "./loop.js";

/** In-memory ring buffer for workflow debug logs (last 200 entries). */
const _debugLog: string[] = [];
function wfLog(msg: string) {
  const ts = new Date().toISOString();
  const entry = `[${ts}] ${msg}`;
  _debugLog.push(entry);
  if (_debugLog.length > 200) _debugLog.shift();
  console.log(msg);
}
export function getWorkflowDebugLog(): string[] { return _debugLog; }

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

/** Max time (ms) to wait for a device to reconnect after a disconnect */
const RECONNECT_TIMEOUT = 60_000; // 60 seconds
/** Poll interval when waiting for reconnection */
const RECONNECT_POLL_INTERVAL = 3_000; // 3 seconds

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

/**
 * Check if the abort was caused by a device disconnect (not a user-initiated stop).
 * If so, wait for the device to reconnect and reset the abort controller.
 * Returns the new (or existing) deviceId to use, or null if we should give up.
 */
async function waitForReconnect(
  deviceId: string,
  persistentDeviceId: string | undefined,
  trackingKey: string,
  userId: string,
  runId: string,
): Promise<string | null> {
  const active = activeSessions.get(trackingKey);
  if (!active || !active.deviceDisconnected) {
    // User-initiated stop, not a disconnect — don't wait
    return null;
  }

  console.log(`[Workflow ${runId}] Device disconnected, waiting up to ${RECONNECT_TIMEOUT / 1000}s for reconnection...`);
  sessions.notifyDashboard(userId, {
    type: "workflow_device_disconnected",
    runId,
    waitingForReconnect: true,
    timeoutSeconds: RECONNECT_TIMEOUT / 1000,
  } as any);

  const deadline = Date.now() + RECONNECT_TIMEOUT;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, RECONNECT_POLL_INTERVAL));

    // Check if user stopped the workflow while we were waiting
    const currentActive = activeSessions.get(trackingKey);
    if (!currentActive || (currentActive.abort.signal.aborted && !currentActive.deviceDisconnected)) {
      console.log(`[Workflow ${runId}] User stopped workflow while waiting for reconnect`);
      return null;
    }

    // Check if device has reconnected
    const device = sessions.getDevice(deviceId) ?? sessions.getDeviceByPersistentId(persistentDeviceId ?? "");
    if (device) {
      console.log(`[Workflow ${runId}] Device reconnected! Resuming workflow...`);

      // Create a fresh AbortController so the workflow can continue
      const newAbort = new AbortController();
      activeSessions.set(trackingKey, {
        ...currentActive!,
        abort: newAbort,
        deviceDisconnected: false,
      });

      sessions.notifyDashboard(userId, {
        type: "workflow_device_reconnected",
        runId,
      } as any);

      return device.deviceId; // May have changed on reconnect
    }
  }

  console.log(`[Workflow ${runId}] Device did not reconnect within ${RECONNECT_TIMEOUT / 1000}s, giving up`);
  return null;
}

/**
 * Get the current AbortSignal for this workflow (may have been replaced after reconnect).
 */
function getCurrentSignal(trackingKey: string, fallbackSignal: AbortSignal): AbortSignal {
  const active = activeSessions.get(trackingKey);
  return active?.abort.signal ?? fallbackSignal;
}

/**
 * Check if the signal abort was a user-initiated stop (not a device disconnect).
 */
function isUserStop(trackingKey: string): boolean {
  const active = activeSessions.get(trackingKey);
  if (!active) return true; // no session = treat as stop
  return active.abort.signal.aborted && !active.deviceDisconnected;
}

export async function runWorkflowServer(options: RunWorkflowOptions): Promise<void> {
  const { runId, persistentDeviceId, userId, name, steps, llmConfig } = options;
  let { deviceId } = options;
  const trackingKey = persistentDeviceId ?? deviceId;
  const stepResults: Array<{ goal: string; success: boolean; stepsUsed: number; sessionId?: string; resolvedBy?: string; error?: string; observations?: ScreenObservation[] }> = [];

  /** Send a JSON message to the device WebSocket (if still connected) */
  const sendToDevice = (msg: Record<string, unknown>) => {
    const d = sessions.getDevice(deviceId) ?? sessions.getDeviceByPersistentId(persistentDeviceId ?? "");
    if (!d) return;
    try { d.ws.send(JSON.stringify(msg)); } catch { /* disconnected */ }
  };

  try {
    // Notify device so it hides the overlay / shows running state
    sendToDevice({ type: "goal_started", goal: `Workflow: ${name}` });

    // Clean slate: press Home then Back to dismiss any leftover UI from previous workflows
    try {
      await sessions.sendCommand(deviceId, { type: "home" });
      await new Promise((r) => setTimeout(r, 500));
      await sessions.sendCommand(deviceId, { type: "back" });
      await new Promise((r) => setTimeout(r, 500));
    } catch { /* ignore */ }

    sessions.notifyDashboard(userId, {
      type: "workflow_started",
      runId,
      name,
      wfType: "workflow",
      totalSteps: steps.length,
    } as any);

    for (let i = 0; i < steps.length; i++) {
      let signal = getCurrentSignal(trackingKey, options.signal);

      const activeAtTop = activeSessions.get(trackingKey);
      wfLog(`[Workflow ${runId}] Step ${i}: signal.aborted=${signal.aborted}, activeSession=${!!activeAtTop}, deviceDisconnected=${activeAtTop?.deviceDisconnected}, isUserStop=${isUserStop(trackingKey)}, trackingKey=${trackingKey}`);

      // Check for user-initiated stop at the top of each step
      if (signal.aborted && isUserStop(trackingKey)) {
        wfLog(`[Workflow ${runId}] STOPPING at step ${i}: signal aborted + isUserStop=true, activeSession=${!!activeSessions.get(trackingKey)}`);
        await db.update(workflowRun).set({ status: "stopped", stepResults, completedAt: new Date() }).where(eq(workflowRun.id, runId));
        sessions.notifyDashboard(userId, { type: "workflow_stopped", runId } as any);
        sendToDevice({ type: "goal_completed", success: false, stepsUsed: 0 });
        return;
      }

      // If signal was aborted by disconnect, try to wait for reconnect before this step
      if (signal.aborted) {
        const newDeviceId = await waitForReconnect(deviceId, persistentDeviceId, trackingKey, userId, runId);
        if (!newDeviceId) {
          // Couldn't reconnect — mark workflow as failed
          await db.update(workflowRun).set({ status: "failed", stepResults, completedAt: new Date() }).where(eq(workflowRun.id, runId));
          sessions.notifyDashboard(userId, { type: "workflow_completed", runId, success: false, stepResults } as any);
          sendToDevice({ type: "goal_completed", success: false, stepsUsed: stepResults.reduce((sum, r) => sum + r.stepsUsed, 0) });
          return;
        }
        deviceId = newDeviceId;
        signal = getCurrentSignal(trackingKey, options.signal);
      }

      const step = steps[i];
      const effectiveGoal = buildGoal(step);

      sessions.notifyDashboard(userId, {
        type: "workflow_step_start",
        runId,
        stepIndex: i,
        goal: step.goal,
        maxRetries: step.retries ?? 0,
      } as any);

      const maxRetries = step.retries ?? 0;
      let stepSuccess = false;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        signal = getCurrentSignal(trackingKey, options.signal);

        // Check for user-initiated stop
        if (signal.aborted && isUserStop(trackingKey)) break;

        // If signal aborted by disconnect, wait for reconnect before this attempt
        if (signal.aborted) {
          console.log(`[Workflow ${runId}] Device disconnected before step ${i} attempt ${attempt + 1}, waiting for reconnect...`);
          const newDeviceId = await waitForReconnect(deviceId, persistentDeviceId, trackingKey, userId, runId);
          if (!newDeviceId) {
            // Couldn't reconnect — record a failed result and break
            stepResults.push({ goal: step.goal, success: false, stepsUsed: 0, error: "Device disconnected and did not reconnect" });
            break;
          }
          deviceId = newDeviceId;
          signal = getCurrentSignal(trackingKey, options.signal);
          // Re-notify device after reconnection
          sendToDevice({ type: "goal_started", goal: `Workflow: ${name}` });
        }

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
            console.log(`[Workflow] Step ${i} attempt ${attempt + 1}/${maxRetries + 1} failed (stepsUsed=${result.stepsUsed}), retrying...`);
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
            console.log(`[Workflow] Step ${i} attempt ${attempt + 1}/${maxRetries + 1} threw error, retrying... Error: ${err}`);
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

      // Safety: ensure a stepResult was always pushed for this step
      if (stepResults.length <= i) {
        signal = getCurrentSignal(trackingKey, options.signal);
        if (signal.aborted && isUserStop(trackingKey)) {
          // User stopped — don't push a fake result, just mark as stopped
          await db.update(workflowRun).set({ status: "stopped", stepResults, completedAt: new Date() }).where(eq(workflowRun.id, runId));
          sessions.notifyDashboard(userId, { type: "workflow_stopped", runId } as any);
          sendToDevice({ type: "goal_completed", success: false, stepsUsed: stepResults.reduce((sum, r) => sum + r.stepsUsed, 0) });
          return;
        }
        // Abort without user stop = device disconnect that couldn't recover
        stepResults.push({ goal: step.goal, success: false, stepsUsed: 0, error: "Step aborted (device disconnected)" });
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

  } catch (err) {
    // Top-level safety net — ensure the workflow is always marked as finished
    console.error(`[Workflow ${runId}] Unexpected error: ${err}`);
    try {
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
    } catch (dbErr) {
      console.error(`[Workflow ${runId}] Failed to update DB after error: ${dbErr}`);
    }
  }
}
