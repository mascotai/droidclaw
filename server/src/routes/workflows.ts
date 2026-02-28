import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { Receiver } from "@upstash/qstash";
import { sessionMiddleware, type AuthEnv } from "../middleware/auth.js";
import { sessions } from "../ws/sessions.js";
import { db } from "../db.js";
import { env } from "../env.js";
import { workflow, workflowRun, llmConfig as llmConfigTable } from "../schema.js";
import { activeSessions } from "../agent/active-sessions.js";
import { runWorkflowServer, type WorkflowStep } from "../agent/workflow-runner.js";
import { runFlowServer } from "../agent/flow-runner.js";
import type { LLMConfig } from "../agent/llm.js";

const workflows = new Hono<AuthEnv>();

// ── Helper: resolve LLM config ──
async function resolveLLMConfig(userId: string, body?: { llmApiKey?: string; llmProvider?: string; llmModel?: string }): Promise<LLMConfig | null> {
  if (body?.llmApiKey) {
    return {
      provider: body.llmProvider ?? process.env.LLM_PROVIDER ?? "openai",
      apiKey: body.llmApiKey,
      model: body.llmModel,
    };
  }
  const configs = await db.select().from(llmConfigTable).where(eq(llmConfigTable.userId, userId)).limit(1);
  if (configs.length > 0) {
    const cfg = configs[0];
    return { provider: cfg.provider, apiKey: cfg.apiKey, model: body?.llmModel ?? cfg.model ?? undefined };
  }
  if (process.env.LLM_API_KEY) {
    return { provider: process.env.LLM_PROVIDER ?? "openai", apiKey: process.env.LLM_API_KEY, model: body?.llmModel };
  }
  return null;
}

// ── Helper: resolve device ──
function resolveDevice(deviceId: string, userId: string) {
  const device = sessions.getDevice(deviceId) ?? sessions.getDeviceByPersistentId(deviceId);
  if (!device) return { error: "device not connected", status: 404 as const };
  if (device.userId !== userId) return { error: "device does not belong to you", status: 403 as const };
  return { device };
}

// ── CRUD: Save template ──
workflows.post("/", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    name: string;
    description?: string;
    type?: "workflow" | "flow";
    steps: unknown[];
    appId?: string;
  }>();

  if (!body.name || !body.steps || !Array.isArray(body.steps) || body.steps.length === 0) {
    return c.json({ error: "name and non-empty steps array are required" }, 400);
  }

  const id = crypto.randomUUID();
  await db.insert(workflow).values({
    id,
    userId: user.id,
    name: body.name,
    description: body.description ?? null,
    type: body.type ?? "workflow",
    steps: body.steps,
    appId: body.appId ?? null,
  });

  return c.json({ id, name: body.name, type: body.type ?? "workflow" }, 201);
});

// ── CRUD: List templates ──
workflows.get("/", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const typeFilter = c.req.query("type");

  let query = db.select().from(workflow).where(eq(workflow.userId, user.id)).orderBy(desc(workflow.createdAt));
  const rows = await query;

  const filtered = typeFilter ? rows.filter((r) => r.type === typeFilter) : rows;
  return c.json(filtered);
});

