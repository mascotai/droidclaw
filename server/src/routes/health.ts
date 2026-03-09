import { Hono } from "hono";
import { sessions } from "../ws/sessions.js";
import { getWorkflowDebugLog } from "../agent/workflow-runner.js";
import { activeSessions } from "../agent/active-sessions.js";
import { db } from "../db.js";
import { cachedFlow } from "../schema.js";
import { desc } from "drizzle-orm";

const health = new Hono();

health.get("/", (c) => {
  return c.json({
    status: "ok",
    connectedDevices: sessions.getStats().devices,
  });
});

health.get("/debug", async (c) => {
  const active: Record<string, unknown> = {};
  for (const [key, val] of activeSessions.entries()) {
    active[key] = {
      sessionId: val.sessionId,
      goal: val.goal?.slice(0, 60),
      aborted: val.abort.signal.aborted,
      deviceDisconnected: val.deviceDisconnected,
    };
  }

  // Query cached flows from DB
  let cachedFlows: unknown[] = [];
  try {
    cachedFlows = await db
      .select({
        id: cachedFlow.id,
        goalKey: cachedFlow.goalKey,
        appPackage: cachedFlow.appPackage,
        deviceId: cachedFlow.deviceId,
        successCount: cachedFlow.successCount,
        failCount: cachedFlow.failCount,
        stepsCount: cachedFlow.steps,
        createdAt: cachedFlow.createdAt,
        lastUsedAt: cachedFlow.lastUsedAt,
      })
      .from(cachedFlow)
      .orderBy(desc(cachedFlow.createdAt))
      .limit(20);
  } catch { /* ignore */ }

  return c.json({
    activeSessions: active,
    debugLog: getWorkflowDebugLog(),
    cachedFlows,
  });
});

export { health };
