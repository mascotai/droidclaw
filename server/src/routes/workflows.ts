import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { sessionMiddleware, type AuthEnv } from "../middleware/auth.js";
import { sessions } from "../ws/sessions.js";
import { db } from "../db.js";
import { workflowRun } from "../schema.js";
import { activeSessions } from "../agent/active-sessions.js";
import {
  enqueueRun,
  cancelQueuedRun,
  getQueueState,
} from "../temporal/client.js";

const workflows = new Hono<AuthEnv>();

// ── Helper: resolve workflow variables ──
function resolveVariables(
  steps: any[],
  variables?: Record<string, { min: number; max: number }>
): any[] {
  if (!variables) return steps;
  const resolved: Record<string, number> = {};
  for (const [key, range] of Object.entries(variables)) {
    resolved[key] = Math.floor(Math.random() * (range.max - range.min + 1)) + range.min;
  }
  return steps.map(step => ({
    ...step,
    goal: step.goal.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) =>
      resolved[key] !== undefined ? String(resolved[key]) : `{{${key}}}`
    ),
  }));
}

// ── Helper: resolve persistent device ID ──
function resolvePersistentDeviceId(deviceId: string): string {
  const device = sessions.getDevice(deviceId) ?? sessions.getDeviceByPersistentId(deviceId);
  return device?.persistentDeviceId ?? deviceId;
}

// ── Run workflow/flow — enqueue via Temporal ──
workflows.post("/run", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    deviceId: string;
    name?: string;
    type?: "workflow" | "flow";
    steps: unknown[];
    variables?: Record<string, { min: number; max: number }>;
    appId?: string;
    llmModel?: string;
  }>();

  if (!body.deviceId || !body.steps || !Array.isArray(body.steps) || body.steps.length === 0) {
    return c.json({ error: "deviceId and non-empty steps array are required" }, 400);
  }

  const resolvedSteps = resolveVariables(body.steps, body.variables);
  const persistentDeviceId = resolvePersistentDeviceId(body.deviceId);

  const wfType = body.type ?? "workflow";
  const wfName = body.name ?? (wfType === "workflow" ? "Ad-hoc Workflow" : "Ad-hoc Flow");
  const runId = crypto.randomUUID();

  // Temporal IS the queue — no DB insert here, no 409.
  // The activity will create the DB row when execution starts.
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
    },
  });

  sessions.notifyDashboard(user.id, {
    type: "workflow_queued",
    runId,
    name: wfName,
    wfType,
  } as any);

  return c.json({ runId, status: "queued", type: wfType });
});

// ── Schedule a workflow/flow — enqueue via Temporal with scheduledFor ──
workflows.post("/schedule", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    deviceId: string;
    scheduledFor?: string;  // ISO-8601 datetime
    delay?: number;         // seconds from now (legacy compat)
    name?: string;
    type?: "workflow" | "flow";
    steps: unknown[];
    variables?: Record<string, { min: number; max: number }>;
    llmModel?: string;
  }>();

  if (!body.deviceId) {
    return c.json({ error: "deviceId is required" }, 400);
  }
  if (!body.scheduledFor && (!body.delay || body.delay <= 0)) {
    return c.json({ error: "scheduledFor (ISO datetime) or positive delay (seconds) is required" }, 400);
  }
  if (!body.steps || !Array.isArray(body.steps) || body.steps.length === 0) {
    return c.json({ error: "non-empty steps array is required" }, 400);
  }

  const resolvedSteps = resolveVariables(body.steps, body.variables);
  const persistentDeviceId = resolvePersistentDeviceId(body.deviceId);

  const scheduledFor = body.scheduledFor
    ? new Date(body.scheduledFor)
    : new Date(Date.now() + (body.delay ?? 0) * 1000);

  const wfType = body.type ?? "workflow";
  const wfName = body.name ?? (wfType === "workflow" ? "Scheduled Workflow" : "Scheduled Flow");
  const runId = crypto.randomUUID();

  // Temporal handles the durable timer — sleeps until scheduledFor, survives restarts
  await enqueueRun({
    deviceId: persistentDeviceId,
    payload: {
      runId,
      userId: user.id,
      name: wfName,
      type: wfType,
      steps: resolvedSteps,
      totalSteps: resolvedSteps.length,
      scheduledFor: scheduledFor.toISOString(),
      llmModel: body.llmModel,
    },
  });

  sessions.notifyDashboard(user.id, {
    type: "workflow_scheduled",
    runId,
    name: wfName,
    scheduledFor: scheduledFor.toISOString(),
  } as any);

  return c.json({ runId, status: "scheduled", scheduledFor: scheduledFor.toISOString() });
});

