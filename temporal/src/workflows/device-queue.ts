/**
 * Device Queue Coordinator Workflow
 *
 * One instance per device (workflowId = "device-queue-<deviceId>").
 * Receives work items via signals and executes them one at a time (FIFO).
 * Queue state lives in workflow memory — Temporal IS the queue.
 *
 * Uses the "mutex workflow" pattern recommended by Temporal co-founder
 * Maxim Fateev for per-resource serial execution with buffering.
 */

import {
  defineSignal,
  defineQuery,
  setHandler,
  proxyActivities,
  sleep,
  condition,
} from "@temporalio/workflow";

import type { RunPayload } from "../types.js";
import type * as activities from "../activities/execute-run.js";

// ── Signals & Queries ──

export const enqueueRunSignal = defineSignal<[RunPayload]>("enqueueRun");
export const cancelRunSignal = defineSignal<[{ runId: string }]>("cancelRun");
export const getQueueQuery = defineQuery<RunPayload[]>("getQueue");

// ── Activity proxy ──

const { executeWorkflowRun } = proxyActivities<typeof activities>({
  startToCloseTimeout: "45m",
  heartbeatTimeout: "2m",
  retry: {
    maximumAttempts: 3,
    initialInterval: "30s",
    backoffCoefficient: 2,
  },
});

// ── Workflow ──

export async function deviceQueueWorkflow(input: {
  deviceId: string;
}): Promise<void> {
  const queue: RunPayload[] = [];

  // Signal handler: enqueue a new run
  setHandler(enqueueRunSignal, (payload) => {
    queue.push(payload);
  });

  // Signal handler: cancel a queued (not yet running) run
  setHandler(cancelRunSignal, ({ runId }) => {
    const idx = queue.findIndex((q) => q.runId === runId);
    if (idx !== -1) queue.splice(idx, 1);
  });

  // Query handler: return current queue state
  setHandler(getQueueQuery, () => [...queue]);

  // Main loop — process items one at a time
  while (true) {
    // Wait until there's work
    await condition(() => queue.length > 0);

    const item = queue.shift()!;

    // If scheduled for the future, sleep (durable — survives restarts)
    if (item.scheduledFor) {
      const delay = new Date(item.scheduledFor).getTime() - Date.now();
      if (delay > 0) {
        await sleep(delay);
      }
    }

    // Execute via activity (creates DB row, runs on device, updates DB)
    try {
      await executeWorkflowRun({
        ...item,
        deviceId: input.deviceId,
      });
    } catch {
      // Activity handles DB status update on failure internally.
      // Temporal retries are configured above — if all attempts fail
      // the error is swallowed here so the queue keeps processing.
    }

    // If queue is empty, wait 5 minutes for more work then exit.
    // signalWithStart will re-create the workflow on next enqueue.
    if (queue.length === 0) {
      const gotMore = await condition(() => queue.length > 0, "5m");
      if (!gotMore) break;
    }
  }
}
