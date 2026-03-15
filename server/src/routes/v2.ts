/**
 * DroidClaw API v2 — LLM/MCP-friendly endpoints
 *
 * Design principles:
 *   - Lean responses by default (no 70KB element trees)
 *   - Drill-down on demand: run → goal → steps → step → screen
 *   - deviceId always in URL path (never in request body for GETs)
 *   - No ?wait=true blocking (fire-and-forget, poll /runs for status)
 *   - goalId is the string id ("add_account") or numeric index as fallback
 *   - No separate /queue endpoint — use ?status=running filter
 *
 * Drill-down hierarchy:
 *   GET .../runs/:runId                       → run summary + per-goal results
 *   GET .../runs/:runId/goals/:goalId         → single goal config + result
 *   GET .../runs/:runId/goals/:goalId/steps   → all agent actions (no screens)
 *   GET .../runs/:runId/goals/:goalId/steps/:step       → single step detail + screen
 *   GET .../runs/:runId/goals/:goalId/steps/:step/screen → screen tree only
 *   GET .../runs/:runId/goals/:goalId/eval    → eval definition + judgment
 */

import { Hono } from "hono";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { sessionMiddleware, type AuthEnv } from "../middleware/auth.js";
import { sessions } from "../ws/sessions.js";
import { db } from "../db.js";
import {
  device,
  workflowRun,
  cachedFlow,
  recipe,
  goalRun,
  step as stepTable,
} from "../schema.js";
import { activeSessions } from "../agent/active-sessions.js";
import { getWorkflowDebugLog } from "../agent/workflow-runner.js";
import {
  enqueueRun,
  cancelQueuedRun,
} from "../temporal/client.js";
import type { ScreenObservation } from "../agent/loop.js";
import type { EvalJudgment } from "../agent/eval-judge.js";

const v2 = new Hono<AuthEnv>();

// ── Helper: resolve workflow variables ──────────────────────────────────────
type VariableValue = string | { min: number; max: number };

function resolveVariables(
  steps: any[],
  variables?: Record<string, VariableValue>,
): { steps: any[]; resolvedValues: Record<string, string> } {
  if (!variables) return { steps, resolvedValues: {} };
  const resolvedValues: Record<string, string> = {};
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === "string") {
      resolvedValues[key] = value;
    } else if (value && typeof value === "object" && "min" in value && "max" in value) {
      resolvedValues[key] = String(
        Math.floor(Math.random() * (value.max - value.min + 1)) + value.min,
      );
    }
  }
  const replacer = (_: string, key: string) =>
    resolvedValues[key] !== undefined ? resolvedValues[key] : `{{${key}}}`;

  return {
    steps: steps.map((step) => {
      const resolvedStep = {
        ...step,
        _goalTemplate: step.goal,
        goal: step.goal.replace(/\{\{(\w+)\}\}/g, replacer),
      };
      if (resolvedStep.eval?.states) {
        const resolvedStates = { ...resolvedStep.eval.states };
        for (const [stateKey, stateDef] of Object.entries(resolvedStates)) {
          const sd = stateDef as any;
          if (typeof sd.expected === "string") {
            resolvedStates[stateKey] = {
              ...sd,
              expected: sd.expected.replace(/\{\{(\w+)\}\}/g, replacer),
            };
          }
        }
        resolvedStep.eval = { states: resolvedStates };
      }
      return resolvedStep;
    }),
    resolvedValues,
  };
}

function resolvePersistentDeviceId(deviceId: string): string {
  const d = sessions.getDevice(deviceId) ?? sessions.getDeviceByPersistentId(deviceId);
  return d?.persistentDeviceId ?? deviceId;
}

