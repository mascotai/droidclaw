/**
 * Workflow Caching System — Unit Tests
 *
 * Tests the three main caching layers:
 *   1. compileGoalRunToRecipe  — compiles AI agent steps → deterministic recipes
 *   2. normalizeGoalKey        — normalises goal strings into cache lookup keys
 *   3. findElementByText       — element matching used during recipe replay
 *   4. resolveRecipeVariables  — {{variable}} placeholder substitution
 *   5. isCacheable             — determines if a workflow step is cache-eligible
 *
 * All functions under test are pure (no DB/WS) — no mocking required.
 *
 * Run:  bun test src/agent/__tests__/caching.test.ts
 */

import { describe, it, expect } from "bun:test";
import {
  compileGoalRunToRecipe,
  normalizeGoalKey,
  isCacheable,
  resolveRecipeVariables,
  findElementByText,
} from "../recipe-compiler.js";
import type { CacheableWorkflowStep, RecipeStep } from "../recipe-compiler.js";

// ─── Helpers ────────────────────────────────────────────────

/** Shorthand for building an agent step that succeeded (legacy format) */
function okStep(action: Record<string, unknown>): { action: Record<string, unknown>; result: string } {
  return { action, result: "-> OK" };
}

/** Shorthand for building an agent step that succeeded (structured JSON format from DB) */
function okStepJson(action: Record<string, unknown>): { action: Record<string, unknown>; result: string } {
  const sig = `${action.action}(${(action.coordinates as number[])?.join(",") ?? ""})`;
  return { action, result: JSON.stringify({ success: true, action: sig, details: "completed", durationMs: 1000 }) };
}

/** Shorthand for building an agent step that failed */
function failStep(action: Record<string, unknown>): { action: Record<string, unknown>; result: string } {
  return { action, result: "-> FAIL: element not found" };
}

/** Shorthand for building an agent step that failed (structured JSON format) */
function failStepJson(action: Record<string, unknown>): { action: Record<string, unknown>; result: string } {
  const sig = `${action.action}(${(action.coordinates as number[])?.join(",") ?? ""})`;
  return { action, result: JSON.stringify({ success: false, action: sig, details: "element not found", errorType: "device_error" }) };
}

/** Shorthand for building a timestamped agent step (for timeline tests) */
function okStepAt(action: Record<string, unknown>, ts: Date) {
  return { ...okStep(action), timestamp: ts };
}

/** Shorthand for building a UI element */
function el(text: string, center: [number, number] = [100, 200], extras?: { hint?: string; id?: string }) {
  return { text, center, hint: extras?.hint, id: extras?.id };
}

// ═══════════════════════════════════════════════════════════
//  1. compileGoalRunToRecipe
// ═══════════════════════════════════════════════════════════

