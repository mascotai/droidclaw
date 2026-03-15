import { Hono } from "hono";
import { cors } from "hono/cors";
import { auth } from "./auth.js";
import { env } from "./env.js";
import { handleDeviceMessage, handleDeviceClose } from "./ws/device.js";
import {
  handleDashboardMessage,
  handleDashboardClose,
} from "./ws/dashboard.js";
import type { WebSocketData } from "./ws/sessions.js";
import { health } from "./routes/health.js";
import { license } from "./routes/license.js";
import { pairing } from "./routes/pairing.js";
import { v2 } from "./routes/v2.js";
import { goalCrud } from "./routes/goal-crud.js";
import { workflowCrud } from "./routes/workflow-crud.js";
import { deviceRegistration, deviceManagement } from "./routes/device-registration.js";

import { db, ensureSchema } from "./db.js";
import { workflowRun, evalBatch, llmConfig as llmConfigTable } from "./schema.js";
import { eq } from "drizzle-orm";
import { sessions } from "./ws/sessions.js";
import { activeSessions } from "./agent/active-sessions.js";
import {
  runWorkflowServer,
  type WorkflowStep,
} from "./agent/workflow-runner.js";
import { registerExecuteRunHandler } from "./temporal/activities.js";
import { startTemporalWorker } from "./temporal/worker.js";
import type { ExecuteRunInput } from "./temporal/types.js";

const app = new Hono();

// CORS for dashboard
app.use(
  "*",
  cors({
    origin: env.CORS_ORIGIN,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

// Better Auth handler
app.on(["POST", "GET"], "/api/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

// REST routes
app.route("/health", health);
app.route("/license", license);
app.route("/pairing", pairing);
app.route("/devices", deviceRegistration);   // Public: /devices/register, /devices/register/status
app.route("/v2", v2);
app.route("/v2/goals", goalCrud);
app.route("/v2/workflows", workflowCrud);
app.route("/v2/devices", deviceManagement);  // Authed: /v2/devices/pending, /:id/approve, /:id/reject

// Start server with WebSocket support
const server = Bun.serve<WebSocketData>({
  port: env.PORT,
  idleTimeout: 255, // seconds — allow long-running commands like diagnose (max 255)
  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade for device connections
    if (url.pathname === "/ws/device") {
      const upgraded = server.upgrade(req, {
        data: { path: "/ws/device" as const, authenticated: false },
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // WebSocket upgrade for dashboard connections
    if (url.pathname === "/ws/dashboard") {
      const upgraded = server.upgrade(req, {
        data: { path: "/ws/dashboard" as const, authenticated: false },
      });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Non-WebSocket requests go to Hono
    return app.fetch(req);
  },
  websocket: {
    idleTimeout: 120,
    sendPings: true,
    open(ws) {
      console.log(`WebSocket opened: ${ws.data.path}`);
    },
    message(ws, message) {
      const raw =
        typeof message === "string"
          ? message
          : new TextDecoder().decode(message);

      if (ws.data.path === "/ws/device") {
        handleDeviceMessage(ws, raw).catch((err) => {
          console.error(`Device message handler error: ${err}`);
        });
      } else if (ws.data.path === "/ws/dashboard") {
        handleDashboardMessage(ws, raw).catch((err) => {
          console.error(`Dashboard message handler error: ${err}`);
        });
      }
    },
    close(ws, code, reason) {
      console.log(`WebSocket closed: ${ws.data.path} device=${ws.data.deviceId ?? "unknown"} code=${code} reason=${reason}`);
      if (ws.data.path === "/ws/device") {
        handleDeviceClose(ws);
      } else if (ws.data.path === "/ws/dashboard") {
        handleDashboardClose(ws);
      }
    },
  },
});

console.log(`Server running on port ${server.port}`);

// Ensure DB schema is up-to-date (adds missing columns/tables)
ensureSchema();

// Clean up stale "running" workflow rows from previous crashes/restarts
db.update(workflowRun)
  .set({ status: "failed", completedAt: new Date() })
  .where(eq(workflowRun.status, "running"))
  .then(() => {
    console.log(`[Startup] Marked stale running workflows as failed`);
  })
  .catch((err) => {
    console.error("[Startup] Failed to clean stale workflows:", err);
  });

// Clean up stale "running" eval runs from previous crashes/restarts
db.update(evalBatch)
  .set({ status: "stopped", completedAt: new Date() })
  .where(eq(evalBatch.status, "running"))
  .then(() => {
    console.log(`[Startup] Marked stale running evals as stopped`);
  })
  .catch((err) => {
    console.error("[Startup] Failed to clean stale evals:", err);
  });

// ── Embedded Temporal Worker ──
// Register the execute handler (same logic as old /internal/execute-run)
// then start the worker in-process — no HTTP roundtrip, no separate container.

registerExecuteRunHandler(async (input: ExecuteRunInput) => {
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

  // Check device is online (direct access — no HTTP needed)
  const device =
    sessions.getDeviceByPersistentId(deviceId) ??
    sessions.getDevice(deviceId);
  if (!device) {
    throw new Error(`Device ${deviceId} not connected`);
  }

  const trackingKey = device.persistentDeviceId ?? device.deviceId;

  // Create DB row (idempotent for retries)
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

  // Resolve LLM config (workflow type needs it)
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
      throw new Error("No LLM config found for user");
    }

    llmCfg = {
      provider: configs[0].provider,
      apiKey: configs[0].apiKey,
      model: llmModel ?? configs[0].model ?? undefined,
    };
  }

  // Register in activeSessions
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
      throw new Error(`Unsupported workflow type: ${wfType}`);
    }
  } catch (err) {
    // Mark the run as failed
    await db
      .update(workflowRun)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(workflowRun.id, runId));
    throw err; // Re-throw so Temporal sees the failure
  } finally {
    activeSessions.delete(trackingKey);
  }
});

startTemporalWorker().catch((err) => {
  console.error("[Temporal] Failed to start embedded worker:", err);
});

