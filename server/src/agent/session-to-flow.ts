/**
 * Compiles a successful AI agent session into a deterministic flow
 * that can be replayed by the flow-runner without any LLM calls.
 *
 * The compiler filters out non-actionable steps, converts coordinate-based
 * taps into text-based targets, substitutes resolved variables back into
 * placeholders, and validates the result is stable enough to cache.
 */

export type FlowStep = string | { [key: string]: string | number | [number, number] };

// ── Element matching utility ────────────────────────────────────────────
// Pure function used by flow-runner during replay and available for testing.

/** Minimal shape required by findElementByText */
export interface TextMatchElement {
  text: string;
  hint?: string;
  id?: string;
  center: [number, number];
}

/**
 * Find a UI element by text query with 4-level fallback:
 *   1. Exact text match (case-insensitive)
 *   2. Partial text match (shortest wins)
 *   3. Hint match
 *   4. Resource ID match
 */
export function findElementByText<T extends TextMatchElement>(elements: T[], query: string): T | null {
  const q = query.toLowerCase();
  const exact = elements.find((el) => el.text && el.text.toLowerCase() === q);
  if (exact) return exact;
  const matches = elements
    .filter((el) => el.text && el.text.toLowerCase().includes(q))
    .sort((a, b) => a.text.length - b.text.length);
  if (matches.length > 0) return matches[0];
  const hintMatch = elements.find((el) => el.hint && el.hint.toLowerCase().includes(q));
  if (hintMatch) return hintMatch;
  const idMatch = elements.find((el) => el.id && el.id.toLowerCase().includes(q));
  if (idMatch) return idMatch;
  return null;
}

/** Action types that are observation-only and should not appear in a replay flow. */
const SKIP_ACTIONS = new Set([
  "wait",
  "done",
  "screenshot",
  "notifications",
  "clipboard_get",
  "read_screen",
  "copy_visible_text",
  "wait_for_content",
]);

/**
 * Compile an agent session's steps into a deterministic flow for the flow-runner.
 *
 * @param steps - Raw agent steps (action + result pairs from the agent_step table).
 * @param appPackage - Optional app package name; if provided, a `launch` step is prepended.
 * @param resolvedVariables - Optional map of variable name → resolved value.
 *   When a `type` action's text matches a resolved value, the compiled step
 *   uses the `{{variableName}}` placeholder instead of the literal value.
 * @returns An array of FlowStep objects ready for the flow-runner, or `null`
 *   if the session is too short, too unstable, or has no reliable tap targets.
 */
export function compileSessionToFlow(
  steps: Array<{
    action: Record<string, unknown> | null;
    result: string | null;
  }>,
  appPackage?: string,
  resolvedVariables?: Record<string, string>,
): FlowStep[] | null {
  const flow: FlowStep[] = [];

  // Prepend launch step if an app package is provided
  if (appPackage) {
    flow.push({ launch: appPackage });
  }

  // Build reverse lookup: resolved value → placeholder name
  const valueToPlaceholder = new Map<string, string>();
  if (resolvedVariables) {
    for (const [name, value] of Object.entries(resolvedVariables)) {
      if (value) {
        valueToPlaceholder.set(value, `{{${name}}}`);
      }
    }
  }

  for (let i = 0; i < steps.length; i++) {
    const { action, result } = steps[i];

    // Only include steps that succeeded
    if (!result || !action) continue;
    // Support both formats: structured JSON ({"success":true,...}) and legacy ("-> OK")
    const isSuccess = result.includes('"success":true') || result.includes("-> OK");
    if (!isSuccess) continue;

    const actionType = String(action.action ?? "").toLowerCase();

    // Skip observation-only action types
    if (SKIP_ACTIONS.has(actionType)) continue;

    const compiled = compileAction(actionType, action, i, steps, valueToPlaceholder);
    if (compiled !== null) {
      flow.push(compiled);
    }
  }

  // ── Validation: ensure the flow is worth caching ──

  // Count meaningful steps (exclude the prepended launch)
  const meaningfulSteps = appPackage ? flow.length - 1 : flow.length;
  if (meaningfulSteps < 2) return null;

  // Count scroll/swipe vs total
  const scrollSwipeCount = flow.filter((s) => {
    if (typeof s === "object") {
      const key = Object.keys(s)[0];
      return key === "scroll" || key === "swipe";
    }
    return false;
  }).length;

  if (scrollSwipeCount > flow.length / 2) return null;

  // Must have at least one text-based tap
  const hasTapWithTarget = flow.some(
    (s) => typeof s === "object" && ("tap" in s || "longpress" in s),
  );
  if (!hasTapWithTarget) return null;

  return flow;
}

/**
 * Compile a single action into a FlowStep.
 *
 * @returns A FlowStep, or `null` if the action should be skipped.
 */
