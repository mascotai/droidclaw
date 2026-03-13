/**
 * Compiles a successful goal run into a deterministic recipe
 * that can be replayed by the recipe-runner without any LLM calls.
 *
 * The compiler filters out non-actionable steps, converts coordinate-based
 * taps into text-based targets, substitutes resolved variables back into
 * placeholders, and validates the result is stable enough to cache.
 */

export type RecipeStep = string | RecipeStepObject;

/** Object-form recipe step. Simple steps have one key (e.g. {tap: "Log in"}).
 *  Tap/longpress carry a stable resource ID fallback for resilient replay. */
export interface RecipeStepObject {
  [key: string]: string | number | [number, number] | undefined;
  /** Android resource ID of the element (e.g. "com.instagram.android:id/login_username").
   *  Most stable identifier — doesn't change between sessions. */
  _id?: string;
  /** Original tap coordinates from the session — last-resort fallback when
   *  neither resource ID nor text match finds the element. */
  _coords?: [number, number];
}

// ── Element matching utility ────────────────────────────────────────────
// Pure function used by recipe-runner during replay and available for testing.

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

/**
 * Find a UI element by its Android resource ID.
 */
export function findElementById<T extends TextMatchElement>(elements: T[], id: string): T | null {
  return elements.find((el) => el.id === id) ?? null;
}

/** Action types that are observation-only and should not appear in a replay recipe. */
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
 * Compile a goal run's steps into a deterministic recipe for the recipe-runner.
 *
 * @param steps - Raw agent steps (action + result pairs from the agent_step table).
 * @param appPackage - Optional app package name; if provided, a `launch` step is prepended.
 * @param resolvedVariables - Optional map of variable name → resolved value.
 *   When a `type` action's text matches a resolved value, the compiled step
 *   uses the `{{variableName}}` placeholder instead of the literal value.
 * @returns An array of RecipeStep objects ready for the recipe-runner, or `null`
 *   if the session is too short, too unstable, or has no reliable tap targets.
 */
/** Result of compiling a goal run into a cacheable recipe */
export interface CompiledRecipe {
  steps: RecipeStep[];
  /** Delay in ms to wait BEFORE executing each step (based on original session timing) */
  timeline: number[];
}

/**
 * Minimum delay between steps during replay (ms).
 * Even if the original session had a very fast transition, we never go below this
 * to give the UI time to settle after an action.
 */
const MIN_STEP_DELAY_MS = 800;

/**
 * Maximum delay between steps during replay (ms).
 * Caps extremely long gaps (e.g. user paused, LLM was slow) to a reasonable wait.
 */
const MAX_STEP_DELAY_MS = 8_000;

export function compileGoalRunToRecipe(
  steps: Array<{
    action: Record<string, unknown> | null;
    result: string | null;
    timestamp?: Date | string | null;
  }>,
  appPackage?: string,
  resolvedVariables?: Record<string, string>,
): CompiledRecipe | null {
  const recipe: RecipeStep[] = [];
  /** Timestamps of each compiled recipe step (from the original session) */
  const compiledTimestamps: (number | null)[] = [];

  // Prepend launch step if an app package is provided
  if (appPackage) {
    recipe.push({ launch: appPackage });
    compiledTimestamps.push(null); // no original timestamp for synthetic launch step
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
    const { action, result, timestamp } = steps[i];

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
      recipe.push(compiled);
      compiledTimestamps.push(timestamp ? new Date(timestamp).getTime() : null);
    }
  }

  // ── Validation: ensure the recipe is worth caching ──

  // Count meaningful steps (exclude the prepended launch)
  const meaningfulSteps = appPackage ? recipe.length - 1 : recipe.length;
  if (meaningfulSteps < 2) return null;

  // Count scroll/swipe vs total
  const scrollSwipeCount = recipe.filter((s) => {
    if (typeof s === "object") {
      const key = Object.keys(s)[0];
      return key === "scroll" || key === "swipe";
    }
    return false;
  }).length;

  if (scrollSwipeCount > recipe.length / 2) return null;

  // Must have at least one text-based tap
  const hasTapWithTarget = recipe.some(
    (s) => typeof s === "object" && ("tap" in s || "longpress" in s),
  );
  if (!hasTapWithTarget) return null;

  // ── Build timeline: delay in ms before each step ──
  const timeline = buildTimeline(compiledTimestamps);

  return { steps: recipe, timeline };
}

