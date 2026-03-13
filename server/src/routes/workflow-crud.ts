/**
 * Workflow template CRUD routes.
 *
 * GET    /workflows              → list user's saved workflows
 * POST   /workflows              → create workflow template
 * GET    /workflows/:id          → get workflow template
 * PUT    /workflows/:id          → update workflow template
 * DELETE /workflows/:id          → delete workflow template
 * POST   /workflows/:id/run      → run a saved workflow on a device
 */

import { Hono } from "hono";
import { eq, and, desc, inArray } from "drizzle-orm";
import { sessionMiddleware, type AuthEnv } from "../middleware/auth.js";
import { db } from "../db.js";
import { workflow, goal } from "../schema.js";
import { sessions } from "../ws/sessions.js";
import { enqueueRun } from "../temporal/client.js";

const workflowCrud = new Hono<AuthEnv>();
workflowCrud.use("*", sessionMiddleware);

// ── Type for workflow step entries ──
interface WorkflowStep {
  goalId?: string;
  goal?: string;
  app?: string;
  maxSteps?: number;
  retries?: number;
  cache?: boolean;
  eval?: unknown;
}

// ── GET /workflows — list user's saved workflows ──
workflowCrud.get("/", async (c) => {
  const user = c.get("user");
  const rows = await db
    .select()
    .from(workflow)
    .where(eq(workflow.userId, user.id))
    .orderBy(desc(workflow.createdAt));

  return c.json(
    rows.map((w) => ({
      id: w.id,
      name: w.name,
      steps: w.steps,
      variables: w.variables,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
    })),
  );
});

// ── POST /workflows — create workflow template ──
workflowCrud.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    name: string;
    steps: WorkflowStep[];
    variables?: Record<string, string>;
  }>();

  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return c.json({ error: "name is required" }, 400);
  }

  if (!body.steps || !Array.isArray(body.steps) || body.steps.length === 0) {
    return c.json({ error: "Non-empty steps array is required" }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(workflow).values({
    id,
    userId: user.id,
    name: body.name.trim(),
    steps: body.steps,
    variables: body.variables ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return c.json(
    {
      id,
      name: body.name.trim(),
      steps: body.steps,
      variables: body.variables ?? null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    201,
  );
});

// ── GET /workflows/:id — get workflow template ──
workflowCrud.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const rows = await db
    .select()
    .from(workflow)
    .where(and(eq(workflow.id, id), eq(workflow.userId, user.id)))
    .limit(1);

  if (rows.length === 0) return c.json({ error: "Workflow not found" }, 404);

  const w = rows[0];
  return c.json({
    id: w.id,
    name: w.name,
    steps: w.steps,
    variables: w.variables,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  });
});

// ── PUT /workflows/:id — update workflow template ──
workflowCrud.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const rows = await db
    .select()
    .from(workflow)
    .where(and(eq(workflow.id, id), eq(workflow.userId, user.id)))
    .limit(1);

  if (rows.length === 0) return c.json({ error: "Workflow not found" }, 404);

  const body = await c.req.json<{
    name?: string;
    steps?: WorkflowStep[];
    variables?: Record<string, string> | null;
  }>();

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.steps !== undefined) updates.steps = body.steps;
  if (body.variables !== undefined) updates.variables = body.variables;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  await db
    .update(workflow)
    .set(updates)
    .where(and(eq(workflow.id, id), eq(workflow.userId, user.id)));

  // Fetch updated row
  const updated = await db
    .select()
    .from(workflow)
    .where(eq(workflow.id, id))
    .limit(1);

  const w = updated[0];
  return c.json({
    id: w.id,
    name: w.name,
    steps: w.steps,
    variables: w.variables,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  });
});

// ── DELETE /workflows/:id — delete workflow template ──
workflowCrud.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const rows = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(and(eq(workflow.id, id), eq(workflow.userId, user.id)))
    .limit(1);

  if (rows.length === 0) return c.json({ error: "Workflow not found" }, 404);

  await db.delete(workflow).where(and(eq(workflow.id, id), eq(workflow.userId, user.id)));

  return c.json({ deleted: id });
});

