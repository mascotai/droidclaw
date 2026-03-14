/**
 * Social Workflow E2E Tests
 *
 * Runs real workflows on a connected device via the DroidClaw API.
 * Requires env vars:
 *   DROIDCLAW_URL          — server URL (e.g., https://droidclaw.stack.mascott.ai)
 *   DROIDCLAW_AUTH_TOKEN   — Bearer token (API key or INTERNAL_SECRET)
 *   DROIDCLAW_DEVICE_ID    — device to run tests on
 *   TEST_IG_USERNAME        — Instagram test account username
 *   TEST_IG_PASSWORD        — Instagram test account password
 *   TEST_IG_TOTP_SECRET     — TOTP secret for 2FA
 *
 * Run:
 *   npx vitest run --config vitest.config.e2e-social.ts
 *   npx vitest run --config vitest.config.e2e-social.ts --grep "Login"
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
//  1. Instagram Login with TOTP
// ═══════════════════════════════════════════════════════════════════════════

describe("Instagram Login with TOTP", () => {
	test(
		"should login and reach home feed (fresh discovery)",
		async () => {
			expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();
			expect(TEST_IG_PASSWORD, "TEST_IG_PASSWORD required").toBeTruthy();
			expect(TEST_IG_TOTP_SECRET, "TEST_IG_TOTP_SECRET required").toBeTruthy();

			const { runId } = await client.runWorkflow(
				"examples/workflows/social/instagram-login-totp.json",
				{
					username: TEST_IG_USERNAME!,
					password: TEST_IG_PASSWORD!,
					totpSecret: TEST_IG_TOTP_SECRET!,
				},
			);

			const result = await client.waitForCompletion(runId, 10 * 60 * 1000);

			expect(result.status).toBe("completed");
			expect(result.goals.every((g) => g.success || g.skipped)).toBe(true);

			// Verify home feed reached via eval
			const verifyGoal = result.goals.find((g) => g.goalId === "verify");
			if (verifyGoal?.evalStateValues) {
				expect(verifyGoal.evalStateValues.on_home_feed).toBe(true);
			}
		},
		10 * 60 * 1000,
	);

	test(
		"second run should use cached recipes",
		async () => {
			expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();
			expect(TEST_IG_PASSWORD, "TEST_IG_PASSWORD required").toBeTruthy();
			expect(TEST_IG_TOTP_SECRET, "TEST_IG_TOTP_SECRET required").toBeTruthy();

			const { runId } = await client.runWorkflow(
				"examples/workflows/social/instagram-login-totp.json",
				{
					username: TEST_IG_USERNAME!,
					password: TEST_IG_PASSWORD!,
					totpSecret: TEST_IG_TOTP_SECRET!,
				},
			);

			const result = await client.waitForCompletion(runId, 10 * 60 * 1000);

			expect(result.status).toBe("completed");

			// At least some goals should hit recipe cache
			const recipeHits = result.goals.filter((g) => g.resolvedBy === "recipe");
			expect(recipeHits.length).toBeGreaterThan(0);
		},
		10 * 60 * 1000,
	);
});

// ═══════════════════════════════════════════════════════════════════════════
//  2. Instagram Profile Text
// ═══════════════════════════════════════════════════════════════════════════

describe("Instagram Profile Text", () => {
	test(
		"should update name, username, and bio",
		async () => {
			expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();

			const { runId } = await client.runWorkflow(
				"examples/workflows/social/instagram-profile-text.json",
				{
					name: TEST_IG_NAME,
					username: TEST_IG_USERNAME!,
					bio: TEST_IG_BIO,
				},
			);

			const result = await client.waitForCompletion(runId, 10 * 60 * 1000);

			expect(result.status).toBe("completed");
			expect(result.goals.every((g) => g.success)).toBe(true);
		},
		10 * 60 * 1000,
	);
});

// ═══════════════════════════════════════════════════════════════════════════
//  3. Instagram Profile Picture
// ═══════════════════════════════════════════════════════════════════════════

describe("Instagram Profile Picture", () => {
	test(
		"should download and set profile picture",
		async () => {
			if (!TEST_IG_PROFILE_PIC_URL) {
				console.log("Skipping: TEST_IG_PROFILE_PIC_URL not set");
				return;
			}

			const albumName = `pfp${Date.now().toString(36).slice(-6)}`;
			const { runId } = await client.runWorkflow(
				"examples/workflows/social/instagram-profile-picture.json",
				{
					imageUrl: TEST_IG_PROFILE_PIC_URL,
					albumName,
				},
			);

			const result = await client.waitForCompletion(runId, 10 * 60 * 1000);

			expect(result.status).toBe("completed");
			expect(result.goals.every((g) => g.success)).toBe(true);
		},
		10 * 60 * 1000,
	);
});

// ═══════════════════════════════════════════════════════════════════════════
//  4. Instagram Warmup
// ═══════════════════════════════════════════════════════════════════════════

describe("Instagram Warmup", () => {
	test(
		"should complete randomized engagement session",
		async () => {
			const { runId } = await client.runWorkflow(
				"examples/workflows/social/instagram-warmup.json",
				{
					nicheKeywords: TEST_IG_NICHE_KEYWORDS,
					commentPrompt: TEST_IG_COMMENT_PROMPT,
				},
			);

			const result = await client.waitForCompletion(runId, 15 * 60 * 1000);

			// Warmup uses exhaustIsSuccess, so individual goals may "fail" due to step exhaustion
			// but the overall workflow should complete
			expect(result.status).toBe("completed");
		},
		15 * 60 * 1000,
	);
});

// ═══════════════════════════════════════════════════════════════════════════
//  5. Instagram Post Reel
// ═══════════════════════════════════════════════════════════════════════════

describe("Instagram Post Reel", () => {
	test(
		"should download video and post as reel",
		async () => {
			if (!TEST_IG_VIDEO_URL) {
				console.log("Skipping: TEST_IG_VIDEO_URL not set");
				return;
			}

			expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();

			const albumName = `r${Date.now().toString(36).slice(-6)}`;
			const caption = `E2E test reel ${new Date().toISOString().slice(0, 16)}`;

			const { runId } = await client.runWorkflow(
				"examples/workflows/social/instagram-post-reel-v2.json",
				{
					username: TEST_IG_USERNAME!,
					videoUrl: TEST_IG_VIDEO_URL,
					caption,
					albumName,
				},
			);

			const result = await client.waitForCompletion(runId, 10 * 60 * 1000);

			expect(result.status).toBe("completed");
			expect(result.goals.every((g) => g.success)).toBe(true);
		},
		10 * 60 * 1000,
	);
});

// ═══════════════════════════════════════════════════════════════════════════
//  6. Conditional Login (eval/when)
// ═══════════════════════════════════════════════════════════════════════════

describe("Conditional Login (eval/when)", () => {
	test(
		"should skip login when already logged in with correct account",
		async () => {
			expect(TEST_IG_USERNAME, "TEST_IG_USERNAME required").toBeTruthy();

			const { runId } = await client.runWorkflow(
				"examples/workflows/social/instagram-ensure-account.json",
				{
					username: TEST_IG_USERNAME!,
					password: TEST_IG_PASSWORD ?? "",
					totpSecret: TEST_IG_TOTP_SECRET ?? "",
				},
			);

			const result = await client.waitForCompletion(runId, 5 * 60 * 1000);

			expect(result.status).toBe("completed");

			// The check_login step should have eval results
			const checkGoal = result.goals.find((g) => g.goalId === "check_login");
			expect(checkGoal).toBeTruthy();

			// If already logged in, login steps should be skipped
			if (checkGoal?.evalStateValues?.correct_account_active === true) {
				const loginGoal = result.goals.find((g) => g.goalId === "full_login");
				// Full login should be skipped since account is already active
				expect(loginGoal?.skipped || loginGoal === undefined).toBe(true);
			}
		},
		5 * 60 * 1000,
	);
});