// ── stepResults shape stored by workflow-runner ─────────────────────────────
interface StepResult {
  goal: string;
  success: boolean;
  stepsUsed: number;
  sessionId?: string;
  resolvedBy?: string;
  cachedFlowId?: string;
  error?: string;
  observations?: ScreenObservation[];
  evalJudgment?: EvalJudgment;
  skipped?: boolean;
  skipReason?: string;
  stepId?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function findGoalIndex(stepResults: StepResult[], stepDefs: any[], goalId: string): number {
  const byResultId = stepResults.findIndex((sr) => sr.stepId === goalId);
  if (byResultId !== -1) return byResultId;
  const byDefId = stepDefs.findIndex((s: any) => s.id === goalId);
  if (byDefId !== -1) return byDefId;
  const num = parseInt(goalId, 10);
  if (!isNaN(num) && num >= 0 && num < stepDefs.length) return num;
  return -1;
}

async function loadRun(runId: string, userId: string) {
  const rows = await db
    .select()
    .from(workflowRun)
    .where(and(eq(workflowRun.id, runId), eq(workflowRun.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

function formatScreen(obs: ScreenObservation) {
  const textElements = obs.elements
    .filter((el: any) => el.text)
    .map((el: any) => el.text)
    .slice(0, 50);
  return {
    package: obs.packageName ?? null,
    activity: obs.activityName ?? null,
    elementCount: obs.elements.length,
    textElements,
    elements: obs.elements,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  DEVICES
// ═══════════════════════════════════════════════════════════════════════════

// Shell & Diagnose — no auth (debug tools)
v2.post("/devices/:deviceId/shell", async (c) => {
  const deviceId = c.req.param("deviceId");
  const body = await c.req.json<{ command: string }>();
  if (!body.command) return c.json({ error: "Missing 'command' field" }, 400);
  try {
    const result = (await sessions.sendCommand(deviceId, { type: "shell", text: body.command }, 30_000)) as {
      success?: boolean; error?: string; data?: string;
    };
    return c.json({ success: result.success ?? false, error: result.error, output: result.data });
  } catch (err) {
    return c.json({ error: `Shell command failed: ${err instanceof Error ? err.message : String(err)}` }, 504);
  }
});

v2.post("/devices/:deviceId/diagnose", async (c) => {
  const deviceId = c.req.param("deviceId");
  try {
    const result = (await sessions.sendCommand(deviceId, { type: "diagnose" }, 120_000)) as {
      success?: boolean; error?: string; data?: string;
    };
    if (!result.success) return c.json({ error: result.error ?? "Diagnose failed" }, 502);
    try { return c.json(JSON.parse(result.data ?? "{}")); } catch { return c.json({ raw: result.data }); }
  } catch (err) {
    return c.json({ error: `Diagnose failed: ${err instanceof Error ? err.message : String(err)}` }, 504);
  }
});

// All other v2 routes require auth
v2.use("*", sessionMiddleware);

// ── GET /v2/devices ──
v2.get("/devices", async (c) => {
  const user = c.get("user");
  const dbDevices = await db.select().from(device).where(eq(device.userId, user.id)).orderBy(desc(device.lastSeen));
  return c.json(
    dbDevices.map((d) => {
      const info = d.deviceInfo as Record<string, unknown> | null;
      return {
        deviceId: d.id,
        name: d.name,
        online: d.status === "online",
        version: info ? { versionName: info.appVersionName ?? null, versionCode: info.appVersionCode ?? null } : null,
        lastSeen: d.lastSeen?.toISOString() ?? d.createdAt.toISOString(),
      };
    }),
  );
});

// ── GET /v2/devices/:deviceId ──
v2.get("/devices/:deviceId", async (c) => {
  const user = c.get("user");
  const deviceId = c.req.param("deviceId");
  const rows = await db.select().from(device)
    .where(and(eq(device.id, deviceId), eq(device.userId, user.id)))
    .limit(1);
  if (rows.length === 0) return c.json({ error: "Device not found" }, 404);

  const d = rows[0];
  const info = d.deviceInfo as Record<string, unknown> | null;
  const active = activeSessions.get(deviceId);

  return c.json({
    deviceId: d.id,
    name: d.name,
    online: d.status === "online",
    version: info ? { versionName: info.appVersionName ?? null, versionCode: info.appVersionCode ?? null } : null,
    activeSession: active ? { sessionId: active.sessionId, goal: active.goal?.slice(0, 120) } : null,
    lastSeen: d.lastSeen?.toISOString() ?? null,
    debugLog: getWorkflowDebugLog().slice(-20),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  WORKFLOWS
// ═══════════════════════════════════════════════════════════════════════════

// ── POST /v2/devices/:deviceId/workflows/run ──
v2.post("/devices/:deviceId/workflows/run", async (c) => {
  const user = c.get("user");
  const deviceId = c.req.param("deviceId");
  const body = await c.req.json<{
    name?: string;
    type?: "workflow" | "flow";
    steps: unknown[];
    variables?: Record<string, VariableValue>;
    llmModel?: string;
  }>();

  if (!body.steps || !Array.isArray(body.steps) || body.steps.length === 0) {
    return c.json({ error: "Non-empty steps array is required" }, 400);
  }

  const { steps: resolvedSteps, resolvedValues } = resolveVariables(body.steps, body.variables);
  const persistentDeviceId = resolvePersistentDeviceId(deviceId);
  const wfType = body.type ?? "workflow";
  const wfName = body.name ?? (wfType === "workflow" ? "Ad-hoc Workflow" : "Ad-hoc Flow");
  const runId = crypto.randomUUID();

  await enqueueRun({
    deviceId: persistentDeviceId,
    payload: {
      runId,
      userId: user.id,
      name: wfName,
      type: wfType,
      steps: resolvedSteps,
      totalSteps: resolvedSteps.length,
      llmModel: body.llmModel,
      resolvedValues: Object.keys(resolvedValues).length > 0 ? resolvedValues : undefined,
    },
  });

  sessions.notifyDashboard(user.id, { type: "workflow_queued", runId, name: wfName, wfType } as any);
  return c.json({ runId, status: "queued", totalSteps: resolvedSteps.length });
});

// ── POST /v2/devices/:deviceId/workflows/runs/:runId/stop ──
v2.post("/devices/:deviceId/workflows/runs/:runId/stop", async (c) => {
  const user = c.get("user");
  const deviceId = c.req.param("deviceId");
  const runId = c.req.param("runId");

  // Try to cancel from Temporal queue
  const persistentDeviceId = resolvePersistentDeviceId(deviceId);
  await cancelQueuedRun(persistentDeviceId, runId);

  // Try to abort if currently running
  const dev = sessions.getDevice(deviceId) ?? sessions.getDeviceByPersistentId(deviceId);
  if (!dev) {
    // Device offline — try to mark run as cancelled in DB
    const rows = await db
      .select({ status: workflowRun.status, userId: workflowRun.userId })
      .from(workflowRun)
      .where(eq(workflowRun.id, runId))
      .limit(1);
    if (rows.length === 0) return c.json({ error: "Run not found" }, 404);
    if (rows[0].userId !== user.id) return c.json({ error: "Not your run" }, 403);
    if (rows[0].status === "running") {
      await db.update(workflowRun)
        .set({ status: "cancelled", completedAt: new Date() })
        .where(eq(workflowRun.id, runId));
    }
    return c.json({ runId, status: "cancelled" });
  }

  if (dev.userId !== user.id) return c.json({ error: "Not your device" }, 403);

  const trackingKey = dev.persistentDeviceId ?? dev.deviceId;
  const active = activeSessions.get(trackingKey);
  if (active) {
    active.deviceDisconnected = false;
    active.abort.abort();
    return c.json({ runId, status: "stopping" });
  }

  return c.json({ runId, status: "cancelled" });
});

// ── GET /v2/devices/:deviceId/workflows/runs ──
// Supports: ?limit=10 &offset=0 &status=running|completed|failed|stopped
v2.get("/devices/:deviceId/workflows/runs", async (c) => {
  const user = c.get("user");
  const deviceId = c.req.param("deviceId");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "10", 10), 100);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const statusFilter = c.req.query("status");

  const conditions = [
    eq(workflowRun.userId, user.id),
    eq(workflowRun.deviceId, deviceId),
    ...(statusFilter ? [eq(workflowRun.status, statusFilter)] : []),
  ];

  const rows = await db
    .select({
      id: workflowRun.id,
      name: workflowRun.name,
      type: workflowRun.type,
      status: workflowRun.status,
      currentStep: workflowRun.currentStep,
      totalSteps: workflowRun.totalSteps,
      startedAt: workflowRun.startedAt,
      completedAt: workflowRun.completedAt,
    })
    .from(workflowRun)
    .where(and(...conditions))
    .orderBy(desc(workflowRun.startedAt))
    .limit(limit)
    .offset(offset);

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(workflowRun)
    .where(and(...conditions));

  return c.json({
    runs: rows.map((r) => ({
      runId: r.id,
      name: r.name,
      type: r.type,
      status: r.status,
      currentStep: r.currentStep,
      totalSteps: r.totalSteps,
      startedAt: r.startedAt?.toISOString() ?? null,
      completedAt: r.completedAt?.toISOString() ?? null,
      durationMs: r.startedAt && r.completedAt ? r.completedAt.getTime() - r.startedAt.getTime() : null,
    })),
    total: Number(countResult[0]?.count ?? 0),
    limit,
    offset,
  });
});

// ── GET /v2/devices/:deviceId/workflows/runs/:runId ──
// Run summary with per-goal results (no screens — drill down for those)
// Running goals appear in the goals array with status: "running"
v2.get("/devices/:deviceId/workflows/runs/:runId", async (c) => {
  const user = c.get("user");
  const deviceId = c.req.param("deviceId");
  const run = await loadRun(c.req.param("runId"), user.id);
  if (!run) return c.json({ error: "Run not found" }, 404);

  const stepResults = (run.stepResults as StepResult[] | null) ?? [];
  const stepDefs = (run.steps as any[]) ?? [];

  // Build goals array from completed stepResults
  const goals: any[] = stepResults.map((sr, idx) => ({
    goal: idx,
    goalId: sr.stepId ?? stepDefs[idx]?.id ?? null,
    text: sr.goal,
    status: sr.success ? "completed" : "failed",
    success: sr.success,
    stepsUsed: sr.stepsUsed,
    resolvedBy: sr.resolvedBy ?? null,
    evalPassed: sr.evalJudgment ? sr.evalJudgment.success : null,
    evalStateValues: sr.evalJudgment?.stateValues ?? null,
    evalMismatches: sr.evalJudgment?.mismatches ?? null,
    skipped: sr.skipped ?? false,
    error: sr.error ?? null,
    sessionId: sr.sessionId ?? null,
  }));

  // If running, append the current live goal to the array
  if (run.status === "running") {
    const trackingKey = resolvePersistentDeviceId(deviceId);
    const active = activeSessions.get(trackingKey);
    const goalIdx = run.currentStep ?? stepResults.length;
    const goalDef = stepDefs[goalIdx];

    if (active?.sessionId) {
      // Get the latest step from DB via goal_run → step table
      let latest: { stepNumber: number; action: any; reasoning: string | null; result: string | null; packageName: string | null; durationMs: number | null } | null = null;

      const goalRunRows = await db
        .select({ id: goalRun.id })
        .from(goalRun)
        .where(and(eq(goalRun.workflowRunId, run.id), eq(goalRun.stepIndex, goalIdx)))
        .limit(1);

      if (goalRunRows.length > 0) {
        const latestSteps = await db
          .select()
          .from(stepTable)
          .where(eq(stepTable.goalRunId, goalRunRows[0].id))
          .orderBy(desc(stepTable.stepNumber))
          .limit(1);
        if (latestSteps.length > 0) {
          latest = latestSteps[0];
        }
      }

      goals.push({
        goal: goalIdx,
        goalId: goalDef?.id ?? null,
        text: goalDef?.goal ?? active.goal,
        status: "running",
        success: null,
        stepsUsed: latest?.stepNumber ?? 0,
        maxSteps: goalDef?.maxSteps ?? null,
        resolvedBy: null,
        evalPassed: null,
        skipped: false,
        error: null,
        sessionId: active.sessionId,
        latestStep: latest ? {
          step: latest.stepNumber,
          action: latest.action,
          reasoning: latest.reasoning,
          result: latest.result,
          package: latest.packageName,
          durationMs: latest.durationMs,
        } : null,
      });
    } else if (goalIdx < stepDefs.length) {
      // Goal is pending (queued, not started yet)
      goals.push({
        goal: goalIdx,
        goalId: goalDef?.id ?? null,
        text: goalDef?.goal ?? null,
        status: "pending",
        success: null,
        stepsUsed: 0,
        resolvedBy: null,
        evalPassed: null,
        skipped: false,
        error: null,
      });
    }
  }

  return c.json({
    runId: run.id,
    name: run.name,
    type: run.type,
    status: run.status,
    currentStep: run.currentStep,
    totalSteps: run.totalSteps,
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    durationMs: run.startedAt && run.completedAt ? run.completedAt.getTime() - run.startedAt.getTime() : null,
    goals,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  GOAL DRILL-DOWN
//  All under: /v2/devices/:deviceId/workflows/runs/:runId/goals/:goalId
// ═══════════════════════════════════════════════════════════════════════════

// ── GET .../goals/:goalId — single goal config + result ──
v2.get("/devices/:deviceId/workflows/runs/:runId/goals/:goalId", async (c) => {
  const user = c.get("user");
  const run = await loadRun(c.req.param("runId"), user.id);
  if (!run) return c.json({ error: "Run not found" }, 404);

  const stepResults = (run.stepResults as StepResult[] | null) ?? [];
  const stepDefs = (run.steps as any[]) ?? [];
  const idx = findGoalIndex(stepResults, stepDefs, c.req.param("goalId"));
  if (idx === -1) return c.json({ error: `Goal "${c.req.param("goalId")}" not found` }, 404);

  const sr = stepResults[idx];
  const def = stepDefs[idx];

  return c.json({
    goal: idx,
    goalId: sr.stepId ?? def?.id ?? null,
    text: sr.goal,
    // Configuration
    app: def?.app ?? null,
    maxSteps: def?.maxSteps ?? null,
    forceStop: def?.forceStop ?? false,
    // Result
    success: sr.success,
    stepsUsed: sr.stepsUsed,
    resolvedBy: sr.resolvedBy ?? null,
    skipped: sr.skipped ?? false,
    skipReason: sr.skipReason ?? null,
    error: sr.error ?? null,
    evalPassed: sr.evalJudgment ? sr.evalJudgment.success : null,
    // Discovery hints for further drill-down
    hasSteps: !!sr.sessionId,
    hasEval: !!def?.eval,
    availableScreens: (sr.observations ?? []).map((o) => o.stepNumber),
  });
});

// ── GET .../goals/:goalId/steps — agent actions with pagination ──
// Supports: ?from=3&to=8 (step numbers, 1-based). Defaults to all steps.
// Works for both completed goals (from stepResults) and running goals (from activeSessions)
v2.get("/devices/:deviceId/workflows/runs/:runId/goals/:goalId/steps", async (c) => {
  const user = c.get("user");
  const run = await loadRun(c.req.param("runId"), user.id);
  if (!run) return c.json({ error: "Run not found" }, 404);

  const stepResults = (run.stepResults as StepResult[] | null) ?? [];
  const stepDefs = (run.steps as any[]) ?? [];
  const goalIdParam = c.req.param("goalId");
  const idx = findGoalIndex(stepResults, stepDefs, goalIdParam);
  if (idx === -1) return c.json({ error: `Goal "${goalIdParam}" not found` }, 404);

  const sr = stepResults[idx] as StepResult | undefined;
  const def = stepDefs[idx];

  // For cached flows/recipes, return the saved deterministic steps
  if ((sr?.resolvedBy === "cached_flow" || sr?.resolvedBy === "recipe") && sr.cachedFlowId) {
    let cachedSteps: any[] | null = null;
    let cachedTimeline: number[] | null = null;

    const recipeRows = await db
      .select()
      .from(recipe)
      .where(eq(recipe.id, sr.cachedFlowId))
      .limit(1);

    if (recipeRows.length > 0) {
      cachedSteps = (recipeRows[0].steps as any[]) ?? [];
      cachedTimeline = (recipeRows[0].timeline as number[]) ?? [];
    } else {
      const cached = await db
        .select()
        .from(cachedFlow)
        .where(eq(cachedFlow.id, sr.cachedFlowId))
        .limit(1);

      if (cached.length > 0) {
        cachedSteps = (cached[0].steps as any[]) ?? [];
        cachedTimeline = (cached[0].timeline as number[]) ?? [];
      }
    }

    if (cachedSteps) {
      return c.json({
        goal: idx,
        goalId: sr?.stepId ?? def?.id ?? null,
        status: "completed",
        stepsUsed: cachedSteps.length,
        totalSteps: cachedSteps.length,
        resolvedBy: sr.resolvedBy,
        steps: cachedSteps.map((fs: any, i: number) => {
          if (typeof fs === "string") {
            return {
              step: i + 1,
              action: { action: fs },
              reasoning: null,
              result: null,
              package: null,
              durationMs: cachedTimeline?.[i] ?? 0,
            };
          }
          const entries = Object.entries(fs).filter(([k]) => !k.startsWith("_"));
          const [actionType, actionValue] = entries[0] ?? ["unknown", null];
          return {
            step: i + 1,
            action: {
              action: actionType,
              ...(typeof actionValue === "string" ? { target: actionValue, text: actionType === "type" ? actionValue : undefined } : {}),
              ...(fs._coords ? { coordinates: fs._coords } : {}),
            },
            reasoning: null,
            result: null,
            package: null,
            durationMs: cachedTimeline?.[i] ?? 0,
          };
        }),
      });
    }
  }

  // Look up goal_run by workflowRunId + stepIndex, then query step table
  const goalRunRows = await db
    .select({ id: goalRun.id })
    .from(goalRun)
    .where(and(eq(goalRun.workflowRunId, run.id), eq(goalRun.stepIndex, idx)))
    .limit(1);

  if (goalRunRows.length === 0) {
    return c.json({
      goal: idx,
      goalId: sr?.stepId ?? def?.id ?? null,
      stepsUsed: sr?.stepsUsed ?? 0,
      totalSteps: 0,
      steps: [],
      note: sr?.skipped
        ? `Skipped: ${sr.skipReason}`
        : "No goal run recorded for this goal",
    });
  }

  const grId = goalRunRows[0].id;

  // Pagination: ?from=3&to=8 (1-based step numbers)
  const fromStep = parseInt(c.req.query("from") ?? "0", 10);
  const toStep = parseInt(c.req.query("to") ?? "0", 10);

  const totalResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(stepTable)
    .where(eq(stepTable.goalRunId, grId));
  const totalSteps = Number(totalResult[0]?.count ?? 0);

  const conditions = [eq(stepTable.goalRunId, grId)];
  if (fromStep > 0) conditions.push(sql`${stepTable.stepNumber} >= ${fromStep}`);
  if (toStep > 0) conditions.push(sql`${stepTable.stepNumber} <= ${toStep}`);

  const steps = await db
    .select()
    .from(stepTable)
    .where(and(...conditions))
    .orderBy(asc(stepTable.stepNumber));

  const isLive = run.status === "running" && idx === (run.currentStep ?? stepResults.length);

  return c.json({
    goal: idx,
    goalId: sr?.stepId ?? def?.id ?? null,
    status: isLive ? "running" : (sr?.success ? "completed" : "failed"),
    stepsUsed: isLive ? totalSteps : (sr?.stepsUsed ?? 0),
    totalSteps,
    maxSteps: def?.maxSteps ?? null,
    ...(fromStep > 0 || toStep > 0 ? { from: fromStep || 1, to: toStep || totalSteps } : {}),
    steps: steps.map((s) => ({
      step: s.stepNumber,
      action: s.action,
      reasoning: s.reasoning,
      result: s.result,
      package: s.packageName,
      durationMs: s.durationMs,
    })),
  });
});

// ── GET .../goals/:goalId/steps/:step — single step with EVERYTHING ──
// Returns: action, reasoning, result, package, duration, AND the screen tree
v2.get("/devices/:deviceId/workflows/runs/:runId/goals/:goalId/steps/:step", async (c) => {
  const user = c.get("user");
  const run = await loadRun(c.req.param("runId"), user.id);
  if (!run) return c.json({ error: "Run not found" }, 404);

  const stepNum = parseInt(c.req.param("step"), 10);
  if (isNaN(stepNum)) return c.json({ error: "step must be a number" }, 400);

  const stepResults = (run.stepResults as StepResult[] | null) ?? [];
  const stepDefs = (run.steps as any[]) ?? [];
  const idx = findGoalIndex(stepResults, stepDefs, c.req.param("goalId"));
  if (idx === -1) return c.json({ error: `Goal "${c.req.param("goalId")}" not found` }, 404);

  const sr = stepResults[idx];

  // Get the agent step from DB via goal_run → step table
  let agentStepData: {
    action: any; reasoning: string | null; result: string | null;
    packageName: string | null; durationMs: number | null;
  } | null = null;

  const goalRunRows = await db
    .select({ id: goalRun.id })
    .from(goalRun)
    .where(and(eq(goalRun.workflowRunId, run.id), eq(goalRun.stepIndex, idx)))
    .limit(1);

  if (goalRunRows.length > 0) {
    const rows = await db
      .select()
      .from(stepTable)
      .where(and(eq(stepTable.goalRunId, goalRunRows[0].id), eq(stepTable.stepNumber, stepNum)))
      .limit(1);
    if (rows.length > 0) {
      agentStepData = {
        action: rows[0].action,
        reasoning: rows[0].reasoning,
        result: rows[0].result,
        packageName: rows[0].packageName,
        durationMs: rows[0].durationMs,
      };
    }
  }

  if (!agentStepData) {
    return c.json({ error: `Step ${stepNum} not found for this goal` }, 404);
  }

  // Get the screen observation for this step (if available)
  const observations = sr.observations ?? [];
  const obs = observations.find((o) => o.stepNumber === stepNum);

  return c.json({
    goal: idx,
    goalId: sr.stepId ?? stepDefs[idx]?.id ?? null,
    step: stepNum,
    // Agent decision
    action: agentStepData.action,
    reasoning: agentStepData.reasoning,
    result: agentStepData.result,
    package: agentStepData.packageName,
    durationMs: agentStepData.durationMs,
    // Screen state at this step (null if not captured)
    screen: obs ? formatScreen(obs) : null,
  });
});

// ── GET .../goals/:goalId/steps/:step/screen — screen tree only ──
v2.get("/devices/:deviceId/workflows/runs/:runId/goals/:goalId/steps/:step/screen", async (c) => {
  const user = c.get("user");
  const run = await loadRun(c.req.param("runId"), user.id);
  if (!run) return c.json({ error: "Run not found" }, 404);

  const stepNum = parseInt(c.req.param("step"), 10);
  if (isNaN(stepNum)) return c.json({ error: "step must be a number" }, 400);

  const stepResults = (run.stepResults as StepResult[] | null) ?? [];
  const stepDefs = (run.steps as any[]) ?? [];
  const idx = findGoalIndex(stepResults, stepDefs, c.req.param("goalId"));
  if (idx === -1) return c.json({ error: `Goal "${c.req.param("goalId")}" not found` }, 404);

  const sr = stepResults[idx];
  const observations = sr.observations ?? [];
  const obs = observations.find((o) => o.stepNumber === stepNum);

  if (!obs) {
    return c.json({
      error: `Screen not found for step ${stepNum}`,
      availableSteps: observations.map((o) => o.stepNumber),
    }, 404);
  }

  return c.json({
    goal: idx,
    step: stepNum,
    ...formatScreen(obs),
  });
});

// ── GET /v2/devices/:deviceId/screen — live screen from device ──
// Returns the current screen tree directly from the device (no run/goal context needed)
v2.get("/devices/:deviceId/screen", async (c) => {
  const deviceId = c.req.param("deviceId");
  try {
    const screenRes = (await sessions.sendCommand(deviceId, { type: "get_screen" }, 10_000)) as any;
    if (!screenRes?.elements) return c.json({ error: "No screen data from device" }, 502);
    return c.json(formatScreen({
      stepNumber: 0,
      elements: screenRes.elements,
      packageName: screenRes.packageName ?? undefined,
      activityName: screenRes.activityName ?? undefined,
    }));
  } catch (err) {
    return c.json({ error: `Failed to get screen: ${err instanceof Error ? err.message : String(err)}` }, 504);
  }
});

// ── GET .../goals/:goalId/eval — eval definition + judgment ──
v2.get("/devices/:deviceId/workflows/runs/:runId/goals/:goalId/eval", async (c) => {
  const user = c.get("user");
  const run = await loadRun(c.req.param("runId"), user.id);
  if (!run) return c.json({ error: "Run not found" }, 404);

  const stepResults = (run.stepResults as StepResult[] | null) ?? [];
  const stepDefs = (run.steps as any[]) ?? [];
  const idx = findGoalIndex(stepResults, stepDefs, c.req.param("goalId"));
  if (idx === -1) return c.json({ error: `Goal "${c.req.param("goalId")}" not found` }, 404);

  const sr = stepResults[idx];
  const def = stepDefs[idx];

  if (!def?.eval) {
    return c.json({ error: "No eval definition for this goal" }, 404);
  }

  return c.json({
    goal: idx,
    goalId: sr.stepId ?? def?.id ?? null,
    definition: def.eval,
    judgment: sr.evalJudgment
      ? {
          success: sr.evalJudgment.success,
          stateValues: sr.evalJudgment.stateValues,
          mismatches: sr.evalJudgment.mismatches,
          trackedOnly: sr.evalJudgment.trackedOnly,
        }
      : null,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
//  CACHED FLOWS
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /v2/devices/:deviceId/workflows/cached ──
v2.get("/devices/:deviceId/workflows/cached", async (c) => {
  const user = c.get("user");
  const deviceId = c.req.param("deviceId");

  const flows = await db
    .select({
      id: cachedFlow.id,
      goalKey: cachedFlow.goalKey,
      appPackage: cachedFlow.appPackage,
      rawSteps: cachedFlow.steps,
      successCount: cachedFlow.successCount,
      failCount: cachedFlow.failCount,
      createdAt: cachedFlow.createdAt,
      lastUsedAt: cachedFlow.lastUsedAt,
    })
    .from(cachedFlow)
    .where(and(eq(cachedFlow.userId, user.id), eq(cachedFlow.deviceId, deviceId), eq(cachedFlow.active, true)))
    .orderBy(desc(cachedFlow.createdAt));

  return c.json({
    flows: flows.map((f) => ({
      id: f.id,
      goalKey: f.goalKey,
      appPackage: f.appPackage,
      stepsCount: Array.isArray(f.rawSteps) ? (f.rawSteps as any[]).length : 0,
      successCount: f.successCount,
      failCount: f.failCount,
      createdAt: f.createdAt?.toISOString() ?? null,
      lastUsedAt: f.lastUsedAt?.toISOString() ?? null,
    })),
  });
});

// ── DELETE /v2/devices/:deviceId/workflows/cached/:id ──
v2.delete("/devices/:deviceId/workflows/cached/:id", async (c) => {
  const id = c.req.param("id");
  await db.update(cachedFlow).set({ active: false }).where(eq(cachedFlow.id, id));
  return c.json({ deactivated: id });
});

// ═══════════════════════════════════════════════════════════════════════════
//  RECIPES (new — replaces cached flows)
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /v2/devices/:deviceId/recipes ──
v2.get("/devices/:deviceId/recipes", async (c) => {
  const user = c.get("user");
  const deviceId = c.req.param("deviceId");

  const recipes = await db
    .select({
      id: recipe.id,
      goalKey: recipe.goalKey,
      appPackage: recipe.appPackage,
      rawSteps: recipe.steps,
      active: recipe.active,
      successCount: recipe.successCount,
      failCount: recipe.failCount,
      createdAt: recipe.createdAt,
      lastUsedAt: recipe.lastUsedAt,
    })
    .from(recipe)
    .where(and(eq(recipe.userId, user.id), eq(recipe.deviceId, deviceId), eq(recipe.active, true)))
    .orderBy(desc(recipe.createdAt));

  return c.json({
    recipes: recipes.map((r) => ({
      id: r.id,
      goalKey: r.goalKey,
      appPackage: r.appPackage,
      stepsCount: Array.isArray(r.rawSteps) ? (r.rawSteps as any[]).length : 0,
      successCount: r.successCount,
      failCount: r.failCount,
      createdAt: r.createdAt?.toISOString() ?? null,
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
    })),
  });
});

// ── DELETE /v2/devices/:deviceId/recipes/:id ──
v2.delete("/devices/:deviceId/recipes/:id", async (c) => {
  const id = c.req.param("id");
  await db.update(recipe).set({ active: false }).where(eq(recipe.id, id));
  return c.json({ deactivated: id });
});

export { v2 };
