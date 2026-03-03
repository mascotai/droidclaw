import { Hono } from "hono";
import { sessions } from "../ws/sessions.js";
import { getWorkflowDebugLog } from "../agent/workflow-runner.js";
import { activeSessions } from "../agent/active-sessions.js";

const health = new Hono();

health.get("/", (c) => {
  return c.json({
    status: "ok",
    connectedDevices: sessions.getStats().devices,
  });
});

health.get("/debug", (c) => {
  const active: Record<string, unknown> = {};
  for (const [key, val] of activeSessions.entries()) {
    active[key] = {
      sessionId: val.sessionId,
      goal: val.goal?.slice(0, 60),
      aborted: val.abort.signal.aborted,
      deviceDisconnected: val.deviceDisconnected,
    };
  }
  return c.json({
    activeSessions: active,
    debugLog: getWorkflowDebugLog(),
  });
});

export { health };
