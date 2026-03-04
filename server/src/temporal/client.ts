/**
 * Temporal Client — singleton connection + helper functions.
 *
 * The client is used by HTTP route handlers to signal the device-queue
 * workflow (enqueue runs, cancel queued runs, query queue state).
 */

import { Client, Connection } from "@temporalio/client";
import { env } from "../env.js";
import type { RunPayload } from "./types.js";

const TASK_QUEUE = "droidclaw-device-queue";

let _client: Client | null = null;

/** Get or create the singleton Temporal client */
export async function getTemporalClient(): Promise<Client> {
  if (!_client) {
    const connection = await Connection.connect({
      address: env.TEMPORAL_ADDRESS,
    });
    _client = new Client({
      connection,
      namespace: env.TEMPORAL_NAMESPACE,
    });
  }
  return _client;
}

/**
 * Signal-or-start the device queue workflow and enqueue a run.
 *
 * If the workflow is already running for this device, the payload is
 * delivered as a signal (added to the in-memory queue).
 * If not, the workflow is started and the signal is delivered atomically.
 */
export async function enqueueRun(opts: {
  deviceId: string;
  payload: RunPayload;
}): Promise<void> {
  const client = await getTemporalClient();
  const workflowId = `device-queue-${opts.deviceId}`;

  await client.workflow.signalWithStart("deviceQueueWorkflow", {
    taskQueue: TASK_QUEUE,
    workflowId,
    args: [{ deviceId: opts.deviceId }],
    signal: "enqueueRun",
    signalArgs: [opts.payload],
  });
}

/**
 * Signal the queue workflow to remove a queued (not yet running) run.
 * No-op if the workflow isn't running (nothing to cancel).
 */
export async function cancelQueuedRun(
  deviceId: string,
  runId: string
): Promise<void> {
  const client = await getTemporalClient();
  try {
    const handle = client.workflow.getHandle(`device-queue-${deviceId}`);
    await handle.signal("cancelRun", { runId });
  } catch {
    // Workflow not running — nothing to cancel
  }
}

/**
 * Query the queue state for a device.
 * Returns the list of payloads waiting to execute (not including
 * the currently running item, which is tracked in the DB).
 */
export async function getQueueState(
  deviceId: string
): Promise<RunPayload[]> {
  const client = await getTemporalClient();
  try {
    const handle = client.workflow.getHandle(`device-queue-${deviceId}`);
    return await handle.query("getQueue");
  } catch {
    return []; // Workflow not running = empty queue
  }
}
