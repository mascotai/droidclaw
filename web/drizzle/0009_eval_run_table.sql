-- Eval Run Tracking for workflow evaluations
CREATE TABLE IF NOT EXISTS "eval_run" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE cascade,
  "device_id" text NOT NULL REFERENCES "device"("id") ON DELETE cascade,
  "name" text,
  "status" text NOT NULL DEFAULT 'running',
  "runs_per_workflow" integer NOT NULL,
  "workflow_defs" jsonb NOT NULL,
  "results" jsonb,
  "started_at" timestamp DEFAULT now() NOT NULL,
  "completed_at" timestamp
);

-- Add eval_run_id foreign key to workflow_run if it doesn't exist
DO $$ BEGIN
  ALTER TABLE "workflow_run" ADD CONSTRAINT "workflow_run_eval_run_id_eval_run_id_fk"
    FOREIGN KEY ("eval_run_id") REFERENCES "public"."eval_run"("id") ON DELETE set null;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add eval_run_id column if it doesn't exist
DO $$ BEGIN
  ALTER TABLE "workflow_run" ADD COLUMN "eval_run_id" text;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