function compileAction(
  actionType: string,
  action: Record<string, unknown>,
  index: number,
  allSteps: Array<{ action: Record<string, unknown> | null; result: string | null }>,
  valueToPlaceholder: Map<string, string>,
): FlowStep | null {
  switch (actionType) {
    // ── Tap ──
    case "tap": {
      const target = action.target as string | undefined;
      if (!target) return null; // coordinate-only taps are fragile
      return { tap: target };
    }

    // ── Long press ──
    case "longpress": {
      const target = action.target as string | undefined;
      if (!target) return null;
      return { longpress: target };
    }

    // ── Type / text input ──
    case "type": {
      const text = String(action.text ?? "");
      // Substitute resolved variable values back to placeholders
      const placeholder = valueToPlaceholder.get(text);
      return { type: placeholder ?? text };
    }

    // ── Scroll / swipe ──
    case "scroll":
      return { scroll: String(action.direction ?? "down") };
    case "swipe":
      return { swipe: String(action.direction ?? "down") };

    // ── Simple key actions ──
    case "enter":
      return "enter";
    case "home":
      return "home";
    case "clear":
      return "clear";

    // ── Back: skip if it looks like error recovery ──
    case "back":
      return isIntentionalBack(index, allSteps) ? "back" : null;

    // ── Launch ──
    case "launch":
      return { launch: String(action.package ?? "") };

    default:
      return null;
  }
}

/**
 * Determine whether a `back` action at the given index is intentional navigation
 * rather than error recovery.
 *
 * Heuristic: if the next successful step is a retry of a different action at the
 * same position (i.e., the step immediately after `back` has a different action
 * type than the step immediately before `back`), this was likely error recovery
 * and the `back` should be excluded.
 */
function isIntentionalBack(
  backIndex: number,
  allSteps: Array<{ action: Record<string, unknown> | null; result: string | null }>,
): boolean {
  // If there's no step before or after, treat as intentional
  if (backIndex === 0 || backIndex >= allSteps.length - 1) return true;

  const prevStep = allSteps[backIndex - 1];
  const nextStep = allSteps[backIndex + 1];

  if (!prevStep?.action || !nextStep?.action) return true;

  const prevType = String(prevStep.action.action ?? "").toLowerCase();
  const nextType = String(nextStep.action.action ?? "").toLowerCase();

  // If the action before back failed and the action after back is a different type,
  // this looks like error recovery: agent tried something, it failed, pressed back,
  // and tried a different approach.
  const prevSucceeded = prevStep.result != null &&
    (prevStep.result.includes('"success":true') || prevStep.result.includes("-> OK"));
  const prevFailed = prevStep.result != null && !prevSucceeded;
  if (prevFailed && prevType !== nextType) return false;

  return true;
}

/**
 * Normalize a goal string into a stable lookup key.
 *
 * - Lowercases the entire string
 * - Trims leading/trailing whitespace
 * - Collapses multiple whitespace characters into a single space
 * - Preserves `{{variable}}` placeholders as-is
 *
 * @param goal - The raw goal text.
 * @returns A normalized key suitable for cache lookups.
 */
export function normalizeGoalKey(goal: string): string {
  return goal.toLowerCase().trim().replace(/\s+/g, " ");
}

// ── Workflow step cacheability & variable resolution ─────────────────────
// These pure functions live here to keep them free of side-effect imports
// (DB, WebSocket, etc.) so they are easily testable.

export interface CacheableWorkflowStep {
  goal: string;
  app?: string;
  maxSteps?: number;
  formData?: Record<string, string>;
  retries?: number;
  exhaustIsSuccess?: boolean;
  cache?: boolean;
  _goalTemplate?: string;
}

/**
 * Determine if a workflow step is eligible for deterministic flow caching.
 *
 * Returns false for:
 * - Steps with `exhaustIsSuccess` (open-ended browsing — no stable "done" state)
 * - Steps with `cache: false` (explicit opt-out)
 * - Steps with formData (dynamic input that changes each run)
 */
export function isCacheable(step: CacheableWorkflowStep): boolean {
  if (step.cache === false) return false;
  if (step.exhaustIsSuccess) return false;
  if (step.formData && Object.keys(step.formData).length > 0) return false;
  return true;
}

/**
 * Resolve `{{variable}}` placeholders in cached flow steps using the resolved values map.
 */
export function resolveFlowVariables(
  flowSteps: FlowStep[],
  resolvedValues: Record<string, string>,
): FlowStep[] {
  if (Object.keys(resolvedValues).length === 0) return flowSteps;

  return flowSteps.map((step) => {
    if (typeof step === "string") return step;
    if (typeof step !== "object" || step === null) return step;

    const [command, value] = Object.entries(step)[0];
    if (typeof value !== "string") return step;

    // Replace {{var}} placeholders in the value
    const resolved = value.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) =>
      resolvedValues[key] !== undefined ? resolvedValues[key] : `{{${key}}}`
    );

    if (resolved === value) return step; // no change
    return { [command]: resolved };
  });
}
