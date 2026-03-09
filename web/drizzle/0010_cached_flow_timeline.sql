-- Add timeline column to cached_flow table
-- Stores delay-in-ms before each step, recorded from the original AI session timing
ALTER TABLE "cached_flow" ADD COLUMN IF NOT EXISTS "timeline" jsonb;
