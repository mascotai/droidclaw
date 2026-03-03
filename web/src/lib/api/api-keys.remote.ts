import { form, getRequestEvent, query } from '$app/server';
import { db } from '$lib/server/db';
import { apikey } from '$lib/server/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { createKeySchema, deleteKeySchema } from '$lib/schema/api-keys';

/**
 * Hash an API key the same way better-auth / the DroidClaw server does:
 * SHA-256 → base64url (no padding).
 */
async function hashApiKey(key: string): Promise<string> {
	const data = new TextEncoder().encode(key);
	const hash = await crypto.subtle.digest('SHA-256', data);
	return btoa(String.fromCharCode(...new Uint8Array(hash)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '');
}

/** Generate a random API key string: prefix + 32 random hex chars */
function generateRawKey(prefix: string): string {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const hex = Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
	return `${prefix}${hex}`;
}

export const listKeys = query(async () => {
	const { locals } = getRequestEvent();
	if (!locals.user) return [];

	return await db
		.select({
			id: apikey.id,
			name: apikey.name,
			start: apikey.start,
			enabled: apikey.enabled,
			createdAt: apikey.createdAt,
			type: apikey.type
		})
		.from(apikey)
		.where(eq(apikey.userId, locals.user.id))
		.orderBy(desc(apikey.createdAt));
});

export const createKey = form(createKeySchema, async ({ name, type }) => {
	const { locals } = getRequestEvent();
	if (!locals.user) return;

	const prefix = 'droidclaw_';
	const rawKey = generateRawKey(prefix);
	const hashedKey = await hashApiKey(rawKey);
	const now = new Date();

	await db.insert(apikey).values({
		id: crypto.randomUUID(),
		name,
		prefix,
		start: rawKey.slice(0, prefix.length + 6),
		key: hashedKey,
		userId: locals.user.id,
		type: type ?? 'user',
		enabled: true,
		rateLimitEnabled: false,
		rateLimitTimeWindow: 86400000,
		rateLimitMax: 1000,
		requestCount: 0,
		createdAt: now,
		updatedAt: now
	});

	// Return the raw key — it's only shown once
	return { key: rawKey };
});

export const deleteKey = form(deleteKeySchema, async ({ keyId }) => {
	const { locals } = getRequestEvent();
	if (!locals.user) return;

	await db
		.delete(apikey)
		.where(and(eq(apikey.id, keyId), eq(apikey.userId, locals.user.id)));

	return { deleted: true };
});
