/**
 * Temporal Activity: Execute a workflow run on a device (in-process).
 *
 * Instead of calling the server via HTTP (old standalone worker pattern),
 * this activity calls the registered handler directly — the server and
 * worker run in the same process, sharing access to WebSocket sessions.
 *
 * The handler is registered at startup by the server (see index.ts)
 * to avoid circular imports between the activity and server modules.
 *
 * Heartbeats every 30s so Temporal knows we're still alive.
 */

import { heartbeat } from "@temporalio/activity";
import type { ExecuteRunInput } from "./types.js";

// Registered at server startup — avoids circular imports
let _executeRun: ((input: ExecuteRunInput) => Promise<void>) | null = null;

/**
 * Register the handler that actually executes a workflow run.
 * Called once at server startup before the worker is started.
 */
export function registerExecuteRunHandler(
  fn: (input: ExecuteRunInput) => Promise<void>
) {
  _executeRun = fn;
}

/**
 * Execute a single workflow or flow run on a device.
 *
 * Called by the device-queue Temporal workflow as an activity.
 * Delegates to the registered handler (which has access to
 * WebSocket sessions, DB, and the workflow runner).
 */
export async function executeWorkflowRun(
  input: ExecuteRunInput
): Promise<void> {
  if (!_executeRun) {
    throw new Error(
      "executeRun handler not registered — server startup incomplete"
    );
  }

  const heartbeatInterval = setInterval(() => {
    try {
      heartbeat();
    } catch {
      // Activity may have been cancelled
    }
  }, 30_000);

  try {
    await _executeRun(input);
  } finally {
    clearInterval(heartbeatInterval);
  }
}
