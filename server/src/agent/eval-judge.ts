/**
 * Eval Judge — LLM-based per-step state evaluator for DroidClaw.
 *
 * After each workflow step completes, the eval judge reviews all screen
 * observations and agent reasoning to independently determine whether
 * the step actually succeeded based on defined state criteria.
 */

import { getLlmProvider, parseJsonResponse, type LLMConfig } from "./llm.js";
import type { ScreenObservation } from "./loop.js";

// ─── Types ───────────────────────────────────────────────────

export interface StateDefinition {
  type: "boolean" | "string" | "number";
  description: string;
  expected?: boolean | string | number;  // if present, this state determines pass/fail
}

export interface EvalJudgment {
  stateValues: Record<string, boolean | string | number>;  // ALL states filled
  success: boolean;       // true if all states WITH expected match their expected value
  mismatches: Array<{ key: string; expected: unknown; actual: unknown }>;  // only for states with expected
  trackedOnly: Record<string, boolean | string | number>;  // states WITHOUT expected (debug info)
}

export interface AgentStepRecord {
  stepNumber: number;
  action: Record<string, unknown> | null;
  reasoning: string | null;
  result: string | null;
  packageName: string | null;
}

// ─── System Prompt ───────────────────────────────────────────

const EVAL_SYSTEM_PROMPT = `You are an independent evaluator for an Android automation agent.
You will be given:
- The GOAL the agent was trying to accomplish
- SCREEN OBSERVATIONS from every step (the UI elements visible on screen)
- The AGENT TRANSCRIPT (actions taken and reasoning)
- STATE DEFINITIONS to evaluate

For each state, analyze the screen observations and transcript to determine
the actual value. Be precise:
- For boolean states: determine true/false based on the evidence
- For string states: extract the exact value you see on screen, or "NOT_FOUND"
- For number states: extract the exact number, or -1 if not found

IMPORTANT: Base your judgment on what you can actually observe in the screen data
and transcript, NOT on what the agent claims. The agent may claim success when
the goal was not actually achieved.

Return ONLY a valid JSON object: { "stateValues": { "key": value, ... } }
Do not include any explanation outside the JSON.`;

// ─── Core Function ───────────────────────────────────────────

export async function evaluateStep(
  goal: string,
  observations: ScreenObservation[],
  agentTranscript: AgentStepRecord[],
  states: Record<string, StateDefinition>,
  llmConfig: LLMConfig,
): Promise<EvalJudgment> {
  // Build observation summary for the LLM
  const obsLines = observations.map((obs) => {
    const elements = obs.elements.map((e) => {
      const parts: string[] = [];
      if (e.text) parts.push(`text="${e.text}"`);
      if (e.hint) parts.push(`hint="${e.hint}"`);
      if (e.editable) parts.push("editable");
      if (e.checked !== undefined) parts.push(`checked=${e.checked}`);
      if (e.enabled === false) parts.push("disabled");
      return parts.join(", ");
    }).filter(Boolean);

    const pkg = obs.packageName ? ` (${obs.packageName})` : "";
    return `--- Screen at step ${obs.stepNumber}${pkg} ---\n${elements.join("\n") || "(empty screen)"}`;
  });

  // Build transcript summary
  const transcriptLines = agentTranscript.map((s) => {
    const action = s.action ? JSON.stringify(s.action) : "none";
    return `Step ${s.stepNumber}: Action=${action} | Reason=${s.reasoning ?? "—"} | Result=${s.result ?? "—"}`;
  });

  // Build state definitions prompt
  const stateDefsLines = Object.entries(states).map(([key, def]) => {
    const expectedNote = def.expected !== undefined ? ` (expected: ${JSON.stringify(def.expected)})` : " (tracked only)";
    return `  "${key}" (${def.type}): ${def.description}${expectedNote}`;
  });

  const userPrompt = `GOAL: ${goal}

SCREEN OBSERVATIONS:
${obsLines.join("\n\n")}

AGENT TRANSCRIPT:
${transcriptLines.join("\n")}

STATE DEFINITIONS TO EVALUATE:
${stateDefsLines.join("\n")}

Analyze the evidence above and return the actual value for each state.
Return JSON: { "stateValues": { ${Object.keys(states).map(k => `"${k}": <value>`).join(", ")} } }`;

  // Call LLM
  const llm = getLlmProvider(llmConfig);
  let rawResponse: string;
  try {
    rawResponse = await llm.getAction(EVAL_SYSTEM_PROMPT, userPrompt);
  } catch (err) {
    console.error(`[EvalJudge] LLM call failed: ${(err as Error).message}`);
    // Return a judgment with all states as their default "not found" values
    return buildDefaultJudgment(states);
  }

  // Parse response
  const parsed = parseJsonResponse(rawResponse);
  const stateValues = (parsed?.stateValues as Record<string, unknown>) ?? {};

  // Coerce and fill state values
  const filledValues: Record<string, boolean | string | number> = {};
  for (const [key, def] of Object.entries(states)) {
    const raw = stateValues[key];
    filledValues[key] = coerceValue(raw, def.type);
  }

  // Compare against expected values
  const mismatches: Array<{ key: string; expected: unknown; actual: unknown }> = [];
  const trackedOnly: Record<string, boolean | string | number> = {};

  for (const [key, def] of Object.entries(states)) {
    if (def.expected !== undefined) {
      const actual = filledValues[key];
      const expected = def.expected;
      if (!valuesMatch(actual, expected)) {
        mismatches.push({ key, expected, actual });
      }
    } else {
      trackedOnly[key] = filledValues[key];
    }
  }

  return {
    stateValues: filledValues,
    success: mismatches.length === 0,
    mismatches,
    trackedOnly,
  };
}

// ─── Helpers ─────────────────────────────────────────────────

function coerceValue(raw: unknown, type: "boolean" | "string" | "number"): boolean | string | number {
  if (raw === undefined || raw === null) {
    switch (type) {
      case "boolean": return false;
      case "string": return "NOT_FOUND";
      case "number": return -1;
    }
  }

  switch (type) {
    case "boolean":
      if (typeof raw === "boolean") return raw;
      if (typeof raw === "string") return raw.toLowerCase() === "true";
      return Boolean(raw);
    case "string":
      return String(raw);
    case "number":
      if (typeof raw === "number") return raw;
      const num = Number(raw);
      return isNaN(num) ? -1 : num;
  }
}

function valuesMatch(actual: boolean | string | number, expected: boolean | string | number): boolean {
  // For strings, do case-insensitive comparison and trim whitespace
  if (typeof actual === "string" && typeof expected === "string") {
    return actual.trim().toLowerCase() === expected.trim().toLowerCase();
  }
  return actual === expected;
}

function buildDefaultJudgment(states: Record<string, StateDefinition>): EvalJudgment {
  const stateValues: Record<string, boolean | string | number> = {};
  const mismatches: Array<{ key: string; expected: unknown; actual: unknown }> = [];
  const trackedOnly: Record<string, boolean | string | number> = {};

  for (const [key, def] of Object.entries(states)) {
    const defaultVal = coerceValue(undefined, def.type);
    stateValues[key] = defaultVal;
    if (def.expected !== undefined) {
      if (!valuesMatch(defaultVal, def.expected)) {
        mismatches.push({ key, expected: def.expected, actual: defaultVal });
      }
    } else {
      trackedOnly[key] = defaultVal;
    }
  }

  return { stateValues, success: mismatches.length === 0, mismatches, trackedOnly };
}
