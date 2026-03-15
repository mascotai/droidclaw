#!/bin/bash
# scripts/test-and-fix.sh — 3-phase self-healing workflow test runner
#
# Phase 1 (Discovery): Run workflow — AI discovers the path. On failure,
#   Claude reads agent steps + screen trees, fixes workflow JSON goal text, re-runs.
# Phase 2 (Recipe): Run again — verify compiled recipe works.
#   Failures here are likely code bugs → pause for approval.
# Phase 3 (Stress): Run 5 more times — measure recipe consistency.
#   Report-only — no auto-fixes.
#
# Usage:
#   npm run test:social:fix
#   bash scripts/test-and-fix.sh

set -euo pipefail

# ── Load secrets from Infisical ──────────────────────────────────────
# Uses infisical CLI with universal auth to fetch prod secrets.
# Falls back to .env if infisical is not available.
INFISICAL_DOMAIN="https://secrets.stack.mascott.ai/api"
INFISICAL_PROJECT_ID="f6753b26-c4ae-476c-a388-1a3cf56a7c0b"

if command -v infisical &>/dev/null; then
  echo "🔐 Loading secrets from Infisical..."
  INFISICAL_TOKEN=$(infisical login --method=universal-auth \
    --client-id="${INFISICAL_CLIENT_ID:-9d81f31c-04e8-44fb-970f-4c635bfdc0ce}" \
    --client-secret="${INFISICAL_CLIENT_SECRET:-462850bd7dceb4d8c38e914975a4c6c89ca1c13606fb0c8db3ccc2d8c27a8924}" \
    --domain="$INFISICAL_DOMAIN" --silent --plain 2>/dev/null) || true

  if [ -n "$INFISICAL_TOKEN" ]; then
    eval "$(infisical export \
      --token="$INFISICAL_TOKEN" \
      --projectId="$INFISICAL_PROJECT_ID" \
      --env=prod \
      --domain="$INFISICAL_DOMAIN" \
      --format=dotenv 2>/dev/null | grep -E '^(DROIDCLAW_|INSTAREG_)' | sed 's/^/export /')"
    echo "   ✅ Loaded secrets from Infisical"
  else
    echo "   ⚠️  Infisical auth failed, falling back to .env"
    set -a && source .env && set +a
  fi
else
  echo "📄 Loading secrets from .env (infisical CLI not found)"
  set -a && source .env && set +a
fi

# Map secret names to what the tests expect
export DROIDCLAW_URL="${DROIDCLAW_URL:-${DROIDCLAW_API_URL:-}}"
export DROIDCLAW_AUTH_TOKEN="${DROIDCLAW_AUTH_TOKEN:-${DROIDCLAW_API_KEY:-${DROIDCLAW_INTERNAL_SECRET:-}}}"
export INSTAREG_API_URL="https://instareg.stack.mascott.ai"  # always use external URL
export INSTAREG_API_KEY="${INSTAREG_API_KEY:-${INSTAREG_API_SECRET_KEY:-}}"

MAX_FIX=3
RESULTS="./test-results/social-e2e.json"
BASE="${DROIDCLAW_URL}/v2/devices/${DROIDCLAW_DEVICE_ID}"
HDR="Authorization: Bearer ${DROIDCLAW_AUTH_TOKEN}"
mkdir -p ./test-results

# ── Phase 1: Discovery (auto-fix loop) ──────────────────────────────
echo ""
echo "═══════════════════════════════════════"
echo "  Phase 1: Discovery"
echo "═══════════════════════════════════════"

PHASE1_PASSED=false

