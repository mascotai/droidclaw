import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "./env.js";
import * as schema from "./schema.js";

const client = postgres(env.DATABASE_URL, {
  idle_timeout: 20,        // close idle connections after 20s (Railway proxy kills at ~60s)
  max_lifetime: 60 * 5,    // recycle connections every 5 minutes
  connect_timeout: 10,     // fail fast on connection issues
});
export const db = drizzle(client, { schema });

/**
 * Run lightweight migrations that ensure columns exist.
 * Uses IF NOT EXISTS so it's safe to run on every startup.
 * This runs on the server side because the server starts before
 * the web container's drizzle-kit push.
 */
export async function ensureSchema() {
  try {
    await client`ALTER TABLE "agent_step" ADD COLUMN IF NOT EXISTS "duration_ms" integer`;

    await client`
      CREATE TABLE IF NOT EXISTS "cached_flow" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "device_id" text NOT NULL REFERENCES "device"("id") ON DELETE CASCADE,
        "goal_key" text NOT NULL,
        "app_package" text,
        "steps" jsonb NOT NULL,
        "success_count" integer DEFAULT 0,
        "fail_count" integer DEFAULT 0,
        "source_session_id" text REFERENCES "agent_session"("id") ON DELETE SET NULL,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "last_used_at" timestamp
      )
    `;

    await client`
      CREATE INDEX IF NOT EXISTS "cached_flow_lookup_idx"
        ON "cached_flow" ("user_id", "device_id", "goal_key", "app_package")
    `;

    await client`
      CREATE TABLE IF NOT EXISTS "eval_run" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "device_id" text NOT NULL REFERENCES "device"("id") ON DELETE CASCADE,
        "name" text,
        "status" text NOT NULL DEFAULT 'running',
        "runs_per_workflow" integer NOT NULL,
        "workflow_defs" jsonb NOT NULL,
        "results" jsonb,
        "started_at" timestamp DEFAULT now() NOT NULL,
        "completed_at" timestamp
      )
    `;

    await client`ALTER TABLE "workflow_run" ADD COLUMN IF NOT EXISTS "eval_run_id" text REFERENCES "eval_run"("id") ON DELETE SET NULL`;

    // cached_flow columns added after initial table creation
    await client`ALTER TABLE "cached_flow" ADD COLUMN IF NOT EXISTS "timeline" jsonb`;
    await client`ALTER TABLE "cached_flow" ADD COLUMN IF NOT EXISTS "active" boolean NOT NULL DEFAULT true`;

    // ══════════════════════════════════════════════════════════════════
    // ── Goals-First Redesign — New Tables
    // ══════════════════════════════════════════════════════════════════

    // ── goal (saved template) ──
    await client`
      CREATE TABLE IF NOT EXISTS "goal" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "app" text,
        "max_steps" integer DEFAULT 15,
        "retries" integer DEFAULT 0,
        "cache" boolean DEFAULT true,
        "eval" jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      )
    `;

    // ── workflow (saved template) ──
    await client`
      CREATE TABLE IF NOT EXISTS "workflow" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "name" text NOT NULL,
        "steps" jsonb NOT NULL,
        "variables" jsonb,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      )
    `;

    // ── recipe (compiled replay — replaces cached_flow) ──
    await client`
      CREATE TABLE IF NOT EXISTS "recipe" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "device_id" text NOT NULL REFERENCES "device"("id") ON DELETE CASCADE,
        "goal_key" text NOT NULL,
        "app_package" text,
        "steps" jsonb NOT NULL,
        "timeline" jsonb,
        "active" boolean NOT NULL DEFAULT true,
        "success_count" integer DEFAULT 0,
        "fail_count" integer DEFAULT 0,
        "source_goal_run_id" text,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "last_used_at" timestamp
      )
    `;

    await client`
      CREATE INDEX IF NOT EXISTS "recipe_lookup_idx"
        ON "recipe" ("user_id", "device_id", "goal_key", "app_package")
    `;

    // ── goal_run (execution of a goal) ──
    await client`
      CREATE TABLE IF NOT EXISTS "goal_run" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "device_id" text NOT NULL REFERENCES "device"("id") ON DELETE CASCADE,
        "goal_id" text REFERENCES "goal"("id") ON DELETE SET NULL,
        "workflow_run_id" text,
        "step_index" integer,
        "goal" text NOT NULL,
        "app" text,
        "max_steps" integer DEFAULT 15,
        "status" text NOT NULL DEFAULT 'running',
        "resolved_by" text,
        "recipe_id" text REFERENCES "recipe"("id") ON DELETE SET NULL,
        "steps_used" integer DEFAULT 0,
        "duration_ms" integer,
        "eval_definition" jsonb,
        "eval_passed" boolean,
        "eval_state_values" jsonb,
        "eval_mismatches" jsonb,
        "scheduled_for" timestamp,
        "started_at" timestamp DEFAULT now() NOT NULL,
        "completed_at" timestamp
      )
    `;

    // ── step (single agent action within a goal run) ──
    await client`
      CREATE TABLE IF NOT EXISTS "step" (
        "id" text PRIMARY KEY NOT NULL,
        "goal_run_id" text NOT NULL REFERENCES "goal_run"("id") ON DELETE CASCADE,
        "step_number" integer NOT NULL,
        "screen_hash" text,
        "action" jsonb,
        "reasoning" text,
        "result" text,
        "package_name" text,
        "activity_name" text,
        "elements" jsonb,
        "duration_ms" integer,
        "timestamp" timestamp DEFAULT now() NOT NULL
      )
    `;

    // ── eval_batch (batch eval run — replaces eval_run) ──
    await client`
      CREATE TABLE IF NOT EXISTS "eval_batch" (
        "id" text PRIMARY KEY NOT NULL,
        "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "device_id" text NOT NULL REFERENCES "device"("id") ON DELETE CASCADE,
        "name" text,
        "status" text NOT NULL DEFAULT 'running',
        "runs_per_workflow" integer NOT NULL,
        "workflow_defs" jsonb NOT NULL,
        "results" jsonb,
        "started_at" timestamp DEFAULT now() NOT NULL,
        "completed_at" timestamp
      )
    `;

    // ── workflow_run new columns ──
    await client`ALTER TABLE "workflow_run" ADD COLUMN IF NOT EXISTS "workflow_id" text`;
    await client`ALTER TABLE "workflow_run" ADD COLUMN IF NOT EXISTS "variables" jsonb`;
    await client`ALTER TABLE "workflow_run" ADD COLUMN IF NOT EXISTS "duration_ms" integer`;
    await client`ALTER TABLE "workflow_run" ADD COLUMN IF NOT EXISTS "eval_batch_id" text`;

    console.log("[db] Schema ensured (cached_flow, eval_run, agent_step.duration_ms, goals-first redesign tables)");
  } catch (err) {
    console.warn("[db] ensureSchema warning:", (err as Error).message);
  }
}
