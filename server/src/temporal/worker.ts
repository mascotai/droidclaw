/**
 * Embedded Temporal Worker — runs in the same process as the server.
 *
 * This eliminates the need for a separate droidclaw-worker container.
 * The worker shares the server process, so activities can directly
 * access WebSocket sessions and DB without an HTTP roundtrip.
 *
 * Requires @temporalio/worker v1.15.0+ (experimental Bun support).
 */

import { Worker, NativeConnection } from "@temporalio/worker";
import { env } from "../env.js";
import * as activities from "./activities.js";

export async function startTemporalWorker(): Promise<void> {
  const connection = await NativeConnection.connect({
    address: env.TEMPORAL_ADDRESS,
  });

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath: new URL("./workflows/device-queue.js", import.meta.url)
      .pathname,
    activities,
    maxConcurrentActivityTaskExecutions: 5,
    maxConcurrentWorkflowTaskExecutions: 10,
  });

  console.log(
    `[Temporal] Worker started — address: ${env.TEMPORAL_ADDRESS}, ` +
      `namespace: ${env.TEMPORAL_NAMESPACE}, queue: ${env.TEMPORAL_TASK_QUEUE}`
  );

  // worker.run() returns a promise that resolves when the worker shuts down
  worker.run().catch((err) => {
    console.error("[Temporal] Worker crashed:", err);
    process.exit(1);
  });
}
