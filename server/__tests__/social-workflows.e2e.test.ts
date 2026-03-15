/**
 * Social Workflow E2E Tests — Phased Structure
 *
 * Each workflow test has 3 phases:
 *   Phase 1 (Discovery): Run once — AI discovers the path
 *   Phase 2 (Recipe):    Run again — verify the compiled recipe works
 *   Phase 3 (Stress):    Run 5 times — measure recipe consistency/success rate
 *
 * Run selectively:
 *   npx vitest run --config vitest.config.e2e-social.ts -t "Phase 1"     # discovery only
 *   npx vitest run --config vitest.config.e2e-social.ts -t "Phase 2"     # recipe only
 *   npx vitest run --config vitest.config.e2e-social.ts -t "stress"      # stress only
 *   npx vitest run --config vitest.config.e2e-social.ts -t "Ensure"      # all phases for one workflow
 *   npm run test:social                                                   # everything
 *
 * Env vars (required):
 *   DROIDCLAW_URL          — server URL (e.g., https://droidclaw.stack.mascott.ai)
 *   DROIDCLAW_AUTH_TOKEN   — Bearer token (API key or INTERNAL_SECRET)
 *   DROIDCLAW_DEVICE_ID    — device to run tests on
 *   INSTAREG_API_URL       — InstaReg API URL (to fetch test account credentials)
 *   INSTAREG_API_KEY       — InstaReg API key
 *
 * Env vars (optional — override auto-fetched credentials):
 *   TEST_IG_USERNAME        — Instagram test account username
 *   TEST_IG_PASSWORD        — Instagram test account password
 *   TEST_IG_TOTP_SECRET     — TOTP secret for 2FA
 */

import { describe, test, expect, beforeAll } from "vitest";
import { DroidClawTestClient } from "./helpers/droidclaw-test-client";

const DROIDCLAW_URL = process.env.DROIDCLAW_URL;
const DROIDCLAW_AUTH_TOKEN = process.env.DROIDCLAW_AUTH_TOKEN;
const DROIDCLAW_DEVICE_ID = process.env.DROIDCLAW_DEVICE_ID;

// IG credentials — set via env or auto-fetched from InstaReg
let TEST_IG_USERNAME = process.env.TEST_IG_USERNAME;
let TEST_IG_PASSWORD = process.env.TEST_IG_PASSWORD;
let TEST_IG_TOTP_SECRET = process.env.TEST_IG_TOTP_SECRET;

// Optional env vars for specific tests
const TEST_IG_NAME = process.env.TEST_IG_NAME ?? "Test User";
const TEST_IG_BIO = process.env.TEST_IG_BIO ?? "Automated test bio";
const TEST_IG_PROFILE_PIC_URL = process.env.TEST_IG_PROFILE_PIC_URL;
const TEST_IG_VIDEO_URL = process.env.TEST_IG_VIDEO_URL;
const TEST_IG_NICHE_KEYWORDS = process.env.TEST_IG_NICHE_KEYWORDS ?? "fitness motivation";
const TEST_IG_COMMENT_PROMPT =
	process.env.TEST_IG_COMMENT_PROMPT ?? "You are a fitness enthusiast. Write a 5-6 word funny supportive reply.";

let client: DroidClawTestClient;

/**
 * Fetch an Instagram account from the InstaReg orders API.
 * Picks the most recent order's first account.
 */
async function fetchAccountFromInstaReg(): Promise<{
	username: string;
	password: string;
	totpSecret: string;
}> {
	const apiUrl = process.env.INSTAREG_API_URL;
	const apiKey = process.env.INSTAREG_API_KEY;

	if (!apiUrl || !apiKey) {
		throw new Error(
			"No TEST_IG_USERNAME set and INSTAREG_API_URL/INSTAREG_API_KEY not available to auto-fetch. " +
			"Set either TEST_IG_USERNAME+TEST_IG_PASSWORD+TEST_IG_TOTP_SECRET or INSTAREG_API_URL+INSTAREG_API_KEY.",
		);
	}

	// List recent orders
	const ordersRes = await fetch(`${apiUrl}/api/orders?limit=5`, {
		headers: { Authorization: `Bearer ${apiKey}` },
	});
	if (!ordersRes.ok) throw new Error(`InstaReg orders list failed: HTTP ${ordersRes.status}`);
	const ordersData = (await ordersRes.json()) as {
		orders: Array<{ orderId: string; accountCount: number }>;
	};

	// Find an order with accounts
	for (const order of ordersData.orders) {
		const detailRes = await fetch(`${apiUrl}/api/orders/${order.orderId}`, {
			headers: { Authorization: `Bearer ${apiKey}` },
		});
		if (!detailRes.ok) continue;
		const detail = (await detailRes.json()) as {
			accounts: Array<{
				username: string;
				password: string;
				seed: string;
				twoFAVerified: boolean;
			}>;
		};

		const account = detail.accounts.find((a) => a.twoFAVerified);
		if (account) {
			// seed may have spaces (base32 formatting), strip them
			const totpSecret = account.seed.replace(/\s+/g, "");
			console.log(`📱 Using InstaReg account: ${account.username} (order ${order.orderId.slice(0, 8)}...)`);
			return {
				username: account.username,
				password: account.password,
				totpSecret,
			};
		}
	}

	throw new Error("No verified InstaReg account found in recent orders");
}