// ── Stop a running workflow/flow or cancel a queued one ──
workflows.post("/stop", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ deviceId?: string; runId?: string }>();

  // Cancel a specific queued run by runId
  if (body.runId && body.deviceId) {
    const persistentDeviceId = resolvePersistentDeviceId(body.deviceId);
    await cancelQueuedRun(persistentDeviceId, body.runId);
    // Also check if it's currently running and abort it
  }

  // Abort the currently running workflow on a device
  if (body.deviceId) {
    const device = sessions.getDevice(body.deviceId) ?? sessions.getDeviceByPersistentId(body.deviceId);
    if (!device) return c.json({ error: "device not connected" }, 404);
    if (device.userId !== user.id) return c.json({ error: "device does not belong to you" }, 403);

    const trackingKey = device.persistentDeviceId ?? device.deviceId;
    const active = activeSessions.get(trackingKey);
    if (active) {
      active.deviceDisconnected = false; // user-initiated stop
      active.abort.abort();
      console.log(`[Workflow] Stop requested for device ${body.deviceId}`);
      return c.json({ status: "stopping" });
    }

    // If no active session but we have a runId, it was cancelled from the queue
    if (body.runId) {
      return c.json({ status: "cancelled" });
    }

    return c.json({ error: "No agent running on this device" }, 404);
  }

  return c.json({ error: "deviceId is required" }, 400);
});

// ── Queue visibility: see what's queued + running for a device ──
workflows.get("/queue/:deviceId", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const deviceId = c.req.param("deviceId");

  // Queued items from Temporal workflow memory
  const queued = await getQueueState(deviceId);

  // Currently running item from DB
  const running = await db
    .select()
    .from(workflowRun)
    .where(
      and(
        eq(workflowRun.deviceId, deviceId),
        eq(workflowRun.userId, user.id),
        eq(workflowRun.status, "running")
      )
    )
    .limit(1);

  return c.json({
    running: running[0] ?? null,
    queued: queued.map((q) => ({
      runId: q.runId,
      name: q.name,
      type: q.type,
      totalSteps: q.totalSteps,
      scheduledFor: q.scheduledFor ?? null,
    })),
  });
});

// ── List completed/failed runs for a device (execution log) ──
workflows.get("/runs/:deviceId", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const deviceId = c.req.param("deviceId");
  const rows = await db
    .select()
    .from(workflowRun)
    .where(and(eq(workflowRun.userId, user.id), eq(workflowRun.deviceId, deviceId)))
    .orderBy(desc(workflowRun.startedAt))
    .limit(50);
  return c.json(rows);
});

// ── Get a single run by ID ──
workflows.get("/runs/:deviceId/:runId", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const runId = c.req.param("runId");
  const rows = await db
    .select()
    .from(workflowRun)
    .where(and(eq(workflowRun.id, runId), eq(workflowRun.userId, user.id)))
    .limit(1);
  if (rows.length === 0) return c.json({ error: "Run not found" }, 404);
  return c.json(rows[0]);
});

// ── Cancel a queued run by ID ──
workflows.delete("/runs/:id/schedule", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const runId = c.req.param("id");

  // Check if it exists in DB (might have already started)
  const rows = await db
    .select()
    .from(workflowRun)
    .where(eq(workflowRun.id, runId))
    .limit(1);

  if (rows.length > 0) {
    const run = rows[0];
    if (run.userId !== user.id) return c.json({ error: "Not your run" }, 403);

    // If it's running, abort it
    if (run.status === "running") {
      const device = sessions.getDeviceByPersistentId(run.deviceId);
      if (device) {
        const trackingKey = device.persistentDeviceId ?? device.deviceId;
        const active = activeSessions.get(trackingKey);
        if (active) {
          active.deviceDisconnected = false;
          active.abort.abort();
        }
      }
      return c.json({ status: "stopping" });
    }

    // Update DB status if already there
    await db
      .update(workflowRun)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(eq(workflowRun.id, runId));
  }

  // Remove from Temporal queue (searches all device queues — we use deviceId from DB if available)
  const deviceId = rows[0]?.deviceId;
  if (deviceId) {
    await cancelQueuedRun(deviceId, runId);
  }

  sessions.notifyDashboard(user.id, {
    type: "workflow_cancelled",
    runId,
  } as any);

  return c.json({ status: "cancelled" });
});

export { workflows };
