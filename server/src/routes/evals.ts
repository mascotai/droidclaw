/**
 * API routes for the Eval system.
 *
 * POST /evals/run  — Start an eval run
 * GET  /evals      — List user's eval runs
 * GET  /evals/:id  — Get eval run with results
 * POST /evals/:id/stop — Stop a running eval
 */

import { Hono } from "hono";
import { eq, and, desc } from "drizzle-orm";
import { sessionMiddleware, type AuthEnv } from "../middleware/auth.js";
import { sessions } from "../ws/sessions.js";
import { db } from "../db.js";
import { evalBatch, llmConfig as llmConfigTable } from "../schema.js";
import { activeSessions } from "../agent/active-sessions.js";
import { runEval, type WorkflowDef } from "../agent/eval-runner.js";
import type { LLMConfig } from "../agent/llm.js";

const evals = new Hono<AuthEnv>();
evals.use("*", sessionMiddleware);

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

// Active eval abort controllers
const activeEvals = new Map<string, AbortController>();

// ── POST /evals/run — Start eval run ──
evals.post("/run", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    deviceId: string;
    name?: string;
    workflows: WorkflowDef[];
    runsPerWorkflow: number;
    llmApiKey?: string;
    llmProvider?: string;
    llmModel?: string;
  }>();

  if (!body.deviceId || !body.workflows || !Array.isArray(body.workflows) || body.workflows.length === 0) {
    return c.json({ error: "deviceId and non-empty workflows array are required" }, 400);
  }
  if (!body.runsPerWorkflow || body.runsPerWorkflow < 1) {
    return c.json({ error: "runsPerWorkflow must be at least 1" }, 400);
  }

  const result = resolveDevice(body.deviceId, user.id);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  const { device } = result;

  const trackingKey = device.persistentDeviceId ?? device.deviceId;
  if (activeSessions.has(trackingKey)) {
    return c.json({ error: "Agent already running on this device" }, 409);
  }

  const llmCfg = await resolveLLMConfig(user.id, body);
  if (!llmCfg) {
    return c.json({ error: "No LLM provider configured" }, 400);
  }

  const evalId = crypto.randomUUID();
  const abort = new AbortController();

  await db.insert(evalBatch).values({
    id: evalId,
    userId: user.id,
    deviceId: device.persistentDeviceId ?? device.deviceId,
    name: body.name ?? `Eval ${new Date().toLocaleDateString()}`,
    status: "running",
    runsPerWorkflow: body.runsPerWorkflow,
    workflowDefs: body.workflows,
  });

  activeEvals.set(evalId, abort);
  activeSessions.set(trackingKey, { sessionId: evalId, goal: `Eval: ${body.name ?? "batch eval"}`, abort });

  runEval({
    evalId,
    deviceId: device.deviceId,
    persistentDeviceId: device.persistentDeviceId,
    userId: user.id,
    workflows: body.workflows,
    runsPerWorkflow: body.runsPerWorkflow,
    llmConfig: llmCfg,
    signal: abort.signal,
  }).finally(() => {
    activeSessions.delete(trackingKey);
    activeEvals.delete(evalId);
  });

  return c.json({ evalId, status: "started" });
});

// ── GET /evals — List eval runs ──
evals.get("/", async (c) => {
  const user = c.get("user");
  const rows = await db.select().from(evalBatch)
    .where(eq(evalBatch.userId, user.id))
    .orderBy(desc(evalBatch.startedAt))
    .limit(50);

  return c.json(rows.map(r => ({
    id: r.id,
    name: r.name,
    status: r.status,
    runsPerWorkflow: r.runsPerWorkflow,
    deviceId: r.deviceId,
    startedAt: r.startedAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    overallSuccessRate: (r.results as any)?.overallSuccessRate ?? null,
    totalRuns: (r.results as any)?.totalRuns ?? null,
  })));
});

// ── GET /evals/:id — Get eval run with results ──
evals.get("/:id", async (c) => {
  const user = c.get("user");
  const evalId = c.req.param("id");

  const rows = await db.select().from(evalBatch)
    .where(and(eq(evalBatch.id, evalId), eq(evalBatch.userId, user.id)))
    .limit(1);

  if (rows.length === 0) return c.json({ error: "Eval run not found" }, 404);

  const row = rows[0];
  return c.json({
    id: row.id,
    name: row.name,
    status: row.status,
    runsPerWorkflow: row.runsPerWorkflow,
    deviceId: row.deviceId,
    workflowDefs: row.workflowDefs,
    results: row.results,
    startedAt: row.startedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  });
});

// ── POST /evals/:id/stop — Stop running eval ──
evals.post("/:id/stop", async (c) => {
  const user = c.get("user");
  const evalId = c.req.param("id");

  // Verify ownership
  const rows = await db.select().from(evalBatch)
    .where(and(eq(evalBatch.id, evalId), eq(evalBatch.userId, user.id)))
    .limit(1);

  if (rows.length === 0) return c.json({ error: "Eval run not found" }, 404);
  if (rows[0].status !== "running") return c.json({ error: "Eval is not running" }, 400);

  const abort = activeEvals.get(evalId);
  if (abort) {
    abort.abort();
    console.log(`[Evals] Stop requested for eval ${evalId}`);
  }

  return c.json({ status: "stopping" });
});

export { evals };
