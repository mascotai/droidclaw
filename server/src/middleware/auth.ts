import type { Context, Next } from "hono";
import { db } from "../db.js";
import { session as sessionTable, user as userTable, apikey } from "../schema.js";
import { eq } from "drizzle-orm";
import { getCookie } from "hono/cookie";
import { env } from "../env.js";

/** Hono Env type for routes protected by sessionMiddleware */
export type AuthEnv = {
  Variables: {
    user: { id: string; name: string; email: string; [key: string]: unknown };
    session: { id: string; userId: string; [key: string]: unknown };
  };
};

/**
 * Hash an API key the same way better-auth does:
 * SHA-256 → base64url (no padding).
 */
async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sessionMiddleware(c: Context, next: Next) {
  // ── Internal server-to-server auth (web app → server) ──
  const internalSecret = c.req.header("x-internal-secret");
  const internalUserId = c.req.header("x-internal-user-id");

  if (internalSecret && internalUserId && env.INTERNAL_SECRET && internalSecret === env.INTERNAL_SECRET) {
    const users = await db
      .select({ id: userTable.id, name: userTable.name, email: userTable.email })
      .from(userTable)
      .where(eq(userTable.id, internalUserId))
      .limit(1);

    if (users.length === 0) {
      return c.json({ error: "unauthorized" }, 401);
    }

    c.set("user", users[0]);
    c.set("session", { id: "internal", userId: internalUserId });
    await next();
    return;
  }

  // ── Proxy-auth (authentik forward-auth headers via Traefik) ──
  if (env.TRUST_PROXY_AUTH === "true") {
    const proxyEmail = c.req.header("x-authentik-email");

    if (proxyEmail) {
      const users = await db
        .select({ id: userTable.id, name: userTable.name, email: userTable.email })
        .from(userTable)
        .where(eq(userTable.email, proxyEmail))
        .limit(1);

      if (users.length > 0) {
        c.set("user", users[0]);
        c.set("session", { id: "proxy-auth", userId: users[0].id });
        await next();
        return;
      }
      // If no matching user found, fall through to other auth methods
    }
  }

  // ── Bearer token auth (external API consumers) ──
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);

    // Check if this is an INTERNAL_SECRET Bearer token (server-to-server via Authorization header)
    if (env.INTERNAL_SECRET && token === env.INTERNAL_SECRET) {
      const headerUserId = c.req.header("x-user-id") || c.req.header("x-internal-user-id");
      if (!headerUserId) {
        return c.json({ error: "X-User-Id header required with INTERNAL_SECRET Bearer auth" }, 400);
      }
      const users = await db
        .select({ id: userTable.id, name: userTable.name, email: userTable.email })
        .from(userTable)
        .where(eq(userTable.id, headerUserId))
        .limit(1);
      if (users.length === 0) {
        return c.json({ error: "unauthorized" }, 401);
      }
      c.set("user", users[0]);
      c.set("session", { id: "internal-bearer", userId: headerUserId });
      await next();
      return;
    }

    const hashedKey = await hashApiKey(token);

    const rows = await db
      .select({ id: apikey.id, userId: apikey.userId, enabled: apikey.enabled, expiresAt: apikey.expiresAt, type: apikey.type })
      .from(apikey)
      .where(eq(apikey.key, hashedKey))
      .limit(1);

    if (rows.length === 0) {
      return c.json({ error: "Invalid API key" }, 401);
    }

    const keyRow = rows[0];

    if (!keyRow.enabled) {
      return c.json({ error: "API key disabled" }, 401);
    }
    if (keyRow.expiresAt && keyRow.expiresAt < new Date()) {
      return c.json({ error: "API key expired" }, 401);
    }

    // Reject device keys from HTTP API access
    if (keyRow.type === 'device') {
      return c.json({ error: "Device keys cannot be used for API access. Use a user API key." }, 403);
    }

    const users = await db
      .select({ id: userTable.id, name: userTable.name, email: userTable.email })
      .from(userTable)
      .where(eq(userTable.id, keyRow.userId))
      .limit(1);

    if (users.length === 0) {
      return c.json({ error: "unauthorized" }, 401);
    }

    c.set("user", users[0]);
    c.set("session", { id: `apikey:${keyRow.id}`, userId: keyRow.userId });
    await next();
    return;
  }

  // ── Cookie-based auth (browser → server) ──
  const rawCookie = getCookie(c, "better-auth.session_token");
  if (!rawCookie) {
    return c.json({ error: "unauthorized" }, 401);
  }

  // Token may have a signature appended after a dot — use only the token part
  const token = rawCookie.split(".")[0];

  // Direct DB lookup
  const rows = await db
    .select({
      sessionId: sessionTable.id,
      userId: sessionTable.userId,
    })
    .from(sessionTable)
    .where(eq(sessionTable.token, token))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const { sessionId, userId } = rows[0];

  // Fetch user info
  const users = await db
    .select({ id: userTable.id, name: userTable.name, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);

  if (users.length === 0) {
    return c.json({ error: "unauthorized" }, 401);
  }

  c.set("user", users[0]);
  c.set("session", { id: sessionId, userId });
  await next();
}
