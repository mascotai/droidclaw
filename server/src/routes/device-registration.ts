import { Hono } from "hono";
import { db } from "../db.js";
import { device } from "../schema.js";
import { eq, and } from "drizzle-orm";
import { sessionMiddleware, type AuthEnv } from "../middleware/auth.js";

// ── Simple in-memory rate limiter ──
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count++;
  return entry.count > maxRequests;
}

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);

/**
 * Hash a token the same way as auth.ts: SHA-256 → base64url (no padding).
 */
async function hashToken(key: string): Promise<string> {
  const data = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export const deviceRegistration = new Hono();

// ══════════════════════════════════════════════════════════════════
// ── Public Endpoints (no auth required) ──
// ══════════════════════════════════════════════════════════════════

/**
 * POST /devices/register
 * Device self-registers. Upserts by deviceFingerprint.
 * Rate limited: 10 requests per minute per IP.
 */
deviceRegistration.post("/register", async (c) => {
  // Rate limit by IP
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    || c.req.header("x-real-ip")
    || "unknown";

  if (isRateLimited(`register:${ip}`, 10, 60_000)) {
    return c.json({ error: "Too many requests. Try again in a minute." }, 429);
  }

  const body = await c.req.json<{
    deviceFingerprint: string;
    name: string;
    model?: string;
    androidVersion?: string;
    deviceInfo?: Record<string, unknown>;
  }>();

  if (!body.deviceFingerprint || !body.name) {
    return c.json({ error: "deviceFingerprint and name are required" }, 400);
  }

  // Check if device already exists by fingerprint
  const existing = await db
    .select()
    .from(device)
    .where(eq(device.deviceFingerprint, body.deviceFingerprint))
    .limit(1);

  if (existing.length > 0) {
    const d = existing[0];

    if (d.status === "active") {
      // Already approved — return current status
      return c.json({ deviceId: d.id, status: "active" });
    }

    if (d.status === "rejected") {
      // Re-register: set back to pending
      await db.update(device).set({
        status: "pending",
        name: body.name,
        model: body.model ?? d.model,
        androidVersion: body.androidVersion ?? d.androidVersion,
        deviceInfo: body.deviceInfo ?? d.deviceInfo,
        updatedAt: new Date(),
      }).where(eq(device.id, d.id));

      return c.json({ deviceId: d.id, status: "pending" });
    }

    // Already pending — update info and return
    await db.update(device).set({
      name: body.name,
      model: body.model ?? d.model,
      androidVersion: body.androidVersion ?? d.androidVersion,
      deviceInfo: body.deviceInfo ?? d.deviceInfo,
      updatedAt: new Date(),
    }).where(eq(device.id, d.id));

    return c.json({ deviceId: d.id, status: "pending" });
  }

  // New device — insert as pending
  const id = crypto.randomUUID();
  await db.insert(device).values({
    id,
    deviceFingerprint: body.deviceFingerprint,
    name: body.name,
    model: body.model,
    androidVersion: body.androidVersion,
    status: "pending",
    deviceInfo: body.deviceInfo,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return c.json({ deviceId: id, status: "pending" }, 201);
});

/**
 * GET /devices/register/status
 * Device polls for approval. Returns token on first poll after approval.
 */
deviceRegistration.get("/register/status", async (c) => {
  const fingerprint = c.req.query("deviceFingerprint");
  if (!fingerprint) {
    return c.json({ error: "deviceFingerprint query param required" }, 400);
  }

  const rows = await db
    .select()
    .from(device)
    .where(eq(device.deviceFingerprint, fingerprint))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: "Device not found. Register first." }, 404);
  }

  const d = rows[0];

  if (d.status === "pending") {
    return c.json({ status: "pending" });
  }

  if (d.status === "rejected") {
    return c.json({ status: "rejected" });
  }

  if (d.status === "active") {
    // If rawToken is still set, return it (first poll only) and clear it
    if (d.rawToken) {
      const rawToken = d.rawToken;
      await db.update(device).set({
        rawToken: null,
        updatedAt: new Date(),
      }).where(eq(device.id, d.id));

      return c.json({
        status: "active",
        token: rawToken,
        deviceId: d.id,
      });
    }

    // Token already retrieved — just confirm active status
    return c.json({ status: "active", deviceId: d.id });
  }

  return c.json({ status: d.status });
});

// ══════════════════════════════════════════════════════════════════
// ── Authenticated Endpoints (dashboard users) ──
// ══════════════════════════════════════════════════════════════════

const authed = new Hono<AuthEnv>();
authed.use("*", sessionMiddleware);

/**
 * GET /v2/devices/pending
 * List devices awaiting approval.
 */
authed.get("/pending", async (c) => {
  const rows = await db
    .select()
    .from(device)
    .where(eq(device.status, "pending"));

  return c.json(rows.map((d) => ({
    id: d.id,
    name: d.name,
    model: d.model,
    androidVersion: d.androidVersion,
    status: d.status,
    deviceInfo: d.deviceInfo,
    createdAt: d.createdAt,
  })));
});

/**
 * POST /v2/devices/:id/approve
 * Approve a pending device — generates token, assigns to user.
 */
authed.post("/:id/approve", async (c) => {
  const user = c.get("user");
  const deviceId = c.req.param("id");

  const rows = await db
    .select()
    .from(device)
    .where(and(eq(device.id, deviceId), eq(device.status, "pending")))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: "Device not found or not pending" }, 404);
  }

  // Generate a device token
  const rawToken = `droidclaw_dev_${crypto.randomUUID().replace(/-/g, "")}`;
  const hashedToken = await hashToken(rawToken);

  await db.update(device).set({
    status: "active",
    userId: user.id,
    token: hashedToken,
    rawToken: rawToken, // Stored temporarily — cleared on first poll by device
    updatedAt: new Date(),
  }).where(eq(device.id, deviceId));

  return c.json({ deviceId, status: "active" });
});

/**
 * POST /v2/devices/:id/reject
 * Reject a pending device.
 */
authed.post("/:id/reject", async (c) => {
  const deviceId = c.req.param("id");

  const rows = await db
    .select()
    .from(device)
    .where(eq(device.id, deviceId))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: "Device not found" }, 404);
  }

  await db.update(device).set({
    status: "rejected",
    token: null,
    rawToken: null,
    updatedAt: new Date(),
  }).where(eq(device.id, deviceId));

  return c.json({ deviceId, status: "rejected" });
});

/**
 * DELETE /v2/devices/:id
 * Revoke an active device — clears token, sets to rejected.
 * Device's WebSocket will disconnect → device detects → re-registers → back to "pending".
 */
authed.delete("/:id", async (c) => {
  const deviceId = c.req.param("id");

  const rows = await db
    .select()
    .from(device)
    .where(eq(device.id, deviceId))
    .limit(1);

  if (rows.length === 0) {
    return c.json({ error: "Device not found" }, 404);
  }

  await db.update(device).set({
    status: "rejected",
    token: null,
    rawToken: null,
    updatedAt: new Date(),
  }).where(eq(device.id, deviceId));

  return c.json({ deviceId, status: "rejected" });
});

export { authed as deviceManagement };
