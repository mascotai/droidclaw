/**
 * Goal template CRUD routes.
 *
 * GET    /goals              → list user's saved goals
 * POST   /goals              → create goal template
 * GET    /goals/:id          → get goal template
 * PUT    /goals/:id          → update goal template
 * DELETE /goals/:id          → delete goal template
 * POST   /goals/:id/run      → run a saved goal on a device
 */

import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { sessionMiddleware, type AuthEnv } from "../middleware/auth.js";
import { db } from "../db.js";
import { goal } from "../schema.js";
import { sessions } from "../ws/sessions.js";
import { enqueueRun } from "../temporal/client.js";

const goalCrud = new Hono<AuthEnv>();
goalCrud.use("*", sessionMiddleware);

// ── GET /goals — list user's saved goals ──
goalCrud.get("/", async (c) => {
  const user = c.get("user");
  const rows = await db
    .select()
    .from(goal)
    .where(eq(goal.userId, user.id))
    .orderBy(desc(goal.createdAt));

  return c.json(
    rows.map((g) => ({
      id: g.id,
      name: g.name,
      app: g.app,
      maxSteps: g.maxSteps,
      retries: g.retries,
      cache: g.cache,
      eval: g.eval,
      createdAt: g.createdAt.toISOString(),
      updatedAt: g.updatedAt.toISOString(),
    })),
  );
});

// ── POST /goals — create goal template ──
goalCrud.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    name: string;
    app?: string;
    maxSteps?: number;
    retries?: number;
    cache?: boolean;
    eval?: unknown;
  }>();

  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return c.json({ error: "name is required" }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date();

  await db.insert(goal).values({
    id,
    userId: user.id,
    name: body.name.trim(),
    app: body.app ?? null,
    maxSteps: body.maxSteps ?? 15,
    retries: body.retries ?? 0,
    cache: body.cache ?? true,
    eval: body.eval ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return c.json(
    {
      id,
      name: body.name.trim(),
      app: body.app ?? null,
      maxSteps: body.maxSteps ?? 15,
      retries: body.retries ?? 0,
      cache: body.cache ?? true,
      eval: body.eval ?? null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    201,
  );
});

// ── GET /goals/:id — get goal template ──
goalCrud.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const rows = await db
    .select()
    .from(goal)
    .where(and(eq(goal.id, id), eq(goal.userId, user.id)))
    .limit(1);

  if (rows.length === 0) return c.json({ error: "Goal not found" }, 404);

  const g = rows[0];
  return c.json({
    id: g.id,
    name: g.name,
    app: g.app,
    maxSteps: g.maxSteps,
    retries: g.retries,
    cache: g.cache,
    eval: g.eval,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  });
});

// ── PUT /goals/:id — update goal template ──
goalCrud.put("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const rows = await db
    .select()
    .from(goal)
    .where(and(eq(goal.id, id), eq(goal.userId, user.id)))
    .limit(1);

  if (rows.length === 0) return c.json({ error: "Goal not found" }, 404);

  const body = await c.req.json<{
    name?: string;
    app?: string | null;
    maxSteps?: number;
    retries?: number;
    cache?: boolean;
    eval?: unknown;
  }>();

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name.trim();
  if (body.app !== undefined) updates.app = body.app;
  if (body.maxSteps !== undefined) updates.maxSteps = body.maxSteps;
  if (body.retries !== undefined) updates.retries = body.retries;
  if (body.cache !== undefined) updates.cache = body.cache;
  if (body.eval !== undefined) updates.eval = body.eval;

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  await db
    .update(goal)
    .set(updates)
    .where(and(eq(goal.id, id), eq(goal.userId, user.id)));

  // Fetch updated row
  const updated = await db
    .select()
    .from(goal)
    .where(eq(goal.id, id))
    .limit(1);

  const g = updated[0];
  return c.json({
    id: g.id,
    name: g.name,
    app: g.app,
    maxSteps: g.maxSteps,
    retries: g.retries,
    cache: g.cache,
    eval: g.eval,
    createdAt: g.createdAt.toISOString(),
    updatedAt: g.updatedAt.toISOString(),
  });
});

// ── DELETE /goals/:id — delete goal template ──
goalCrud.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const rows = await db
    .select({ id: goal.id })
    .from(goal)
    .where(and(eq(goal.id, id), eq(goal.userId, user.id)))
    .limit(1);

  if (rows.length === 0) return c.json({ error: "Goal not found" }, 404);

  await db.delete(goal).where(and(eq(goal.id, id), eq(goal.userId, user.id)));

  return c.json({ deleted: id });
});

// ── POST /goals/:id/run — run a saved goal on a device ──
goalCrud.post("/:id/run", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");

  const body = await c.req.json<{
    deviceId: string;
    variables?: Record<string, string>;
  }>();

  if (!body.deviceId) {
    return c.json({ error: "deviceId is required" }, 400);
  }

  // Fetch the goal template
  const rows = await db
    .select()
    .from(goal)
    .where(and(eq(goal.id, id), eq(goal.userId, user.id)))
    .limit(1);

  if (rows.length === 0) return c.json({ error: "Goal not found" }, 404);

  const g = rows[0];

  // Resolve goal text: substitute variables if provided
  let goalText = g.name;
  if (body.variables) {
    for (const [key, value] of Object.entries(body.variables)) {
      goalText = goalText.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
    }
  }

  // Build a single-step workflow from the goal template
  const step = {
    id: g.id,
    goal: goalText,
    _goalTemplate: g.name,
    app: g.app ?? undefined,
    maxSteps: g.maxSteps ?? 15,
    retries: g.retries ?? 0,
    cache: g.cache ?? true,
    ...(g.eval ? { eval: g.eval } : {}),
  };

  // Resolve persistent device ID the same way v2 does
  const d = sessions.getDevice(body.deviceId) ?? sessions.getDeviceByPersistentId(body.deviceId);
  const persistentDeviceId = d?.persistentDeviceId ?? body.deviceId;

  const runId = crypto.randomUUID();

  await enqueueRun({
    deviceId: persistentDeviceId,
    payload: {
      runId,
      userId: user.id,
      name: g.name,
      type: "workflow",
      steps: [step],
      totalSteps: 1,
      resolvedValues: body.variables && Object.keys(body.variables).length > 0 ? body.variables : undefined,
    },
  });

  sessions.notifyDashboard(user.id, {
    type: "workflow_queued",
    runId,
    name: g.name,
    wfType: "workflow",
  } as any);

  return c.json({ runId, goalId: g.id, status: "queued" });
});

export { goalCrud };