beforeAll(async () => {
	if (!DROIDCLAW_URL || !DROIDCLAW_AUTH_TOKEN || !DROIDCLAW_DEVICE_ID) {
		throw new Error(
			"Missing required env vars: DROIDCLAW_URL, DROIDCLAW_AUTH_TOKEN, DROIDCLAW_DEVICE_ID",
		);
	}
	client = new DroidClawTestClient(DROIDCLAW_URL, DROIDCLAW_AUTH_TOKEN, DROIDCLAW_DEVICE_ID);

	// Auto-fetch IG credentials from InstaReg if not provided
	if (!TEST_IG_USERNAME) {
		const account = await fetchAccountFromInstaReg();
		TEST_IG_USERNAME = account.username;
		TEST_IG_PASSWORD = account.password;
		TEST_IG_TOTP_SECRET = account.totpSecret;
	}
});

// ═══════════════════════════════════════════════════════════════════════════
//  Helper: run stress test loop
// ═══════════════════════════════════════════════════════════════════════════

async function runStressTest(
	workflowPath: string,
	variables: Record<string, string>,
	runs: number,
	timeoutPerRun: number,
	minPassRate = 0.8,
) {
	let passed = 0;
	const results: Array<{ run: number; status: string; runId: string }> = [];

	for (let i = 0; i < runs; i++) {
		const { runId } = await client.runWorkflow(workflowPath, variables);
		const result = await client.waitForCompletion(runId, timeoutPerRun);
		const success = result.status === "completed";
		if (success) passed++;
		results.push({ run: i + 1, status: result.status, runId });
		console.log(`  Stress run ${i + 1}/${runs}: ${result.status} (${runId.slice(0, 8)}...)`);
	}

	console.log(`  Stress results: ${passed}/${runs} passed (${Math.round((passed / runs) * 100)}%)`);
	const minPassed = Math.ceil(runs * minPassRate);
	expect(passed).toBeGreaterThanOrEqual(minPassed);
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. Instagram Login with TOTP
// ═══════════════════════════════════════════════════════════════════════════

describe("Instagram Login with TOTP", () => {
	const getVars = () => {
		expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();
		expect(TEST_IG_PASSWORD, "TEST_IG_PASSWORD required").toBeTruthy();
		expect(TEST_IG_TOTP_SECRET, "TEST_IG_TOTP_SECRET required").toBeTruthy();
		return {
			username: TEST_IG_USERNAME!,
			password: TEST_IG_PASSWORD!,
			totpSecret: TEST_IG_TOTP_SECRET!,
		};
	};
	const workflow = "examples/workflows/social/instagram-login-totp.json";

	test(
		"Phase 1: discovery",
		async () => {
			const { runId } = await client.runWorkflow(workflow, getVars());
			const result = await client.waitForCompletion(runId, 10 * 60_000);

			expect(result.status).toBe("completed");
			expect(result.goals.every((g) => g.success || g.skipped)).toBe(true);

			// Verify home feed reached via eval
			const verifyGoal = result.goals.find((g) => g.goalId === "verify");
			if (verifyGoal?.evalStateValues) {
				expect(verifyGoal.evalStateValues.on_home_feed).toBe(true);
			}
		},
		10 * 60_000,
	);

	test(
		"Phase 2: recipe",
		async () => {
			const { runId } = await client.runWorkflow(workflow, getVars());
			const result = await client.waitForCompletion(runId, 10 * 60_000);

			expect(result.status).toBe("completed");

			// At least some goals should hit recipe cache
			const recipeHits = result.goals.filter((g) => g.resolvedBy === "recipe");
			expect(recipeHits.length).toBeGreaterThan(0);
		},
		10 * 60_000,
	);

	test(
		"Phase 3: stress test (5 runs)",
		async () => {
			await runStressTest(workflow, getVars(), 5, 10 * 60_000);
		},
		60 * 60_000,
	);
});

// ═══════════════════════════════════════════════════════════════════════════
//  2. Instagram Profile Text
// ═══════════════════════════════════════════════════════════════════════════

describe("Instagram Profile Text", () => {
	const getVars = () => {
		expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();
		return {
			name: TEST_IG_NAME,
			username: TEST_IG_USERNAME!,
			bio: TEST_IG_BIO,
		};
	};
	const workflow = "examples/workflows/social/instagram-profile-text.json";

	test(
		"Phase 1: discovery",
		async () => {
			const { runId } = await client.runWorkflow(workflow, getVars());
			const result = await client.waitForCompletion(runId, 10 * 60_000);

			expect(result.status).toBe("completed");
			expect(result.goals.every((g) => g.success)).toBe(true);
		},
		10 * 60_000,
	);

	test(
		"Phase 2: recipe",
		async () => {
			const { runId } = await client.runWorkflow(workflow, getVars());
			const result = await client.waitForCompletion(runId, 10 * 60_000);

			expect(result.status).toBe("completed");
			const recipeHits = result.goals.filter((g) => g.resolvedBy === "recipe");
			expect(recipeHits.length).toBeGreaterThan(0);
		},
		10 * 60_000,
	);

	test(
		"Phase 3: stress test (5 runs)",
		async () => {
			await runStressTest(workflow, getVars(), 5, 10 * 60_000);
		},
		60 * 60_000,
	);
});

// ═══════════════════════════════════════════════════════════════════════════
//  3. Instagram Profile Picture
// ═══════════════════════════════════════════════════════════════════════════

describe("Instagram Profile Picture", () => {
	const getVars = () => {
		expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();
		return {
			username: TEST_IG_USERNAME!,
			imageUrl: TEST_IG_PROFILE_PIC_URL!,
			albumName: `pfp${Date.now().toString(36).slice(-6)}`,
		};
	};
	const workflow = "examples/workflows/social/instagram-profile-picture.json";

	test(
		"Phase 1: discovery",
		async () => {
			if (!TEST_IG_PROFILE_PIC_URL) {
				console.log("Skipping: TEST_IG_PROFILE_PIC_URL not set");
				return;
			}

			const { runId } = await client.runWorkflow(workflow, getVars());
			const result = await client.waitForCompletion(runId, 10 * 60_000);

			expect(result.status).toBe("completed");
			expect(result.goals.every((g) => g.success)).toBe(true);
		},
		10 * 60_000,
	);

	test(
		"Phase 2: recipe",
		async () => {
			if (!TEST_IG_PROFILE_PIC_URL) {
				console.log("Skipping: TEST_IG_PROFILE_PIC_URL not set");
				return;
			}

			const { runId } = await client.runWorkflow(workflow, getVars());
			const result = await client.waitForCompletion(runId, 10 * 60_000);

			expect(result.status).toBe("completed");
			const recipeHits = result.goals.filter((g) => g.resolvedBy === "recipe");
			expect(recipeHits.length).toBeGreaterThan(0);
		},
		10 * 60_000,
	);

	test(
		"Phase 3: stress test (5 runs)",
		async () => {
			if (!TEST_IG_PROFILE_PIC_URL) {
				console.log("Skipping: TEST_IG_PROFILE_PIC_URL not set");
				return;
			}
			await runStressTest(workflow, getVars(), 5, 10 * 60_000);
		},
		60 * 60_000,
	);
});

// ═══════════════════════════════════════════════════════════════════════════
//  4. Instagram Warmup
// ═══════════════════════════════════════════════════════════════════════════

describe("Instagram Warmup", () => {
	const getVars = () => ({
		username: TEST_IG_USERNAME!,
		nicheKeywords: TEST_IG_NICHE_KEYWORDS,
		commentPrompt: TEST_IG_COMMENT_PROMPT,
	});
	const workflow = "examples/workflows/social/instagram-warmup.json";

	test(
		"Phase 1: discovery",
		async () => {
			expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();

			const { runId } = await client.runWorkflow(workflow, getVars());
			const result = await client.waitForCompletion(runId, 15 * 60_000);

			// Warmup uses exhaustIsSuccess, so individual goals may "fail" due to step exhaustion
			// but the overall workflow should complete
			expect(result.status).toBe("completed");
		},
		15 * 60_000,
	);

	test(
		"Phase 2: recipe",
		async () => {
			expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();

			const { runId } = await client.runWorkflow(workflow, getVars());
			const result = await client.waitForCompletion(runId, 15 * 60_000);

			expect(result.status).toBe("completed");
			// Warmup has many goals; at least some should use recipes
			const recipeHits = result.goals.filter((g) => g.resolvedBy === "recipe");
			expect(recipeHits.length).toBeGreaterThan(0);
		},
		15 * 60_000,
	);

	test(
		"Phase 3: stress test (5 runs)",
		async () => {
			expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();
			await runStressTest(workflow, getVars(), 5, 15 * 60_000, 0.6); // warmup is more variable
		},
		90 * 60_000,
	);
});

// ═══════════════════════════════════════════════════════════════════════════
//  5. Instagram Post Reel
// ═══════════════════════════════════════════════════════════════════════════

describe("Instagram Post Reel", () => {
	const getVars = () => ({
		username: TEST_IG_USERNAME!,
		videoUrl: TEST_IG_VIDEO_URL!,
		caption: `E2E test reel ${new Date().toISOString().slice(0, 16)}`,
		albumName: `r${Date.now().toString(36).slice(-6)}`,
	});
	const workflow = "examples/workflows/social/instagram-post-reel-v2.json";

	test(
		"Phase 1: discovery",
		async () => {
			if (!TEST_IG_VIDEO_URL) {
				console.log("Skipping: TEST_IG_VIDEO_URL not set");
				return;
			}
			expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();

			const { runId } = await client.runWorkflow(workflow, getVars());
			const result = await client.waitForCompletion(runId, 10 * 60_000);

			expect(result.status).toBe("completed");
			expect(result.goals.every((g) => g.success)).toBe(true);
		},
		10 * 60_000,
	);

	test(
		"Phase 2: recipe",
		async () => {
			if (!TEST_IG_VIDEO_URL) {
				console.log("Skipping: TEST_IG_VIDEO_URL not set");
				return;
			}
			expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();

			const { runId } = await client.runWorkflow(workflow, getVars());
			const result = await client.waitForCompletion(runId, 10 * 60_000);

			expect(result.status).toBe("completed");
			const recipeHits = result.goals.filter((g) => g.resolvedBy === "recipe");
			expect(recipeHits.length).toBeGreaterThan(0);
		},
		10 * 60_000,
	);

	test(
		"Phase 3: stress test (5 runs)",
		async () => {
			if (!TEST_IG_VIDEO_URL) {
				console.log("Skipping: TEST_IG_VIDEO_URL not set");
				return;
			}
			expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();
			await runStressTest(workflow, getVars(), 5, 10 * 60_000);
		},
		60 * 60_000,
	);
});

// ═══════════════════════════════════════════════════════════════════════════
//  6. Ensure Account
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Helper: shared assertions for a successful ensure_account goal.
 * Validates eval states, step structure, and eval endpoint.
 *
 * @param expectOnHomeFeed - If true, assert on_home_feed === true. Default: false.
 *   The workflow's eval only requires active_username; on_home_feed has no
 *   expected value (informational only). After switching accounts, Instagram often
 *   lands on the profile page, not the home feed.
 */
async function assertEnsureAccountSuccess(
	runId: string,
	targetUsername: string,
	label: string,
	opts?: { expectOnHomeFeed?: boolean },
) {
	const result = await client.waitForCompletion(runId, 5 * 60_000);
	expect(result.status).toBe("completed");

	const ensureGoal = result.goals.find((g) => g.goalId === "ensure_account");
	expect(ensureGoal, `${label}: ensure_account goal not found`).toBeTruthy();
	expect(ensureGoal!.evalPassed).toBe(true);

	// ── Eval state verification ──
	// active_username is a string eval — the judge extracts the actual username from the screen
	// and compares it (case-insensitive) to the expected username
	expect(ensureGoal!.evalStateValues).toBeDefined();
	const activeUsername = String(ensureGoal!.evalStateValues!.active_username ?? "").toLowerCase();
	expect(activeUsername).toBe(targetUsername.toLowerCase());
	expect(ensureGoal!.evalMismatches).toEqual([]);
	if (opts?.expectOnHomeFeed) {
		expect(ensureGoal!.evalStateValues!.on_home_feed).toBe(true);
	}

	// ── Step inspection ──
	const { steps, totalSteps } = await client.getGoalSteps(runId, "ensure_account");
	expect(steps.length).toBeGreaterThan(0);
	expect(totalSteps).toBeLessThanOrEqual(12);

	// Last step action is "done" — agent completed, didn't exhaust steps
	const lastStep = steps[steps.length - 1];
	const lastAction = typeof lastStep.action === "string"
		? lastStep.action
		: (lastStep.action as Record<string, unknown>).action;
	expect(lastAction).toBe("done");

	// All steps with a package stayed in Instagram
	const stepsWithPackage = steps.filter((s) => s.package);
	for (const s of stepsWithPackage) {
		expect(s.package).toBe("com.instagram.android");
	}

	// At least one step's reasoning mentions the username
	const mentionsUsername = steps.some(
		(s) => s.reasoning?.toLowerCase().includes(targetUsername.toLowerCase()),
	);
	expect(mentionsUsername).toBe(true);

	// ── Eval endpoint verification ──
	const evalResult = await client.getGoalEval(runId, "ensure_account");
	expect(evalResult.judgment).toBeTruthy();
	expect(evalResult.judgment!.success).toBe(true);
	const evalUsername = String(evalResult.judgment!.stateValues.active_username ?? "").toLowerCase();
	expect(evalUsername).toBe(targetUsername.toLowerCase());

	// ── Console logging ──
	console.log(`\n📋 ${label} — ${totalSteps} steps (active_username=${activeUsername}):`);
	for (const s of steps) {
		const actionStr = typeof s.action === "string"
			? s.action
			: JSON.stringify(s.action);
		console.log(`  Step ${s.step}: [${actionStr}] ${s.reasoning?.slice(0, 120) ?? ""}`);
	}

	return { result, ensureGoal: ensureGoal!, steps, totalSteps };
}

describe("Ensure Account", () => {
	const workflow = "examples/workflows/social/instagram-ensure-account.json";

	// ── Scenario 1: Target already active ──
	// The primary test account is already the active account on the device.
	// Agent should recognize it and mark done quickly.
	test(
		"Scenario 1: target already active — should succeed immediately",
		async () => {
			expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();

			const { runId } = await client.runWorkflow(workflow, { username: TEST_IG_USERNAME! });
			const { totalSteps } = await assertEnsureAccountSuccess(
				runId,
				TEST_IG_USERNAME!,
				"Scenario 1 (already active)",
			);

			// Should complete quickly — just check profile and done
			expect(totalSteps).toBeLessThanOrEqual(5);
			console.log(`✅ Scenario 1 passed: account already active, ${totalSteps} steps`);
		},
		5 * 60_000,
	);

	// ── Scenario 2: Target exists in account switcher — should switch ──
	// Pre-condition: multiple accounts are already logged in on the device.
	// First, ensure_account switches to a different account, then switches back to primary.
	// ensure_account itself does NOT log in — it only checks/switches existing accounts.
	test(
		"Scenario 2: different account active, target in switcher — should switch",
		async () => {
			expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();

			// Step 1: Switch to a different account so primary is NOT active
			// Use one of the existing accounts already on the device
			const OTHER_USERNAME = "dragon.2408522";
			console.log(`\n🔧 Test setup: switching to ${OTHER_USERNAME} so primary is no longer active...`);
			const setupResult = await client.runWorkflow(workflow, { username: OTHER_USERNAME });
			const setupCompletion = await client.waitForCompletion(setupResult.runId, 5 * 60_000);
			expect(setupCompletion.status).toBe("completed");
			console.log(`✅ Setup: ${OTHER_USERNAME} is now active, ${TEST_IG_USERNAME} should be in the switcher`);

			// Step 2: Now ensure_account for the PRIMARY account — should switch via account switcher
			console.log(`\n🔄 Running ensure_account to switch from ${OTHER_USERNAME} → ${TEST_IG_USERNAME}...`);
			const { runId } = await client.runWorkflow(workflow, { username: TEST_IG_USERNAME! });
			const { totalSteps, steps } = await assertEnsureAccountSuccess(
				runId,
				TEST_IG_USERNAME!,
				"Scenario 2 (switch account)",
			);

			// Verify the agent actually switched — should have used account switcher
			// Look for steps that involve long-press on profile or tapping the account
			const switchingSteps = steps.filter(
				(s) => {
					const reasoning = s.reasoning?.toLowerCase() ?? "";
					const actionStr = typeof s.action === "string" ? s.action : JSON.stringify(s.action);
					return reasoning.includes("switch") ||
						reasoning.includes("account") ||
						reasoning.includes("long") ||
						actionStr.includes("longpress");
				},
			);
			expect(switchingSteps.length).toBeGreaterThan(0);
			console.log(`✅ Scenario 2 passed: switched account in ${totalSteps} steps, ${switchingSteps.length} switch-related steps`);
		},
		10 * 60_000,
	);

	// ── Scenario 3: Target not in account switcher — should fail ──
	// Use a username that doesn't exist on the device.
	// The agent should check the account switcher and fail gracefully.
	test(
		"Scenario 3: target not in switcher — should fail",
		async () => {
			const FAKE_USERNAME = "nonexistent_user_xyz_99999";

			console.log(`\n❌ Running ensure_account for nonexistent account ${FAKE_USERNAME}...`);
			const { runId } = await client.runWorkflow(workflow, { username: FAKE_USERNAME });
			const result = await client.waitForCompletion(runId, 5 * 60_000);

			// Workflow should fail — account doesn't exist on the device
			expect(result.status).toBe("failed");

			const ensureGoal = result.goals.find((g) => g.goalId === "ensure_account");
			expect(ensureGoal, "ensure_account goal not found").toBeTruthy();

			// Goal should NOT have passed
			expect(ensureGoal!.success).toBe(false);

			// Eval should show active_username is NOT the fake username
			if (ensureGoal!.evalStateValues) {
				const activeUsername = String(ensureGoal!.evalStateValues.active_username ?? "").toLowerCase();
				expect(activeUsername).not.toBe(FAKE_USERNAME.toLowerCase());
			}

			// ── Step inspection — agent should have attempted but failed ──
			const { steps, totalSteps } = await client.getGoalSteps(runId, "ensure_account");
			expect(steps.length).toBeGreaterThan(0);

			// Agent should have tried to find the account and concluded it's not there
			console.log(`\n📋 Scenario 3 — ${totalSteps} steps (expected failure):`);
			for (const s of steps) {
				const actionStr = typeof s.action === "string"
					? s.action
					: JSON.stringify(s.action);
				console.log(`  Step ${s.step}: [${actionStr}] ${s.reasoning?.slice(0, 120) ?? ""}`);
			}

			console.log(`✅ Scenario 3 passed: correctly failed for nonexistent account`);
		},
		5 * 60_000,
	);

	// ── Original phased tests (kept for recipe/stress testing) ──

	test(
		"Phase 1: discovery",
		async () => {
			expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();

			const { runId } = await client.runWorkflow(workflow, { username: TEST_IG_USERNAME! });
			await assertEnsureAccountSuccess(runId, TEST_IG_USERNAME!, "Phase 1 (discovery)");
		},
		5 * 60_000,
	);

	test(
		"Phase 2: recipe",
		async () => {
			expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();

			const { runId } = await client.runWorkflow(workflow, { username: TEST_IG_USERNAME! });
			const result = await client.waitForCompletion(runId, 5 * 60_000);

			expect(result.status).toBe("completed");

			const ensureGoal = result.goals.find((g) => g.goalId === "ensure_account");
			expect(ensureGoal).toBeTruthy();
			expect(ensureGoal!.resolvedBy).toBe("recipe");

			// ── Eval state verification ──
			expect(ensureGoal!.evalPassed).toBe(true);
			expect(ensureGoal!.evalStateValues).toBeDefined();
			const activeUsername = String(ensureGoal!.evalStateValues!.active_username ?? "").toLowerCase();
			expect(activeUsername).toBe(TEST_IG_USERNAME!.toLowerCase());
			expect(ensureGoal!.evalMismatches).toEqual([]);

			// ── Eval endpoint verification ──
			const evalResult = await client.getGoalEval(runId, "ensure_account");
			expect(evalResult.judgment).toBeTruthy();
			expect(evalResult.judgment!.success).toBe(true);
			const evalUsername = String(evalResult.judgment!.stateValues.active_username ?? "").toLowerCase();
			expect(evalUsername).toBe(TEST_IG_USERNAME!.toLowerCase());

			console.log(`\n📋 Ensure Account — recipe replay, eval passed ✓`);
		},
		5 * 60_000,
	);

	test(
		"Phase 3: stress test (5 runs)",
		async () => {
			expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();
			await runStressTest(workflow, { username: TEST_IG_USERNAME! }, 5, 5 * 60_000);
		},
		30 * 60_000,
	);
});
