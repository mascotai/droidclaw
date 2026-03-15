/**
 * Social Workflow E2E Tests — Phased Structure
 *
 * Each workflow test has 3 phases:
 *   Phase 1 (Discovery): Run once — AI discovers the path
 *   Phase 2 (Recipe):    Run again — verify the compiled recipe works
 *   Phase 3 (Stress):    Run 5 times — measure recipe consistency/success rate
 *
 * Run selectively:
 *   npx vitest run --config vitest.config.e2e-social.ts --grep "Phase 1"     # discovery only
 *   npx vitest run --config vitest.config.e2e-social.ts --grep "Phase 2"     # recipe only
 *   npx vitest run --config vitest.config.e2e-social.ts --grep "stress"      # stress only
 *   npx vitest run --config vitest.config.e2e-social.ts --grep "Ensure"      # all phases for one workflow
 *   npm run test:social                                                       # everything
 *
 * Requires env vars:
 *   DROIDCLAW_URL          — server URL (e.g., https://droidclaw.stack.mascott.ai)
 *   DROIDCLAW_AUTH_TOKEN   — Bearer token (API key or INTERNAL_SECRET)
 *   DROIDCLAW_DEVICE_ID    — device to run tests on
 *   TEST_IG_USERNAME        — Instagram test account username
 *   TEST_IG_PASSWORD        — Instagram test account password
 *   TEST_IG_TOTP_SECRET     — TOTP secret for 2FA
 */

import { describe, test, expect, beforeAll } from "vitest";
import { DroidClawTestClient } from "./helpers/droidclaw-test-client";

const DROIDCLAW_URL = process.env.DROIDCLAW_URL;
const DROIDCLAW_AUTH_TOKEN = process.env.DROIDCLAW_AUTH_TOKEN;
const DROIDCLAW_DEVICE_ID = process.env.DROIDCLAW_DEVICE_ID;
const TEST_IG_USERNAME = process.env.TEST_IG_USERNAME;
const TEST_IG_PASSWORD = process.env.TEST_IG_PASSWORD;
const TEST_IG_TOTP_SECRET = process.env.TEST_IG_TOTP_SECRET;

// Optional env vars for specific tests
const TEST_IG_NAME = process.env.TEST_IG_NAME ?? "Test User";
const TEST_IG_BIO = process.env.TEST_IG_BIO ?? "Automated test bio";
const TEST_IG_PROFILE_PIC_URL = process.env.TEST_IG_PROFILE_PIC_URL;
const TEST_IG_VIDEO_URL = process.env.TEST_IG_VIDEO_URL;
const TEST_IG_NICHE_KEYWORDS = process.env.TEST_IG_NICHE_KEYWORDS ?? "fitness motivation";
const TEST_IG_COMMENT_PROMPT =
	process.env.TEST_IG_COMMENT_PROMPT ?? "You are a fitness enthusiast. Write a 5-6 word funny supportive reply.";

let client: DroidClawTestClient;

beforeAll(() => {
	if (!DROIDCLAW_URL || !DROIDCLAW_AUTH_TOKEN || !DROIDCLAW_DEVICE_ID) {
		throw new Error(
			"Missing required env vars: DROIDCLAW_URL, DROIDCLAW_AUTH_TOKEN, DROIDCLAW_DEVICE_ID",
		);
	}
	client = new DroidClawTestClient(DROIDCLAW_URL, DROIDCLAW_AUTH_TOKEN, DROIDCLAW_DEVICE_ID);
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

describe("Ensure Account", () => {
	const getVars = () => {
		expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();
		return { username: TEST_IG_USERNAME! };
	};
	const workflow = "examples/workflows/social/instagram-ensure-account.json";

	test(
		"Phase 1: discovery",
		async () => {
			const { runId } = await client.runWorkflow(workflow, getVars());
			const result = await client.waitForCompletion(runId, 5 * 60_000);

			expect(result.status).toBe("completed");

			const ensureGoal = result.goals.find((g) => g.goalId === "ensure_account");
			expect(ensureGoal).toBeTruthy();
			expect(ensureGoal!.evalPassed).toBe(true);
		},
		5 * 60_000,
	);

	test(
		"Phase 2: recipe",
		async () => {
			const { runId } = await client.runWorkflow(workflow, getVars());
			const result = await client.waitForCompletion(runId, 5 * 60_000);

			expect(result.status).toBe("completed");

			const ensureGoal = result.goals.find((g) => g.goalId === "ensure_account");
			expect(ensureGoal).toBeTruthy();
			expect(ensureGoal!.resolvedBy).toBe("recipe");
		},
		5 * 60_000,
	);

	test(
		"Phase 3: stress test (5 runs)",
		async () => {
			await runStressTest(workflow, getVars(), 5, 5 * 60_000);
		},
		30 * 60_000,
	);
});
