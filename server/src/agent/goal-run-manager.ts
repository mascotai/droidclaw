/**
 * Goal Run Manager — Centralized lifecycle for goal run execution.
 *
 * All goal run creation, step recording, and completion goes through
 * these functions. This is the single source of truth for the
 * goal_run and step tables.
 */

import { db } from "../db.js";
import { goalRun, step } from "../schema.js";
import { eq } from "drizzle-orm";

// ─── Types ───────────────────────────────────────────────────

export interface CreateGoalRunParams {
  userId: string;
  deviceId: string;
  goal: string;
  app?: string | null;
  goalId?: string | null;
  workflowRunId?: string | null;
  stepIndex?: number | null;
  maxSteps?: number;
  evalDefinition?: Record<string, unknown> | null;
  scheduledFor?: Date | null;
}

export interface RecordStepParams {
  stepNumber: number;
  action: Record<string, unknown> | null;
  reasoning: string | null;
  result?: string | null;
  packageName?: string | null;
  activityName?: string | null;
  elements?: unknown | null;
  durationMs?: number | null;
  screenHash?: string | null;
}

export interface CompleteGoalRunParams {
  status: "completed" | "failed" | "skipped";
  resolvedBy: "discovery" | "recipe" | "parser" | "classifier";
  stepsUsed: number;
  durationMs?: number | null;
  recipeId?: string | null;
  evalPassed?: boolean | null;
  evalStateValues?: Record<string, unknown> | null;
  evalMismatches?: Array<{ key: string; expected: unknown; actual: unknown }> | null;
}

// ─── Functions ───────────────────────────────────────────────

/**
 * Create a new goal run in the database.
 * Returns the generated goalRunId.
 */
export async function createGoalRun(params: CreateGoalRunParams): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(goalRun).values({
    id,
    userId: params.userId,
    deviceId: params.deviceId,
    goal: params.goal,
    app: params.app ?? null,
    goalId: params.goalId ?? null,
    workflowRunId: params.workflowRunId ?? null,
    stepIndex: params.stepIndex ?? null,
    maxSteps: params.maxSteps ?? 15,
    status: "running",
    evalDefinition: params.evalDefinition ?? null,
    scheduledFor: params.scheduledFor ?? null,
  });
  return id;
}

/**
 * Record a single agent step within a goal run.
 * Returns the generated step ID.
 */
export async function recordStep(
  goalRunId: string,
  params: RecordStepParams
): Promise<string> {
  const id = crypto.randomUUID();
  await db.insert(step).values({
    id,
    goalRunId,
    stepNumber: params.stepNumber,
    screenHash: params.screenHash ?? null,
    action: params.action,
    reasoning: params.reasoning,
    result: params.result ?? null,
    packageName: params.packageName ?? null,
    activityName: params.activityName ?? null,
    elements: params.elements ?? null,
    durationMs: params.durationMs ?? null,
  });
  return id;
}

/**
 * Update a step's result and duration after execution.
 */
export async function updateStep(
  stepId: string,
  params: { result?: string | null; durationMs?: number | null; action?: Record<string, unknown> | null }
): Promise<void> {
  const updates: Record<string, unknown> = {};
  if (params.result !== undefined) updates.result = params.result;
  if (params.durationMs !== undefined) updates.durationMs = params.durationMs;
  if (params.action !== undefined) updates.action = params.action;

  if (Object.keys(updates).length > 0) {
    await db.update(step).set(updates).where(eq(step.id, stepId));
  }
}

/**
 * Complete (or fail) a goal run. Sets final status, resolvedBy,
 * steps used, duration, and optional eval results.
 */
export async function completeGoalRun(
  goalRunId: string,
  params: CompleteGoalRunParams
): Promise<void> {
  await db
    .update(goalRun)
    .set({
      status: params.status,
      resolvedBy: params.resolvedBy,
      stepsUsed: params.stepsUsed,
      durationMs: params.durationMs ?? null,
      recipeId: params.recipeId ?? null,
      evalPassed: params.evalPassed ?? null,
      evalStateValues: params.evalStateValues ?? null,
      evalMismatches: params.evalMismatches ?? null,
      completedAt: new Date(),
    })
    .where(eq(goalRun.id, goalRunId));
}

/**
 * Update goal run's stepsUsed counter (for progress tracking).
 */
export async function updateGoalRunSteps(
  goalRunId: string,
  stepsUsed: number
): Promise<void> {
  await db
    .update(goalRun)
    .set({ stepsUsed })
    .where(eq(goalRun.id, goalRunId));
}