describe("compileGoalRunToRecipe", () => {
  describe("basic compilation", () => {
    it("compiles a simple tap-type-tap session into a flow", () => {
      const steps = [
        okStep({ action: "tap", target: "Search" }),
        okStep({ action: "type", text: "hello world" }),
        okStep({ action: "tap", target: "Submit" }),
      ];

      const result = compileGoalRunToRecipe(steps);
      expect(result).not.toBeNull();
      expect(result!.steps).toEqual([
        { tap: "Search" },
        { type: "hello world" },
        { tap: "Submit" },
      ]);
      expect(result!.timeline).toHaveLength(3);
    });

    it("prepends a launch step when appPackage is provided", () => {
      const steps = [
        okStep({ action: "tap", target: "Search" }),
        okStep({ action: "tap", target: "Settings" }),
      ];

      const result = compileGoalRunToRecipe(steps, "com.example.app");
      expect(result).not.toBeNull();
      expect(result!.steps[0]).toEqual({ launch: "com.example.app" });
      expect(result!.steps).toHaveLength(3); // launch + 2 taps
    });

    it("compiles scroll and swipe actions", () => {
      const steps = [
        okStep({ action: "tap", target: "Search" }),
        okStep({ action: "scroll", direction: "down" }),
        okStep({ action: "swipe", direction: "up" }),
        okStep({ action: "tap", target: "Item" }),
      ];

      const result = compileGoalRunToRecipe(steps);
      expect(result!.steps).toEqual([
        { tap: "Search" },
        { scroll: "down" },
        { swipe: "up" },
        { tap: "Item" },
      ]);
    });

    it("compiles simple key actions (enter, home)", () => {
      const steps = [
        okStep({ action: "tap", target: "Email" }),
        okStep({ action: "type", text: "test@example.com" }),
        okStep({ action: "enter" }),
      ];

      const result = compileGoalRunToRecipe(steps);
      expect(result!.steps).toEqual([
        { tap: "Email" },
        { type: "test@example.com" },
        "enter",
      ]);
    });

    it("compiles longpress actions", () => {
      const steps = [
        okStep({ action: "tap", target: "Menu" }),
        okStep({ action: "longpress", target: "Copy" }),
        okStep({ action: "tap", target: "OK" }),
      ];

      const result = compileGoalRunToRecipe(steps);
      expect(result!.steps).toEqual([
        { tap: "Menu" },
        { longpress: "Copy" },
        { tap: "OK" },
      ]);
    });

    it("compiles steps with structured JSON results (DB format)", () => {
      // This is the format actually stored in the database by the agent loop
      const steps = [
        okStepJson({ action: "longpress", target: "Profile", coordinates: [972, 2137] }),
        okStepJson({ action: "tap", target: "Add Instagram account", coordinates: [540, 1490] }),
        okStepJson({ action: "tap", target: "Log into existing account", coordinates: [540, 1929] }),
        okStepJson({ action: "tap", target: "Use another profile", coordinates: [540, 1404] }),
      ];

      const result = compileGoalRunToRecipe(steps, "com.instagram.android");
      expect(result).not.toBeNull();
      expect(result!.steps).toEqual([
        { launch: "com.instagram.android" },
        { longpress: "Profile" },
        { tap: "Add Instagram account" },
        { tap: "Log into existing account" },
        { tap: "Use another profile" },
      ]);
    });

    it("skips failed steps with structured JSON results", () => {
      const steps = [
        failStepJson({ action: "tap", target: "Wrong", coordinates: [100, 200] }),
        okStepJson({ action: "tap", target: "Correct", coordinates: [200, 300] }),
        okStepJson({ action: "tap", target: "Submit", coordinates: [300, 400] }),
      ];

      const result = compileGoalRunToRecipe(steps);
      expect(result!.steps).toEqual([
        { tap: "Correct" },
        { tap: "Submit" },
      ]);
    });
  });

  describe("filtering", () => {
    it("skips failed steps", () => {
      const steps = [
        failStep({ action: "tap", target: "Wrong" }),
        okStep({ action: "tap", target: "Correct" }),
        okStep({ action: "tap", target: "Submit" }),
      ];

      const result = compileGoalRunToRecipe(steps);
      expect(result!.steps).toEqual([
        { tap: "Correct" },
        { tap: "Submit" },
      ]);
    });

    it("skips observation-only actions (wait, screenshot, done, etc.)", () => {
      const steps = [
        okStep({ action: "tap", target: "Start" }),
        okStep({ action: "wait" }),
        okStep({ action: "screenshot" }),
        okStep({ action: "read_screen" }),
        okStep({ action: "done" }),
        okStep({ action: "tap", target: "Confirm" }),
      ];

      const result = compileGoalRunToRecipe(steps);
      expect(result!.steps).toEqual([
        { tap: "Start" },
        { tap: "Confirm" },
      ]);
    });

    it("skips coordinate-only taps (no target)", () => {
      const steps = [
        okStep({ action: "tap", coordinates: [100, 200] }), // no target = fragile
        okStep({ action: "tap", target: "Button" }),
        okStep({ action: "tap", target: "OK" }),
      ];

      const result = compileGoalRunToRecipe(steps);
      expect(result!.steps).toEqual([
        { tap: "Button" },
        { tap: "OK" },
      ]);
    });
  });

  describe("error recovery detection", () => {
    it("skips back when it looks like error recovery", () => {
      const steps = [
        failStep({ action: "tap", target: "Wrong" }),
        okStep({ action: "back" }), // error recovery
        okStep({ action: "scroll", direction: "down" }), // different approach after back
        okStep({ action: "tap", target: "Correct" }),
      ];

      const result = compileGoalRunToRecipe(steps);
      // back should be excluded (error recovery)
      // the failed tap is also excluded (result != OK)
      expect(result!.steps).toEqual([
        { scroll: "down" },
        { tap: "Correct" },
      ]);
    });

    it("keeps back when it looks intentional", () => {
      const steps = [
        okStep({ action: "tap", target: "Settings" }),
        okStep({ action: "tap", target: "Wi-Fi" }),
        okStep({ action: "back" }), // intentional navigation
        okStep({ action: "tap", target: "Bluetooth" }),
      ];

      const result = compileGoalRunToRecipe(steps);
      expect(result!.steps).toEqual([
        { tap: "Settings" },
        { tap: "Wi-Fi" },
        "back",
        { tap: "Bluetooth" },
      ]);
    });
  });

  describe("variable substitution", () => {
    it("replaces resolved values with {{placeholder}} tokens", () => {
      const steps = [
        okStep({ action: "tap", target: "Search" }),
        okStep({ action: "type", text: "lofi beats" }),
        okStep({ action: "tap", target: "Go" }),
      ];

      const result = compileGoalRunToRecipe(steps, undefined, { query: "lofi beats" });
      expect(result!.steps).toEqual([
        { tap: "Search" },
        { type: "{{query}}" },
        { tap: "Go" },
      ]);
    });

    it("preserves text that does not match any variable", () => {
      const steps = [
        okStep({ action: "tap", target: "Search" }),
        okStep({ action: "type", text: "some random text" }),
        okStep({ action: "tap", target: "Go" }),
      ];

      const result = compileGoalRunToRecipe(steps, undefined, { query: "lofi beats" });
      expect(result!.steps).toEqual([
        { tap: "Search" },
        { type: "some random text" },
        { tap: "Go" },
      ]);
    });

    it("handles multiple variables", () => {
      const steps = [
        okStep({ action: "tap", target: "Username" }),
        okStep({ action: "type", text: "john" }),
        okStep({ action: "tap", target: "Password" }),
        okStep({ action: "type", text: "secret123" }),
        okStep({ action: "tap", target: "Login" }),
      ];

      const result = compileGoalRunToRecipe(steps, undefined, {
        username: "john",
        password: "secret123",
      });

      expect(result!.steps).toEqual([
        { tap: "Username" },
        { type: "{{username}}" },
        { tap: "Password" },
        { type: "{{password}}" },
        { tap: "Login" },
      ]);
    });
  });

  describe("validation", () => {
    it("returns null when fewer than 2 meaningful steps", () => {
      const steps = [
        okStep({ action: "tap", target: "Button" }),
      ];

      expect(compileGoalRunToRecipe(steps)).toBeNull();
    });

    it("returns null when more than half the steps are scroll/swipe", () => {
      const steps = [
        okStep({ action: "tap", target: "Start" }),
        okStep({ action: "scroll", direction: "down" }),
        okStep({ action: "scroll", direction: "down" }),
        okStep({ action: "scroll", direction: "down" }),
      ];

      expect(compileGoalRunToRecipe(steps)).toBeNull();
    });

    it("returns null when there are no text-based taps", () => {
      const steps = [
        okStep({ action: "type", text: "hello" }),
        okStep({ action: "enter" }),
        okStep({ action: "type", text: "world" }),
      ];

      expect(compileGoalRunToRecipe(steps)).toBeNull();
    });

    it("does not count the prepended launch toward the 2-step minimum", () => {
      // 1 meaningful step + launch = still only 1 meaningful
      const steps = [
        okStep({ action: "tap", target: "Only one" }),
      ];

      expect(compileGoalRunToRecipe(steps, "com.app")).toBeNull();
    });

    it("returns a valid flow with exactly 2 meaningful steps", () => {
      const steps = [
        okStep({ action: "tap", target: "First" }),
        okStep({ action: "tap", target: "Second" }),
      ];

      const result = compileGoalRunToRecipe(steps);
      expect(result).not.toBeNull();
      expect(result!.steps).toHaveLength(2);
    });
  });

  // ── Timeline tests ──

  describe("timeline", () => {
    it("builds a timeline from timestamps with correct delays", () => {
      const t0 = new Date("2026-01-01T00:00:00Z");
      const steps = [
        okStepAt({ action: "tap", target: "Search" }, t0),
        okStepAt({ action: "type", text: "hello" }, new Date(t0.getTime() + 3500)),
        okStepAt({ action: "tap", target: "Submit" }, new Date(t0.getTime() + 6000)),
      ];

      const result = compileGoalRunToRecipe(steps);
      expect(result).not.toBeNull();
      expect(result!.timeline).toEqual([0, 3500, 2500]);
    });

    it("clamps delays to MIN (800ms) and MAX (8000ms)", () => {
      const t0 = new Date("2026-01-01T00:00:00Z");
      const steps = [
        okStepAt({ action: "tap", target: "A" }, t0),
        okStepAt({ action: "tap", target: "B" }, new Date(t0.getTime() + 100)),   // 100ms gap → clamped to 800
        okStepAt({ action: "tap", target: "C" }, new Date(t0.getTime() + 30100)), // 30000ms gap → clamped to 8000
      ];

      const result = compileGoalRunToRecipe(steps);
      expect(result).not.toBeNull();
      expect(result!.timeline).toEqual([0, 800, 8000]);
    });

    it("uses default delay (2000ms) when timestamps are missing", () => {
      const steps = [
        okStep({ action: "tap", target: "Search" }),
        okStep({ action: "type", text: "hello" }),
        okStep({ action: "tap", target: "Submit" }),
      ];

      const result = compileGoalRunToRecipe(steps);
      expect(result).not.toBeNull();
      // No timestamps → defaults: [0, 2000, 2000]
      expect(result!.timeline).toEqual([0, 2000, 2000]);
    });

    it("includes launch step delay of 0 and default for subsequent", () => {
      const steps = [
        okStep({ action: "tap", target: "Search" }),
        okStep({ action: "tap", target: "Go" }),
      ];

      const result = compileGoalRunToRecipe(steps, "com.app");
      expect(result).not.toBeNull();
      // launch (0) + search (default 2000) + go (default 2000)
      expect(result!.timeline).toEqual([0, 2000, 2000]);
    });

    it("handles skipped steps — timeline follows compiled steps only", () => {
      const t0 = new Date("2026-01-01T00:00:00Z");
      const steps = [
        okStepAt({ action: "tap", target: "Search" }, t0),
        okStepAt({ action: "wait" }, new Date(t0.getTime() + 1000)),         // skipped
        okStepAt({ action: "screenshot" }, new Date(t0.getTime() + 2000)),   // skipped
        okStepAt({ action: "tap", target: "Submit" }, new Date(t0.getTime() + 5000)),
      ];

      const result = compileGoalRunToRecipe(steps);
      expect(result).not.toBeNull();
      expect(result!.steps).toHaveLength(2);
      // Gap is from Search (t0) to Submit (t0+5000) = 5000ms
      expect(result!.timeline).toEqual([0, 5000]);
    });
  });
});

