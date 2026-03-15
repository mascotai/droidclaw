# E2E Test Runner — Handoff Notes

## What Was Done

### 1. Server: `evalStateValues`/`evalMismatches` in run summary ✅
**File:** `server/src/routes/v2.ts` (line ~386)

Added two fields to each goal object in `GET /v2/devices/:deviceId/workflows/runs/:runId`:
```typescript
evalStateValues: sr.evalJudgment?.stateValues ?? null,
evalMismatches: sr.evalJudgment?.mismatches ?? null,
```

### 2. Test Client: drill-down methods ✅
**File:** `server/__tests__/helpers/droidclaw-test-client.ts`

- Added `GoalStepResult`, `GoalStepsResult`, `GoalEvalResult` interfaces
- Added `getGoalSteps(runId, goalId, options?)` — fetches agent steps with pagination
- Added `getGoalEval(runId, goalId)` — fetches eval definition + judgment
- Fixed `waitForCompletion()` to handle 404 gracefully (run may be queued but not yet in DB — retries instead of crashing)
- Improved error logging in `runWorkflow()` — shows full URL + response body on failure

### 3. E2E Tests: phased structure + fixes ✅
**File:** `server/__tests__/social-workflows.e2e.test.ts`

- **Fixed test 6:** Changed from "Conditional Login" (`check_login`/`full_login`) → "Ensure Account" (`ensure_account`, only needs `username`)
- **Fixed tests 3 & 4:** Added missing `username` variable to Profile Picture and Warmup
- **Phased structure:** Every workflow now has 3 phases:
  - `Phase 1: discovery` — run once, verify AI finds the path
  - `Phase 2: recipe` — run again, verify `resolvedBy === "recipe"`
  - `Phase 3: stress test (5 runs)` — run 5 times, ≥80% pass rate
- **Auto-fetch IG credentials:** `beforeAll` fetches account from InstaReg orders API if `TEST_IG_USERNAME` not set
- **Run selectively:** `npx vitest run --config vitest.config.e2e-social.ts -t "Ensure Account.*Phase 1"`

### 4. Vitest Config: JSON reporter ✅
**File:** `vitest.config.e2e-social.ts`

Added `reporters: ["default", "json"]` and `outputFile: { json: "./test-results/social-e2e.json" }`.

### 5. Self-Healing Test Runner ✅
**File:** `scripts/test-and-fix.sh`

Three-phase pipeline:
- **Phase 1:** Auto-fix loop (up to 3 attempts). On failure → fetch agent steps via API → invoke `claude` CLI to fix workflow JSON goal text → re-run
- **Phase 2:** Recipe verification. Failures pause for human approval
- **Phase 3:** Stress report. 5 runs, report pass rate

Loads secrets from **Infisical CLI** at runtime (universal-auth), falls back to `.env`.

### 6. Package.json ✅
- Added `"test:social:fix": "bash scripts/test-and-fix.sh"`
- Installed `@vitest/ui@4.1.0`

### 7. Infisical CLI ✅
- Installed at `~/bin/infisical` (v0.43.59)
- Self-hosted instance: `https://secrets.stack.mascott.ai/api`
- Auth: universal-auth with `INFISICAL_CLIENT_ID` / `INFISICAL_CLIENT_SECRET` (from env vars, NOT hardcoded)
- Project ID: `f6753b26-c4ae-476c-a388-1a3cf56a7c0b`

### 8. .gitignore ✅
Added `test-results/`

---

## Commits Pushed to `main`

| SHA | Description |
|-----|-------------|
| `6b666dc` | feat: phased E2E test structure + self-healing test runner |
| `bcd5298` | fix: use vitest `-t` flag instead of `--grep` |
| `e3ed19e` | feat: auto-fetch IG credentials from InstaReg API |
| `c96825c` | feat: load secrets from Infisical CLI in test-and-fix.sh |
| `0b8bf4e` | fix: remove hardcoded Infisical credentials, handle queued run 404 |

---

## What's Blocking / Next