/**
 * Build a timeline of delays (ms) from the original session timestamps.
 *
 * For each step, the delay is the gap between this step's timestamp and the
 * previous step's timestamp, clamped to [MIN_STEP_DELAY_MS, MAX_STEP_DELAY_MS].
 *
 * The first step always gets 0 delay (no waiting before the very first action).
 * Steps without timestamps get a default delay of 2000ms.
 */
function buildTimeline(timestamps: (number | null)[]): number[] {
  const DEFAULT_DELAY_MS = 2000;
  const timeline: number[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    if (i === 0) {
      // No delay before the first step
      timeline.push(0);
      continue;
    }

    const curr = timestamps[i];
    const prev = timestamps[i - 1];

    if (curr != null && prev != null) {
      const gap = curr - prev;
      // Clamp to sensible range
      timeline.push(Math.max(MIN_STEP_DELAY_MS, Math.min(MAX_STEP_DELAY_MS, gap)));
    } else {
      // No timestamp data — use a safe default
      timeline.push(DEFAULT_DELAY_MS);
    }
  }

  return timeline;
}

/**
 * Compile a single action into a RecipeStep.
 *
 * @returns A RecipeStep, or `null` if the action should be skipped.
 */
function compileAction(
  actionType: string,
  action: Record<string, unknown>,
  index: number,
  allSteps: Array<{ action: Record<string, unknown> | null; result: string | null }>,
  valueToPlaceholder: Map<string, string>,
): RecipeStep | null {
  switch (actionType) {
    // ── Tap ──
    case "tap": {
      const target = action.target as string | undefined;
      if (!target) return null; // coordinate-only taps are fragile
      // Extract the stable resource ID and coordinates from the resolved match (set by agent loop)
      const resolved = action._resolved as { matchedId?: string; matchedCenter?: [number, number] } | undefined;
      const id = resolved?.matchedId;
      const coords = resolved?.matchedCenter;
      const step: RecipeStepObject = { tap: target };
      if (id) step._id = id;
      if (coords) step._coords = coords;
      return step;
    }

    // ── Long press ──
    case "longpress": {
      const target = action.target as string | undefined;
      if (!target) return null;
      const resolved = action._resolved as { matchedId?: string; matchedCenter?: [number, number] } | undefined;
      const id = resolved?.matchedId;
      const coords = resolved?.matchedCenter;
      const step: RecipeStepObject = { longpress: target };
      if (id) step._id = id;
      if (coords) step._coords = coords;
      return step;
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

    // ── find_and_tap: keep as its own step type so the recipe-runner can scroll to find it ──
    case "find_and_tap": {
      const query = action.query as string | undefined;
      if (!query) return null;
      return { find_and_tap: query };
    }

    // ── Dismiss popup (soft — replayed as optional tap) ──
    case "dismiss_popup": {
      const query = action.query as string | undefined;
      if (!query) return null;
      return { dismiss_popup: query };
    }

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
  retries?: number;
  cache?: boolean;
  _goalTemplate?: string;
}

/**
 * Determine if a workflow step is eligible for deterministic recipe caching.
 *
 * Returns false for:
 * - Steps with `cache: false` (explicit opt-out)
 */
export function isCacheable(step: CacheableWorkflowStep): boolean {
  if (step.cache === false) return false;
  return true;
}

/**
 * Resolve `{{variable}}` placeholders in cached recipe steps using the resolved values map.
 */
export function resolveRecipeVariables(
  recipeSteps: RecipeStep[],
  resolvedValues: Record<string, string>,
): RecipeStep[] {
  if (Object.keys(resolvedValues).length === 0) return recipeSteps;

  return recipeSteps.map((step) => {
    if (typeof step === "string") return step;
    if (typeof step !== "object" || step === null) return step;

    // Find the primary command entry (skip underscore-prefixed metadata keys)
    const entries = Object.entries(step);
    const cmdEntry = entries.find(([k]) => !k.startsWith("_"));
    if (!cmdEntry) return step;
    const [command, value] = cmdEntry;
    if (typeof value !== "string") return step;

    // Replace {{var}} placeholders in the value
    const resolved = value.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) =>
      resolvedValues[key] !== undefined ? resolvedValues[key] : `{{${key}}}`
    );

    if (resolved === value) return step; // no change
    return { ...step, [command]: resolved };
  });
}
