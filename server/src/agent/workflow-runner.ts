import { sessions } from "../ws/sessions.js";
import { db } from "../db.js";
import { workflowRun, cachedFlow, agentStep } from "../schema.js";
import { eq, and, asc, sql } from "drizzle-orm";
import { runPipeline } from "./pipeline.js";
import { executeFlowStepWs } from "./flow-runner.js";
import { compileSessionToFlow, normalizeGoalKey, isCacheable, resolveFlowVariables } from "./session-to-flow.js";
import type { FlowStep } from "./session-to-flow.js";
import { activeSessions } from "./active-sessions.js";
import { evaluateStep, type EvalJudgment, type StateDefinition, type AgentStepRecord } from "./eval-judge.js";
import type { LLMConfig } from "./llm.js";
import type { ScreenObservation } from "./loop.js";

/** In-memory ring buffer for workflow debug logs (last 200 entries). */
const _debugLog: string[] = [];
function wfLog(msg: string) {
  const ts = new Date().toISOString();
  const entry = `[${ts}] ${msg}`;
  _debugLog.push(entry);
  if (_debugLog.length > 200) _debugLog.shift();
  console.log(msg);
}
export function getWorkflowDebugLog(): string[] { return _debugLog; }

export interface EvalDefinition {
  states: Record<string, StateDefinition>;
}

export interface WorkflowStep {
  goal: string;
  app?: string;
  maxSteps?: number;
  retries?: number; // max retry attempts on failure (default: 0 = no retry)
  cache?: boolean; // explicit opt-in/out for deterministic flow caching (default: true for cacheable steps)
  eval?: EvalDefinition; // state-based evaluation criteria
  id?: string; // stable identifier for referencing from `when` conditions
  when?: Record<string, boolean | string | number>; // condition: ALL must match (AND semantics)
  forceStop?: boolean; // kill the app process before launching to ensure a clean start
  /** Preserved by resolveVariables() — the original goal text with {{placeholders}} intact */
  _goalTemplate?: string;
}

export interface RunWorkflowOptions {
  runId: string;
  deviceId: string;
  persistentDeviceId?: string;
  userId: string;
  name: string;
  steps: WorkflowStep[];
  llmConfig: LLMConfig;
  signal: AbortSignal;
  /** Resolved variable values (variable name → resolved string value) for cache key reconstruction */
  resolvedValues?: Record<string, string>;
}

/** Max time (ms) to wait for a device to reconnect after a disconnect */
const RECONNECT_TIMEOUT = 60_000; // 60 seconds
/** Poll interval when waiting for reconnection */
const RECONNECT_POLL_INTERVAL = 3_000; // 3 seconds

function buildGoal(step: WorkflowStep): string {
  return step.goal;
}

/**
 * Replay a cached deterministic flow on the device.
 *
 * Uses the recorded timeline (delays between steps from the original AI session)
 * to pace actions at the same rhythm the agent originally used. This naturally
 * accounts for screen transition times since the original session had to wait
 * for the LLM to "think" between actions, giving the UI time to settle.
 *
 * @param deviceId - The device to execute on
 * @param flowSteps - Deterministic flow steps
 * @param timeline - Delay in ms before each step (from original session timing)
 * @param appId - Optional app identifier
 * @returns `true` if all steps succeeded, `false` if any step failed.
 */
