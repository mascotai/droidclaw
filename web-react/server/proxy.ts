import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { auth } from './auth.js';
import { db } from './db.js';
import { user as userTable, session as sessionTable } from './schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const app = new Hono();

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8080';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || '';
const TRUST_PROXY_AUTH = process.env.TRUST_PROXY_AUTH === 'true';
const PORT = parseInt(process.env.PORT || '3000');

// ── Proxy auth helper (authentik forward-auth headers) ──

async function proxyAuthLogin(
	email: string,
	username: string | null,
	displayName: string | null
): Promise<{ userId: string; sessionToken: string }> {
	const existing = await db
		.select()
		.from(userTable)
		.where(eq(userTable.email, email))
		.limit(1);

	let userId: string;

	if (existing.length > 0) {
		userId = existing[0].id;
	} else {
		userId = crypto.randomUUID();
		const userName = displayName || username || email.split('@')[0];
		await db.insert(userTable).values({
			id: userId,
			email,
			name: userName,
			emailVerified: true,
			createdAt: new Date(),
			updatedAt: new Date()
		});
	}

	const sessionToken = crypto.randomUUID();
	const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
	const sessionId = crypto.randomUUID();

	await db.insert(sessionTable).values({
		id: sessionId,
		userId,
		token: sessionToken,
		expiresAt,
		createdAt: new Date(),
		updatedAt: new Date()
	});

	return { userId, sessionToken };
}

// ── Helper: get current user from request ──

async function getUserFromRequest(req: Request): Promise<{ id: string; email: string; name: string } | null> {
	// Try proxy auth first
	if (TRUST_PROXY_AUTH) {
		const proxyEmail = req.headers.get('x-authentik-email');
		if (proxyEmail) {
			const existing = await db
				.select()
				.from(userTable)
				.where(eq(userTable.email, proxyEmail))
				.limit(1);
			if (existing.length > 0) {
				return { id: existing[0].id, email: existing[0].email, name: existing[0].name };
			}
			// Auto-create
			const proxyUsername = req.headers.get('x-authentik-username');
			const proxyName = req.headers.get('x-authentik-name');
			const { userId } = await proxyAuthLogin(proxyEmail, proxyUsername, proxyName);
			return { id: userId, email: proxyEmail, name: proxyName || proxyUsername || proxyEmail.split('@')[0] };
		}
	}

	// Fall back to better-auth session
	try {
		const session = await auth.api.getSession({ headers: req.headers });
		if (session?.user) {
			return { id: session.user.id, email: session.user.email, name: session.user.name };
		}
	} catch (err) {
		console.error('[Proxy] getSession error:', err);
	}
	return null;
}

// ── Better Auth routes ──

app.all('/api/auth/*', async (c) => {
	return auth.handler(c.req.raw);
});

// ── API proxy to DroidClaw server ──

app.all('/api/*', async (c) => {
	const user = await getUserFromRequest(c.req.raw);
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401);
	}

	// Strip /api prefix → forward to server
	const path = c.req.path.replace(/^\/api/, '');
	const url = `${SERVER_URL}${path}${c.req.raw.url.includes('?') ? '?' + c.req.raw.url.split('?')[1] : ''}`;

	const headers: Record<string, string> = {
		'x-internal-secret': INTERNAL_SECRET,
		'x-internal-user-id': user.id,
	};

	// Forward content-type if present
	const contentType = c.req.header('content-type');
	if (contentType) {
		headers['content-type'] = contentType;
	}

	try {
		const res = await fetch(url, {
			method: c.req.method,
			headers,
			body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : c.req.raw.body,
		});

		// Forward response
		return new Response(res.body, {
			status: res.status,
			headers: {
				'content-type': res.headers.get('content-type') || 'application/json',
			},
		});
	} catch (err) {
		console.error('[Proxy] Upstream error:', err);
		return c.json({ error: 'Backend unavailable' }, 502);
	}
});

// ── Static assets (production) ──

app.use('*', serveStatic({ root: './dist' }));

// SPA fallback — serve index.html for all unmatched routes
app.get('*', serveStatic({ root: './dist', path: 'index.html' }));

// ── WebSocket upgrade handling ──

function handleUpgrade(req: IncomingMessage, socket: import('node:net').Socket, _head: Buffer) {
	const url = req.url || '';
	if (!url.startsWith('/ws')) return;

	const targetUrl = new URL(url, SERVER_URL);

	const http = require('node:http');
	const proxyReq = http.request(
		{
			hostname: targetUrl.hostname,
			port: targetUrl.port,
			path: targetUrl.pathname + targetUrl.search,
			method: 'GET',
			headers: {
				...req.headers,
				host: targetUrl.host,
			},
		},
		() => {} // We don't use the response
	);

	proxyReq.on('upgrade', (proxyRes: IncomingMessage, proxySocket: import('node:net').Socket, proxyHead: Buffer) => {
		socket.write(
			`HTTP/1.1 101 Switching Protocols\r\n` +
			Object.entries(proxyRes.headers)
				.filter(([, v]) => v !== undefined)
				.map(([k, v]) => `${k}: ${v}`)
				.join('\r\n') +
			'\r\n\r\n'
		);

		if (proxyHead.length > 0) {
			socket.write(proxyHead);
		}

		proxySocket.pipe(socket);
		socket.pipe(proxySocket);

		proxySocket.on('error', () => socket.destroy());
		socket.on('error', () => proxySocket.destroy());
	});

	proxyReq.on('error', (err: Error) => {
		console.error('[WS Proxy] Error:', err.message);
		socket.destroy();
	});

	proxyReq.end();
}

// ── Start server ──

console.log(`Starting DroidClaw web proxy on port ${PORT}...`);

const server = serve({
	fetch: app.fetch,
	port: PORT,
}, (info) => {
	console.log(`DroidClaw web running at http://localhost:${info.port}`);
});

server.on('upgrade', handleUpgrade);
