/**
 * Embedded Temporal Worker
 *
 * Runs inside the droidclaw-server process. Connects to the Temporal
 * server and processes device-queue workflows + activities.
 */

import { Worker, NativeConnection } from "@temporalio/worker";
import { env } from "../env.js";
import * as activities from "./activities/execute-run.js";

const TASK_QUEUE = "droidclaw-device-queue";

/**
 * Start the embedded Temporal worker.
 *
 * The worker polls the `droidclaw-device-queue` task queue for:
 * - Workflow tasks (device-queue coordinator)
 * - Activity tasks (executeWorkflowRun)
 *
 * Call this once on server startup. The returned promise resolves
 * when the worker shuts down (typically on process exit).
 */
export async function startTemporalWorker(): Promise<void> {
  const connection = await NativeConnection.connect({
    address: env.TEMPORAL_ADDRESS,
  });

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: TASK_QUEUE,
    workflowsPath: new URL("./workflows/index.js", import.meta.url).pathname,
    activities,
    maxConcurrentActivityTaskExecutions: 10,
    maxConcurrentWorkflowTaskExecutions: 20,
  });

  console.log(
    `[Temporal] Worker started — address: ${env.TEMPORAL_ADDRESS}, ` +
      `namespace: ${env.TEMPORAL_NAMESPACE}, queue: ${TASK_QUEUE}`
  );

  // worker.run() returns a promise that resolves when the worker shuts down
  await worker.run();
}