async function replayCachedFlow(
  deviceId: string,
  flowSteps: FlowStep[],
  timeline?: number[],
  appId?: string,
): Promise<boolean> {
  for (let i = 0; i < flowSteps.length; i++) {
    const step = flowSteps[i];
    try {
      // Wait according to the recorded timeline before executing this step
      const delay = timeline?.[i] ?? (i === 0 ? 0 : 2000);
      if (delay > 0) {
        wfLog(`[Workflow] Cached flow: waiting ${delay}ms before step ${i} (timeline)`);
        await new Promise((r) => setTimeout(r, delay));
      }

      const stepLabel = typeof step === "string" ? step : JSON.stringify(step);
      const result = await executeFlowStepWs(deviceId, step, appId);
      wfLog(`[Workflow] Cached flow step ${i}: ${stepLabel} → ${result.message}`);
      if (!result.success) {
        // For tap/longpress/find_and_tap that can't find the element, retry a few times
        // because the UI may still be transitioning
        const stepCmd = typeof step === "object" ? Object.keys(step).find(k => !k.startsWith("_")) : null;
        if ((stepCmd === "tap" || stepCmd === "longpress" || stepCmd === "find_and_tap") && result.message.includes("not found")) {
          let retryResult = result;
          for (let retry = 0; retry < 3; retry++) {
            wfLog(`[Workflow] Cached flow step ${i}: element not found, waiting 2s and retrying (${retry + 1}/3)`);
            await new Promise((r) => setTimeout(r, 2000));
            retryResult = await executeFlowStepWs(deviceId, step, appId);
            wfLog(`[Workflow] Cached flow step ${i} retry ${retry + 1}: ${retryResult.message}`);
            if (retryResult.success) break;
          }
          if (!retryResult.success) {
            wfLog(`[Workflow] Cached flow replay failed at step ${i}: ${retryResult.message}`);
            return false;
          }
        } else {
          wfLog(`[Workflow] Cached flow replay failed at step ${i}: ${result.message}`);
          return false;
        }
      }
    } catch (err) {
      wfLog(`[Workflow] Cached flow replay threw at step ${i}: ${err}`);
      return false;
    }
  }
  return true;
}

/**
 * Check if the abort was caused by a device disconnect (not a user-initiated stop).
 * If so, wait for the device to reconnect and reset the abort controller.
 * Returns the new (or existing) deviceId to use, or null if we should give up.
 */
async function waitForReconnect(
  deviceId: string,
  persistentDeviceId: string | undefined,
  trackingKey: string,
  userId: string,
  runId: string,
): Promise<string | null> {
  const active = activeSessions.get(trackingKey);
  if (!active || !active.deviceDisconnected) {
    // User-initiated stop, not a disconnect — don't wait
    return null;
  }

  console.log(`[Workflow ${runId}] Device disconnected, waiting up to ${RECONNECT_TIMEOUT / 1000}s for reconnection...`);
  sessions.notifyDashboard(userId, {
    type: "workflow_device_disconnected",
    runId,
    waitingForReconnect: true,
    timeoutSeconds: RECONNECT_TIMEOUT / 1000,
  } as any);

  const deadline = Date.now() + RECONNECT_TIMEOUT;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, RECONNECT_POLL_INTERVAL));

    // Check if user stopped the workflow while we were waiting
    const currentActive = activeSessions.get(trackingKey);
    if (!currentActive || (currentActive.abort.signal.aborted && !currentActive.deviceDisconnected)) {
      console.log(`[Workflow ${runId}] User stopped workflow while waiting for reconnect`);
      return null;
    }

    // Check if device has reconnected
    const device = sessions.getDevice(deviceId) ?? sessions.getDeviceByPersistentId(persistentDeviceId ?? "");
    if (device) {
      console.log(`[Workflow ${runId}] Device reconnected! Resuming workflow...`);

      // Create a fresh AbortController so the workflow can continue
      const newAbort = new AbortController();
      activeSessions.set(trackingKey, {
        ...currentActive!,
        abort: newAbort,
        deviceDisconnected: false,
      });

      sessions.notifyDashboard(userId, {
        type: "workflow_device_reconnected",
        runId,
      } as any);

      return device.deviceId; // May have changed on reconnect
    }
  }

  console.log(`[Workflow ${runId}] Device did not reconnect within ${RECONNECT_TIMEOUT / 1000}s, giving up`);
  return null;
}

/**
 * Get the current AbortSignal for this workflow (may have been replaced after reconnect).
 */
