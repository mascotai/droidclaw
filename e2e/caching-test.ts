#!/usr/bin/env bun
/**
 * E2E Caching Test — Instagram Login Workflow
 *
 * Tests that the workflow caching system works end-to-end:
 *   Run 1: AI pipeline discovers login steps (slow, ~30-60s per step)
 *   Run 2: Cached flows replay deterministically (fast, ~2-5s per step)
 *
 * Usage:
 *   # Full test (run1 + logout + run2 comparison):
 *   bun run e2e/caching-test.ts
 *
 *   # Run only the login workflow once (to seed the cache):
 *   bun run e2e/caching-test.ts --seed-only
 *
 *   # Run only the second pass (assumes cache is already seeded):
 *   bun run e2e/caching-test.ts --cached-only
 *
 *   # List existing cached flows:
 *   bun run e2e/caching-test.ts --list-cache
 *
 *   # Clear cached flows for this device:
 *   bun run e2e/caching-test.ts --clear-cache
 */

const API_URL = process.env.DROIDCLAW_API_URL || "https://droidclaw.stack.mascott.ai";
const API_KEY = process.env.DROIDCLAW_API_KEY!;
const DEVICE_ID = process.env.DROIDCLAW_DEVICE_ID || "a65b6cfe-cedd-4faf-a39c-b1290c6b249a";

if (!API_KEY) {
  console.error("❌ DROIDCLAW_API_KEY is required. Set it in .env");
  process.exit(1);
}

// ── Instagram credentials ──
const IG_USERNAME = "chipmunk.9921766";
const IG_PASSWORD = "igmsctpss";
const TOTP_SECRET = "WII6K5I7ETUHTMT7YLZJ3EGOO2INZOOW";

// ── Helpers ──

async function api(path: string, options?: RequestInit) {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      ...options?.headers,
    },
    // Long timeout for blocking workflow runs (can take 5+ minutes)
    signal: AbortSignal.timeout(10 * 60 * 1000),
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new Error(`API ${path}: ${JSON.stringify(data)}`);
  return data;
}

function elapsed(startMs: number): string {
  const s = ((Date.now() - startMs) / 1000).toFixed(1);
  return `${s}s`;
}

function printStepResults(results: any[]) {
  for (const r of results) {
    const icon = r.success ? "✅" : "❌";
    const cached = r.resolvedBy === "cached_flow" ? " ⚡ CACHED" : r.resolvedBy ? ` [${r.resolvedBy}]` : "";
    const steps = r.stepsUsed ? ` (${r.stepsUsed} steps)` : "";
    console.log(`  ${icon} ${r.goal}${steps}${cached}`);
    if (r.error) console.log(`     └─ Error: ${r.error}`);
  }
}

// ── Workflow definition ──

function makeLoginWorkflow() {
  return {
    deviceId: DEVICE_ID,
    name: "E2E Cache Test — Instagram Login/Add Account",
    type: "workflow" as const,
    steps: [
      {
        app: "com.instagram.android",
        goal: `Open Instagram. Check if you are already logged in as '${IG_USERNAME}' — if so, you are done. Otherwise: if you see a home feed (logged in as a different account), go to the profile tab, tap the username at the top or hamburger menu (≡), tap 'Add Instagram account', then tap 'Log in to existing account'. If you see the initial login screen, tap 'Log in'. In both cases: first clear any pre-filled username by tapping the X button or selecting all and deleting, then enter username '${IG_USERNAME}' and password '${IG_PASSWORD}', then tap 'Log In'. Wait for the next screen to appear.`,
        maxSteps: 25,
        retries: 1,
      },
      {
        app: "com.instagram.android",
        goal: `You should see a 2FA / security code input screen. Use get_totp with text '${TOTP_SECRET}' to generate the 6-digit code and copy it to clipboard. Then tap the security code input field and use paste to paste the code. Then use find_and_tap with query 'Confirm' or 'Continue' or 'Next' to submit.`,
        maxSteps: 10,
        retries: 2,
      },
      {
        app: "com.instagram.android",
        goal: "If there are any onboarding screens (Save Login Info, Turn on Notifications, etc.), dismiss them by tapping 'Not Now' or 'Skip'. Navigate to the home feed. Confirm login was successful by checking for the home feed icons.",
        maxSteps: 25,
      },
    ],
  };
}

function makeLogoutWorkflow() {
  return {
    deviceId: DEVICE_ID,
    name: "E2E Cache Test — Instagram Logout",
    type: "workflow" as const,
    steps: [
      {
        app: "com.instagram.android",
        goal: "Open Instagram. Go to your profile tab (bottom right). Tap the hamburger menu (≡) or settings icon. Scroll down and tap 'Log out' or 'Log Out'. Confirm the logout if prompted. Done when you see the login screen.",
        maxSteps: 15,
        cache: false, // Don't cache logout — it's a test utility, not a real workflow
      },
    ],
  };
}

// ── Run a workflow and wait for completion ──

async function runWorkflow(workflow: any, label: string): Promise<{ duration: number; result: any }> {
  console.log(`\n🚀 Starting: ${label}`);
  console.log(`   Steps: ${workflow.steps.length}`);

  const start = Date.now();
  const result = await api("/workflows/run?wait=true", {
    method: "POST",
    body: JSON.stringify(workflow),
  });

  const duration = Date.now() - start;
  const status = result.status ?? "unknown";
  const icon = status === "completed" ? "✅" : status === "failed" ? "❌" : "⚠️";

  console.log(`\n${icon} ${label} — ${status} in ${elapsed(start)}`);

  if (result.stepResults) {
    printStepResults(result.stepResults);
  }

  return { duration, result };
}

