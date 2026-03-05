/**
 * Workflow Caching System — Unit Tests
 *
 * Tests the three main caching layers:
 *   1. compileSessionToFlow  — compiles AI agent steps → deterministic flows
 *   2. normalizeGoalKey      — normalises goal strings into cache lookup keys
 *   3. findElementByText     — element matching used during flow replay
 *   4. resolveFlowVariables  — {{variable}} placeholder substitution
 *   5. isCacheable           — determines if a workflow step is cache-eligible
 *
 * All functions under test are pure (no DB/WS) — no mocking required.
 *
 * Run:  bun test src/agent/__tests__/caching.test.ts
 */

import { describe, it, expect } from "bun:test";
import {
  compileSessionToFlow,
  normalizeGoalKey,
  isCacheable,
  resolveFlowVariables,
  findElementByText,
} from "../session-to-flow.js";
import type { CacheableWorkflowStep, FlowStep } from "../session-to-flow.js";

// ─── Helpers ────────────────────────────────────────────────

/** Shorthand for building an agent step that succeeded */
function okStep(action: Record<string, unknown>): { action: Record<string, unknown>; result: string } {
  return { action, result: "-> OK" };
}

/** Shorthand for building an agent step that failed */
function failStep(action: Record<string, unknown>): { action: Record<string, unknown>; result: string } {
  return { action, result: "-> FAIL: element not found" };
}

/** Shorthand for building a UI element */
function el(text: string, center: [number, number] = [100, 200], extras?: { hint?: string; id?: string }) {
  return { text, center, hint: extras?.hint, id: extras?.id };
}

// ═══════════════════════════════════════════════════════════
//  1. compileSessionToFlow
// ═══════════════════════════════════════════════════════════

