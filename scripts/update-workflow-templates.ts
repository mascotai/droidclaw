/**
 * Update Workflow Templates in DB
 *
 * Reads the updated JSON files and PUTs them to the existing
 * workflow templates in the database via /v2/workflows/:id.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   bun run scripts/update-workflow-templates.ts
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

const headers = {
	"Content-Type": "application/json",
	Authorization: `Bearer ${API_KEY}`,
};

// Map: template name in DB → JSON file path
const TEMPLATE_FILES: Record<string, string> = {
	"Instagram Login with TOTP 2FA": "examples/workflows/social/instagram-login-totp.json",
	"Instagram Ensure Account": "examples/workflows/social/instagram-ensure-account.json",
	"Instagram Update Profile Text": "examples/workflows/social/instagram-profile-text.json",
	"Instagram Set Profile Picture": "examples/workflows/social/instagram-profile-picture.json",
	"Instagram Warm-up Engagement": "examples/workflows/social/instagram-warmup.json",
	"Instagram Post Reel": "examples/workflows/social/instagram-post-reel-v2.json",
};

// Variables for each template (extracted from JSON params)
const TEMPLATE_VARIABLES: Record<string, Record<string, string>> = {
	"Instagram Login with TOTP 2FA": {
		username: "",
		password: "",
		totpSecret: "",
	},
	"Instagram Ensure Account": {
		username: "",
	},
	"Instagram Update Profile Text": {
		username: "",
		name: "",
		bio: "",
	},
	"Instagram Set Profile Picture": {
		username: "",
		imageUrl: "",
		albumName: "",
	},
	"Instagram Warm-up Engagement": {
		username: "",
		nicheKeywords: "fitness motivation",
		commentPrompt: "You are a fitness enthusiast. Write a 5-6 word funny supportive reply.",
		commentCount: "2",
	},
	"Instagram Post Reel": {
		username: "",
		videoUrl: "",
		caption: "",
		albumName: "",
	},
};

async function main() {
	console.log(`\n🔄 Updating workflow templates on ${BASE}\n`);

	// Fetch existing templates
	const listRes = await fetch(`${BASE}/v2/workflows`, { headers });
	if (!listRes.ok) {
		console.error(`❌ Failed to list workflows: HTTP ${listRes.status}`);
		process.exit(1);
	}

	const existing = (await listRes.json()) as Array<{ id: string; name: string; steps: unknown[] }>;
	const byName = new Map(existing.map((w) => [w.name, w]));

	console.log(`📋 Found ${existing.length} existing templates\n`);

	let updated = 0;
	let skipped = 0;

	for (const [templateName, filePath] of Object.entries(TEMPLATE_FILES)) {
		const tmpl = byName.get(templateName);
		if (!tmpl) {
			console.log(`⏭️  ${templateName} — not found in DB, skipping`);
			skipped++;
			continue;
		}

		const absPath = resolve(filePath);
		const workflow = JSON.parse(readFileSync(absPath, "utf-8"));
		const variables = TEMPLATE_VARIABLES[templateName] ?? {};

		const body = {
			name: templateName,
			steps: workflow.steps,
			variables,
		};

		const res = await fetch(`${BASE}/v2/workflows/${tmpl.id}`, {
			method: "PUT",
			headers,
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
			console.error(`❌ ${templateName}: ${(err as any).error ?? res.status}`);
			continue;
		}

		const data = (await res.json()) as { id: string; name: string; steps: unknown[] };
		console.log(`✅ ${data.name} → ${(data.steps as unknown[]).length} steps (id: ${data.id})`);
		updated++;
	}

	console.log(`\n✨ Done: ${updated} updated, ${skipped} skipped\n`);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