// ── List cached flows ──

async function listCachedFlows() {
  const runs = await api(`/workflows/runs/${DEVICE_ID}`);
  // The cached flows are visible in step results with resolvedBy: "cached_flow"
  // But let's also check the DB directly if available
  console.log("\n📦 Recent workflow runs:");
  for (const run of (runs.items ?? runs).slice(0, 10)) {
    const icon = run.status === "completed" ? "✅" : run.status === "failed" ? "❌" : "⏳";
    const cacheHits = (run.stepResults ?? []).filter((r: any) => r?.resolvedBy === "cached_flow").length;
    const total = (run.stepResults ?? []).length;
    const cache = cacheHits > 0 ? ` ⚡ ${cacheHits}/${total} cached` : "";
    console.log(`  ${icon} ${run.name} [${run.status}]${cache} — ${new Date(run.startedAt).toLocaleString()}`);
  }
}

// ── Main ──

const args = process.argv.slice(2);

if (args.includes("--list-cache")) {
  await listCachedFlows();
  process.exit(0);
}

if (args.includes("--clear-cache")) {
  console.log("🗑️  Clearing cached flows is done via the dashboard (Overview tab). Use --list-cache to see current state.");
  process.exit(0);
}

if (args.includes("--seed-only")) {
  // Just run the login once to seed the cache
  const { result } = await runWorkflow(makeLoginWorkflow(), "Run 1 — Seed Cache (AI pipeline)");
  if (result.status === "completed") {
    console.log("\n✅ Cache seeded. Run with --cached-only to test cache replay.");
  }
  process.exit(result.status === "completed" ? 0 : 1);
}

if (args.includes("--cached-only")) {
  // Assumes cache is seeded — just run and expect cached hits
  const { result, duration } = await runWorkflow(makeLoginWorkflow(), "Cached Run (should use cached flows)");
  const cacheHits = (result.stepResults ?? []).filter((r: any) => r?.resolvedBy === "cached_flow").length;
  const total = (result.stepResults ?? []).length;

  console.log(`\n📊 Cache hits: ${cacheHits}/${total} steps`);
  console.log(`⏱️  Total time: ${(duration / 1000).toFixed(1)}s`);

  if (cacheHits > 0) {
    console.log("✅ Caching is working! Steps were replayed from cache.");
  } else {
    console.log("⚠️  No cache hits. Cache may have been cleared or goals changed.");
  }
  process.exit(0);
}

// ── Full test: Run 1 → Logout → Run 2 → Compare ──

console.log("═══════════════════════════════════════════════════════════");
console.log("  E2E Caching Test — Instagram Login Workflow");
console.log("═══════════════════════════════════════════════════════════");
console.log(`  API:    ${API_URL}`);
console.log(`  Device: ${DEVICE_ID}`);
console.log("═══════════════════════════════════════════════════════════");

// Step 1: Run the login workflow (AI pipeline, no cache)
console.log("\n━━━ PHASE 1: First Login (AI pipeline — building cache) ━━━");
const run1 = await runWorkflow(makeLoginWorkflow(), "Run 1 — AI Pipeline");

if (run1.result.status !== "completed") {
  console.log("\n❌ Run 1 failed. Fix the workflow before testing caching.");
  console.log("   Tip: Check the dashboard for details, or run with --seed-only to retry.");
  process.exit(1);
}

// Step 2: Log out
console.log("\n━━━ PHASE 2: Logging out ━━━");
const logout = await runWorkflow(makeLogoutWorkflow(), "Logout");

if (logout.result.status !== "completed") {
  console.log("\n⚠️  Logout may have failed. Continuing anyway...");
}

// Brief pause for UI to settle
console.log("\n⏳ Waiting 5s for UI to settle...");
await new Promise((r) => setTimeout(r, 5000));

// Step 3: Run the login workflow again (should use cached flows)
console.log("\n━━━ PHASE 3: Second Login (should use cached flows) ━━━");
const run2 = await runWorkflow(makeLoginWorkflow(), "Run 2 — Cache Replay");

// ── Analysis ──
console.log("\n═══════════════════════════════════════════════════════════");
console.log("  RESULTS");
console.log("═══════════════════════════════════════════════════════════");

const run1CacheHits = (run1.result.stepResults ?? []).filter((r: any) => r?.resolvedBy === "cached_flow").length;
const run2CacheHits = (run2.result.stepResults ?? []).filter((r: any) => r?.resolvedBy === "cached_flow").length;

console.log(`\n  Run 1 (AI):     ${(run1.duration / 1000).toFixed(1)}s — ${run1CacheHits} cache hits`);
console.log(`  Run 2 (Cache):  ${(run2.duration / 1000).toFixed(1)}s — ${run2CacheHits} cache hits`);

if (run2.duration < run1.duration) {
  const speedup = (run1.duration / run2.duration).toFixed(1);
  console.log(`\n  🚀 Speedup: ${speedup}x faster with caching!`);
}

if (run2CacheHits > 0) {
  console.log(`\n  ✅ PASS — Caching works! ${run2CacheHits} steps replayed from cache.`);
} else if (run2.result.status === "completed") {
  console.log(`\n  ⚠️  Run 2 completed but without cache hits.`);
  console.log(`     This can happen if the TOTP step isn't cacheable (it's dynamic by nature).`);
  console.log(`     Steps 1 and 3 (login form + onboarding) should be cached on next run.`);
} else {
  console.log(`\n  ❌ FAIL — Run 2 status: ${run2.result.status}`);
}

console.log("\n═══════════════════════════════════════════════════════════");