function getCurrentSignal(trackingKey: string, fallbackSignal: AbortSignal): AbortSignal {
  const active = activeSessions.get(trackingKey);
  return active?.abort.signal ?? fallbackSignal;
}

/**
 * Check if the signal abort was a user-initiated stop (not a device disconnect).
 */
function isUserStop(trackingKey: string): boolean {
  const active = activeSessions.get(trackingKey);
  if (!active) return true; // no session = treat as stop
  return active.abort.signal.aborted && !active.deviceDisconnected;
}

/**
 * Evaluate a `when` condition against collected eval states from previous steps.
 * ALL entries must match (AND semantics). Missing states = condition not met.
 */
function evaluateWhenCondition(
  when: Record<string, boolean | string | number>,
  evalStateMap: Map<string, Record<string, boolean | string | number>>
): { met: boolean; reason?: string } {
  for (const [key, expectedValue] of Object.entries(when)) {
    const dotIndex = key.indexOf(".");
    if (dotIndex === -1) {
      return { met: false, reason: `Invalid when key "${key}" — expected "stepId.stateName" format` };
    }
    const stepId = key.slice(0, dotIndex);
    const stateName = key.slice(dotIndex + 1);

    const stepStates = evalStateMap.get(stepId);
    if (!stepStates) {
      return { met: false, reason: `Step "${stepId}" has no eval states (not run or was skipped)` };
    }
    if (!(stateName in stepStates)) {
      return { met: false, reason: `State "${stateName}" not found in step "${stepId}"` };
    }
    if (stepStates[stateName] !== expectedValue) {
      return { met: false, reason: `${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(stepStates[stateName])}` };
    }
  }
  return { met: true };
}