for attempt in $(seq 1 $MAX_FIX); do
  echo ""
  echo "🧪 Discovery attempt $attempt/$MAX_FIX"
  npx vitest run --config vitest.config.e2e-social.ts -t "Phase 1" || true

  # Check results
  if [ ! -f "$RESULTS" ]; then
    echo "⚠️  No test results file found at $RESULTS"
    FAILED=1
  else
    FAILED=$(jq '.numFailedTests // 0' "$RESULTS" 2>/dev/null || echo "1")
  fi

  if [ "$FAILED" -eq 0 ]; then
    echo "✅ Phase 1 passed!"
    PHASE1_PASSED=true
    break
  fi

  echo "❌ $FAILED test(s) failed"

  if [ "$attempt" -eq "$MAX_FIX" ]; then
    echo "💀 Max fix attempts reached ($MAX_FIX). Phase 1 failed."
    exit 1
  fi

  # ── Build diagnosis context ──
  DIAG_FILE="./test-results/diagnosis-$attempt.md"
  echo "# Phase 1 Failure Diagnosis (attempt $attempt)" > "$DIAG_FILE"
  echo "" >> "$DIAG_FILE"

  # Extract failed test details from JSON report
  echo "## Failed Tests" >> "$DIAG_FILE"
  jq -r '.testResults[].assertionResults[] | select(.status=="failed") |
    "### FAILED: \(.fullName)\nError: \(.failureMessages[0] // "unknown")\n"' \
    "$RESULTS" >> "$DIAG_FILE" 2>/dev/null || echo "Could not parse test results" >> "$DIAG_FILE"

  # Fetch recent failed runs via API
  echo "" >> "$DIAG_FILE"
  echo "## Recent Failed Runs" >> "$DIAG_FILE"
  RECENT=$(curl -sf "$BASE/workflows/runs?status=failed&limit=3" -H "$HDR" 2>/dev/null || echo '{"runs":[]}')
  echo '```json' >> "$DIAG_FILE"
  echo "$RECENT" | jq '.' >> "$DIAG_FILE" 2>/dev/null || echo "$RECENT" >> "$DIAG_FILE"
  echo '```' >> "$DIAG_FILE"

  # For each failed run, get agent steps for the failed goal
  for RUN_ID in $(echo "$RECENT" | jq -r '.runs[].runId' 2>/dev/null); do
    RUN_DETAIL=$(curl -sf "$BASE/workflows/runs/$RUN_ID" -H "$HDR" 2>/dev/null || echo '{"goals":[]}')
    FAILED_GOALS=$(echo "$RUN_DETAIL" | jq -r '.goals[] | select(.success==false) | .goalId // .goal' 2>/dev/null || true)

    for GOAL_ID in $FAILED_GOALS; do
      [ -z "$GOAL_ID" ] && continue
      STEPS=$(curl -sf "$BASE/workflows/runs/$RUN_ID/goals/$GOAL_ID/steps" -H "$HDR" 2>/dev/null || echo '{"steps":[]}')

      echo "" >> "$DIAG_FILE"
      echo "## Run $RUN_ID — Goal: $GOAL_ID" >> "$DIAG_FILE"
      echo "" >> "$DIAG_FILE"
      echo "### Last 5 agent steps:" >> "$DIAG_FILE"
      echo '```json' >> "$DIAG_FILE"
      echo "$STEPS" | jq '.steps[-5:]' >> "$DIAG_FILE" 2>/dev/null || echo "$STEPS" >> "$DIAG_FILE"
      echo '```' >> "$DIAG_FILE"

      # Also get eval results if available
      EVAL=$(curl -sf "$BASE/workflows/runs/$RUN_ID/goals/$GOAL_ID/eval" -H "$HDR" 2>/dev/null || echo '{}')
      if echo "$EVAL" | jq -e '.judgment' > /dev/null 2>&1; then
        echo "" >> "$DIAG_FILE"
        echo "### Eval judgment:" >> "$DIAG_FILE"
        echo '```json' >> "$DIAG_FILE"
        echo "$EVAL" | jq '.judgment' >> "$DIAG_FILE" 2>/dev/null
        echo '```' >> "$DIAG_FILE"
      fi
    done
  done

  echo ""
  echo "📋 Diagnosis written to $DIAG_FILE"
  echo "🔧 Invoking Claude to fix workflow goals..."
  echo ""

  claude --dangerously-skip-permissions \
    "Read $DIAG_FILE. This contains failed DroidClaw workflow test results with agent step traces.

The agent follows goal text from workflow JSON files in examples/workflows/social/.
Analyze WHY the agent got stuck (wrong screen, missed button, unclear instruction, etc.).
Fix ONLY the goal text in the workflow JSON files — do NOT change test code or server code.
After fixing, explain what you changed and why." || {
    echo "⚠️  Claude invocation failed. Continuing to next attempt..."
  }
done

# ── Phase 2: Recipe (pause on failure) ───────────────────────────────
echo ""
echo "═══════════════════════════════════════"
echo "  Phase 2: Recipe Verification"
echo "═══════════════════════════════════════"
echo ""

npx vitest run --config vitest.config.e2e-social.ts -t "Phase 2" || true

if [ ! -f "$RESULTS" ]; then
  echo "⚠️  No test results file"
  FAILED=1
else
  FAILED=$(jq '.numFailedTests // 0' "$RESULTS" 2>/dev/null || echo "1")
fi

if [ "$FAILED" -gt 0 ]; then
  echo ""
  echo "⚠️  Recipe verification failed — this may be a code issue."
  echo "   Review the failures and approve fixes before continuing."
  echo ""

  jq -r '.testResults[].assertionResults[] | select(.status=="failed") |
    "  FAIL: \(.fullName)\n  Error: \(.failureMessages[0] // "unknown")\n"' \
    "$RESULTS" 2>/dev/null || echo "  Could not parse failures"

  read -p "🔧 Invoke Claude to diagnose? [y/N] " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    claude "Phase 2 (recipe) tests failed. This likely means the recipe compilation or replay \
      has a code bug. Analyze the test results in $RESULTS and the recent failed runs via the \
      DroidClaw API. Check server/src/agent/workflow-runner.ts recipe compilation logic. \
      Suggest fixes but WAIT for my approval before editing any code."
  fi
  exit 1
fi
echo "✅ Phase 2 passed — recipes work!"

# ── Phase 3: Stress Test (report) ────────────────────────────────────
echo ""
echo "═══════════════════════════════════════"
echo "  Phase 3: Stress Test (5 runs)"
echo "═══════════════════════════════════════"
echo ""

npx vitest run --config vitest.config.e2e-social.ts -t "stress" || true

if [ ! -f "$RESULTS" ]; then
  echo "⚠️  No test results file"
  TOTAL=0
  PASSED=0
  FAILED=0
else
  TOTAL=$(jq '.numTotalTests // 0' "$RESULTS" 2>/dev/null || echo "0")
  PASSED=$(jq '.numPassedTests // 0' "$RESULTS" 2>/dev/null || echo "0")
  FAILED=$(jq '.numFailedTests // 0' "$RESULTS" 2>/dev/null || echo "0")
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Stress Results: $PASSED/$TOTAL passed"
if [ "$FAILED" -gt 0 ]; then
  echo "  ⚠️  $FAILED flaky failure(s):"
  jq -r '.testResults[].assertionResults[] | select(.status=="failed") |
    "    FAIL: \(.fullName)"' "$RESULTS" 2>/dev/null || true
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🎉 All phases complete!"