// ── CRUD: Get single template ──
workflows.get("/:id", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const rows = await db.select().from(workflow).where(eq(workflow.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  if (rows[0].userId !== user.id) return c.json({ error: "Not your workflow" }, 403);
  return c.json(rows[0]);
});

// ── CRUD: Update template ──
workflows.put("/:id", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const rows = await db.select().from(workflow).where(eq(workflow.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  if (rows[0].userId !== user.id) return c.json({ error: "Not your workflow" }, 403);

  const body = await c.req.json<{
    name?: string;
    description?: string;
    steps?: unknown[];
    appId?: string;
  }>();

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.steps !== undefined) updates.steps = body.steps;
  if (body.appId !== undefined) updates.appId = body.appId;

  if (Object.keys(updates).length > 0) {
    await db.update(workflow).set(updates).where(eq(workflow.id, id));
  }

  return c.json({ id, ...updates });
});

// ── CRUD: Delete template ──
workflows.delete("/:id", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const rows = await db.select().from(workflow).where(eq(workflow.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  if (rows[0].userId !== user.id) return c.json({ error: "Not your workflow" }, 403);
  await db.delete(workflow).where(eq(workflow.id, id));
  return c.json({ status: "deleted" });
});

// ── Run saved workflow/flow ──
workflows.post("/:id/run", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{ deviceId: string; llmApiKey?: string; llmProvider?: string; llmModel?: string }>();

  if (!body.deviceId) return c.json({ error: "deviceId is required" }, 400);

  const rows = await db.select().from(workflow).where(eq(workflow.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: "Workflow not found" }, 404);
  if (rows[0].userId !== user.id) return c.json({ error: "Not your workflow" }, 403);

  const wf = rows[0];
  const result = resolveDevice(body.deviceId, user.id);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  const { device } = result;

  const trackingKey = device.persistentDeviceId ?? device.deviceId;
  if (activeSessions.has(trackingKey)) {
    return c.json({ error: "Agent already running on this device" }, 409);
  }

  if (wf.type === "workflow") {
    const llmCfg = await resolveLLMConfig(user.id, body);
    if (!llmCfg) return c.json({ error: "No LLM provider configured" }, 400);

    const runId = crypto.randomUUID();
    const steps = wf.steps as WorkflowStep[];
    const abort = new AbortController();

    await db.insert(workflowRun).values({
      id: runId,
      workflowId: wf.id,
      userId: user.id,
      deviceId: device.persistentDeviceId ?? device.deviceId,
      name: wf.name,
      type: "workflow",
      status: "running",
      totalSteps: steps.length,
    });

    activeSessions.set(trackingKey, { sessionId: runId, goal: `Workflow: ${wf.name}`, abort });

    runWorkflowServer({
      runId,
      deviceId: device.deviceId,
      persistentDeviceId: device.persistentDeviceId,
      userId: user.id,
      name: wf.name,
      steps,
      llmConfig: llmCfg,
      signal: abort.signal,
    }).finally(() => activeSessions.delete(trackingKey));

    return c.json({ runId, status: "started", type: "workflow" });
  } else {
    // Flow
    const runId = crypto.randomUUID();
    const steps = wf.steps as any[];
    const abort = new AbortController();

    await db.insert(workflowRun).values({
      id: runId,
      workflowId: wf.id,
      userId: user.id,
      deviceId: device.persistentDeviceId ?? device.deviceId,
      name: wf.name,
      type: "flow",
      status: "running",
      totalSteps: steps.length,
    });

    activeSessions.set(trackingKey, { sessionId: runId, goal: `Flow: ${wf.name}`, abort });

    runFlowServer({
      runId,
      deviceId: device.deviceId,
      persistentDeviceId: device.persistentDeviceId,
      userId: user.id,
      name: wf.name,
      steps,
      appId: wf.appId ?? undefined,
      signal: abort.signal,
    }).finally(() => activeSessions.delete(trackingKey));

    return c.json({ runId, status: "started", type: "flow" });
  }
});

// ── Run ad-hoc workflow/flow (not saved) ──
workflows.post("/run", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    deviceId: string;
    name?: string;
    type?: "workflow" | "flow";
    steps: unknown[];
    appId?: string;
    llmApiKey?: string;
    llmProvider?: string;
    llmModel?: string;
  }>();

  if (!body.deviceId || !body.steps || !Array.isArray(body.steps) || body.steps.length === 0) {
    return c.json({ error: "deviceId and non-empty steps array are required" }, 400);
  }

  const result = resolveDevice(body.deviceId, user.id);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  const { device } = result;

  const trackingKey = device.persistentDeviceId ?? device.deviceId;
  if (activeSessions.has(trackingKey)) {
    return c.json({ error: "Agent already running on this device" }, 409);
  }

  const wfType = body.type ?? "workflow";
  const wfName = body.name ?? (wfType === "workflow" ? "Ad-hoc Workflow" : "Ad-hoc Flow");
  const runId = crypto.randomUUID();
  const abort = new AbortController();

  await db.insert(workflowRun).values({
    id: runId,
    userId: user.id,
    deviceId: device.persistentDeviceId ?? device.deviceId,
    name: wfName,
    type: wfType,
    status: "running",
    totalSteps: body.steps.length,
  });

  activeSessions.set(trackingKey, { sessionId: runId, goal: `${wfType}: ${wfName}`, abort });

  if (wfType === "workflow") {
    const llmCfg = await resolveLLMConfig(user.id, body);
    if (!llmCfg) {
      activeSessions.delete(trackingKey);
      return c.json({ error: "No LLM provider configured" }, 400);
    }

    runWorkflowServer({
      runId,
      deviceId: device.deviceId,
      persistentDeviceId: device.persistentDeviceId,
      userId: user.id,
      name: wfName,
      steps: body.steps as WorkflowStep[],
      llmConfig: llmCfg,
      signal: abort.signal,
    }).finally(() => activeSessions.delete(trackingKey));
  } else {
    runFlowServer({
      runId,
      deviceId: device.deviceId,
      persistentDeviceId: device.persistentDeviceId,
      userId: user.id,
      name: wfName,
      steps: body.steps as any[],
      appId: body.appId,
      signal: abort.signal,
    }).finally(() => activeSessions.delete(trackingKey));
  }

  return c.json({ runId, status: "started", type: wfType });
});

