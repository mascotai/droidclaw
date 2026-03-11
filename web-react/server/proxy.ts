import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { db } from './db.js';
import { user as userTable } from './schema.js';
import { eq } from 'drizzle-orm';
import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const app = new Hono();

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:8080';
const INTERNAL_SECRET = process.env.INTERNAL_SECRET || '';
const PORT = parseInt(process.env.PORT || '3000');

// ── Helper: get or create user from authentik headers ──

interface AuthUser {
	id: string;
	email: string;
	name: string;
}

async function getUserFromHeaders(req: Request): Promise<AuthUser | null> {
	const email = req.headers.get('x-authentik-email');
	if (!email) return null;

	const username = req.headers.get('x-authentik-username');
	const displayName = req.headers.get('x-authentik-name');

	// Look up existing user
	const existing = await db
		.select()
		.from(userTable)
		.where(eq(userTable.email, email))
		.limit(1);

	if (existing.length > 0) {
		return { id: existing[0].id, email: existing[0].email, name: existing[0].name };
	}

	// Auto-create user from authentik headers
	const userId = crypto.randomUUID();
	const name = displayName || username || email.split('@')[0];
	await db.insert(userTable).values({
		id: userId,
		email,
		name,
		emailVerified: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	});

	return { id: userId, email, name };
}

// ── /api/me — return current user info to the SPA ──

app.get('/api/me', async (c) => {
	const user = await getUserFromHeaders(c.req.raw);
	if (!user) {
		return c.json({ error: 'Unauthorized' }, 401);
	}
	return c.json(user);
});

// ── API proxy to DroidClaw server ──

app.all('/api/*', async (c) => {
	const user = await getUserFromHeaders(c.req.raw);
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