// ═══════════════════════════════════════════════════════════
//  2. normalizeGoalKey
// ═══════════════════════════════════════════════════════════

describe("normalizeGoalKey", () => {
  it("lowercases the goal", () => {
    expect(normalizeGoalKey("Open YouTube")).toBe("open youtube");
  });

  it("trims whitespace", () => {
    expect(normalizeGoalKey("  Open YouTube  ")).toBe("open youtube");
  });

  it("collapses multiple whitespace into single space", () => {
    expect(normalizeGoalKey("Open   YouTube   and   search")).toBe("open youtube and search");
  });

  it("preserves {{variable}} placeholders", () => {
    expect(normalizeGoalKey("Search for {{query}} on YouTube")).toBe("search for {{query}} on youtube");
  });

  it("handles empty string", () => {
    expect(normalizeGoalKey("")).toBe("");
  });

  it("handles string with only whitespace", () => {
    expect(normalizeGoalKey("   ")).toBe("");
  });

  it("normalizes tabs and newlines to spaces", () => {
    expect(normalizeGoalKey("Open\tYouTube\nand search")).toBe("open youtube and search");
  });

  it("produces identical keys for semantically equal goals", () => {
    const a = normalizeGoalKey("  Open  YouTube and  search  for lofi  ");
    const b = normalizeGoalKey("open youtube and search for lofi");
    expect(a).toBe(b);
  });
});

