/**
 * Seed Workflow Templates
 *
 * Creates workflow templates from the social workflow JSON files
 * so they appear in the dashboard Workflows library.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   bun run scripts/seed-workflow-templates.ts
 *
 * Requires env vars:
 *   DROIDCLAW_API_KEY — User API key
 *   DROIDCLAW_URL     — Server URL (defaults to https://droidclaw.stack.mascott.ai)
 */

import { readFileSync } from "fs";
import { resolve } from "path";

const DROIDCLAW_URL = process.env.DROIDCLAW_URL ?? "https://droidclaw.stack.mascott.ai";
const API_KEY = process.env.DROIDCLAW_API_KEY;

if (!API_KEY) {
	console.error("❌ DROIDCLAW_API_KEY is required");
	process.exit(1);
}

const BASE = DROIDCLAW_URL.replace(/\/$/, "");

interface WorkflowDef {
	name: string;
	description?: string;
	steps: unknown[];
	variables?: Record<string, unknown>;
	params?: Record<string, string>;
}

// ── Workflow template definitions ──
// Each maps a JSON file to the template to create via the API.
// The API stores steps + variables; params (descriptions) are just for docs.

const TEMPLATES: Array<{
	file: string;
	name: string;
	variables?: Record<string, string>;
}> = [
	{
		file: "examples/workflows/social/instagram-login-totp.json",
		name: "Instagram Login with TOTP 2FA",
		variables: {
			username: "",
			password: "",
			totpSecret: "",
		},
	},
	{
		file: "examples/workflows/social/instagram-ensure-account.json",
		name: "Instagram Ensure Account",
		variables: {
			username: "",
			password: "",
			totpSecret: "",
		},
	},
	{
		file: "examples/workflows/social/instagram-profile-text.json",
		name: "Instagram Update Profile Text",
		variables: {
			name: "",
			username: "",
			bio: "",
		},
	},
	{
		file: "examples/workflows/social/instagram-profile-picture.json",
		name: "Instagram Set Profile Picture",
		variables: {
			imageUrl: "",
			albumName: "",
		},
	},
	{
		file: "examples/workflows/social/instagram-warmup.json",
		name: "Instagram Warm-up Engagement",
		variables: {
			nicheKeywords: "fitness motivation",
			commentPrompt:
				"You are a fitness enthusiast. Write a 5-6 word funny supportive reply.",
			commentCount: "2",
		},
	},
	{
		file: "examples/workflows/social/instagram-post-reel-v2.json",
		name: "Instagram Post Reel",
		variables: {
			username: "",
			videoUrl: "",
			caption: "",
			albumName: "",
		},
	},
];

async function createTemplate(tmpl: (typeof TEMPLATES)[0]): Promise<void> {
	const absPath = resolve(tmpl.file);
	const workflow: WorkflowDef = JSON.parse(readFileSync(absPath, "utf-8"));

	const body = {
		name: tmpl.name,
		steps: workflow.steps,
		variables: tmpl.variables ?? {},
	};

	const res = await fetch(`${BASE}/v2/workflows`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${API_KEY}`,
		},
		body: JSON.stringify(body),
	});

	if (!res.ok) {
		const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
		console.error(`❌ ${tmpl.name}: ${(err as any).error ?? res.status}`);
		return;
	}

	const data = (await res.json()) as { id: string; name: string };
	console.log(`✅ ${data.name} → ${data.id}`);
}

async function main() {
	console.log(`\n🔧 Seeding workflow templates to ${BASE}\n`);

	// First, list existing to avoid duplicates
	const listRes = await fetch(`${BASE}/v2/workflows`, {
		headers: { Authorization: `Bearer ${API_KEY}` },
	});

	if (!listRes.ok) {
		console.error(`❌ Failed to list existing workflows: HTTP ${listRes.status}`);
		const body = await listRes.text();
		console.error(body);
		process.exit(1);
	}

	const existing = (await listRes.json()) as Array<{ id: string; name: string }>;
	const existingNames = new Set(existing.map((w) => w.name));

	console.log(`📋 Found ${existing.length} existing workflow templates`);
	if (existing.length > 0) {
		for (const w of existing) {
			console.log(`   • ${w.name} (${w.id})`);
		}
	}
	console.log();

	let created = 0;
	let skipped = 0;

	for (const tmpl of TEMPLATES) {
		if (existingNames.has(tmpl.name)) {
			console.log(`⏭️  ${tmpl.name} — already exists, skipping`);
			skipped++;
			continue;
		}

		await createTemplate(tmpl);
		created++;
	}

	console.log(`\n✨ Done: ${created} created, ${skipped} skipped\n`);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
