-- Add composite index for fast workflow_run queries (filtered by user + device, sorted by started_at)
CREATE INDEX IF NOT EXISTS "idx_workflow_run_user_device_started"
  ON "workflow_run" ("user_id", "device_id", "started_at" DESC);

-- Add composite index for fast agent_session queries (same pattern)
CREATE INDEX IF NOT EXISTS "idx_agent_session_user_device_started"
  ON "agent_session" ("user_id", "device_id", "started_at" DESC);
