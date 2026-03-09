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
import { devices } from "./routes/devices.js";
import { goals } from "./routes/goals.js";
import { health } from "./routes/health.js";
import { license } from "./routes/license.js";
import { pairing } from "./routes/pairing.js";
import { investigate } from "./routes/investigate.js";
import { workflows } from "./routes/workflows.js";
import { evals } from "./routes/evals.js";
import { startTemporalWorker } from "./temporal/worker.js";
import { db, ensureSchema } from "./db.js";
import { workflowRun, evalRun } from "./schema.js";
import { eq } from "drizzle-orm";

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
app.route("/devices", devices);
app.route("/goals", goals);
app.route("/health", health);
app.route("/license", license);
app.route("/pairing", pairing);
app.route("/investigate", investigate);
app.route("/workflows", workflows);
app.route("/evals", evals);

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
db.update(evalRun)
  .set({ status: "stopped", completedAt: new Date() })
  .where(eq(evalRun.status, "running"))
  .then(() => {
    console.log(`[Startup] Marked stale running evals as stopped`);
  })
  .catch((err) => {
    console.error("[Startup] Failed to clean stale evals:", err);
  });

// Start embedded Temporal worker (non-blocking — runs in background)
startTemporalWorker().catch((err) => {
  console.error("[Temporal] Worker failed:", err);
});