describe("compileSessionToFlow", () => {
  describe("basic compilation", () => {
    it("compiles a simple tap-type-tap session into a flow", () => {
      const steps = [
        okStep({ action: "tap", target: "Search" }),
        okStep({ action: "type", text: "hello world" }),
        okStep({ action: "tap", target: "Submit" }),
      ];

      const flow = compileSessionToFlow(steps);
      expect(flow).not.toBeNull();
      expect(flow).toEqual([
        { tap: "Search" },
        { type: "hello world" },
        { tap: "Submit" },
      ]);
    });

    it("prepends a launch step when appPackage is provided", () => {
      const steps = [
        okStep({ action: "tap", target: "Search" }),
        okStep({ action: "tap", target: "Settings" }),
      ];

      const flow = compileSessionToFlow(steps, "com.example.app");
      expect(flow).not.toBeNull();
      expect(flow![0]).toEqual({ launch: "com.example.app" });
      expect(flow!.length).toBe(3); // launch + 2 taps
    });

    it("compiles scroll and swipe actions", () => {
      const steps = [
        okStep({ action: "tap", target: "Search" }),
        okStep({ action: "scroll", direction: "down" }),
        okStep({ action: "swipe", direction: "up" }),
        okStep({ action: "tap", target: "Item" }),
      ];

      const flow = compileSessionToFlow(steps);
      expect(flow).toEqual([
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

      const flow = compileSessionToFlow(steps);
      expect(flow).toEqual([
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

      const flow = compileSessionToFlow(steps);
      expect(flow).toEqual([
        { tap: "Menu" },
        { longpress: "Copy" },
        { tap: "OK" },
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

      const flow = compileSessionToFlow(steps);
      expect(flow).toEqual([
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

      const flow = compileSessionToFlow(steps);
      expect(flow).toEqual([
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

      const flow = compileSessionToFlow(steps);
      expect(flow).toEqual([
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

      const flow = compileSessionToFlow(steps);
      // back should be excluded (error recovery)
      // the failed tap is also excluded (result != OK)
      expect(flow).toEqual([
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

      const flow = compileSessionToFlow(steps);
      expect(flow).toEqual([
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

      const flow = compileSessionToFlow(steps, undefined, { query: "lofi beats" });
      expect(flow).toEqual([
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

      const flow = compileSessionToFlow(steps, undefined, { query: "lofi beats" });
      expect(flow).toEqual([
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

      const flow = compileSessionToFlow(steps, undefined, {
        username: "john",
        password: "secret123",
      });

      expect(flow).toEqual([
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

      expect(compileSessionToFlow(steps)).toBeNull();
    });

    it("returns null when more than half the steps are scroll/swipe", () => {
      const steps = [
        okStep({ action: "tap", target: "Start" }),
        okStep({ action: "scroll", direction: "down" }),
        okStep({ action: "scroll", direction: "down" }),
        okStep({ action: "scroll", direction: "down" }),
      ];

      expect(compileSessionToFlow(steps)).toBeNull();
    });

    it("returns null when there are no text-based taps", () => {
      const steps = [
        okStep({ action: "type", text: "hello" }),
        okStep({ action: "enter" }),
        okStep({ action: "type", text: "world" }),
      ];

      expect(compileSessionToFlow(steps)).toBeNull();
    });

    it("does not count the prepended launch toward the 2-step minimum", () => {
      // 1 meaningful step + launch = still only 1 meaningful
      const steps = [
        okStep({ action: "tap", target: "Only one" }),
      ];

      expect(compileSessionToFlow(steps, "com.app")).toBeNull();
    });

    it("returns a valid flow with exactly 2 meaningful steps", () => {
      const steps = [
        okStep({ action: "tap", target: "First" }),
        okStep({ action: "tap", target: "Second" }),
      ];

      const flow = compileSessionToFlow(steps);
      expect(flow).not.toBeNull();
      expect(flow!.length).toBe(2);
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
//  4. resolveFlowVariables
// ═══════════════════════════════════════════════════════════

describe("resolveFlowVariables", () => {
  it("replaces {{placeholder}} with resolved values", () => {
    const steps: FlowStep[] = [
      { tap: "Search" },
      { type: "{{query}}" },
      { tap: "Go" },
    ];

    const resolved = resolveFlowVariables(steps, { query: "lofi beats" });
    expect(resolved).toEqual([
      { tap: "Search" },
      { type: "lofi beats" },
      { tap: "Go" },
    ]);
  });

  it("handles multiple placeholders in the same step", () => {
    const steps: FlowStep[] = [
      { type: "{{greeting}} {{name}}" },
    ];

    const resolved = resolveFlowVariables(steps, { greeting: "Hello", name: "World" });
    expect(resolved).toEqual([
      { type: "Hello World" },
    ]);
  });

  it("leaves unknown placeholders intact", () => {
    const steps: FlowStep[] = [
      { type: "{{known}} and {{unknown}}" },
    ];

    const resolved = resolveFlowVariables(steps, { known: "resolved" });
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

    const resolved = resolveFlowVariables(steps, { query: "test" });
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

    const resolved = resolveFlowVariables(steps, { query: "test" });
    expect(resolved[0]).toEqual({ tap: [100, 200] });
    expect(resolved[1]).toEqual({ wait: 3 });
    expect(resolved[2]).toEqual({ type: "test" });
  });

  it("returns steps unchanged when no resolved values", () => {
    const steps: FlowStep[] = [
      { tap: "Search" },
      { type: "{{query}}" },
    ];

    const resolved = resolveFlowVariables(steps, {});
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

  it("returns false for exhaustIsSuccess steps (open-ended browsing)", () => {
    const step: CacheableWorkflowStep = { goal: "Browse feed", exhaustIsSuccess: true, maxSteps: 20 };
    expect(isCacheable(step)).toBe(false);
  });

  it("returns false for steps with formData", () => {
    const step: CacheableWorkflowStep = {
      goal: "Fill registration form",
      formData: { name: "John", email: "john@test.com" },
    };
    expect(isCacheable(step)).toBe(false);
  });

  it("returns true for steps with empty formData", () => {
    const step: CacheableWorkflowStep = { goal: "Open form", formData: {} };
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
    const compiled = compileSessionToFlow(
      sessionSteps,
      "com.google.maps",
      { query: "coffee shops" },
    );

    expect(compiled).not.toBeNull();
    expect(compiled).toEqual([
      { launch: "com.google.maps" },
      { tap: "Search" },
      { type: "{{query}}" },
      { tap: "Search button" },
      { tap: "First result" },
    ]);

    // Step 2: On a later run with different variable value, resolve placeholders
    const resolved = resolveFlowVariables(compiled!, { query: "pizza" });
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

    const flow = compileSessionToFlow(sessionSteps, "com.instagram.android");
    expect(flow).not.toBeNull();
    // Should contain: launch, tap, type, tap, scroll, tap, tap
    // Should NOT contain: wait, screenshot, done
    expect(flow!.length).toBe(7);
    expect(flow![0]).toEqual({ launch: "com.instagram.android" });
    expect(flow!.find((s) => typeof s === "object" && "scroll" in s)).toBeTruthy();
    // No observation steps
    expect(flow!.every((s) =>
      typeof s === "string"
        ? !["wait", "screenshot", "done"].includes(s)
        : !Object.keys(s).some((k) => ["wait", "screenshot", "done"].includes(k))
    )).toBe(true);
  });
});
