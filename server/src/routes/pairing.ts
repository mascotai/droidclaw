import { Hono } from "hono";
import { sessionMiddleware, type AuthEnv } from "../middleware/auth.js";
import { db } from "../db.js";
import { pairingCode, apikey } from "../schema.js";
import { eq, and, gt } from "drizzle-orm";

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

/** Generate a random API key string: prefix + 32 random hex chars */
function generateRawKey(prefix: string): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${prefix}${hex}`;
}

// ── Rate limiter for claim endpoint ──
const claimAttempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = claimAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    claimAttempts.set(ip, { count: 1, resetAt: now + 60_000 });
    return false;
  }

  entry.count++;
  return entry.count > 5;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of claimAttempts) {
    if (now > entry.resetAt) claimAttempts.delete(ip);
  }
}, 5 * 60_000);

// ── Single router with per-route auth ──
const pairing = new Hono<AuthEnv>();

/** POST /pairing/claim — phone sends code to get API key + WS URL (PUBLIC, no auth) */
pairing.post("/claim", async (c) => {
  // Rate limit by IP
  const ip = c.req.header("x-forwarded-for") ?? c.req.header("x-real-ip") ?? "unknown";
  if (isRateLimited(ip)) {
    return c.json({ error: "Too many attempts. Try again in a minute." }, 429);
  }

  const body = await c.req.json<{ code?: string }>();
  const code = body.code?.trim();

  // Validate 6-digit format
  if (!code || !/^\d{6}$/.test(code)) {
    return c.json({ error: "Invalid code format" }, 400);
  }

  // Look up non-expired code
  const now = new Date();
  const rows = await db
    .select()
    .from(pairingCode)
    .where(and(eq(pairingCode.code, code), gt(pairingCode.expiresAt, now)))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: "Invalid or expired code" }, 400);
  }

  const row = rows[0];

  // Generate a device API key with direct DB insert (type: 'device')
  const prefix = 'droidclaw_dev_';
  const rawKey = generateRawKey(prefix);
  const hashedKey = await hashApiKey(rawKey);
  const keyCreatedAt = new Date();

  await db.insert(apikey).values({
    id: crypto.randomUUID(),
    name: 'Paired Device',
    prefix,
    start: rawKey.slice(0, prefix.length + 6),
    key: hashedKey,
    userId: row.userId,
    type: 'device',
    enabled: true,
    rateLimitEnabled: false,
    createdAt: keyCreatedAt,
    updatedAt: keyCreatedAt,
  });

  // Delete the used code
  await db.delete(pairingCode).where(eq(pairingCode.id, row.id));

  const wsUrl = process.env.WS_URL ?? "wss://tunnel.droidclaw.ai";

  return c.json({ apiKey: rawKey, wsUrl });
});

/** POST /pairing/create — generate a 6-digit pairing code (authed) */
pairing.post("/create", sessionMiddleware, async (c) => {
  const user = c.get("user");

  // Delete any existing code for this user (one active code at a time)
  await db.delete(pairingCode).where(eq(pairingCode.userId, user.id));

  // Generate random 6-digit code
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const expiresAt = new Date(Date.now() + 5 * 60_000); // 5 minutes
  const id = crypto.randomUUID();

  await db.insert(pairingCode).values({
    id,
    code,
    userId: user.id,
    expiresAt,
  });

  return c.json({ code, expiresAt: expiresAt.toISOString() });
});

/** GET /pairing/status — check if user's code was claimed (authed) */
pairing.get("/status", sessionMiddleware, async (c) => {
  const user = c.get("user");
  const now = new Date();

  const rows = await db
    .select()
    .from(pairingCode)
    .where(eq(pairingCode.userId, user.id))
    .limit(1);

  if (rows.length === 0) {
    // No code exists — it was claimed and deleted
    return c.json({ paired: true });
  }

  const row = rows[0];
  if (row.expiresAt < now) {
    return c.json({ paired: false, expired: true });
  }

  return c.json({ paired: false, expired: false });
});

export { pairing };
