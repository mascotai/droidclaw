/**
 * Eval Runner — Batch eval orchestrator for DroidClaw.
 *
 * Runs a set of workflows N times each for statistical evaluation.
 * Uses the existing runWorkflowServer() which calls the eval judge
 * per step when eval definitions are present.
 */

import { db } from "../db.js";
import { evalBatch, workflowRun } from "../schema.js";
import { eq } from "drizzle-orm";
import { sessions } from "../ws/sessions.js";
import { runWorkflowServer, type WorkflowStep } from "./workflow-runner.js";
import type { LLMConfig } from "./llm.js";
import type { EvalJudgment } from "./eval-judge.js";

// ─── Types ───────────────────────────────────────────────────

export interface WorkflowDef {
  name: string;
  steps: WorkflowStep[];
  variables?: Record<string, { min: number; max: number }>;
}

interface StepResultWithEval {
  goal: string;
  success: boolean;
  stepsUsed: number;
  sessionId?: string;
  resolvedBy?: string;
  error?: string;
  evalJudgment?: EvalJudgment;
  skipped?: boolean;
  skipReason?: string;
  stepId?: string;
}

export interface WorkflowEvalResult {
  workflowName: string;
  runs: Array<{
    runId: string;
    success: boolean;
    stepsUsed: number;
    stepResults: StepResultWithEval[];
    durationMs: number;
  }>;
  successRate: number;
  avgStepsUsed: number;
  perStepPassRates: Record<number, {
    passRate: number;
    skippedCount: number;
    commonMismatches: Array<{ key: string; expected: unknown; failCount: number }>;
  }>;
}

export interface EvalResults {
  overallSuccessRate: number;
  totalRuns: number;
  totalSuccesses: number;
  totalFailures: number;
  durationMs: number;
  workflows: WorkflowEvalResult[];
}

export interface RunEvalOptions {
  evalId: string;
  deviceId: string;
  persistentDeviceId?: string;
  userId: string;
  workflows: WorkflowDef[];
  runsPerWorkflow: number;
  llmConfig: LLMConfig;
  signal: AbortSignal;
}

// ─── Variable Resolution ─────────────────────────────────────

function resolveVariables(
  steps: WorkflowStep[],
  variables?: Record<string, { min: number; max: number }>
): { steps: WorkflowStep[]; resolvedValues: Record<string, string> } {
  if (!variables) return { steps, resolvedValues: {} };
  const resolved: Record<string, string> = {};
  for (const [key, range] of Object.entries(variables)) {
    resolved[key] = String(Math.floor(Math.random() * (range.max - range.min + 1)) + range.min);
  }
  const resolvedSteps = steps.map(step => {
    const replacer = (_: string, key: string) =>
      resolved[key] !== undefined ? resolved[key] : `{{${key}}}`;

    const resolvedStep = {
      ...step,
      _goalTemplate: step.goal, // preserve original template for cache key
      goal: step.goal.replace(/\{\{(\w+)\}\}/g, replacer),
    };

    // Also resolve eval expected values
    if (resolvedStep.eval?.states) {
      const resolvedStates = { ...resolvedStep.eval.states };
      for (const [stateKey, stateDef] of Object.entries(resolvedStates)) {
        if (typeof stateDef.expected === "string") {
          resolvedStates[stateKey] = {
            ...stateDef,
            expected: stateDef.expected.replace(/\{\{(\w+)\}\}/g, replacer),
          };
        }
      }
      resolvedStep.eval = { states: resolvedStates };
    }

    return resolvedStep;
  });
  return { steps: resolvedSteps, resolvedValues: resolved };
}

// ─── Core Logic ──────────────────────────────────────────────

