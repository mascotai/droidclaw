import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '$lib/server/auth';
import { building } from '$app/environment';
import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { user as userTable, session as sessionTable } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';

/**
 * Auto-create or find a user by email from proxy-auth headers,
 * then issue a Better Auth session cookie.
 */
async function proxyAuthLogin(
	event: Parameters<Handle>[0]['event'],
	email: string,
	username: string | null,
	displayName: string | null
) {
	// Look up existing user by email
	const existing = await db
		.select()
		.from(userTable)
		.where(eq(userTable.email, email))
		.limit(1);

	let userId: string;
	let userName: string;

	if (existing.length > 0) {
		userId = existing[0].id;
		userName = existing[0].name ?? email.split('@')[0];
	} else {
		// Auto-create user from proxy-auth headers
		userId = crypto.randomUUID();
		userName = displayName || username || email.split('@')[0];
		await db.insert(userTable).values({
			id: userId,
			email,
			name: userName,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date()
		});
	}

	// Create a new session
	const sessionToken = crypto.randomUUID();
	const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
	const sessionId = crypto.randomUUID();

	await db.insert(sessionTable).values({
		id: sessionId,
		userId,
		token: sessionToken,
		expiresAt,
		createdAt: new Date(),
		updatedAt: new Date()
	});

	// Set the Better Auth session cookie
	event.cookies.set('better-auth.session_token', sessionToken, {
		path: '/',
		httpOnly: true,
		secure: true,
		sameSite: 'lax',
		expires: expiresAt
	});

	// Populate locals directly — getSession() won't work here because
	// the cookie was just set on the response, not on the incoming request headers
	event.locals.session = { id: sessionId, token: sessionToken, userId, expiresAt } as any;
	event.locals.user = { id: userId, email, name: userName, emailVerified: true } as any;
}

export const handle: Handle = async ({ event, resolve }) => {
	try {
		// ── Proxy-auth auto-login (authentik forward-auth headers) ──
		if (env.TRUST_PROXY_AUTH === 'true') {
			const proxyEmail = event.request.headers.get('x-authentik-email');
			if (proxyEmail) {
				// Try existing session first
				const existingSession = event.cookies.get('better-auth.session_token')
					? await auth.api.getSession({ headers: event.request.headers })
					: null;

				if (existingSession) {
					event.locals.session = existingSession.session;
					event.locals.user = existingSession.user;
				} else {
					// No valid session — clear stale cookie and create a new one
					if (event.cookies.get('better-auth.session_token')) {
						event.cookies.delete('better-auth.session_token', { path: '/' });
					}
					const proxyUsername = event.request.headers.get('x-authentik-username');
					const proxyName = event.request.headers.get('x-authentik-name');
					await proxyAuthLogin(event, proxyEmail, proxyUsername, proxyName);
				}
			}
		}

		// For non-proxy-auth requests (or if proxy auth didn't run)
		if (!event.locals.user) {
			const session = await auth.api.getSession({
				headers: event.request.headers
			});

			if (session) {
				event.locals.session = session.session;
				event.locals.user = session.user;
			}
		}
	} catch (err) {
		console.error(`[Auth] getSession error for ${event.request.method} ${event.url.pathname}:`, err);
	}

	return svelteKitHandler({ event, resolve, auth, building });
};
