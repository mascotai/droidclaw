/**
 * Screen validation utilities for DroidClaw agent.
 *
 * When the Android accessibility tree is mid-transition (e.g., after tapping
 * a button, during app loading), the `get_screen` command may return an empty
 * element list — the app window hasn't rendered yet.
 *
 * Since APK v1.0.90+, system UI elements (status bar, notification icons,
 * nav bar) are filtered out on the Android side. An empty elements array
 * means no app content is visible.
 *
 * This module provides:
 *   isEmptyScreen()       — detect empty captures (no app content)
 *   getScreenWithRetry()  — retry get_screen when empty
 */

import { sessions } from "../ws/sessions.js";

/**
 * Detect if a screen capture has no app content.
 *
 * Since v1.0.90, Android filters out system UI elements (com.android.systemui).
 * An empty elements array means the app hasn't rendered its accessibility tree yet.
 *
 * For older APK versions, falls back to a text heuristic.
 */
export function isEmptyScreen(
  elements: { text?: string; editable?: boolean; [key: string]: unknown }[],
  hasAppWindow?: boolean
): boolean {
  // Primary: empty elements means no app content (v1.0.90+ filters system UI)
  if (elements.length === 0) return true;

  // hasAppWindow=false means Android found no TYPE_APPLICATION window
  if (hasAppWindow === false) return true;

  // Fallback heuristic for older APK versions (< 1.0.90) that still send
  // system UI elements: if ALL text-bearing elements contain "notification"
  // and there are no editable fields, the screen is system-only.
  if (hasAppWindow === undefined) {
    const textElements = elements.filter((el) => el.text?.trim());
    if (textElements.length === 0) return false;
    const allNotifications = textElements.every((el) =>
      el.text!.toLowerCase().includes("notification")
    );
    const hasEditable = elements.some((el) => el.editable);
    if (allNotifications && !hasEditable) return true;
  }

  return false;
}

// Backward-compatible alias
export const isSystemOnlyScreen = isEmptyScreen;

/**
 * Get screen with retry — retries if the capture is empty (no app content).
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

    if (!isEmptyScreen(elements, res?.hasAppWindow)) {
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
        `[screen-utils] Empty screen (${elements.length} elements, hasAppWindow=${res?.hasAppWindow}), retrying in ${delayMs}ms (${attempt + 1}/${maxRetries})`
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  // All retries exhausted — return whatever we got
  console.log(
    `[screen-utils] All ${maxRetries} retries exhausted, returning empty screen`
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
