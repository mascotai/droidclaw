#!/usr/bin/env bash
# DroidClaw API helper — handles auth automatically.
#
# Usage:
#   ./e2e/api.sh GET /devices
#   ./e2e/api.sh GET /workflows/runs/DEVICE
#   ./e2e/api.sh GET /workflows/runs/DEVICE/RUN_ID?expand=steps
#   ./e2e/api.sh POST /goals '{"deviceId":"DEVICE","goal":"Open Settings"}'
#   ./e2e/api.sh POST /workflows/run?wait=true @examples/workflows/my-workflow.json
#   ./e2e/api.sh POST /workflows/stop '{"deviceId":"DEVICE"}'
#
# The special token DEVICE is replaced with $DROIDCLAW_DEVICE_ID automatically.
# Use @filepath to send a JSON file as the body.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Load .env
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a; source "$SCRIPT_DIR/.env"; set +a
fi

API_URL="${DROIDCLAW_API_URL:-https://droidclaw.stack.mascott.ai}"
API_KEY="${DROIDCLAW_API_KEY:?DROIDCLAW_API_KEY not set — add it to .env}"
DEVICE_ID="${DROIDCLAW_DEVICE_ID:-a65b6cfe-cedd-4faf-a39c-b1290c6b249a}"

METHOD="${1:?Usage: api.sh METHOD PATH [BODY|@file]}"
PATH_ARG="${2:?Usage: api.sh METHOD PATH [BODY|@file]}"
BODY="${3:-}"

# Replace DEVICE placeholder
PATH_ARG="${PATH_ARG//DEVICE/$DEVICE_ID}"

# Build curl args
CURL_ARGS=(
  -s
  -H "Authorization: Bearer $API_KEY"
  -H "Content-Type: application/json"
  -X "$METHOD"
)

# Handle body: @file or inline JSON
if [[ -n "$BODY" ]]; then
  if [[ "$BODY" == @* ]]; then
    CURL_ARGS+=(-d "$BODY")
  else
    CURL_ARGS+=(-d "$BODY")
  fi
fi

# Execute and pretty-print
RESPONSE=$(curl "${CURL_ARGS[@]}" "${API_URL}${PATH_ARG}" 2>&1)

# Try to pretty-print JSON, fall back to raw
if command -v python3 &>/dev/null; then
  echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"
else
  echo "$RESPONSE"
fi
