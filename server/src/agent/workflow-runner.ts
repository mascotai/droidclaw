import { sessions } from "../ws/sessions.js";
import { db } from "../db.js";
import { workflowRun, recipe, step as stepTable } from "../schema.js";
import { eq, and, asc, sql } from "drizzle-orm";
import { runPipeline } from "./pipeline.js";
import { executeRecipeStep } from "./recipe-runner.js";
import { compileGoalRunToRecipe, normalizeGoalKey, isCacheable, resolveRecipeVariables } from "./recipe-compiler.js";
import type { RecipeStep } from "./recipe-compiler.js";
import { activeSessions } from "./active-sessions.js";
import { evaluateStep, type EvalJudgment, type StateDefinition, type AgentStepRecord } from "./eval-judge.js";
import { createGoalRun, completeGoalRun } from "./goal-run-manager.js";
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
 * @param recipeSteps - Deterministic recipe steps
 * @param timeline - Delay in ms before each step (from original session timing)
 * @param appId - Optional app identifier
 * @returns `true` if all steps succeeded, `false` if any step failed.
 */
async function replayCachedFlow(
  deviceId: string,
  recipeSteps: RecipeStep[],
  timeline?: number[],
  appId?: string,
): Promise<boolean> {
  for (let i = 0; i < recipeSteps.length; i++) {
    const step = recipeSteps[i];
    try {
      // Wait according to the recorded timeline before executing this step
      const delay = timeline?.[i] ?? (i === 0 ? 0 : 2000);
      if (delay > 0) {
        wfLog(`[Workflow] Cached flow: waiting ${delay}ms before step ${i} (timeline)`);
        await new Promise((r) => setTimeout(r, delay));
      }

      const stepLabel = typeof step === "string" ? step : JSON.stringify(step);
      const result = await executeRecipeStep(deviceId, step, appId);
      wfLog(`[Workflow] Cached flow step ${i}: ${stepLabel} → ${result.message}`);
      if (!result.success) {
        // For tap/longpress/find_and_tap that can't find the element, retry a few times
        // because the UI may still be transitioning
        const stepCmd = typeof step === "object" ? Object.keys(step).find(k => !k.startsWith("_")) : null;
        if ((stepCmd === "tap" || stepCmd === "longpress" || stepCmd === "find_and_tap") && result.message.includes("not found")) {
          let retryResult = result;
          for (let retry = 0; retry < 5; retry++) {
            wfLog(`[Workflow] Cached flow step ${i}: element not found, waiting 3s and retrying (${retry + 1}/5)`);
            await new Promise((r) => setTimeout(r, 3000));
            retryResult = await executeRecipeStep(deviceId, step, appId);
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
  const stepResults: Array<{ goal: string; success: boolean; stepsUsed: number; sessionId?: string; resolvedBy?: string; cachedFlowId?: string; error?: string; observations?: ScreenObservation[]; evalJudgment?: EvalJudgment; skipped?: boolean; skipReason?: string; stepId?: string }> = [];
  const evalStateMap = new Map<string, Record<string, boolean | string | number>>();

  wfLog(`[Workflow ${runId}] Starting: persistentDeviceId=${persistentDeviceId ?? "UNDEFINED"}, deviceId=${deviceId}, trackingKey=${trackingKey}`);

  // ── Build set of eval state keys that have downstream `when` handlers ──
  // When a step's eval fails but ALL mismatched states are referenced by a
  // downstream `when` condition, the workflow continues instead of failing.
  // The `when` system handles the branching/recovery.
  const handledStateKeys = new Set<string>();
  for (const s of steps) {
    if (s.when) {
      for (const key of Object.keys(s.when)) {
        handledStateKeys.add(key);
      }
    }
  }
  if (handledStateKeys.size > 0) {
    wfLog(`[Workflow ${runId}] Handled eval state keys (via when): ${[...handledStateKeys].join(", ")}`);
  }

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

          // Create + complete a goal_run for the skipped step
          if (persistentDeviceId) {
            try {
              const skipGoalRunId = await createGoalRun({
                userId,
                deviceId: persistentDeviceId,
                goal: step.goal,
                app: step.app,
                workflowRunId: runId,
                stepIndex: i,
                maxSteps: step.maxSteps,
                evalDefinition: (step.eval as unknown as Record<string, unknown> | undefined) ?? null,
              });
              await completeGoalRun(skipGoalRunId, {
                status: "skipped",
                resolvedBy: "discovery",
                stepsUsed: 0,
              });
            } catch (err) {
              wfLog(`[Workflow ${runId}] Step ${i}: failed to create/complete skipped goal_run: ${err}`);
            }
          }

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
      const stepCacheable = isCacheable(step);
      let usedRecipeId: string | undefined;

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

        // ── Create goal_run row for this step ──
        let currentGoalRunId: string | undefined;
        if (persistentDeviceId) {
          try {
            currentGoalRunId = await createGoalRun({
              userId,
              deviceId: persistentDeviceId,
              goal: step.goal,
              app: step.app,
              workflowRunId: runId,
              stepIndex: i,
              maxSteps: step.maxSteps,
              evalDefinition: (step.eval as unknown as Record<string, unknown> | undefined) ?? null,
            });
          } catch (err) {
            wfLog(`[Workflow ${runId}] Step ${i}: failed to create goal_run: ${err}`);
          }
        }

        // ── Cache lookup: try to replay a cached deterministic flow ──
        // Check both recipe table (new) and cachedFlow table (legacy) for cached replays
        const pdevId = persistentDeviceId ?? "UNDEFINED";
        wfLog(`[Workflow ${runId}] Step ${i}: cache lookup check: stepCacheable=${stepCacheable}, persistentDeviceId=${pdevId}, userId=${userId}`);
        if (stepCacheable && persistentDeviceId) {
          const goalKey = normalizeGoalKey(step._goalTemplate ?? step.goal);
          const appPackage = step.app ?? null;

          try {
            // Look up recipe from recipe table
            let cachedEntry: { id: string; steps: unknown; timeline: unknown; successCount: number | null; failCount: number | null } | null = null;

            const recipes = await db
              .select()
              .from(recipe)
              .where(
                and(
                  eq(recipe.userId, userId),
                  eq(recipe.deviceId, persistentDeviceId),
                  eq(recipe.goalKey, goalKey),
                  appPackage ? eq(recipe.appPackage, appPackage) : sql`${recipe.appPackage} IS NULL`,
                  eq(recipe.active, true),
                )
              )
              .limit(1);

            if (recipes.length > 0) {
              cachedEntry = recipes[0];
            }

            if (cachedEntry) {
              const rawRecipeSteps = cachedEntry.steps as RecipeStep[];
              const cachedTimeline = cachedEntry.timeline as number[] | null;
              const resolvedRecipeSteps = resolveRecipeVariables(rawRecipeSteps, resolvedValues ?? {});

              wfLog(`[Workflow ${runId}] Step ${i}: replaying recipe (${resolvedRecipeSteps.length} steps, timeline=${cachedTimeline ? "yes" : "no"}, success=${cachedEntry.successCount}, fail=${cachedEntry.failCount})`);

              const replayOk = await replayCachedFlow(deviceId, resolvedRecipeSteps, cachedTimeline ?? undefined, step.app);
              if (replayOk) {
                // Cache hit success — update stats (reset failCount on success)
                await db
                  .update(recipe)
                  .set({
                    successCount: sql`${recipe.successCount} + 1`,
                    failCount: 0,
                    lastUsedAt: new Date(),
                  } as any)
                  .where(eq(recipe.id, cachedEntry.id));

                usedRecipeId = cachedEntry.id;
                stepResults.push({
                  goal: step.goal,
                  success: true,
                  stepsUsed: resolvedRecipeSteps.length,
                  resolvedBy: "recipe",
                  cachedFlowId: cachedEntry.id,
                });
                stepSuccess = true;
                wfLog(`[Workflow ${runId}] Step ${i}: recipe replay SUCCESS`);

                // Complete goal_run for cache hit
                if (currentGoalRunId) {
                  completeGoalRun(currentGoalRunId, {
                    status: "completed",
                    resolvedBy: "recipe",
                    stepsUsed: resolvedRecipeSteps.length,
                    recipeId: usedRecipeId,
                  }).catch(err => wfLog(`[Workflow ${runId}] Step ${i}: failed to complete goal_run: ${err}`));
                }

                break; // Success — move to next step
              } else {
                // Cache replay failed — increment failCount, deactivate after 3 consecutive failures
                const newFailCount = (cachedEntry.failCount ?? 0) + 1;
                const MAX_CONSECUTIVE_FAILS = 3;

                if (newFailCount >= MAX_CONSECUTIVE_FAILS) {
                  wfLog(`[Workflow ${runId}] Step ${i}: recipe replay FAILED (${newFailCount}/${MAX_CONSECUTIVE_FAILS} consecutive), deactivating stale cache`);
                  await db
                    .update(recipe)
                    .set({ failCount: newFailCount, active: false } as any)
                    .where(eq(recipe.id, cachedEntry.id));
                } else {
                  wfLog(`[Workflow ${runId}] Step ${i}: recipe replay FAILED (${newFailCount}/${MAX_CONSECUTIVE_FAILS} consecutive), keeping cache, falling through to AI`);
                  await db
                    .update(recipe)
                    .set({ failCount: newFailCount } as any)
                    .where(eq(recipe.id, cachedEntry.id));
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
            goalRunId: currentGoalRunId,
          });

          wfLog(`[Workflow ${runId}] Step ${i} attempt ${attempt}: pipeline returned success=${result.success}, stepsUsed=${result.stepsUsed}, resolvedBy=${result.resolvedBy}`);

          const isSuccess = result.success;

          // ── Eval judge: evaluate step state if eval definition is present ──
          let evalJudgment: EvalJudgment | undefined;
          let evalSuccess = isSuccess;

          if (step.eval && step.eval.states && Object.keys(step.eval.states).length > 0) {
            try {
              // Fetch step records from the new step table for this goal run's transcript
              const goalRunSteps = currentGoalRunId ? await db
                .select()
                .from(stepTable)
                .where(eq(stepTable.goalRunId, currentGoalRunId))
                .orderBy(asc(stepTable.stepNumber)) : [];

              const transcript: AgentStepRecord[] = goalRunSteps.map((s) => ({
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

          // ── Always populate evalStateMap so `when` conditions work regardless of eval pass/fail ──
          if (step.id && evalJudgment?.stateValues) {
            evalStateMap.set(step.id, evalJudgment.stateValues);
          }

          if (evalSuccess) {
            stepResults.push({ goal: step.goal, success: true, stepsUsed: result.stepsUsed, sessionId: result.sessionId, resolvedBy: result.resolvedBy, observations: result.observations, evalJudgment, stepId: step.id });
            stepSuccess = true;

            // Complete goal_run for pipeline success
            if (currentGoalRunId) {
              completeGoalRun(currentGoalRunId, {
                status: "completed",
                resolvedBy: "discovery",
                stepsUsed: result.stepsUsed,
                recipeId: usedRecipeId,
                evalPassed: evalJudgment?.success,
                evalStateValues: evalJudgment?.stateValues,
                evalMismatches: evalJudgment?.mismatches,
              }).catch(err => wfLog(`[Workflow ${runId}] Step ${i}: failed to complete goal_run: ${err}`));
            }

            // ── Cache save: compile the successful AI session into a deterministic flow ──
            wfLog(`[Workflow ${runId}] Step ${i}: cache save check: stepCacheable=${stepCacheable}, persistentDeviceId=${persistentDeviceId ?? "UNDEFINED"}, sessionId=${result.sessionId ?? "UNDEFINED"}`);
            if (stepCacheable && persistentDeviceId && currentGoalRunId) {
              try {
                const sessionSteps = await db
                  .select({ action: stepTable.action, result: stepTable.result, timestamp: stepTable.timestamp })
                  .from(stepTable)
                  .where(eq(stepTable.goalRunId, currentGoalRunId))
                  .orderBy(stepTable.stepNumber);

                const compiled = compileGoalRunToRecipe(
                  sessionSteps as Array<{ action: Record<string, unknown> | null; result: string | null; timestamp?: Date | null }>,
                  step.app,
                  resolvedValues,
                );

                wfLog(`[Workflow ${runId}] Step ${i}: compileGoalRunToRecipe returned ${compiled ? compiled.steps.length + " steps" : "NULL"} (from ${sessionSteps.length} raw steps)`);

                if (compiled) {
                  const goalKey = normalizeGoalKey(step._goalTemplate ?? step.goal);
                  // Deactivate any existing recipes for this goal (keep for history, mark inactive)
                  await db.update(recipe).set({ active: false }).where(
                    and(
                      eq(recipe.userId, userId),
                      eq(recipe.deviceId, persistentDeviceId),
                      eq(recipe.goalKey, goalKey),
                      step.app ? eq(recipe.appPackage, step.app) : sql`${recipe.appPackage} IS NULL`,
                    )
                  );

                  // Insert new recipe
                  const newRecipeId = crypto.randomUUID();
                  await db.insert(recipe).values({
                    id: newRecipeId,
                    userId,
                    deviceId: persistentDeviceId,
                    goalKey,
                    appPackage: step.app ?? null,
                    steps: compiled.steps as any,
                    timeline: compiled.timeline as any,
                    sourceGoalRunId: currentGoalRunId ?? null,
                  });
                  usedRecipeId = newRecipeId;

                  wfLog(`[Workflow ${runId}] Step ${i}: compiled and cached deterministic recipe (${compiled.steps.length} steps, timeline: [${compiled.timeline.join(", ")}]ms)`);

                  // Notify dashboard that a new recipe was compiled
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

          // ── Soft failure: eval mismatched but all mismatches have downstream `when` handlers ──
          if (evalJudgment && step.id && evalJudgment.mismatches.length > 0) {
            const unhandledMismatches = evalJudgment.mismatches.filter((m) => {
              const stateKey = `${step.id}.${m.key}`;
              return !handledStateKeys.has(stateKey);
            });

            if (unhandledMismatches.length === 0) {
              // ALL mismatches are handled by downstream `when` conditions → continue workflow
              wfLog(`[Workflow ${runId}] Step ${i} eval: SOFT FAIL — all ${evalJudgment.mismatches.length} mismatch(es) handled by downstream when conditions`);

              stepResults.push({
                goal: step.goal, success: true, stepsUsed: result.stepsUsed,
                sessionId: result.sessionId, resolvedBy: result.resolvedBy,
                observations: result.observations, evalJudgment, stepId: step.id,
              });
              stepSuccess = true;

              // Complete goal_run — eval recorded but didn't block
              if (currentGoalRunId) {
                completeGoalRun(currentGoalRunId, {
                  status: "completed",
                  resolvedBy: "discovery",
                  stepsUsed: result.stepsUsed,
                  evalPassed: false,
                  evalStateValues: evalJudgment.stateValues,
                  evalMismatches: evalJudgment.mismatches,
                }).catch(err => wfLog(`[Workflow ${runId}] Step ${i}: failed to complete goal_run: ${err}`));
              }

              // Don't compile recipe — eval mismatch means this path is conditional, not worth caching
              break;
            }
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

            // Complete goal_run for pipeline failure
            if (currentGoalRunId) {
              completeGoalRun(currentGoalRunId, {
                status: "failed",
                resolvedBy: "discovery",
                stepsUsed: result.stepsUsed,
                recipeId: usedRecipeId,
                evalPassed: evalJudgment?.success,
                evalStateValues: evalJudgment?.stateValues,
                evalMismatches: evalJudgment?.mismatches,
              }).catch(err => wfLog(`[Workflow ${runId}] Step ${i}: failed to complete goal_run: ${err}`));
            }
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

            // Complete goal_run for pipeline error
            if (currentGoalRunId) {
              completeGoalRun(currentGoalRunId, {
                status: "failed",
                resolvedBy: "discovery",
                stepsUsed: 0,
              }).catch(err2 => wfLog(`[Workflow ${runId}] Step ${i}: failed to complete goal_run: ${err2}`));
            }
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