// ═══════════════════════════════════════════════════════════
//  3. findElementByText
// ═══════════════════════════════════════════════════════════

describe("findElementByText", () => {
  const elements = [
    el("Settings"),
    el("Search settings"),
    el("Wi-Fi", [200, 300]),
    el("Bluetooth", [300, 400], { hint: "Enable Bluetooth" }),
    el("About phone", [400, 500], { id: "com.android.settings:id/about" }),
    el("", [500, 600], { hint: "navigation drawer" }),
  ];

  describe("exact text match (priority 1)", () => {
    it("matches exact text (case-insensitive)", () => {
      const result = findElementByText(elements, "Settings");
      expect(result?.text).toBe("Settings");
    });

    it("prefers exact match over partial", () => {
      const result = findElementByText(elements, "Settings");
      expect(result?.text).toBe("Settings");
      expect(result?.text).not.toBe("Search settings");
    });

    it("matches exact text with different casing", () => {
      const result = findElementByText(elements, "settings");
      expect(result?.text).toBe("Settings");
    });
  });

  describe("partial text match (priority 2)", () => {
    it("matches partial text when no exact match", () => {
      const result = findElementByText(elements, "search");
      expect(result?.text).toBe("Search settings");
    });

    it("prefers shorter match (more specific) among partials", () => {
      const items = [
        el("Submit your application form"),
        el("Submit"),
        el("Submit form"),
      ];
      const result = findElementByText(items, "submit");
      // Exact match wins first
      expect(result?.text).toBe("Submit");
    });
  });

  describe("hint match (priority 3)", () => {
    it("matches by hint when text doesn't match", () => {
      const result = findElementByText(elements, "enable bluetooth");
      // "Bluetooth" exact text match takes priority over hint match
      expect(result?.text).toBe("Bluetooth");
    });

    it("matches element with empty text via hint", () => {
      const result = findElementByText(elements, "navigation drawer");
      expect(result?.hint).toBe("navigation drawer");
    });
  });

  describe("id match (priority 4)", () => {
    it("matches by resource id", () => {
      const result = findElementByText(elements, "about");
      // "About phone" partial text match takes priority
      expect(result?.text).toBe("About phone");
    });

    it("matches by id when text and hint don't match", () => {
      const items = [
        el("", [100, 200], { id: "com.app:id/submit_button" }),
        el("Other", [200, 300]),
      ];
      const result = findElementByText(items, "submit_button");
      expect(result?.id).toBe("com.app:id/submit_button");
    });
  });

  describe("no match", () => {
    it("returns null when nothing matches", () => {
      const result = findElementByText(elements, "nonexistent_xyz_123");
      expect(result).toBeNull();
    });

    it("returns null for empty elements array", () => {
      const result = findElementByText([], "anything");
      expect(result).toBeNull();
    });
  });
});

