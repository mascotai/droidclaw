#!/usr/bin/env bash
# Post-workflow hook — runs after e2e workflow tests complete.
# Fetches the latest workflow run and summarizes results.

set -euo pipefail

# Read JSON input from stdin (Claude Code passes hook context)
INPUT=$(cat)

# Only trigger for workflow-related bash commands
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)
if [[ -z "$COMMAND" ]]; then
  exit 0
fi

# Match e2e workflow test commands
if ! echo "$COMMAND" | grep -qE 'caching-test|workflows/run|/workflows/'; then
  exit 0
fi

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# Load .env
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a; source "$SCRIPT_DIR/.env"; set +a
fi

API_URL="${DROIDCLAW_API_URL:-https://droidclaw.stack.mascott.ai}"
API_KEY="${DROIDCLAW_API_KEY:-}"
DEVICE_ID="${DROIDCLAW_DEVICE_ID:-a65b6cfe-cedd-4faf-a39c-b1290c6b249a}"

if [[ -z "$API_KEY" ]]; then
  exit 0
fi

# Fetch latest workflow run
RUNS_JSON=$(curl -s --max-time 10 \
  -H "Authorization: Bearer $API_KEY" \
  "${API_URL}/workflows/runs/${DEVICE_ID}" 2>/dev/null || echo '[]')

# Get the most recent run
LATEST=$(echo "$RUNS_JSON" | jq -r '(if type == "array" then . else .items // [] end) | sort_by(.startedAt) | last // empty' 2>/dev/null)

if [[ -z "$LATEST" || "$LATEST" == "null" ]]; then
  exit 0
fi

RUN_NAME=$(echo "$LATEST" | jq -r '.name // "unnamed"')
RUN_STATUS=$(echo "$LATEST" | jq -r '.status // "unknown"')
RUN_ID=$(echo "$LATEST" | jq -r '.id // "?"')
STARTED=$(echo "$LATEST" | jq -r '.startedAt // "?"')

# Count cache hits from step results
TOTAL_STEPS=$(echo "$LATEST" | jq '[.stepResults // [] | length] | add // 0')
CACHE_HITS=$(echo "$LATEST" | jq '[.stepResults // [] | .[] | select(.resolvedBy == "cached_flow")] | length')

# Build summary
if [[ "$RUN_STATUS" == "completed" ]]; then
  STATUS_ICON="✅"
elif [[ "$RUN_STATUS" == "failed" ]]; then
  STATUS_ICON="❌"
else
  STATUS_ICON="⏳"
fi

SUMMARY="${STATUS_ICON} Latest workflow run: ${RUN_NAME}
  Status: ${RUN_STATUS}
  Steps: ${TOTAL_STEPS} total, ${CACHE_HITS} cached
  Started: ${STARTED}
  Run ID: ${RUN_ID}"

jq -n \
  --arg summary "$SUMMARY" \
  '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: $summary
    }
  }'