export async function runWorkflowServer(options: RunWorkflowOptions): Promise<void> {
  const { runId, persistentDeviceId, userId, name, steps, llmConfig, resolvedValues } = options;
  let { deviceId } = options;
  const trackingKey = persistentDeviceId ?? deviceId;
  const stepResults: Array<{ goal: string; success: boolean; stepsUsed: number; sessionId?: string; resolvedBy?: string; error?: string; observations?: ScreenObservation[]; evalJudgment?: EvalJudgment; skipped?: boolean; skipReason?: string; stepId?: string }> = [];
  const evalStateMap = new Map<string, Record<string, boolean | string | number>>();

  wfLog(`[Workflow ${runId}] Starting: persistentDeviceId=${persistentDeviceId ?? "UNDEFINED"}, deviceId=${deviceId}, trackingKey=${trackingKey}`);

  /** Send a JSON message to the device WebSocket (if still connected) */
  const sendToDevice = (msg: Record<string, unknown>) => {
    const d = sessions.getDevice(deviceId) ?? sessions.getDeviceByPersistentId(persistentDeviceId ?? "");
    if (!d) return;
    try { d.ws.send(JSON.stringify(msg)); } catch { /* disconnected */ }
  };

  try {
    // Notify device so it hides the overlay / shows running state
    sendToDevice({ type: "goal_started", goal: `Workflow: ${name}` });

    sessions.notifyDashboard(userId, {
      type: "workflow_started",
      runId,
      name,
      wfType: "workflow",
      totalSteps: steps.length,
      stepGoals: steps.map((s) => ({ goal: s.goal, app: s.app })),
    } as any);

    for (let i = 0; i < steps.length; i++) {
      let signal = getCurrentSignal(trackingKey, options.signal);

      const activeAtTop = activeSessions.get(trackingKey);
      wfLog(`[Workflow ${runId}] Step ${i}: signal.aborted=${signal.aborted}, activeSession=${!!activeAtTop}, deviceDisconnected=${activeAtTop?.deviceDisconnected}, isUserStop=${isUserStop(trackingKey)}, trackingKey=${trackingKey}`);

      // Check for user-initiated stop at the top of each step
      if (signal.aborted && isUserStop(trackingKey)) {
        wfLog(`[Workflow ${runId}] STOPPING at step ${i}: signal aborted + isUserStop=true, activeSession=${!!activeSessions.get(trackingKey)}`);
        await db.update(workflowRun).set({ status: "stopped", stepResults, completedAt: new Date() }).where(eq(workflowRun.id, runId));
        sessions.notifyDashboard(userId, { type: "workflow_stopped", runId } as any);
        sendToDevice({ type: "goal_completed", success: false, stepsUsed: 0 });
        return;
      }

      // If signal was aborted by disconnect, try to wait for reconnect before this step
      if (signal.aborted) {
        const newDeviceId = await waitForReconnect(deviceId, persistentDeviceId, trackingKey, userId, runId);
        if (!newDeviceId) {
          // Couldn't reconnect — mark workflow as failed
          await db.update(workflowRun).set({ status: "failed", stepResults, completedAt: new Date() }).where(eq(workflowRun.id, runId));
          sessions.notifyDashboard(userId, { type: "workflow_completed", runId, success: false, stepResults } as any);
          sendToDevice({ type: "goal_completed", success: false, stepsUsed: stepResults.reduce((sum, r) => sum + r.stepsUsed, 0) });
          return;
        }
        deviceId = newDeviceId;
        signal = getCurrentSignal(trackingKey, options.signal);
      }

      const step = steps[i];

      // ── Evaluate `when` condition — skip step if not met ──
      if (step.when) {
        const { met, reason } = evaluateWhenCondition(step.when, evalStateMap);
        if (!met) {
          const skipReason = reason ?? "when condition not met";
          wfLog(`[Workflow ${runId}] Step ${i} skipped: ${skipReason}`);

          stepResults.push({
            goal: step.goal,
            success: true,
            stepsUsed: 0,
            skipped: true,
            skipReason,
            stepId: step.id,
          });

          // Update DB and notify dashboard
          await db.update(workflowRun).set({
            currentStep: i + 1,
            stepResults: stepResults,
          }).where(eq(workflowRun.id, runId));

          sessions.notifyDashboard(userId, {
            type: "workflow_step_done",
            runId,
            stepIndex: i,
            success: true,
            stepsUsed: 0,
            skipped: true,
            skipReason,
          } as any);

          continue;
        }
      }

      // ── Clean slate between steps: collapse notification shade ──
      // Cached flow replays can leave the notification shade open (e.g., a
      // downward swipe from step 1 pulls it down). Collapse it before each step.
      try {
        await sessions.sendCommand(deviceId, { type: "shell", text: "cmd statusbar collapse" });
      } catch { /* ignore — device may not support it */ }

      const effectiveGoal = buildGoal(step);

      sessions.notifyDashboard(userId, {
        type: "workflow_step_start",
        runId,
        stepIndex: i,
        goal: step.goal,
        maxRetries: step.retries ?? 0,
      } as any);

      const maxRetries = step.retries ?? 0;
      let stepSuccess = false;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        signal = getCurrentSignal(trackingKey, options.signal);

        wfLog(`[Workflow ${runId}] Step ${i} attempt ${attempt}: pre-check signal.aborted=${signal.aborted}, isUserStop=${isUserStop(trackingKey)}`);

        // Check for user-initiated stop
        if (signal.aborted && isUserStop(trackingKey)) {
          wfLog(`[Workflow ${runId}] Step ${i} attempt ${attempt}: breaking due to user stop`);
          break;
        }

        // If signal aborted by disconnect, wait for reconnect before this attempt
        if (signal.aborted) {
          console.log(`[Workflow ${runId}] Device disconnected before step ${i} attempt ${attempt + 1}, waiting for reconnect...`);
          const newDeviceId = await waitForReconnect(deviceId, persistentDeviceId, trackingKey, userId, runId);
          if (!newDeviceId) {
            // Couldn't reconnect — record a failed result and break
            stepResults.push({ goal: step.goal, success: false, stepsUsed: 0, error: "Device disconnected and did not reconnect" });
            break;
          }
          deviceId = newDeviceId;
          signal = getCurrentSignal(trackingKey, options.signal);
          // Re-notify device after reconnection
          sendToDevice({ type: "goal_started", goal: `Workflow: ${name}` });
        }

        // Launch app fresh — go Home first to dismiss any overlays,
        // then launch the app. The companion app uses
        // FLAG_ACTIVITY_CLEAR_TASK so the entire task stack is cleared
        // and the app restarts from its main activity.
        // If forceStop is set, kill the app process first to ensure
        // a completely clean start (e.g., dismiss multi-account choosers).
        if (step.app) {
          try {
            if (step.forceStop) {
              await sessions.sendCommand(deviceId, { type: "kill_app", packageName: step.app });
              await new Promise((r) => setTimeout(r, 500));
            }
            await sessions.sendCommand(deviceId, { type: "home" });
            await new Promise((r) => setTimeout(r, 500));
            await sessions.sendCommand(deviceId, { type: "launch", packageName: step.app });
            await new Promise((r) => setTimeout(r, 2500));
          } catch (err) {
            console.warn(`[Workflow] Failed to launch ${step.app}: ${err}`);
          }
        }

        // ── Cache lookup: try to replay a cached deterministic flow ──
        const stepCacheable = isCacheable(step);
        const pdevId = persistentDeviceId ?? "UNDEFINED";
        wfLog(`[Workflow ${runId}] Step ${i}: cache lookup check: stepCacheable=${stepCacheable}, persistentDeviceId=${pdevId}, userId=${userId}`);
        if (stepCacheable && persistentDeviceId) {
          const goalKey = normalizeGoalKey(step._goalTemplate ?? step.goal);
          const appPackage = step.app ?? null;

          try {
            const cached = await db
              .select()
              .from(cachedFlow)
              .where(
                and(
                  eq(cachedFlow.userId, userId),
                  eq(cachedFlow.deviceId, persistentDeviceId),
                  eq(cachedFlow.goalKey, goalKey),
                  appPackage ? eq(cachedFlow.appPackage, appPackage) : sql`${cachedFlow.appPackage} IS NULL`,
                )
              )
              .limit(1);

            if (cached.length > 0) {
              const cachedEntry = cached[0];
              const rawFlowSteps = cachedEntry.steps as FlowStep[];
              const cachedTimeline = cachedEntry.timeline as number[] | null;
              const resolvedFlowSteps = resolveFlowVariables(rawFlowSteps, resolvedValues ?? {});

              wfLog(`[Workflow ${runId}] Step ${i}: replaying cached flow (${resolvedFlowSteps.length} steps, timeline=${cachedTimeline ? "yes" : "no"}, success=${cachedEntry.successCount}, fail=${cachedEntry.failCount})`);

              const replayOk = await replayCachedFlow(deviceId, resolvedFlowSteps, cachedTimeline ?? undefined, step.app);
              if (replayOk) {
                // Cache hit success — update stats (reset failCount on success)
                await db
                  .update(cachedFlow)
                  .set({
                    successCount: sql`${cachedFlow.successCount} + 1`,
                    failCount: 0,
                    lastUsedAt: new Date(),
                  })
                  .where(eq(cachedFlow.id, cachedEntry.id));

                stepResults.push({
                  goal: step.goal,
                  success: true,
                  stepsUsed: resolvedFlowSteps.length,
                  resolvedBy: "cached_flow",
                });
                stepSuccess = true;
                wfLog(`[Workflow ${runId}] Step ${i}: cached flow replay SUCCESS`);
                break; // Success — move to next step
              } else {
                // Cache replay failed — increment failCount, delete only after 3 consecutive failures
                const newFailCount = (cachedEntry.failCount ?? 0) + 1;
                const MAX_CONSECUTIVE_FAILS = 3;

                if (newFailCount >= MAX_CONSECUTIVE_FAILS) {
                  wfLog(`[Workflow ${runId}] Step ${i}: cached flow replay FAILED (${newFailCount}/${MAX_CONSECUTIVE_FAILS} consecutive), deleting stale cache`);
                  await db.delete(cachedFlow).where(eq(cachedFlow.id, cachedEntry.id));
                } else {
                  wfLog(`[Workflow ${runId}] Step ${i}: cached flow replay FAILED (${newFailCount}/${MAX_CONSECUTIVE_FAILS} consecutive), keeping cache, falling through to AI`);
                  await db
                    .update(cachedFlow)
                    .set({ failCount: newFailCount })
                    .where(eq(cachedFlow.id, cachedEntry.id));
                }

                // Re-launch app since cached flow may have left UI in a bad state
                if (step.app) {
                  try {
                    await sessions.sendCommand(deviceId, { type: "home" });
                    await new Promise((r) => setTimeout(r, 500));
                    await sessions.sendCommand(deviceId, { type: "launch", packageName: step.app });
                    await new Promise((r) => setTimeout(r, 2000));
                  } catch { /* ignore */ }
                }
              }
            }
          } catch (cacheErr) {
            // Cache lookup/replay error — non-fatal, fall through to AI
            wfLog(`[Workflow ${runId}] Step ${i}: cache lookup error: ${cacheErr}`);
          }
        }

        // ── AI execution: run the full LLM pipeline ──
        try {
          wfLog(`[Workflow ${runId}] Step ${i} attempt ${attempt}: calling runPipeline...`);
          const result = await runPipeline({
            deviceId,
            persistentDeviceId,
            userId,
            goal: effectiveGoal,
            llmConfig,
            maxSteps: step.maxSteps,
            signal,
          });

          wfLog(`[Workflow ${runId}] Step ${i} attempt ${attempt}: pipeline returned success=${result.success}, stepsUsed=${result.stepsUsed}, resolvedBy=${result.resolvedBy}`);

          const isSuccess = result.success;

          // ── Eval judge: evaluate step state if eval definition is present ──
          let evalJudgment: EvalJudgment | undefined;
          let evalSuccess = isSuccess;

          if (step.eval && step.eval.states && Object.keys(step.eval.states).length > 0) {
            try {
              // Fetch agent step records for this session's transcript
              const agentSteps = await db
                .select()
                .from(agentStep)
                .where(eq(agentStep.sessionId, result.sessionId))
                .orderBy(asc(agentStep.stepNumber));

              const transcript: AgentStepRecord[] = agentSteps.map((s) => ({
                stepNumber: s.stepNumber,
                action: s.action as Record<string, unknown> | null,
                reasoning: s.reasoning,
                result: s.result,
                packageName: s.packageName,
              }));

              evalJudgment = await evaluateStep(
                step.goal,
                result.observations,
                transcript,
                step.eval.states,
                llmConfig,
              );

              // Eval success overrides agent success
              evalSuccess = evalJudgment.success;
              wfLog(`[Workflow ${runId}] Step ${i} eval: ${evalJudgment.success ? "PASS" : "FAIL"} (agent said: ${isSuccess}, mismatches: ${evalJudgment.mismatches.length})`);
            } catch (err) {
              wfLog(`[Workflow ${runId}] Eval judge failed for step ${i}: ${err}`);
              // On eval failure, fall back to agent's success
              evalSuccess = isSuccess;
            }
          }

          if (evalSuccess) {
            stepResults.push({ goal: step.goal, success: true, stepsUsed: result.stepsUsed, sessionId: result.sessionId, resolvedBy: result.resolvedBy, observations: result.observations, evalJudgment, stepId: step.id });
            stepSuccess = true;

            // ── Populate evalStateMap for `when` condition resolution ──
            if (step.id && evalJudgment?.stateValues) {
              evalStateMap.set(step.id, evalJudgment.stateValues);
            }

            // ── Cache save: compile the successful AI session into a deterministic flow ──
            wfLog(`[Workflow ${runId}] Step ${i}: cache save check: stepCacheable=${stepCacheable}, persistentDeviceId=${persistentDeviceId ?? "UNDEFINED"}, sessionId=${result.sessionId ?? "UNDEFINED"}`);
            if (stepCacheable && persistentDeviceId && result.sessionId) {
              try {
                const sessionSteps = await db
                  .select({ action: agentStep.action, result: agentStep.result, timestamp: agentStep.timestamp })
                  .from(agentStep)
                  .where(eq(agentStep.sessionId, result.sessionId))
                  .orderBy(agentStep.stepNumber);

                const compiled = compileSessionToFlow(
                  sessionSteps as Array<{ action: Record<string, unknown> | null; result: string | null; timestamp?: Date | null }>,
                  step.app,
                  resolvedValues,
                );

                wfLog(`[Workflow ${runId}] Step ${i}: compileSessionToFlow returned ${compiled ? compiled.steps.length + " steps" : "NULL"} (from ${sessionSteps.length} raw steps)`);

                if (compiled) {
                  const goalKey = normalizeGoalKey(step._goalTemplate ?? step.goal);
                  // Remove any existing cache entry for this goal (handles re-discovery after failure)
                  await db.delete(cachedFlow).where(
                    and(
                      eq(cachedFlow.userId, userId),
                      eq(cachedFlow.deviceId, persistentDeviceId),
                      eq(cachedFlow.goalKey, goalKey),
                      step.app ? eq(cachedFlow.appPackage, step.app) : sql`${cachedFlow.appPackage} IS NULL`,
                    )
                  );
                  await db.insert(cachedFlow).values({
                    id: crypto.randomUUID(),
                    userId,
                    deviceId: persistentDeviceId,
                    goalKey,
                    appPackage: step.app ?? null,
                    steps: compiled.steps as any,
                    timeline: compiled.timeline as any,
                    sourceSessionId: result.sessionId,
                  });
                  wfLog(`[Workflow ${runId}] Step ${i}: compiled and cached deterministic flow (${compiled.steps.length} steps, timeline: [${compiled.timeline.join(", ")}]ms)`);

                  // Notify dashboard that a new cached flow was compiled
                  sessions.notifyDashboard(userId, {
                    type: "cached_flow_compiled",
                    runId,
                    stepIndex: i,
                    deviceId: persistentDeviceId,
                    goalKey,
                    appPackage: step.app ?? null,
                    stepCount: compiled.steps.length,
                  } as any);
                }
              } catch (cacheErr) {
                // Cache save error — non-fatal, just log
                wfLog(`[Workflow ${runId}] Step ${i}: cache save error: ${cacheErr}`);
              }
            }

            break; // Success — move to next step
          }

          // Failed — log attempt and retry if attempts remain
          if (attempt < maxRetries) {
            console.log(`[Workflow] Step ${i} attempt ${attempt + 1}/${maxRetries + 1} failed (stepsUsed=${result.stepsUsed}), retrying...`);
            sessions.notifyDashboard(userId, {
              type: "workflow_step_retry",
              runId, stepIndex: i,
              attempt: attempt + 1,
              maxRetries: maxRetries + 1,
              stepsUsed: result.stepsUsed,
            } as any);
          } else {
            // All retries exhausted
            stepResults.push({ goal: step.goal, success: false, stepsUsed: result.stepsUsed, sessionId: result.sessionId, resolvedBy: result.resolvedBy, observations: result.observations, evalJudgment });
          }
        } catch (err) {
          wfLog(`[Workflow ${runId}] Step ${i} attempt ${attempt}: pipeline THREW: ${err}`);
          if (attempt < maxRetries) {
            console.log(`[Workflow] Step ${i} attempt ${attempt + 1}/${maxRetries + 1} threw error, retrying... Error: ${err}`);
            sessions.notifyDashboard(userId, {
              type: "workflow_step_retry",
              runId, stepIndex: i,
              attempt: attempt + 1,
              maxRetries: maxRetries + 1,
              stepsUsed: 0,
            } as any);
          } else {
            stepResults.push({ goal: step.goal, success: false, stepsUsed: 0, error: String(err) });
          }
        }
      }

      // Safety: ensure a stepResult was always pushed for this step
      if (stepResults.length <= i) {
        signal = getCurrentSignal(trackingKey, options.signal);
        wfLog(`[Workflow ${runId}] Step ${i}: SAFETY CHECK - no result pushed. signal.aborted=${signal.aborted}, isUserStop=${isUserStop(trackingKey)}, activeSession=${!!activeSessions.get(trackingKey)}`);
        if (signal.aborted && isUserStop(trackingKey)) {
          // User stopped — don't push a fake result, just mark as stopped
          await db.update(workflowRun).set({ status: "stopped", stepResults, completedAt: new Date() }).where(eq(workflowRun.id, runId));
          sessions.notifyDashboard(userId, { type: "workflow_stopped", runId } as any);
          sendToDevice({ type: "goal_completed", success: false, stepsUsed: stepResults.reduce((sum, r) => sum + r.stepsUsed, 0) });
          return;
        }
        // Abort without user stop = device disconnect that couldn't recover
        stepResults.push({ goal: step.goal, success: false, stepsUsed: 0, error: "Step aborted (device disconnected)" });
      }

      // Update DB and check result
      await db.update(workflowRun).set({
        currentStep: i + 1,
        stepResults: stepResults,
      }).where(eq(workflowRun.id, runId));

      const lastResult = stepResults[stepResults.length - 1];
      sessions.notifyDashboard(userId, {
        type: "workflow_step_done",
        runId,
        stepIndex: i,
        success: stepSuccess,
        stepsUsed: lastResult?.stepsUsed ?? 0,
        resolvedBy: lastResult?.resolvedBy,
        error: lastResult?.error,
      } as any);

      if (!stepSuccess) {
        await db.update(workflowRun).set({
          status: "failed",
          stepResults,
          completedAt: new Date(),
        }).where(eq(workflowRun.id, runId));

        sessions.notifyDashboard(userId, {
          type: "workflow_completed",
          runId,
          success: false,
          stepResults,
        } as any);
        sendToDevice({ type: "goal_completed", success: false, stepsUsed: stepResults.reduce((sum, r) => sum + r.stepsUsed, 0) });
        return;
      }
    }

    // All steps completed successfully
    await db.update(workflowRun).set({
      status: "completed",
      stepResults,
      completedAt: new Date(),
    }).where(eq(workflowRun.id, runId));

    sessions.notifyDashboard(userId, {
      type: "workflow_completed",
      runId,
      success: true,
      stepResults,
    } as any);
    sendToDevice({ type: "goal_completed", success: true, stepsUsed: stepResults.reduce((sum, r) => sum + r.stepsUsed, 0) });

  } catch (err) {
    // Top-level safety net — ensure the workflow is always marked as finished
    console.error(`[Workflow ${runId}] Unexpected error: ${err}`);
    try {
      await db.update(workflowRun).set({
        status: "failed",
        stepResults,
        completedAt: new Date(),
      }).where(eq(workflowRun.id, runId));

      sessions.notifyDashboard(userId, {
        type: "workflow_completed",
        runId,
        success: false,
        stepResults,
      } as any);
      sendToDevice({ type: "goal_completed", success: false, stepsUsed: stepResults.reduce((sum, r) => sum + r.stepsUsed, 0) });
    } catch (dbErr) {
      console.error(`[Workflow ${runId}] Failed to update DB after error: ${dbErr}`);
    }
  }
}