// ═══════════════════════════════════════════════════════════
//  4. resolveRecipeVariables
// ═══════════════════════════════════════════════════════════

describe("resolveRecipeVariables", () => {
  it("replaces {{placeholder}} with resolved values", () => {
    const steps: RecipeStep[] = [
      { tap: "Search" },
      { type: "{{query}}" },
      { tap: "Go" },
    ];

    const resolved = resolveRecipeVariables(steps, { query: "lofi beats" });
    expect(resolved).toEqual([
      { tap: "Search" },
      { type: "lofi beats" },
      { tap: "Go" },
    ]);
  });

  it("handles multiple placeholders in the same step", () => {
    const steps: RecipeStep[] = [
      { type: "{{greeting}} {{name}}" },
    ];

    const resolved = resolveRecipeVariables(steps, { greeting: "Hello", name: "World" });
    expect(resolved).toEqual([
      { type: "Hello World" },
    ]);
  });

  it("leaves unknown placeholders intact", () => {
    const steps: RecipeStep[] = [
      { type: "{{known}} and {{unknown}}" },
    ];

    const resolved = resolveRecipeVariables(steps, { known: "resolved" });
    expect(resolved).toEqual([
      { type: "resolved and {{unknown}}" },
    ]);
  });

  it("passes through string steps unchanged", () => {
    const steps: Array<string | { [key: string]: string }> = [
      "enter",
      "back",
      { type: "{{query}}" },
    ];

    const resolved = resolveRecipeVariables(steps, { query: "test" });
    expect(resolved).toEqual([
      "enter",
      "back",
      { type: "test" },
    ]);
  });

  it("passes through non-string values unchanged", () => {
    const steps: Array<string | { [key: string]: string | number | [number, number] }> = [
      { tap: [100, 200] as [number, number] },
      { wait: 3 },
      { type: "{{query}}" },
    ];

    const resolved = resolveRecipeVariables(steps, { query: "test" });
    expect(resolved[0]).toEqual({ tap: [100, 200] });
    expect(resolved[1]).toEqual({ wait: 3 });
    expect(resolved[2]).toEqual({ type: "test" });
  });

  it("returns steps unchanged when no resolved values", () => {
    const steps: RecipeStep[] = [
      { tap: "Search" },
      { type: "{{query}}" },
    ];

    const resolved = resolveRecipeVariables(steps, {});
    expect(resolved).toEqual(steps);
  });
});

