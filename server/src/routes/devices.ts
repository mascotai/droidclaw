import { Hono } from "hono";
import { sessionMiddleware, type AuthEnv } from "../middleware/auth.js";
import { sessions } from "../ws/sessions.js";
import { db } from "../db.js";
import { device, agentSession, agentStep } from "../schema.js";
import { eq, desc, and } from "drizzle-orm";

const devices = new Hono<AuthEnv>();

/** Run device diagnostics including a live download test (no auth — debug tool) */
devices.post("/:deviceId/diagnose", async (c) => {
  const deviceId = c.req.param("deviceId");

  try {
    const result = (await sessions.sendCommand(
      deviceId,
      { type: "diagnose" },
      120_000
    )) as { success?: boolean; error?: string; data?: string };

    if (!result.success) {
      return c.json({ error: result.error ?? "Diagnose failed" }, 502);
    }

    // Parse the JSON report from the device and return it directly
    try {
      const report = JSON.parse(result.data ?? "{}");
      return c.json(report);
    } catch {
      // If parsing fails, return the raw data
      return c.json({ raw: result.data });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: `Diagnose command failed: ${message}` }, 504);
  }
});

devices.use("*", sessionMiddleware);

/** List all devices for the authenticated user (from DB, includes offline) */
devices.get("/", async (c) => {
  const user = c.get("user");

  const dbDevices = await db
    .select()
    .from(device)
    .where(eq(device.userId, user.id))
    .orderBy(desc(device.lastSeen));

  return c.json(
    dbDevices.map((d) => ({
      deviceId: d.id,
      name: d.name,
      status: d.status,
      deviceInfo: d.deviceInfo,
      lastSeen: d.lastSeen?.toISOString() ?? d.createdAt.toISOString(),
      connectedAt: d.createdAt.toISOString(),
    }))
  );
});

/** List agent sessions for a specific device */
devices.get("/:deviceId/sessions", async (c) => {
  const user = c.get("user");
  const deviceId = c.req.param("deviceId");

  const deviceSessions = await db
    .select()
    .from(agentSession)
    .where(
      and(
        eq(agentSession.deviceId, deviceId),
        eq(agentSession.userId, user.id)
      )
    )
    .orderBy(desc(agentSession.startedAt))
    .limit(50);

  return c.json(deviceSessions);
});

/** List steps for a specific agent session */
devices.get("/:deviceId/sessions/:sessionId/steps", async (c) => {
  const user = c.get("user");
  const sessionId = c.req.param("sessionId");

  // Verify session belongs to user
  const sess = await db
    .select()
    .from(agentSession)
    .where(
      and(eq(agentSession.id, sessionId), eq(agentSession.userId, user.id))
    )
    .limit(1);

  if (sess.length === 0) {
    return c.json({ error: "Session not found" }, 404);
  }

  const steps = await db
    .select()
    .from(agentStep)
    .where(eq(agentStep.sessionId, sessionId))
    .orderBy(agentStep.stepNumber);

  return c.json(steps);
});

export { devices };
