-- Add duration_ms to agent_step for per-step timing
ALTER TABLE "agent_step" ADD COLUMN IF NOT EXISTS "duration_ms" integer;

-- Cached deterministic flows (compiled from successful AI sessions)
CREATE TABLE IF NOT EXISTS "cached_flow" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "device_id" text NOT NULL,
  "goal_key" text NOT NULL,
  "app_package" text,
  "steps" jsonb NOT NULL,
  "success_count" integer DEFAULT 0,
  "fail_count" integer DEFAULT 0,
  "source_session_id" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "last_used_at" timestamp
);

DO $$ BEGIN
  ALTER TABLE "cached_flow" ADD CONSTRAINT "cached_flow_user_id_user_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cached_flow" ADD CONSTRAINT "cached_flow_device_id_device_id_fk"
    FOREIGN KEY ("device_id") REFERENCES "public"."device"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "cached_flow" ADD CONSTRAINT "cached_flow_source_session_id_agent_session_id_fk"
    FOREIGN KEY ("source_session_id") REFERENCES "public"."agent_session"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Index for fast lookup by (user_id, device_id, goal_key, app_package)
CREATE INDEX IF NOT EXISTS "cached_flow_lookup_idx"
  ON "cached_flow" ("user_id", "device_id", "goal_key", "app_package");
