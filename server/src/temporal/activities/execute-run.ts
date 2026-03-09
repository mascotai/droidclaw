/**
 * Temporal Activity: Execute a workflow or flow run on a device.
 *
 * This is the only place that performs I/O for the device-queue system.
 * It creates the DB row, resolves LLM config, delegates to the existing
 * runWorkflowServer / runFlowServer, and cleans up when done.
 *
 * Heartbeats every 30s so Temporal knows we're still alive.
 */

import { heartbeat } from "@temporalio/activity";
import { db } from "../../db.js";
import { workflowRun, llmConfig as llmConfigTable } from "../../schema.js";
import { eq } from "drizzle-orm";
import { sessions } from "../../ws/sessions.js";
import { activeSessions } from "../../agent/active-sessions.js";
import {
  runWorkflowServer,
  type WorkflowStep,
} from "../../agent/workflow-runner.js";
import { runFlowServer } from "../../agent/flow-runner.js";
import type { ExecuteRunInput } from "../types.js";

/**
 * Execute a single workflow or flow run on a device.
 *
 * Called by the device-queue Temporal workflow as an activity.
 * The activity is idempotent (uses onConflictDoNothing for DB insert)
 * so Temporal retries are safe.
 */
export async function executeWorkflowRun(input: ExecuteRunInput): Promise<void> {
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
  // Try persistent ID first, then fall back to ephemeral device ID
  const device = sessions.getDeviceByPersistentId(deviceId) ?? sessions.getDevice(deviceId);
  if (!device) {
    // Temporal will retry with backoff — device might come back online
    throw new Error(`Device ${deviceId} not connected`);
  }

  const trackingKey = device.persistentDeviceId ?? device.deviceId;

  // ── Create DB row (execution is starting NOW) ──
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
    .onConflictDoNothing(); // Idempotent for Temporal retries

  // ── Resolve LLM config (workflow type needs it, flow doesn't) ──
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
      // Don't retry — this is a permanent configuration problem
      return;
    }

    llmCfg = {
      provider: configs[0].provider,
      apiKey: configs[0].apiKey,
      model: llmModel ?? configs[0].model ?? undefined,
    };
  }

  // ── Register in activeSessions so stop/disconnect handling works ──
  const abort = new AbortController();
  activeSessions.set(trackingKey, {
    sessionId: runId,
    goal: `${wfType}: ${name}`,
    abort,
  });

  // ── Heartbeat to Temporal every 30s ──
  const heartbeatInterval = setInterval(() => {
    try {
      heartbeat();
    } catch {
      // Activity may have been cancelled
    }
  }, 30_000);

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
      await runFlowServer({
        runId,
        deviceId: device.deviceId,
        persistentDeviceId: device.persistentDeviceId,
        userId,
        name,
        steps: steps as any[],
        signal: abort.signal,
      });
    }
  } catch (err) {
    // Mark the run as failed in the DB so it doesn't stay "running" forever
    await db
      .update(workflowRun)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(workflowRun.id, runId));
    throw err; // Re-throw so Temporal sees the failure
  } finally {
    clearInterval(heartbeatInterval);
    activeSessions.delete(trackingKey);
  }
}
