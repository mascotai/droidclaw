/**
 * Screen validation utilities for DroidClaw agent.
 *
 * When the Android accessibility tree is mid-transition (e.g., after tapping
 * a button, during app loading), the `get_screen` command may return only
 * system UI elements — notification labels, status bar, nav bar — instead
 * of the actual app content.
 *
 * Detection uses the `hasAppWindow` flag from the Android side (preferred)
 * with a text-based heuristic fallback for older APK versions.
 *
 * This module provides:
 *   isSystemOnlyScreen() — detect system-only captures
 *   getScreenWithRetry() — retry get_screen when system-only is detected
 */

import { sessions } from "../ws/sessions.js";

interface ScreenElement {
  text: string;
  editable?: boolean;
  [key: string]: unknown;
}

/**
 * Detect if a screen capture contains only system UI elements
 * (notification shade, status bar) and no actual app content.
 *
 * Uses `hasAppWindow` from the Android response when available (v1.0.88+).
 * Falls back to a text heuristic for older APK versions.
 */
export function isSystemOnlyScreen(
  elements: ScreenElement[],
  hasAppWindow?: boolean
): boolean {
  // Preferred: use the Android-side flag (accurate, based on window type)
  if (hasAppWindow === false && elements.length > 0) return true;
  if (hasAppWindow === true) return false;

  // Fallback heuristic for older APK versions that don't send hasAppWindow:
  // If ALL text-bearing elements contain "notification" and there are no
  // editable fields, the screen is system-only.
  const textElements = elements.filter((el) => el.text?.trim());
  if (textElements.length === 0) return false; // empty = different problem
  const allNotifications = textElements.every((el) =>
    el.text.toLowerCase().includes("notification")
  );
  const hasEditable = elements.some((el) => el.editable);
  return allNotifications && !hasEditable;
}

/**
 * Get screen with retry — retries if the capture is system-only.
 * Waits up to ~10s total for the app window to appear.
 */
export async function getScreenWithRetry(
  deviceId: string,
  maxRetries = 4,
  delayMs = 2500
): Promise<{
  elements: any[];
  packageName?: string;
  activityName?: string;
  screenshot?: string;
  hasAppWindow?: boolean;
}> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = (await sessions.sendCommand(deviceId, {
      type: "get_screen",
    })) as any;
    const elements = res?.elements ?? [];

    if (!isSystemOnlyScreen(elements, res?.hasAppWindow)) {
      return {
        elements,
        packageName: res?.packageName,
        activityName: res?.activityName,
        screenshot: res?.screenshot,
        hasAppWindow: res?.hasAppWindow,
      };
    }

    if (attempt < maxRetries) {
      console.log(
        `[screen-utils] System-only screen detected (${elements.length} elements, hasAppWindow=${res?.hasAppWindow}), retrying in ${delayMs}ms (${attempt + 1}/${maxRetries})`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  // All retries exhausted — return whatever we got
  console.log(
    `[screen-utils] All ${maxRetries} retries exhausted, returning system-only screen`
  );
  const finalRes = (await sessions.sendCommand(deviceId, {
    type: "get_screen",
  })) as any;
  return {
    elements: finalRes?.elements ?? [],
    packageName: finalRes?.packageName,
    activityName: finalRes?.activityName,
    screenshot: finalRes?.screenshot,
    hasAppWindow: finalRes?.hasAppWindow,
  };
}