// ── POST /workflows/:id/run — run a saved workflow on a device ──
workflowCrud.post("/:id/run", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const body = await c.req.json<{
    deviceId: string;
    variables?: Record<string, string>;
  }>();

  if (!body.deviceId) {
    return c.json({ error: "deviceId is required" }, 400);
  }

  // Fetch the workflow template
  const rows = await db
    .select()
    .from(workflow)
    .where(and(eq(workflow.id, id), eq(workflow.userId, user.id)))
    .limit(1);

  if (rows.length === 0) return c.json({ error: "Workflow not found" }, 404);

  const w = rows[0];
  const templateSteps = w.steps as WorkflowStep[];

  // Merge provided variables with template defaults
  const templateVars = (w.variables as Record<string, string> | null) ?? {};
  const mergedVars = { ...templateVars, ...body.variables };

  // Collect goalIds that need to be resolved
  const goalIds = templateSteps
    .map((s) => s.goalId)
    .filter((gid): gid is string => !!gid);

  // Batch-fetch referenced goals
  let goalsMap: Map<string, typeof goalRows[0]> = new Map();
  const goalRows = goalIds.length > 0
    ? await db
        .select()
        .from(goal)
        .where(and(eq(goal.userId, user.id), inArray(goal.id, goalIds)))
    : [];
  for (const g of goalRows) {
    goalsMap.set(g.id, g);
  }

  // Build resolved steps array
  const resolvedSteps = templateSteps.map((templateStep) => {
    let goalText: string;
    let app: string | undefined;
    let maxSteps: number;
    let retries: number;
    let cache: boolean;
    let evalDef: unknown | undefined;
    let stepId: string | undefined;

    if (templateStep.goalId) {
      // Resolve from goal table
      const g = goalsMap.get(templateStep.goalId);
      if (!g) {
        throw new Error(`Referenced goal "${templateStep.goalId}" not found`);
      }
      goalText = g.name;
      app = templateStep.app ?? g.app ?? undefined;
      maxSteps = templateStep.maxSteps ?? g.maxSteps ?? 15;
      retries = templateStep.retries ?? g.retries ?? 0;
      cache = templateStep.cache ?? g.cache ?? true;
      evalDef = templateStep.eval ?? g.eval ?? undefined;
      stepId = g.id;
    } else {
      // Inline goal
      goalText = templateStep.goal ?? "";
      app = templateStep.app;
      maxSteps = templateStep.maxSteps ?? 15;
      retries = templateStep.retries ?? 0;
      cache = templateStep.cache ?? true;
      evalDef = templateStep.eval;
    }

    // Resolve {{variables}} in goal text
    const goalTemplate = goalText;
    if (mergedVars && Object.keys(mergedVars).length > 0) {
      for (const [key, value] of Object.entries(mergedVars)) {
        goalText = goalText.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
      }
    }

    return {
      ...(stepId ? { id: stepId } : {}),
      goal: goalText,
      _goalTemplate: goalTemplate,
      app,
      maxSteps,
      retries,
      cache,
      ...(evalDef ? { eval: evalDef } : {}),
    };
  });

  // Resolve persistent device ID
  const d = sessions.getDevice(body.deviceId) ?? sessions.getDeviceByPersistentId(body.deviceId);
  const persistentDeviceId = d?.persistentDeviceId ?? body.deviceId;

  const runId = crypto.randomUUID();
  const resolvedValues = Object.keys(mergedVars).length > 0 ? mergedVars : undefined;

  await enqueueRun({
    deviceId: persistentDeviceId,
    payload: {
      runId,
      userId: user.id,
      name: w.name,
      type: "workflow",
      steps: resolvedSteps,
      totalSteps: resolvedSteps.length,
      resolvedValues,
    },
  });

  sessions.notifyDashboard(user.id, {
    type: "workflow_queued",
    runId,
    name: w.name,
    wfType: "workflow",
  } as any);

  return c.json({ runId, workflowId: w.id, status: "queued", totalSteps: resolvedSteps.length });
});

export { workflowCrud };
