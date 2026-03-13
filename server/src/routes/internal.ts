/**
 * Internal API routes — called by the standalone Temporal worker.
 *
 * These endpoints are NOT exposed publicly. They are only reachable
 * within the Docker network (droidclaw-worker → droidclaw-server).
 *
 * Authentication: Bearer token via INTERNAL_SECRET env var.
 */

import { Hono } from "hono";
import { env } from "../env.js";
import { db } from "../db.js";
import { workflowRun, llmConfig as llmConfigTable } from "../schema.js";
import { eq } from "drizzle-orm";
import { sessions } from "../ws/sessions.js";
import { activeSessions } from "../agent/active-sessions.js";
import {
  runWorkflowServer,
  type WorkflowStep,
} from "../agent/workflow-runner.js";

export const internal = new Hono();

/**
 * POST /internal/execute-run
 *
 * Execute a workflow or flow run on a connected device.
 * Called by the standalone Temporal worker's activity.
 */
internal.post("/execute-run", async (c) => {
  // ── Auth check ──
  const authHeader = c.req.header("Authorization");
  if (env.INTERNAL_SECRET) {
    if (authHeader !== `Bearer ${env.INTERNAL_SECRET}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }

  const input = await c.req.json();
  const {
    runId,
    deviceId,
    userId,
    name,
    type: wfType,
    steps,
    totalSteps,
    llmModel,
    resolvedValues,
  } = input;

  // ── Check device is online ──
  const device =
    sessions.getDeviceByPersistentId(deviceId) ??
    sessions.getDevice(deviceId);
  if (!device) {
    return c.json({ error: `Device ${deviceId} not connected` }, 503);
  }

  const trackingKey = device.persistentDeviceId ?? device.deviceId;

  // ── Create DB row (idempotent for retries) ──
  await db
    .insert(workflowRun)
    .values({
      id: runId,
      userId,
      deviceId,
      name,
      type: wfType,
      steps: steps as any,
      status: "running",
      totalSteps,
      startedAt: new Date(),
    })
    .onConflictDoNothing();

  // ── Resolve LLM config (workflow type needs it) ──
  let llmCfg = null;
  if (wfType === "workflow") {
    const configs = await db
      .select()
      .from(llmConfigTable)
      .where(eq(llmConfigTable.userId, userId))
      .limit(1);

    if (configs.length === 0) {
      await db
        .update(workflowRun)
        .set({ status: "failed", completedAt: new Date() })
        .where(eq(workflowRun.id, runId));
      return c.json({ error: "No LLM config found for user" }, 422);
    }

    llmCfg = {
      provider: configs[0].provider,
      apiKey: configs[0].apiKey,
      model: llmModel ?? configs[0].model ?? undefined,
    };
  }

  // ── Register in activeSessions ──
  const abort = new AbortController();
  activeSessions.set(trackingKey, {
    sessionId: runId,
    goal: `${wfType}: ${name}`,
    abort,
  });

  try {
    if (wfType === "workflow") {
      await runWorkflowServer({
        runId,
        deviceId: device.deviceId,
        persistentDeviceId: device.persistentDeviceId,
        userId,
        name,
        steps: steps as WorkflowStep[],
        llmConfig: llmCfg!,
        signal: abort.signal,
        resolvedValues,
      });
    } else {
      return c.json({ error: `Unsupported workflow type: ${wfType}` }, 400);
    }

    return c.json({ success: true });
  } catch (err) {
    // Mark the run as failed
    await db
      .update(workflowRun)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(workflowRun.id, runId));

    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  } finally {
    activeSessions.delete(trackingKey);
  }
});
