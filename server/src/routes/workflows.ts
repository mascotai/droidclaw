import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { Receiver } from "@upstash/qstash";
import { sessionMiddleware, type AuthEnv } from "../middleware/auth.js";
import { sessions } from "../ws/sessions.js";
import { db } from "../db.js";
import { env } from "../env.js";
import { workflowRun, llmConfig as llmConfigTable } from "../schema.js";
import { activeSessions } from "../agent/active-sessions.js";
import { runWorkflowServer, type WorkflowStep } from "../agent/workflow-runner.js";
import { runFlowServer } from "../agent/flow-runner.js";
import type { LLMConfig } from "../agent/llm.js";

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

// ── Run workflow/flow (send full JSON) ──
workflows.post("/run", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    deviceId: string;
    name?: string;
    type?: "workflow" | "flow";
    steps: unknown[];
    variables?: Record<string, { min: number; max: number }>;
    appId?: string;
    llmApiKey?: string;
    llmProvider?: string;
    llmModel?: string;
  }>();

  if (!body.deviceId || !body.steps || !Array.isArray(body.steps) || body.steps.length === 0) {
    return c.json({ error: "deviceId and non-empty steps array are required" }, 400);
  }

  const resolvedSteps = resolveVariables(body.steps, body.variables);

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
    steps: resolvedSteps,
    status: "running",
    totalSteps: resolvedSteps.length,
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
      steps: resolvedSteps as WorkflowStep[],
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
      steps: resolvedSteps as any[],
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

// ── Get a single run by ID ──
workflows.get("/runs/:deviceId/:runId", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const runId = c.req.param("runId");
  const rows = await db.select().from(workflowRun)
    .where(and(eq(workflowRun.id, runId), eq(workflowRun.userId, user.id)))
    .limit(1);
  if (rows.length === 0) return c.json({ error: "Run not found" }, 404);
  return c.json(rows[0]);
});

// ── Schedule a workflow/flow (send full JSON) ──
workflows.post("/schedule", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    deviceId: string;
    delay: number;
    name?: string;
    type?: "workflow" | "flow";
    steps: unknown[];
    variables?: Record<string, { min: number; max: number }>;
    appId?: string;
  }>();

  if (!body.deviceId || !body.delay || body.delay <= 0) {
    return c.json({ error: "deviceId and positive delay (seconds) are required" }, 400);
  }
  if (!body.steps || !Array.isArray(body.steps) || body.steps.length === 0) {
    return c.json({ error: "non-empty steps array is required" }, 400);
  }

  const { getQStashClient } = await import("../qstash.js");
  const qstash = getQStashClient();
  if (!qstash) {
    return c.json({ error: "Scheduling requires QStash. Configure QSTASH_TOKEN to enable scheduling." }, 400);
  }

  const wfType = body.type ?? "workflow";
  const wfName = body.name ?? (wfType === "workflow" ? "Scheduled Workflow" : "Scheduled Flow");
  const runId = crypto.randomUUID();
  const scheduledFor = new Date(Date.now() + body.delay * 1000);

  // Resolve persistent device ID
  const device = sessions.getDevice(body.deviceId) ?? sessions.getDeviceByPersistentId(body.deviceId);
  const persistentDeviceId = device?.persistentDeviceId ?? body.deviceId;

  await db.insert(workflowRun).values({
    id: runId,
    userId: user.id,
    deviceId: persistentDeviceId,
    name: wfName,
    type: wfType,
    steps: body.steps,
    status: "scheduled",
    totalSteps: body.steps.length,
    scheduledFor,
  });

  const callbackUrl = `${env.SERVER_PUBLIC_URL}/workflows/execute`;
  const qstashResult = await qstash.publishJSON({
    url: callbackUrl,
    body: {
      runId,
      deviceId: persistentDeviceId,
      userId: user.id,
      type: wfType,
      variables: body.variables,
    },
    delay: body.delay,
  });

  if (qstashResult.messageId) {
    await db.update(workflowRun).set({ qstashMessageId: qstashResult.messageId }).where(eq(workflowRun.id, runId));
  }

  sessions.notifyDashboard(user.id, {
    type: "workflow_scheduled",
    runId,
    name: wfName,
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
    deviceId: string;
    userId: string;
    type: string;
    variables?: Record<string, { min: number; max: number }>;
  };

  const { runId, deviceId, userId, type: wfType, variables } = payload;

  // Load the run (steps are stored in the row)
  const [run] = await db.select().from(workflowRun).where(eq(workflowRun.id, runId)).limit(1);
  if (!run) return c.json({ error: "Run not found" }, 200);
  if (run.status === "cancelled") return c.json({ status: "cancelled" }, 200);

  // Check device is online
  const device = sessions.getDeviceByPersistentId(deviceId);
  if (!device) return c.json({ error: "Device not connected" }, 500);

  const trackingKey = device.persistentDeviceId ?? device.deviceId;
  if (activeSessions.has(trackingKey)) return c.json({ error: "Device busy" }, 500);

  await db.update(workflowRun).set({ status: "running", startedAt: new Date() }).where(eq(workflowRun.id, runId));

  const resolvedSteps = resolveVariables(run.steps as any[], variables);
  const abort = new AbortController();
  activeSessions.set(trackingKey, { sessionId: runId, goal: `Scheduled ${wfType}: ${run.name}`, abort });

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
      name: run.name,
      steps: resolvedSteps as WorkflowStep[],
      llmConfig: llmCfg,
      signal: abort.signal,
    }).finally(() => activeSessions.delete(trackingKey));
  } else {
    runFlowServer({
      runId,
      deviceId: device.deviceId,
      persistentDeviceId: device.persistentDeviceId,
      userId,
      name: run.name,
      steps: resolvedSteps as any[],
      appId: undefined,
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
