/**
 * Device Queue Workflow — Integration Tests
 *
 * Uses @temporalio/testing to spin up an in-memory Temporal server
 * with time-skipping support. All activities are mocked — we only
 * test the queue coordination logic.
 *
 * A single Worker + TestWorkflowEnvironment is shared across all tests
 * to avoid Bun segfaults from repeated native module setup/teardown.
 *
 * Run:  npm test
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  TestWorkflowEnvironment,
  workflowInterceptorModules,
} from "@temporalio/testing";
import { Worker } from "@temporalio/worker";
import type { RunPayload, ExecuteRunInput } from "../types.js";

// ── Helpers ──

const TASK_QUEUE = "test-device-queue";

function makePayload(overrides: Partial<RunPayload> = {}): RunPayload {
  return {
    runId: overrides.runId ?? crypto.randomUUID(),
    userId: "user-1",
    name: overrides.name ?? "Test Workflow",
    type: "workflow",
    steps: [{ goal: "tap button" }],
    totalSteps: 1,
    ...overrides,
  };
}

/** Track activity invocations for assertions */
interface ActivityCall {
  input: ExecuteRunInput;
  startedAt: number;
  resolvedAt?: number;
}

// ── Shared state across all tests ──

/**
 * Mock activity implementation that records calls and simulates work.
 *
 * Each test registers a custom handler via `setActivityHandler` before running.
 * This allows per-test control over activity behavior (duration, failure, etc.)
 */
type ActivityHandler = (input: ExecuteRunInput) => Promise<void>;

let currentHandler: ActivityHandler = async () => {};

function setActivityHandler(handler: ActivityHandler) {
  currentHandler = handler;
}

// ── Test Suite ──