### 🔴 BLOCKER: Runs queue but never start

When we run the test, the workflow gets **queued successfully** (returns a `runId`), but the run **never appears in the DB** — `GET /v2/.../runs/:runId` returns 404 indefinitely.

**Diagnosis so far:**
- `POST /v2/devices/:deviceId/workflows/run` returns `200 { runId, status: "queued" }` ✅
- The Temporal `deviceQueueWorkflow` is running and receiving signals ✅
- Device is online ✅
- But the `execute-run` activity (which creates the DB record and calls back to the server) appears to be **failing silently**

**Likely cause:** The Temporal worker's `execute-run` activity calls the server's internal API (`POST /internal/execute-run`). This may be failing because:
1. The worker might not have the latest code (check if `ci-worker.yml` CI triggered)
2. The `DROIDCLAW_INTERNAL_SECRET` might not match between worker and server
3. The internal URL might be misconfigured

**To debug:**
```bash
# Check Temporal worker logs via Dagger MCP or Docker
# Check if CI deployed the worker
gh run list -R mascotai/droidclaw

# Query the device queue workflow history
# (use mcp__temporal__get_workflow_history with workflow_id: "device-queue-a65b6cfe-cedd-4faf-a39c-b1290c6b249a")

# Try running a workflow via Bruno MCP (uses v1 API, different code path)
# mcp__bruno__droidclaw_workflows_run_add_account
```

### ⚠️ Security: Rotate Infisical Credentials

Commit `c96825c` briefly contained hardcoded Infisical `client-id` and `client-secret`. It was fixed in `0b8bf4e`, but the values are in git history. **Rotate these credentials** via the Infisical admin panel (Machine Identities → Universal Auth). The old values have been redacted from this doc.

**Note:** Infisical OIDC login is not configured (no Authentik provider exists for it). To log in to the Infisical web UI, set up an OIDC provider in the Authentik blueprint or use email/password.

### Next Steps (after unblocking)

1. ~~**Fix the run execution issue** — get runs to actually start on the device~~ ✅ Fixed: mounted `/internal` route in `server/src/index.ts`
2. **Run `Ensure Account Phase 1`** — verify the test works end-to-end
3. **Run the full self-healing pipeline:** `npm run test:social:fix`
4. **Add `INFISICAL_CLIENT_ID`/`INFISICAL_CLIENT_SECRET` to `.env`** (after rotation)

---

## How to Run Tests

```bash
# Load env vars (map .env names to test expectations)
set -a && source .env && set +a
export DROIDCLAW_URL="$DROIDCLAW_API_URL"
export DROIDCLAW_AUTH_TOKEN="$DROIDCLAW_API_KEY"
export INSTAREG_API_URL="https://instareg.stack.mascott.ai"
export INSTAREG_API_KEY="P787xOukBRX/bOpd/NF3H2W8zXiGiA6kYpt4HaLgQEU="

# Run a specific workflow phase
npx vitest run --config vitest.config.e2e-social.ts -t "Ensure Account.*Phase 1"

# Run all Phase 1 discovery tests
npx vitest run --config vitest.config.e2e-social.ts -t "Phase 1"

# Run the full self-healing pipeline (requires INFISICAL_CLIENT_ID/SECRET)
npm run test:social:fix

# Run everything
npm run test:social
```

## Key Files

| File | Purpose |
|------|---------|
| `server/__tests__/social-workflows.e2e.test.ts` | E2E tests (phased) |
| `server/__tests__/helpers/droidclaw-test-client.ts` | Test API client |
| `vitest.config.e2e-social.ts` | Vitest config with JSON reporter |
| `scripts/test-and-fix.sh` | Self-healing pipeline |
| `examples/workflows/social/*.json` | Workflow definitions (goal text) |
| `server/src/routes/v2.ts` | V2 API routes |
| `temporal/src/workflows/device-queue.ts` | Temporal queue coordinator |
| `temporal/src/activities/execute-run.ts` | Activity that creates DB record + runs workflow |
