/**
 * Server-side multi-step skills for the DroidClaw agent loop.
 *
 * These replace 3-8 LLM calls with deterministic server-side logic.
 * Each skill uses sessions.sendCommand() to interact with the device
 * via WebSocket — no direct ADB needed.
 *
 * Skills:
 *   copy_visible_text — Extract text from screen elements, set clipboard
 *   find_and_tap     — Search elements by text, scroll if needed, tap
 *   submit_message   — Find Send/Submit button and tap it
 *   read_screen      — Scroll through page, collect all text, set clipboard
 *   wait_for_content — Poll for new content to appear
 *   compose_email    — Launch mailto: intent, paste body
 *   download         — Download file from URL to device storage (130s timeout)
 *   get_totp         — Generate TOTP code from secret, set clipboard
 *   dismiss_popup    — Tap a dismiss button on a system popup (soft — always succeeds)
 */

import { sessions } from "../ws/sessions.js";
import { createHmac } from "crypto";
import type { UIElement } from "@droidclaw/shared";

// ─── Types ──────────────────────────────────────────────────────

export interface SkillResult {
  success: boolean;
  message: string;
  data?: string;
}

interface SkillAction {
  action: string;
  query?: string;
  text?: string;
  [key: string]: unknown;
}

// ─── Skill Registry ─────────────────────────────────────────────

const SKILL_ACTIONS = new Set([
  "copy_visible_text",
  "find_and_tap",
  "submit_message",
  "read_screen",
  "wait_for_content",
  "compose_email",
  "download",
  "get_totp",
  "dismiss_popup",
]);

export function isSkillAction(action: string): boolean {
  return SKILL_ACTIONS.has(action);
}

/**
 * Execute a multi-step skill server-side.
 * Returns null if the action is not a skill (caller should handle normally).
 */
export async function executeSkill(
  deviceId: string,
  action: SkillAction,
  currentElements: UIElement[],
  screenWidth = 1080,
  screenHeight = 2400
): Promise<SkillResult> {
  switch (action.action) {
    case "copy_visible_text":
      return copyVisibleText(deviceId, action, currentElements);
    case "find_and_tap":
      return findAndTap(deviceId, action, currentElements, screenWidth, screenHeight);
    case "submit_message":
      return submitMessage(deviceId, currentElements);
    case "read_screen":
      return readScreen(deviceId, currentElements, screenWidth, screenHeight);
    case "wait_for_content":
      return waitForContent(deviceId, currentElements);
    case "compose_email":
      return composeEmail(deviceId, action);
    case "download":
      return downloadFile(deviceId, action);
    case "get_totp":
      return getTotp(deviceId, action);
    case "dismiss_popup":
      return dismissPopup(deviceId, action, currentElements);
    default:
      return { success: false, message: `Unknown skill: ${action.action}` };
  }
}

// ─── Helpers ────────────────────────────────────────────────────

async function getScreen(
  deviceId: string
): Promise<{ elements: UIElement[]; packageName?: string }> {
  try {
    const res = (await sessions.sendCommand(deviceId, {
      type: "get_screen",
    })) as { elements?: UIElement[]; packageName?: string };
    return { elements: res.elements ?? [], packageName: res.packageName };
  } catch {
    return { elements: [] };
  }
}

async function tap(deviceId: string, x: number, y: number): Promise<void> {
  await sessions.sendCommand(deviceId, { type: "tap", x, y });
}

async function swipeDown(
  deviceId: string,
  screenWidth = 1080,
  screenHeight = 2400
): Promise<void> {
  const cx = Math.round(screenWidth * 0.5);
  const topY = Math.round(screenHeight * 0.167);
  const bottomY = Math.round(screenHeight * 0.667);
  await sessions.sendCommand(deviceId, {
    type: "swipe",
    x1: cx, y1: bottomY, x2: cx, y2: topY,
  });
}