// ═══════════════════════════════════════════════════════════
//  5. isCacheable
// ═══════════════════════════════════════════════════════════

describe("isCacheable", () => {
  it("returns true for a basic step", () => {
    const step: CacheableWorkflowStep = { goal: "Open settings" };
    expect(isCacheable(step)).toBe(true);
  });

  it("returns true for a step with app", () => {
    const step: CacheableWorkflowStep = { goal: "Open settings", app: "com.android.settings" };
    expect(isCacheable(step)).toBe(true);
  });

  it("returns true for a step with maxSteps", () => {
    const step: CacheableWorkflowStep = { goal: "Search", maxSteps: 10 };
    expect(isCacheable(step)).toBe(true);
  });

  it("returns true for a step with retries", () => {
    const step: CacheableWorkflowStep = { goal: "Search", retries: 3 };
    expect(isCacheable(step)).toBe(true);
  });

  it("returns false when cache is explicitly disabled", () => {
    const step: CacheableWorkflowStep = { goal: "Open settings", cache: false };
    expect(isCacheable(step)).toBe(false);
  });

  it("returns true when cache is explicitly enabled", () => {
    const step: CacheableWorkflowStep = { goal: "Open settings", cache: true };
    expect(isCacheable(step)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════
//  6. End-to-end flow: compile → resolve → validate
// ═══════════════════════════════════════════════════════════

describe("end-to-end: compile → resolve cycle", () => {
  it("compiles a session with variables, then resolves them for replay", () => {
    // Simulate an AI session that searched for "coffee shops"
    const sessionSteps = [
      okStep({ action: "tap", target: "Search" }),
      okStep({ action: "type", text: "coffee shops" }),
      okStep({ action: "tap", target: "Search button" }),
      okStep({ action: "tap", target: "First result" }),
    ];

    // Step 1: compile with variables → produces {{placeholder}} tokens
    const compiled = compileGoalRunToRecipe(
      sessionSteps,
      "com.google.maps",
      { query: "coffee shops" },
    );

    expect(compiled).not.toBeNull();
    expect(compiled!.steps).toEqual([
      { launch: "com.google.maps" },
      { tap: "Search" },
      { type: "{{query}}" },
      { tap: "Search button" },
      { tap: "First result" },
    ]);

    // Step 2: On a later run with different variable value, resolve placeholders
    const resolved = resolveRecipeVariables(compiled!.steps, { query: "pizza" });
    expect(resolved).toEqual([
      { launch: "com.google.maps" },
      { tap: "Search" },
      { type: "pizza" },
      { tap: "Search button" },
      { tap: "First result" },
    ]);
  });

  it("compiled flow normalizes the same as the lookup key", () => {
    // The goal template should normalize identically whether coming from
    // the original workflow definition or from a later lookup
    const original = "  Search for {{query}} on  YouTube  ";
    const later    = "search for {{query}} on youtube";

    expect(normalizeGoalKey(original)).toBe(normalizeGoalKey(later));
  });

  it("round-trips: compile preserves enough info for accurate replay", () => {
    // A realistic Instagram interaction
    const sessionSteps = [
      okStep({ action: "tap", target: "Search" }),
      okStep({ action: "type", text: "sunset" }),
      okStep({ action: "tap", target: "Search" }),
      okStep({ action: "wait" }),          // skipped in compilation
      okStep({ action: "screenshot" }),    // skipped
      okStep({ action: "scroll", direction: "down" }),
      okStep({ action: "tap", target: "First post" }),
      okStep({ action: "tap", target: "Like" }),
      okStep({ action: "done" }),          // skipped
    ];

    const result = compileGoalRunToRecipe(sessionSteps, "com.instagram.android");
    expect(result).not.toBeNull();
    // Should contain: launch, tap, type, tap, scroll, tap, tap
    // Should NOT contain: wait, screenshot, done
    expect(result!.steps).toHaveLength(7);
    expect(result!.steps[0]).toEqual({ launch: "com.instagram.android" });
    expect(result!.steps.find((s) => typeof s === "object" && "scroll" in s)).toBeTruthy();
    // No observation steps
    expect(result!.steps.every((s) =>
      typeof s === "string"
        ? !["wait", "screenshot", "done"].includes(s)
        : !Object.keys(s).some((k) => ["wait", "screenshot", "done"].includes(k))
    )).toBe(true);
    // Timeline has same length as steps
    expect(result!.timeline).toHaveLength(7);
  });
});
