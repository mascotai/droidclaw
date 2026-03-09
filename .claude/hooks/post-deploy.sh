#!/usr/bin/env bash
# Post-deploy hook — runs after deploy-apk skill completes.
# Checks device version and connectivity to verify the APK landed.

set -euo pipefail

# Read JSON input from stdin (Claude Code passes hook context)
INPUT=$(cat)

# Only trigger for the deploy-apk skill
SKILL_NAME=$(echo "$INPUT" | jq -r '.tool_input.skill // empty' 2>/dev/null)
if [[ "$SKILL_NAME" != "deploy-apk" ]]; then
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
  echo "⚠️ DROIDCLAW_API_KEY not set, skipping post-deploy check" >&2
  exit 0
fi

# Check device version
VERSION_JSON=$(curl -s --max-time 10 \
  -H "Authorization: Bearer $API_KEY" \
  "${API_URL}/devices/${DEVICE_ID}/version" 2>/dev/null || echo '{}')

STATUS=$(echo "$VERSION_JSON" | jq -r '.status // "unknown"')
APP_VERSION=$(echo "$VERSION_JSON" | jq -r '.appVersionName // "unknown"')
APP_CODE=$(echo "$VERSION_JSON" | jq -r '.appVersionCode // "unknown"')
DEVICE_NAME=$(echo "$VERSION_JSON" | jq -r '.name // "unknown"')

# Output context that Claude will see
jq -n \
  --arg status "$STATUS" \
  --arg version "$APP_VERSION" \
  --arg code "$APP_CODE" \
  --arg device "$DEVICE_NAME" \
  '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: ("📱 Post-deploy verification:\n  Device: " + $device + "\n  Status: " + $status + "\n  Version: " + $version + " (code " + $code + ")\n\nDevice is " + (if $status == "online" then "✅ online and responding" else "⚠️ " + $status + " — may still be restarting" end))
    }
  }'
