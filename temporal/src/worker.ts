/**
 * Standalone Temporal Worker for DroidClaw
 *
 * Runs as a separate process from the droidclaw-server.
 * Connects to Temporal and processes device-queue workflows + activities.
 */

import { Worker, NativeConnection } from "@temporalio/worker";
import * as activities from "./activities/execute-run.js";

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS || "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE || "droidclaw";
const TEMPORAL_TASK_QUEUE =
  process.env.TEMPORAL_TASK_QUEUE || "droidclaw-queue-dev";

async function main(): Promise<void> {
  const connection = await NativeConnection.connect({
    address: TEMPORAL_ADDRESS,
  });

  const worker = await Worker.create({
    connection,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: TEMPORAL_TASK_QUEUE,
    workflowsPath: new URL("./workflows/index.js", import.meta.url).pathname,
    activities,
    maxConcurrentActivityTaskExecutions: 10,
    maxConcurrentWorkflowTaskExecutions: 20,
  });

  console.log(
    `[Temporal] Worker started — address: ${TEMPORAL_ADDRESS}, ` +
      `namespace: ${TEMPORAL_NAMESPACE}, queue: ${TEMPORAL_TASK_QUEUE}`
  );

  // worker.run() returns a promise that resolves when the worker shuts down
  await worker.run();
}

main().catch((err) => {
  console.error("[Temporal] Worker failed:", err);
  process.exit(1);
});