async function clipboardSet(deviceId: string, text: string): Promise<void> {
  await sessions.sendCommand(deviceId, { type: "clipboard_set", text });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function findMatch(
  elements: UIElement[],
  queryLower: string
): UIElement | null {
  const matches = elements.filter(
    (el) => el.text && el.text.toLowerCase().includes(queryLower)
  );
  if (matches.length === 0) return null;

  const scored = matches.map((el) => {
    let score = 0;
    if (el.enabled) score += 10;
    if (el.clickable || el.longClickable) score += 5;
    if (el.text.toLowerCase() === queryLower) score += 20;
    else score += 5;
    return { el, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].el;
}

// ─── Skill: copy_visible_text ───────────────────────────────────

async function copyVisibleText(
  deviceId: string,
  action: SkillAction,
  elements: UIElement[]
): Promise<SkillResult> {
  // 1. Filter for readable text elements
  let textElements = elements.filter((el) => el.text && el.action === "read");

  // 2. If query provided, filter to matching elements
  if (action.query) {
    const query = action.query.toLowerCase();
    textElements = textElements.filter((el) =>
      el.text.toLowerCase().includes(query)
    );
  }

  // Fallback: include all elements with text
  if (textElements.length === 0) {
    textElements = elements.filter((el) => el.text);
    if (action.query) {
      const query = action.query.toLowerCase();
      textElements = textElements.filter((el) =>
        el.text.toLowerCase().includes(query)
      );
    }
  }

  if (textElements.length === 0) {
    return {
      success: false,
      message: action.query
        ? `No text matching "${action.query}" found on screen`
        : "No readable text found on screen",
    };
  }

  // 3. Sort by vertical position (top to bottom)
  textElements.sort((a, b) => a.center[1] - b.center[1]);

  // 4. Concatenate and set clipboard
  const combinedText = textElements.map((el) => el.text).join("\n");
  await clipboardSet(deviceId, combinedText);

  return {
    success: true,
    message: `Copied ${textElements.length} text elements to clipboard (${combinedText.length} chars)`,
    data: combinedText.slice(0, 200),
  };
}

// ─── Skill: find_and_tap ────────────────────────────────────────

async function findAndTap(
  deviceId: string,
  action: SkillAction,
  elements: UIElement[],
  screenWidth = 1080,
  screenHeight = 2400
): Promise<SkillResult> {
  const query = action.query;
  if (!query) {
    return { success: false, message: "find_and_tap requires a query" };
  }

  const queryLower = query.toLowerCase();

  // 1. Check current screen
  let best = findMatch(elements, queryLower);

  // 2. If not found, scroll down and re-check (up to 8 scrolls)
  if (!best) {
    const maxScrolls = 8;
    for (let i = 0; i < maxScrolls; i++) {
      console.log(
        `[Skill] find_and_tap: "${query}" not visible, scrolling down (${i + 1}/${maxScrolls})`
      );
      await swipeDown(deviceId, screenWidth, screenHeight);
      await sleep(1200);

      const { elements: freshElements } = await getScreen(deviceId);
      best = findMatch(freshElements, queryLower);
      if (best) {
        console.log(
          `[Skill] find_and_tap: Found "${query}" after ${i + 1} scroll(s)`
        );
        break;
      }
    }
  }

  if (!best) {
    const available = elements
      .filter((el) => el.text)
      .map((el) => el.text)
      .slice(0, 10);
    return {
      success: false,
      message: `No element matching "${query}" found after scrolling. Visible: ${available.join(", ")}`,
    };
  }

  // 3. Tap it
  const [x, y] = best.center;
  console.log(`[Skill] find_and_tap: Tapping "${best.text}" at (${x}, ${y})`);
  await tap(deviceId, x, y);

  return {
    success: true,
    message: `Found and tapped "${best.text}" at (${x}, ${y})`,
    data: best.text,
  };
}

// ─── Skill: submit_message ──────────────────────────────────────

const SEND_BUTTON_PATTERN = /send|submit|post|arrow|paper.?plane/i;

async function submitMessage(
  deviceId: string,
  elements: UIElement[]
): Promise<SkillResult> {
  // 1. Search for Send/Submit button by text or ID
  let candidates = elements.filter(
    (el) =>
      el.enabled &&
      (el.clickable || el.action === "tap") &&
      (SEND_BUTTON_PATTERN.test(el.text) || SEND_BUTTON_PATTERN.test(el.id))
  );

  // 2. Fallback: clickable elements in bottom 20%, prefer rightmost
  if (candidates.length === 0) {
    const clickable = elements
      .filter((el) => el.enabled && el.clickable)
      .sort((a, b) => b.center[1] - a.center[1]);

    if (clickable.length > 0) {
      const maxY = clickable[0].center[1];
      const threshold = maxY * 0.8;
      candidates = clickable.filter((el) => el.center[1] >= threshold);
      candidates.sort((a, b) => b.center[0] - a.center[0]);
    }
  }

  if (candidates.length === 0) {
    return {
      success: false,
      message: "Could not find a Send/Submit button on screen",
    };
  }

  // 3. Tap the best match
  const target = candidates[0];
  const [x, y] = target.center;
  console.log(
    `[Skill] submit_message: Tapping "${target.text}" at (${x}, ${y})`
  );
  await tap(deviceId, x, y);

  // 4. Wait for response
  await sleep(4000);

  // 5. Check for new content
  const { elements: newElements } = await getScreen(deviceId);
  const originalTexts = new Set(
    elements.map((el) => el.text).filter(Boolean)
  );
  const newTexts = newElements
    .map((el) => el.text)
    .filter((t) => t && !originalTexts.has(t));

  if (newTexts.length > 0) {
    const summary = newTexts.slice(0, 3).join("; ");
    return {
      success: true,
      message: `Tapped "${target.text}" — new content: ${summary}`,
      data: summary,
    };
  }

  return {
    success: true,
    message: `Tapped "${target.text}" at (${x}, ${y}). No new content yet — may still be loading.`,
  };
}

// ─── Skill: read_screen ─────────────────────────────────────────

async function readScreen(
  deviceId: string,
  elements: UIElement[],
  screenWidth = 1080,
  screenHeight = 2400
): Promise<SkillResult> {
  const allTexts: string[] = [];
  const seenTexts = new Set<string>();

  function collectTexts(els: UIElement[]): number {
    let added = 0;
    for (const el of els) {
      if (el.text && !seenTexts.has(el.text)) {
        seenTexts.add(el.text);
        allTexts.push(el.text);
        added++;
      }
    }
    return added;
  }

  // 1. Collect from initial screen
  collectTexts(elements);

  // 2. Scroll down and collect until no new content
  const maxScrolls = 5;
  let scrollsDone = 0;

  for (let i = 0; i < maxScrolls; i++) {
    await swipeDown(deviceId, screenWidth, screenHeight);
    await sleep(1200);
    scrollsDone++;

    const { elements: newElements } = await getScreen(deviceId);
    const added = collectTexts(newElements);
    console.log(
      `[Skill] read_screen: Scroll ${scrollsDone} — found ${added} new text elements`
    );

    if (added === 0) break;
  }

  const combinedText = allTexts.join("\n");

  // 3. Copy to clipboard
  if (combinedText.length > 0) {
    await clipboardSet(deviceId, combinedText);
  }

  return {
    success: true,
    message: `Read ${allTexts.length} text elements across ${scrollsDone} scrolls (${combinedText.length} chars), copied to clipboard`,
    data: combinedText.slice(0, 300),
  };
}

// ─── Skill: wait_for_content ────────────────────────────────────

async function waitForContent(
  deviceId: string,
  elements: UIElement[]
): Promise<SkillResult> {
  const originalTexts = new Set(
    elements.map((el) => el.text).filter(Boolean)
  );

  // Poll up to 5 times (3s intervals = 15s max)
  for (let i = 0; i < 5; i++) {
    console.log(
      `[Skill] wait_for_content: Waiting 3s... (attempt ${i + 1}/5)`
    );
    await sleep(3000);

    const { elements: newElements } = await getScreen(deviceId);
    const newTexts = newElements
      .map((el) => el.text)
      .filter((t) => t && !originalTexts.has(t));

    const totalNewChars = newTexts.reduce((sum, t) => sum + t.length, 0);
    if (totalNewChars > 20) {
      const summary = newTexts.slice(0, 5).join("; ");
      return {
        success: true,
        message: `New content appeared after ${(i + 1) * 3}s: ${summary}`,
        data: summary,
      };
    }
  }

  return {
    success: false,
    message: "No new content appeared after 15s",
  };
}

// ─── Skill: compose_email ───────────────────────────────────────

async function composeEmail(
  deviceId: string,
  action: SkillAction
): Promise<SkillResult> {
  const emailAddress = action.query;
  const bodyContent = action.text;
  const subject = action.subject as string | undefined;

  if (!emailAddress) {
    return {
      success: false,
      message:
        'compose_email requires query (email address). Example: {"action": "compose_email", "query": "user@example.com"}',
    };
  }

  // 1. Build mailto URI with subject and body encoded as query params
  //    (many email apps ignore intent extras with SENDTO+mailto)
  const params: string[] = [];
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`);
  if (bodyContent) params.push(`body=${encodeURIComponent(bodyContent)}`);
  const mailtoUri = params.length > 0
    ? `mailto:${emailAddress}?${params.join("&")}`
    : `mailto:${emailAddress}`;

  console.log(`[Skill] compose_email: Launching ${mailtoUri}`);
  await sessions.sendCommand(deviceId, {
    type: "intent",
    intentAction: "android.intent.action.SENDTO",
    intentUri: mailtoUri,
    intentExtras: {
      "android.intent.extra.SUBJECT": subject ?? "",
      "android.intent.extra.TEXT": bodyContent ?? "",
    },
  });
  await sleep(2500);

  return {
    success: true,
    message: `Email compose opened to ${emailAddress}${subject ? ` with subject "${subject}"` : ""}${bodyContent ? ", body filled" : ""}. Use submit_message or tap Send to send it.`,
  };
}

// ─── Skill: download ────────────────────────────────────────────

async function downloadFile(
  deviceId: string,
  action: SkillAction
): Promise<SkillResult> {
  const url = action.url as string | undefined;
  const filename = action.text;

  if (!url) {
    return {
      success: false,
      message: 'download requires url. Example: {"action": "download", "url": "https://example.com/video.mp4", "text": "my_video.mp4"} or {"action": "download", "url": "...", "text": "MyAlbum/video.mp4"} to create a gallery album.',
    };
  }

  console.log(`[Skill] download: Downloading ${url}${filename ? ` as "${filename}"` : ""}`);

  try {
    // Send download command with 130s timeout (companion app waits up to 120s)
    const result = (await sessions.sendCommand(
      deviceId,
      { type: "download", url, text: filename ?? "" },
      130_000
    )) as { success?: boolean; error?: string; data?: string };

    if (result.success === false) {
      return {
        success: false,
        message: `Download failed: ${result.error ?? "unknown error"}`,
      };
    }

    const filePath = result.data ?? "Downloads folder";
    return {
      success: true,
      message: `File downloaded successfully to ${filePath}`,
      data: filePath,
    };
  } catch (err) {
    return {
      success: false,
      message: `Download failed: ${(err as Error).message}`,
    };
  }
}

// ─── Skill: get_totp ──────────────────────────────────────────

/**
 * Generate a TOTP (RFC 6238) code from a base32-encoded secret
 * and set it on the device clipboard, ready to paste.
 *
 * Usage: {"action": "get_totp", "text": "BASE32SECRET"}
 *
 * The secret is a base32-encoded string (e.g., from Google Authenticator setup).
 * Returns the 6-digit code and sets it on the device clipboard.
 */
async function getTotp(
  deviceId: string,
  action: SkillAction
): Promise<SkillResult> {
  const secret = action.text;
  if (!secret) {
    return {
      success: false,
      message: 'get_totp requires "text" with the base32-encoded TOTP secret. Example: {"action": "get_totp", "text": "JBSWY3DPEHPK3PXP"}',
    };
  }

  try {
    const code = generateTOTP(secret);
    console.log(`[Skill] get_totp: Generated code ${code}, setting clipboard`);
    await clipboardSet(deviceId, code);

    return {
      success: true,
      message: `TOTP code ${code} generated and copied to clipboard. Use "paste" to paste it into the input field.`,
      data: code,
    };
  } catch (err) {
    return {
      success: false,
      message: `TOTP generation failed: ${(err as Error).message}`,
    };
  }
}

/**
 * Generate a 6-digit TOTP code per RFC 6238 / RFC 4226.
 * Uses HMAC-SHA1 with a 30-second time step.
 */
function generateTOTP(base32Secret: string, digits = 6, period = 30): string {
  // 1. Decode base32 secret to bytes
  const key = base32Decode(base32Secret.replace(/\s+/g, "").toUpperCase());

  // 2. Get current time counter (number of 30s intervals since epoch)
  const counter = Math.floor(Date.now() / 1000 / period);

  // 3. Convert counter to 8-byte big-endian buffer
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  counterBuf.writeUInt32BE(counter & 0xffffffff, 4);

  // 4. HMAC-SHA1
  const hmac = createHmac("sha1", key);
  hmac.update(counterBuf);
  const hash = hmac.digest();

  // 5. Dynamic truncation (RFC 4226 §5.4)
  const offset = hash[hash.length - 1] & 0x0f;
  const binary =
    ((hash[offset] & 0x7f) << 24) |
    ((hash[offset + 1] & 0xff) << 16) |
    ((hash[offset + 2] & 0xff) << 8) |
    (hash[offset + 3] & 0xff);

  // 6. Modulo to get desired digits
  const otp = binary % Math.pow(10, digits);
  return otp.toString().padStart(digits, "0");
}

/** Decode a base32 string (RFC 4648) to a Buffer */
function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  // Strip padding
  const clean = input.replace(/=+$/, "");

  let bits = 0;
  let value = 0;
  const output: number[] = [];

  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(output);
}

// ─── Skill: dismiss_popup ──────────────────────────────────────

/** Packages known to render system popups with inaccessible UI trees */
const POPUP_PACKAGES = new Set([
  "com.android.credentialmanager",
  "com.google.android.gms",
  "com.samsung.android.autofill",
]);

/**
 * Dismiss a system popup by tapping its dismiss button.
 * This is a SOFT action — it always succeeds.
 * If the button isn't found, it presses Back to dismiss.
 *
 * For popups with inaccessible UI trees (e.g., credentialmanager),
 * the skill presses Back and verifies the popup is gone, retrying if needed.
 *
 * Usage: {"action": "dismiss_popup", "query": "Cancel"}
 *
 * The agent sees the popup in the screen tree and identifies the
 * dismiss button text (e.g., "Not now", "None of the above", "Cancel").
 */
async function dismissPopup(
  deviceId: string,
  action: SkillAction,
  elements: UIElement[]
): Promise<SkillResult> {
  const buttonText = action.query;

  // If we have a query, try to find and tap the matching button
  if (buttonText) {
    const queryLower = buttonText.toLowerCase();
    const match = elements.find(
      (el) =>
        el.text &&
        el.text.toLowerCase().includes(queryLower) &&
        (el.clickable || el.action === "tap")
    );

    if (match) {
      const [x, y] = match.center;
      console.log(
        `[Skill] dismiss_popup: Tapping "${match.text}" at (${x}, ${y})`
      );
      await tap(deviceId, x, y);
      await sleep(500);
      return {
        success: true,
        message: `Dismissed popup by tapping '${match.text}' at (${x}, ${y})`,
      };
    }
  }

  // No matching button found (or no query) — press Back to dismiss.
  // Retry up to 3 times, verifying the popup is gone after each attempt.
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(
      `[Skill] dismiss_popup: Pressing Back to dismiss (attempt ${attempt}/3)`
    );
    await sessions.sendCommand(deviceId, { type: "back" });
    await sleep(800);

    // Re-check if we're still on a popup
    const { packageName } = await getScreen(deviceId);
    if (!packageName || !POPUP_PACKAGES.has(packageName)) {
      console.log(
        `[Skill] dismiss_popup: Popup dismissed after ${attempt} Back press(es), now on ${packageName}`
      );
      return {
        success: true,
        message: `Dismissed popup with Back (${attempt} attempt${attempt > 1 ? "s" : ""}), now on ${packageName}`,
      };
    }
    console.log(
      `[Skill] dismiss_popup: Still on popup ${packageName}, retrying...`
    );
  }

  // After 3 attempts, report success anyway (soft action) but note it may still be showing
  return {
    success: true,
    message: `Pressed Back 3 times to dismiss popup${buttonText ? ` (button "${buttonText}" not found in tree)` : ""}`,
  };
}