// ── Stop a running workflow/flow ──
workflows.post("/stop", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ deviceId: string }>();
  if (!body.deviceId) return c.json({ error: "deviceId is required" }, 400);

  const result = resolveDevice(body.deviceId, user.id);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  const { device } = result;

  const trackingKey = device.persistentDeviceId ?? device.deviceId;
  const active = activeSessions.get(trackingKey);
  if (!active) return c.json({ error: "No agent running on this device" }, 404);

  active.abort.abort();
  console.log(`[Workflow] Stop requested for device ${body.deviceId}`);
  return c.json({ status: "stopping" });
});

// ── List runs for a device ──
workflows.get("/runs/:deviceId", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const deviceId = c.req.param("deviceId");
  const rows = await db.select().from(workflowRun)
    .where(and(eq(workflowRun.userId, user.id), eq(workflowRun.deviceId, deviceId)))
    .orderBy(desc(workflowRun.startedAt))
    .limit(50);
  return c.json(rows);
});

// ── Schedule a saved workflow/flow ──
workflows.post("/:id/schedule", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const body = await c.req.json<{ deviceId: string; delay: number }>();

  if (!body.deviceId || !body.delay || body.delay <= 0) {
    return c.json({ error: "deviceId and positive delay (seconds) are required" }, 400);
  }

  const rows = await db.select().from(workflow).where(eq(workflow.id, id)).limit(1);
  if (rows.length === 0) return c.json({ error: "Workflow not found" }, 404);
  if (rows[0].userId !== user.id) return c.json({ error: "Not your workflow" }, 403);

  const wf = rows[0];

  const { getQStashClient } = await import("../qstash.js");
  const qstash = getQStashClient();
  if (!qstash) {
    return c.json({ error: "Scheduling requires QStash. Configure QSTASH_TOKEN to enable scheduling." }, 400);
  }

  const runId = crypto.randomUUID();
  const scheduledFor = new Date(Date.now() + body.delay * 1000);

  // Resolve persistent device ID
  const device = sessions.getDevice(body.deviceId) ?? sessions.getDeviceByPersistentId(body.deviceId);
  const persistentDeviceId = device?.persistentDeviceId ?? body.deviceId;

  await db.insert(workflowRun).values({
    id: runId,
    workflowId: wf.id,
    userId: user.id,
    deviceId: persistentDeviceId,
    name: wf.name,
    type: wf.type,
    status: "scheduled",
    totalSteps: (wf.steps as unknown[]).length,
    scheduledFor,
  });

  const callbackUrl = `${env.SERVER_PUBLIC_URL}/workflows/execute`;
  const qstashResult = await qstash.publishJSON({
    url: callbackUrl,
    body: {
      runId,
      workflowId: wf.id,
      deviceId: persistentDeviceId,
      userId: user.id,
      type: wf.type,
    },
    delay: body.delay,
  });

  if (qstashResult.messageId) {
    await db.update(workflowRun).set({ qstashMessageId: qstashResult.messageId }).where(eq(workflowRun.id, runId));
  }

  sessions.notifyDashboard(user.id, {
    type: "workflow_scheduled",
    runId,
    name: wf.name,
    scheduledFor: scheduledFor.toISOString(),
  } as any);

  return c.json({ runId, status: "scheduled", scheduledFor: scheduledFor.toISOString() });
});

