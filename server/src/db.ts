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

    console.log("[db] Schema ensured (cached_flow, eval_run, agent_step.duration_ms)");
  } catch (err) {
    console.warn("[db] ensureSchema warning:", (err as Error).message);
  }
}
