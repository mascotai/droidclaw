/**
 * Temporal Activity: Execute a workflow or flow run on a device.
 *
 * This is a standalone activity that delegates execution to the droidclaw-server
 * via an internal HTTP endpoint. The server handles device session management,
 * DB updates, and actual workflow/flow execution.
 *
 * Heartbeats every 30s so Temporal knows we're still alive.
 */

import { heartbeat } from "@temporalio/activity";
import type { ExecuteRunInput } from "../types.js";

const DROIDCLAW_SERVER_URL =
  process.env.DROIDCLAW_SERVER_URL || "http://localhost:8080";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || "";

/**
 * Execute a single workflow or flow run on a device.
 *
 * Called by the device-queue Temporal workflow as an activity.
 * Delegates to droidclaw-server via internal HTTP endpoint.
 */
export async function executeWorkflowRun(
  input: ExecuteRunInput
): Promise<void> {
  // ── Heartbeat to Temporal every 30s ──
  const heartbeatInterval = setInterval(() => {
    try {
      heartbeat();
    } catch {
      // Activity may have been cancelled
    }
  }, 30_000);

  try {
    const response = await fetch(
      `${DROIDCLAW_SERVER_URL}/internal/execute-run`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(INTERNAL_SECRET
            ? { Authorization: `Bearer ${INTERNAL_SECRET}` }
            : {}),
        },
        body: JSON.stringify(input),
      }
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `Server returned ${response.status}: ${body.slice(0, 500)}`
      );
    }
  } finally {
    clearInterval(heartbeatInterval);
  }
}