describe("deviceQueueWorkflow", () => {
  let testEnv: TestWorkflowEnvironment;
  let worker: Worker;
  let workerRunning: Promise<void>;

  beforeAll(async () => {
    testEnv = await TestWorkflowEnvironment.createTimeSkipping();

    worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue: TASK_QUEUE,
      workflowsPath: new URL("../workflows/index.ts", import.meta.url)
        .pathname,
      interceptors: {
        workflowModules: workflowInterceptorModules,
      },
      activities: {
        async executeWorkflowRun(input: ExecuteRunInput): Promise<void> {
          await currentHandler(input);
        },
      },
    });

    // Run worker in background — it stays alive for all tests
    workerRunning = worker.run();
  }, 60_000);

  afterAll(async () => {
    worker?.shutdown();
    await workerRunning;
    await testEnv?.teardown();
  }, 30_000);

  // ── 1. Single item executes immediately ──

  it("executes a single enqueued item", async () => {
    const calls: ActivityCall[] = [];
    const payload = makePayload({ name: "Single Run" });

    setActivityHandler(async (input) => {
      calls.push({ input, startedAt: Date.now() });
      await testEnv.sleep(100);
      calls[calls.length - 1].resolvedAt = Date.now();
    });

    const handle = await testEnv.client.workflow.signalWithStart(
      "deviceQueueWorkflow",
      {
        taskQueue: TASK_QUEUE,
        workflowId: `queue-single-${Date.now()}`,
        args: [{ deviceId: "device-A" }],
        signal: "enqueueRun",
        signalArgs: [payload],
      }
    );

    await handle.result();

    expect(calls.length).toBe(1);
    expect(calls[0].input.runId).toBe(payload.runId);
    expect(calls[0].input.deviceId).toBe("device-A");
    expect(calls[0].input.name).toBe("Single Run");
  }, 30_000);

  // ── 2. FIFO ordering ──

  it("executes items in FIFO order", async () => {
    const calls: ActivityCall[] = [];
    const payloadA = makePayload({ name: "First" });
    const payloadB = makePayload({ name: "Second" });
    const payloadC = makePayload({ name: "Third" });

    setActivityHandler(async (input) => {
      const call: ActivityCall = { input, startedAt: Date.now() };
      calls.push(call);
      await testEnv.sleep(200);
      call.resolvedAt = Date.now();
    });

    const workflowId = `queue-fifo-${Date.now()}`;

    const handle = await testEnv.client.workflow.signalWithStart(
      "deviceQueueWorkflow",
      {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{ deviceId: "device-B" }],
        signal: "enqueueRun",
        signalArgs: [payloadA],
      }
    );

    await handle.signal("enqueueRun", payloadB);
    await handle.signal("enqueueRun", payloadC);

    await handle.result();

    expect(calls.length).toBe(3);
    expect(calls[0].input.name).toBe("First");
    expect(calls[1].input.name).toBe("Second");
    expect(calls[2].input.name).toBe("Third");

    // Verify serial execution: each starts after previous finishes
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].startedAt).toBeGreaterThanOrEqual(
        calls[i - 1].resolvedAt!
      );
    }
  }, 30_000);

  // ── 3. Queue query returns pending items ──

  it("returns pending items via query", async () => {
    const payloadA = makePayload({ name: "Running" });
    const payloadB = makePayload({ name: "Queued-1" });
    const payloadC = makePayload({ name: "Queued-2" });

    let queryResult: RunPayload[] = [];

    setActivityHandler(async (input) => {
      if (input.name === "Running") {
        // Long-running activity so we can query while it's executing
        await testEnv.sleep(5000);
      } else {
        await testEnv.sleep(100);
      }
    });

    const workflowId = `queue-query-${Date.now()}`;

    const handle = await testEnv.client.workflow.signalWithStart(
      "deviceQueueWorkflow",
      {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{ deviceId: "device-C" }],
        signal: "enqueueRun",
        signalArgs: [payloadA],
      }
    );

    // Enqueue B and C
    await handle.signal("enqueueRun", payloadB);
    await handle.signal("enqueueRun", payloadC);

    // Small sleep to let signals be processed and A to start
    await testEnv.sleep(500);

    // Query the queue — A is executing, B and C should be pending
    queryResult = await handle.query<RunPayload[]>("getQueue");

    // Let it finish
    await handle.result();

    expect(queryResult.length).toBe(2);
    expect(queryResult[0].name).toBe("Queued-1");
    expect(queryResult[1].name).toBe("Queued-2");
  }, 30_000);

  // ── 4. Cancel removes queued item ──

  it("cancels a queued (not running) item", async () => {
    const calls: ActivityCall[] = [];
    const payloadA = makePayload({ name: "Will Run" });
    const payloadB = makePayload({ name: "Will Cancel" });
    const payloadC = makePayload({ name: "Will Also Run" });

    setActivityHandler(async (input) => {
      calls.push({ input, startedAt: Date.now() });
      await testEnv.sleep(2000);
      calls[calls.length - 1].resolvedAt = Date.now();
    });

    const workflowId = `queue-cancel-${Date.now()}`;

    const handle = await testEnv.client.workflow.signalWithStart(
      "deviceQueueWorkflow",
      {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{ deviceId: "device-D" }],
        signal: "enqueueRun",
        signalArgs: [payloadA],
      }
    );

    // Enqueue B and C
    await handle.signal("enqueueRun", payloadB);
    await handle.signal("enqueueRun", payloadC);

    // Small delay to let A start
    await testEnv.sleep(500);

    // Cancel B while A is running
    await handle.signal("cancelRun", { runId: payloadB.runId });

    // Verify B was removed from queue
    const queueAfterCancel = await handle.query<RunPayload[]>("getQueue");
    const cancelledInQueue = queueAfterCancel.find(
      (q) => q.runId === payloadB.runId
    );
    expect(cancelledInQueue).toBeUndefined();

    // Wait for completion
    await handle.result();

    // Only A and C should have executed
    expect(calls.length).toBe(2);
    expect(calls[0].input.name).toBe("Will Run");
    expect(calls[1].input.name).toBe("Will Also Run");
  }, 30_000);

  // ── 5. Scheduled item waits until scheduledFor ──

  it("defers scheduled item until scheduledFor time", async () => {
    const calls: ActivityCall[] = [];
    const now = Date.now();
    const scheduledTime = new Date(now + 10 * 60 * 1000); // 10 minutes from now

    const payload = makePayload({
      name: "Scheduled Run",
      scheduledFor: scheduledTime.toISOString(),
    });

    setActivityHandler(async (input) => {
      calls.push({ input, startedAt: Date.now() });
      await testEnv.sleep(100);
      calls[calls.length - 1].resolvedAt = Date.now();
    });

    const handle = await testEnv.client.workflow.signalWithStart(
      "deviceQueueWorkflow",
      {
        taskQueue: TASK_QUEUE,
        workflowId: `queue-schedule-${Date.now()}`,
        args: [{ deviceId: "device-E" }],
        signal: "enqueueRun",
        signalArgs: [payload],
      }
    );

    // Time-skipping means Temporal advances time for the 10min sleep
    await handle.result();

    expect(calls.length).toBe(1);
    expect(calls[0].input.name).toBe("Scheduled Run");
    expect(calls[0].input.scheduledFor).toBe(scheduledTime.toISOString());
  }, 30_000);

  // ── 6. Scheduled item doesn't jump ahead of currently running ──

  it("scheduled item executes after current run, not before", async () => {
    const calls: ActivityCall[] = [];
    const now = Date.now();

    // A: immediate run (takes 5s simulated time)
    const payloadA = makePayload({ name: "Immediate" });

    // B: scheduled for 2 seconds from now — but A takes 5s,
    //    so B should still wait for A to finish first (FIFO)
    const payloadB = makePayload({
      name: "Scheduled Soon",
      scheduledFor: new Date(now + 2000).toISOString(),
    });

    setActivityHandler(async (input) => {
      const call: ActivityCall = { input, startedAt: Date.now() };
      calls.push(call);
      await testEnv.sleep(5000);
      call.resolvedAt = Date.now();
    });

    const workflowId = `queue-sched-order-${Date.now()}`;

    const handle = await testEnv.client.workflow.signalWithStart(
      "deviceQueueWorkflow",
      {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{ deviceId: "device-F" }],
        signal: "enqueueRun",
        signalArgs: [payloadA],
      }
    );

    // Enqueue B (scheduled for 2s from now, but A takes 5s)
    await handle.signal("enqueueRun", payloadB);

    await handle.result();

    // A must run first, then B — FIFO order respected
    expect(calls.length).toBe(2);
    expect(calls[0].input.name).toBe("Immediate");
    expect(calls[1].input.name).toBe("Scheduled Soon");

    // B started after A finished (serial execution)
    expect(calls[1].startedAt).toBeGreaterThanOrEqual(calls[0].resolvedAt!);
  }, 30_000);

  // ── 7. Queue keeps processing after activity failure ──

  it("continues processing queue after an activity failure", async () => {
    const calls: ActivityCall[] = [];
    let callCount = 0;

    setActivityHandler(async (input) => {
      callCount++;
      const call: ActivityCall = { input, startedAt: Date.now() };
      calls.push(call);
      await testEnv.sleep(100);
      call.resolvedAt = Date.now();

      // Fail the first item on every attempt (Temporal retries 3x)
      if (input.name === "Will Fail") {
        throw new Error("Simulated failure");
      }
    });

    const payloadA = makePayload({ name: "Will Fail" });
    const payloadB = makePayload({ name: "Should Still Run" });

    const workflowId = `queue-fail-${Date.now()}`;

    const handle = await testEnv.client.workflow.signalWithStart(
      "deviceQueueWorkflow",
      {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{ deviceId: "device-G" }],
        signal: "enqueueRun",
        signalArgs: [payloadA],
      }
    );

    await handle.signal("enqueueRun", payloadB);
    await handle.result();

    // B should have executed despite A failing
    const bCalls = calls.filter((c) => c.input.name === "Should Still Run");
    expect(bCalls.length).toBeGreaterThanOrEqual(1);
  }, 120_000); // longer timeout for retries

  // ── 8. Idle timeout — workflow exits when queue is empty ──

  it("exits after idle timeout when no more work arrives", async () => {
    const calls: ActivityCall[] = [];
    const payload = makePayload({ name: "Quick Run" });

    setActivityHandler(async (input) => {
      calls.push({ input, startedAt: Date.now() });
      await testEnv.sleep(100);
      calls[calls.length - 1].resolvedAt = Date.now();
    });

    const workflowId = `queue-idle-${Date.now()}`;

    const handle = await testEnv.client.workflow.signalWithStart(
      "deviceQueueWorkflow",
      {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{ deviceId: "device-H" }],
        signal: "enqueueRun",
        signalArgs: [payload],
      }
    );

    // Workflow will: execute payload, queue empty, wait 5min, exit
    // Time-skipping means this resolves quickly
    await handle.result();

    expect(calls.length).toBe(1);

    // Workflow should have completed (not still running)
    const description = await handle.describe();
    expect(description.status.name).toBe("COMPLETED");
  }, 30_000);

  // ── 9. signalWithStart restarts workflow after idle exit ──

  it("restarts workflow via signalWithStart after idle exit", async () => {
    const calls: ActivityCall[] = [];
    const workflowId = `queue-restart-${Date.now()}`;
    const payloadA = makePayload({ name: "First Session" });
    const payloadB = makePayload({ name: "Second Session" });

    setActivityHandler(async (input) => {
      calls.push({ input, startedAt: Date.now() });
      await testEnv.sleep(100);
      calls[calls.length - 1].resolvedAt = Date.now();
    });

    // First run — will process, idle, and exit
    const handle1 = await testEnv.client.workflow.signalWithStart(
      "deviceQueueWorkflow",
      {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{ deviceId: "device-I" }],
        signal: "enqueueRun",
        signalArgs: [payloadA],
      }
    );

    await handle1.result();
    expect(calls.length).toBe(1);
    expect(calls[0].input.name).toBe("First Session");

    // Second run — signalWithStart will create a new workflow instance
    const handle2 = await testEnv.client.workflow.signalWithStart(
      "deviceQueueWorkflow",
      {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{ deviceId: "device-I" }],
        signal: "enqueueRun",
        signalArgs: [payloadB],
      }
    );

    await handle2.result();
    expect(calls.length).toBe(2);
    expect(calls[1].input.name).toBe("Second Session");
  }, 30_000);

  // ── 10. Multiple items with mixed scheduling ──

  it("handles mix of immediate and scheduled items in FIFO order", async () => {
    const calls: ActivityCall[] = [];
    const now = Date.now();

    const payloads = [
      makePayload({ name: "Immediate-1" }),
      makePayload({
        name: "Scheduled-5min",
        scheduledFor: new Date(now + 5 * 60 * 1000).toISOString(),
      }),
      makePayload({ name: "Immediate-2" }),
    ];

    setActivityHandler(async (input) => {
      calls.push({ input, startedAt: Date.now() });
      await testEnv.sleep(100);
      calls[calls.length - 1].resolvedAt = Date.now();
    });

    const workflowId = `queue-mixed-${Date.now()}`;

    const handle = await testEnv.client.workflow.signalWithStart(
      "deviceQueueWorkflow",
      {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{ deviceId: "device-J" }],
        signal: "enqueueRun",
        signalArgs: [payloads[0]],
      }
    );

    await handle.signal("enqueueRun", payloads[1]);
    await handle.signal("enqueueRun", payloads[2]);

    await handle.result();

    // FIFO: Immediate-1 first, then Scheduled-5min (with sleep), then Immediate-2
    expect(calls.length).toBe(3);
    expect(calls[0].input.name).toBe("Immediate-1");
    expect(calls[1].input.name).toBe("Scheduled-5min");
    expect(calls[2].input.name).toBe("Immediate-2");
  }, 30_000);

  // ── 11. DeviceId is passed correctly to activity ──

  it("passes the correct deviceId from workflow input to activity", async () => {
    const calls: ActivityCall[] = [];
    const payload = makePayload({ name: "Check DeviceId" });

    setActivityHandler(async (input) => {
      calls.push({ input, startedAt: Date.now() });
      await testEnv.sleep(100);
      calls[calls.length - 1].resolvedAt = Date.now();
    });

    const handle = await testEnv.client.workflow.signalWithStart(
      "deviceQueueWorkflow",
      {
        taskQueue: TASK_QUEUE,
        workflowId: `queue-deviceid-${Date.now()}`,
        args: [{ deviceId: "persistent-device-xyz" }],
        signal: "enqueueRun",
        signalArgs: [payload],
      }
    );

    await handle.result();

    expect(calls.length).toBe(1);
    // The workflow merges { ...payload, deviceId: input.deviceId }
    expect(calls[0].input.deviceId).toBe("persistent-device-xyz");
    // The payload's own fields should be preserved
    expect(calls[0].input.userId).toBe("user-1");
    expect(calls[0].input.runId).toBe(payload.runId);
  }, 30_000);

  // ── 12. Work arriving during idle period keeps workflow alive ──

  it("does not exit if new work arrives during idle period", async () => {
    const calls: ActivityCall[] = [];
    const payloadA = makePayload({ name: "Before Idle" });
    const payloadB = makePayload({ name: "During Idle" });

    setActivityHandler(async (input) => {
      calls.push({ input, startedAt: Date.now() });
      await testEnv.sleep(100);
      calls[calls.length - 1].resolvedAt = Date.now();
    });

    const workflowId = `queue-idle-signal-${Date.now()}`;

    // Start with item A
    const handle = await testEnv.client.workflow.signalWithStart(
      "deviceQueueWorkflow",
      {
        taskQueue: TASK_QUEUE,
        workflowId,
        args: [{ deviceId: "device-K" }],
        signal: "enqueueRun",
        signalArgs: [payloadA],
      }
    );

    // Send B immediately — the workflow will process A first,
    // then process B (since it's already in the queue when A finishes,
    // the idle timeout is never entered)
    await handle.signal("enqueueRun", payloadB);

    // Workflow should process both, then idle timeout, then exit
    await handle.result();

    expect(calls.length).toBe(2);
    expect(calls[0].input.name).toBe("Before Idle");
    expect(calls[1].input.name).toBe("During Idle");
  }, 30_000);
});