// ── QStash callback: execute scheduled workflow/flow ──
workflows.post("/execute", async (c) => {
  const body = await c.req.text();

  if (env.QSTASH_CURRENT_SIGNING_KEY) {
    const receiver = new Receiver({
      currentSigningKey: env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: env.QSTASH_NEXT_SIGNING_KEY,
    });
    const signature = c.req.header("upstash-signature") ?? "";
    try {
      await receiver.verify({ signature, body });
    } catch {
      return c.json({ error: "Invalid QStash signature" }, 401);
    }
  }

  const payload = JSON.parse(body) as {
    runId: string;
    workflowId: string;
    deviceId: string;
    userId: string;
    type: string;
  };

  const { runId, workflowId, deviceId, userId, type: wfType } = payload;

  // Check if run was cancelled
  const [existing] = await db.select().from(workflowRun).where(eq(workflowRun.id, runId)).limit(1);
  if (!existing) return c.json({ error: "Run not found" }, 200);
  if (existing.status === "cancelled") return c.json({ status: "cancelled" }, 200);

  // Check device is online
  const device = sessions.getDeviceByPersistentId(deviceId);
  if (!device) return c.json({ error: "Device not connected" }, 500);

  // Load workflow template
  const [wf] = await db.select().from(workflow).where(eq(workflow.id, workflowId)).limit(1);
  if (!wf) {
    await db.update(workflowRun).set({ status: "failed", completedAt: new Date() }).where(eq(workflowRun.id, runId));
    return c.json({ error: "Workflow template deleted" }, 200);
  }

  const trackingKey = device.persistentDeviceId ?? device.deviceId;
  if (activeSessions.has(trackingKey)) return c.json({ error: "Device busy" }, 500);

  await db.update(workflowRun).set({ status: "running", startedAt: new Date() }).where(eq(workflowRun.id, runId));

  const abort = new AbortController();
  activeSessions.set(trackingKey, { sessionId: runId, goal: `Scheduled ${wfType}: ${wf.name}`, abort });

  if (wfType === "workflow") {
    const llmCfg = await resolveLLMConfig(userId);
    if (!llmCfg) {
      activeSessions.delete(trackingKey);
      await db.update(workflowRun).set({ status: "failed", completedAt: new Date() }).where(eq(workflowRun.id, runId));
      return c.json({ error: "No LLM config" }, 200);
    }

    runWorkflowServer({
      runId,
      deviceId: device.deviceId,
      persistentDeviceId: device.persistentDeviceId,
      userId,
      name: wf.name,
      steps: wf.steps as WorkflowStep[],
      llmConfig: llmCfg,
      signal: abort.signal,
    }).finally(() => activeSessions.delete(trackingKey));
  } else {
    runFlowServer({
      runId,
      deviceId: device.deviceId,
      persistentDeviceId: device.persistentDeviceId,
      userId,
      name: wf.name,
      steps: wf.steps as any[],
      appId: wf.appId ?? undefined,
      signal: abort.signal,
    }).finally(() => activeSessions.delete(trackingKey));
  }

  return c.json({ status: "started", runId });
});

// ── Cancel a scheduled run ──
workflows.delete("/runs/:id/schedule", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const runId = c.req.param("id");

  const rows = await db.select().from(workflowRun).where(eq(workflowRun.id, runId)).limit(1);
  if (rows.length === 0) return c.json({ error: "Run not found" }, 404);
  const run = rows[0];
  if (run.userId !== user.id) return c.json({ error: "Not your run" }, 403);
  if (run.status !== "scheduled") return c.json({ error: "Run is not scheduled" }, 400);

  if (run.qstashMessageId) {
    const { getQStashClient } = await import("../qstash.js");
    const qstash = getQStashClient();
    if (qstash) {
      try { await qstash.messages.delete(run.qstashMessageId); } catch (err) {
        console.warn(`[Workflows] QStash cancel failed: ${err}`);
      }
    }
  }

  await db.update(workflowRun).set({ status: "cancelled", completedAt: new Date() }).where(eq(workflowRun.id, runId));

  sessions.notifyDashboard(user.id, {
    type: "workflow_cancelled",
    runId,
  } as any);

  return c.json({ status: "cancelled" });
});

export { workflows };
