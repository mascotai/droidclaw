/**
 * Shared types for the Temporal device-queue system.
 *
 * These are used by the client, workflow, and activity layers.
 * Kept in a separate file so the workflow sandbox can import
 * the type without pulling in Node/Bun dependencies.
 */

export interface RunPayload {
  runId: string;
  userId: string;
  name: string;
  type: "workflow" | "flow";
  steps: unknown[];
  totalSteps: number;
  /** ISO-8601 datetime — if set, execution is deferred until this time */
  scheduledFor?: string;
  /** Optional LLM overrides supplied by the caller */
  llmModel?: string;
}

export interface ExecuteRunInput extends RunPayload {
  /** Persistent device ID (DB primary key) */
  deviceId: string;
}