export async function runEval(options: RunEvalOptions): Promise<void> {
  const { evalId, deviceId, persistentDeviceId, userId, workflows, runsPerWorkflow, llmConfig, signal } = options;
  const evalStart = Date.now();

  const workflowResults: WorkflowEvalResult[] = [];
  let totalRuns = 0;
  let totalSuccesses = 0;

  sessions.notifyDashboard(userId, {
    type: "eval_progress",
    evalId,
    status: "running",
    totalWorkflows: workflows.length,
    runsPerWorkflow,
  } as any);

  for (let wi = 0; wi < workflows.length; wi++) {
    if (signal.aborted) break;

    const workflow = workflows[wi];
    const runs: WorkflowEvalResult["runs"] = [];

    for (let ri = 0; ri < runsPerWorkflow; ri++) {
      if (signal.aborted) break;

      const runId = crypto.randomUUID();
      const runStart = Date.now();

      // Resolve variables fresh for each run
      const { steps: resolvedSteps, resolvedValues } = resolveVariables(workflow.steps, workflow.variables);

      // Create a workflow_run row linked to this eval
      await db.insert(workflowRun).values({
        id: runId,
        userId,
        deviceId: persistentDeviceId ?? deviceId,
        name: `${workflow.name} (eval run ${ri + 1}/${runsPerWorkflow})`,
        type: "workflow",
        steps: resolvedSteps,
        status: "running",
        totalSteps: resolvedSteps.length,
        evalBatchId: evalId,
      });

      // Notify progress
      sessions.notifyDashboard(userId, {
        type: "eval_progress",
        evalId,
        workflowIndex: wi,
        runIndex: ri,
        workflowName: workflow.name,
        status: "running_workflow",
      } as any);

      try {
        // Run the workflow (which now calls eval judge per step)
        await runWorkflowServer({
          runId,
          deviceId,
          persistentDeviceId,
          userId,
          name: workflow.name,
          steps: resolvedSteps,
          llmConfig,
          signal,
          resolvedValues,
        });

        // Fetch the completed workflow run to get results
        const [completedRun] = await db.select().from(workflowRun)
          .where(eq(workflowRun.id, runId)).limit(1);

        const stepResults = (completedRun?.stepResults as StepResultWithEval[]) ?? [];
        const runSuccess = completedRun?.status === "completed";
        const runSteps = stepResults.reduce((sum, sr) => sum + sr.stepsUsed, 0);

        runs.push({
          runId,
          success: runSuccess,
          stepsUsed: runSteps,
          stepResults,
          durationMs: Date.now() - runStart,
        });

        totalRuns++;
        if (runSuccess) totalSuccesses++;
      } catch (err) {
        console.error(`[EvalRunner] Workflow "${workflow.name}" run ${ri + 1} failed: ${err}`);
        runs.push({
          runId,
          success: false,
          stepsUsed: 0,
          stepResults: [],
          durationMs: Date.now() - runStart,
        });
        totalRuns++;
      }

      // Update partial results in DB after each run
      const partialResults = buildResults(workflowResults, workflow.name, runs, totalRuns, totalSuccesses, Date.now() - evalStart);
      await db.update(evalBatch).set({ results: partialResults }).where(eq(evalBatch.id, evalId));
    }

    // Compute per-step pass rates for this workflow
    const perStepPassRates: WorkflowEvalResult["perStepPassRates"] = {};
    const stepCount = workflow.steps.length;
    for (let si = 0; si < stepCount; si++) {
      const stepRuns = runs.map(r => r.stepResults[si]).filter(Boolean);
      const skippedCount = stepRuns.filter(sr => sr.skipped).length;
      const executedRuns = stepRuns.filter(sr => !sr.skipped);
      const passed = executedRuns.filter(sr => sr.success).length;

      // Collect common mismatches (only from executed runs)
      const mismatchCounts = new Map<string, { expected: unknown; count: number }>();
      for (const sr of executedRuns) {
        if (sr.evalJudgment?.mismatches) {
          for (const m of sr.evalJudgment.mismatches) {
            const existing = mismatchCounts.get(m.key);
            if (existing) {
              existing.count++;
            } else {
              mismatchCounts.set(m.key, { expected: m.expected, count: 1 });
            }
          }
        }
      }

      perStepPassRates[si] = {
        passRate: executedRuns.length > 0 ? passed / executedRuns.length : 0,
        skippedCount,
        commonMismatches: [...mismatchCounts.entries()]
          .map(([key, { expected, count }]) => ({ key, expected, failCount: count }))
          .sort((a, b) => b.failCount - a.failCount),
      };
    }

    const successfulRuns = runs.filter(r => r.success);
    workflowResults.push({
      workflowName: workflow.name,
      runs,
      successRate: runs.length > 0 ? successfulRuns.length / runs.length : 0,
      avgStepsUsed: successfulRuns.length > 0
        ? successfulRuns.reduce((sum, r) => sum + r.stepsUsed, 0) / successfulRuns.length
        : 0,
      perStepPassRates,
    });
  }

  // Final results
  const finalResults: EvalResults = {
    overallSuccessRate: totalRuns > 0 ? totalSuccesses / totalRuns : 0,
    totalRuns,
    totalSuccesses,
    totalFailures: totalRuns - totalSuccesses,
    durationMs: Date.now() - evalStart,
    workflows: workflowResults,
  };

  const finalStatus = signal.aborted ? "stopped" : "completed";
  await db.update(evalBatch).set({
    status: finalStatus,
    results: finalResults,
    completedAt: new Date(),
  }).where(eq(evalBatch.id, evalId));

  sessions.notifyDashboard(userId, {
    type: "eval_completed",
    evalId,
    status: finalStatus,
    results: finalResults,
  } as any);
}

// ─── Helper ──────────────────────────────────────────────────

function buildResults(
  completedWorkflows: WorkflowEvalResult[],
  currentName: string,
  currentRuns: WorkflowEvalResult["runs"],
  totalRuns: number,
  totalSuccesses: number,
  durationMs: number,
): EvalResults {
  const successfulCurrentRuns = currentRuns.filter(r => r.success);
  const currentWorkflow: WorkflowEvalResult = {
    workflowName: currentName,
    runs: currentRuns,
    successRate: currentRuns.length > 0 ? successfulCurrentRuns.length / currentRuns.length : 0,
    avgStepsUsed: successfulCurrentRuns.length > 0
      ? successfulCurrentRuns.reduce((sum, r) => sum + r.stepsUsed, 0) / successfulCurrentRuns.length
      : 0,
    perStepPassRates: {},
  };

  const allWorkflows = [
    ...completedWorkflows,
    currentWorkflow,
  ];

  return {
    overallSuccessRate: totalRuns > 0 ? totalSuccesses / totalRuns : 0,
    totalRuns,
    totalSuccesses,
    totalFailures: totalRuns - totalSuccesses,
    durationMs,
    workflows: allWorkflows,
  };
}
