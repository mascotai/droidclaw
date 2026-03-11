import { sessions } from "../ws/sessions.js";
import { db } from "../db.js";
import { workflowRun } from "../schema.js";
import { eq } from "drizzle-orm";
import { findElementByText, findElementById } from "./session-to-flow.js";
import type { FlowStep } from "./session-to-flow.js";
export { findElementByText } from "./session-to-flow.js";
export type { FlowStep } from "./session-to-flow.js";

export interface RunFlowOptions {
  runId: string;
  deviceId: string;
  persistentDeviceId?: string;
  userId: string;
  name: string;
  steps: FlowStep[];
  appId?: string;
  signal: AbortSignal;
}

interface FlowUIElement {
  text: string;
  hint?: string;
  id?: string;
  bounds: { left: number; top: number; right: number; bottom: number };
  center: [number, number];
}

/** Helper to tap an element and return a success result */
async function tapElement(
  deviceId: string,
  el: FlowUIElement,
  message: string,
): Promise<{ success: boolean; message: string }> {
  await sessions.sendCommand(deviceId, { type: "tap", x: el.center[0], y: el.center[1] });
  return { success: true, message };
}

export async function executeFlowStepWs(
  deviceId: string,
  step: FlowStep,
  appId?: string
): Promise<{ success: boolean; message: string }> {
  if (typeof step === "string") {
    switch (step) {
      case "launchApp":
        if (!appId) return { success: false, message: "launchApp requires appId" };
        await sessions.sendCommand(deviceId, { type: "launch", packageName: appId });
        return { success: true, message: `Launched ${appId}` };
      case "back":
        await sessions.sendCommand(deviceId, { type: "back" });
        return { success: true, message: "back" };
      case "home":
        await sessions.sendCommand(deviceId, { type: "home" });
        return { success: true, message: "home" };
      case "enter":
        await sessions.sendCommand(deviceId, { type: "enter" });
        return { success: true, message: "enter" };
      case "clear":
        await sessions.sendCommand(deviceId, { type: "clear" });
        return { success: true, message: "clear" };
      case "done":
        return { success: true, message: "Flow complete" };
      default:
        return { success: false, message: `Unknown step: ${step}` };
    }
  }

  if (typeof step === "object" && step !== null) {
    // Find the primary command (skip underscore-prefixed metadata keys like _coords, _hint)
    const primaryEntry = Object.entries(step).find(([k]) => !k.startsWith("_"));
    if (!primaryEntry) return { success: false, message: `No command in step: ${JSON.stringify(step)}` };
    const [command, value] = primaryEntry;
    const stepObj = step as Record<string, unknown>;
    switch (command) {
      case "tap": {
        if (Array.isArray(value)) {
          await sessions.sendCommand(deviceId, { type: "tap", x: value[0], y: value[1] });
          return { success: true, message: `Tapped (${value[0]}, ${value[1]})` };
        }
        const screenRes = await sessions.sendCommand(deviceId, { type: "get_screen" }) as any;
        const elements = (screenRes?.elements ?? []) as FlowUIElement[];

        // 1. ID first (stable across sessions)
        const id = stepObj._id as string | undefined;
        let el = id ? findElementById(elements, id) : null;
        // 2. Text fallback (for elements without IDs)
        if (!el) el = findElementByText(elements, String(value));
        // 3. No coordinate fallback — if the element isn't found by ID or text,
        //    the screen probably hasn't transitioned yet. Report failure so the
        //    retry logic in replayCachedFlow can wait and try again.
        if (!el) {
          const available = elements.filter((e: FlowUIElement) => e.text).map((e: FlowUIElement) => e.text).slice(0, 10);
          return { success: false, message: `Element "${value}" not found. Available: ${available.join(", ")}` };
        }
        return await tapElement(deviceId, el, `Tapped "${el.text}" at (${el.center[0]}, ${el.center[1]})`);
      }
      case "longpress": {
        if (Array.isArray(value)) {
          await sessions.sendCommand(deviceId, { type: "longpress", x: value[0], y: value[1] });
          return { success: true, message: `Long-pressed (${value[0]}, ${value[1]})` };
        }
        const lpScreenRes = await sessions.sendCommand(deviceId, { type: "get_screen" }) as any;
        const lpElements = (lpScreenRes?.elements ?? []) as FlowUIElement[];
        const lpId = stepObj._id as string | undefined;
        let lpEl = lpId ? findElementById(lpElements, lpId) : null;
        if (!lpEl) lpEl = findElementByText(lpElements, String(value));
        if (!lpEl) {
          return { success: false, message: `Element "${value}" not found for longpress` };
        }
        await sessions.sendCommand(deviceId, { type: "longpress", x: lpEl.center[0], y: lpEl.center[1] });
        return { success: true, message: `Long-pressed "${lpEl.text}"` };
      }
      case "type":
        await sessions.sendCommand(deviceId, { type: "type", text: String(value) });
        return { success: true, message: `Typed "${value}"` };
      case "swipe":
        await sessions.sendCommand(deviceId, { type: "swipe", direction: String(value) });
        return { success: true, message: `Swiped ${value}` };
      case "scroll":
        await sessions.sendCommand(deviceId, { type: "scroll", direction: String(value) });
        return { success: true, message: `Scrolled ${value}` };
      case "wait": {
        const seconds = Number(value) || 2;
        await new Promise((r) => setTimeout(r, seconds * 1000));
        return { success: true, message: `Waited ${seconds}s` };
      }
      case "launch":
        await sessions.sendCommand(deviceId, { type: "launch", packageName: String(value) });
        return { success: true, message: `Launched ${value}` };
      case "openUrl":
        await sessions.sendCommand(deviceId, { type: "open_url", url: String(value) });
        return { success: true, message: `Opened URL ${value}` };
      case "settings":
        await sessions.sendCommand(deviceId, { type: "open_settings", setting: String(value) });
        return { success: true, message: `Opened settings ${value}` };
      case "done":
        return { success: true, message: String(value) };
      case "dismiss_popup": {
        // Soft action — always succeeds. Try to tap dismiss button, fallback to Back.
        const dpScreenRes = await sessions.sendCommand(deviceId, { type: "get_screen" }) as any;
        const dpElements = (dpScreenRes?.elements ?? []) as FlowUIElement[];
        const queryLower = String(value).toLowerCase();
        const dpEl = dpElements.find((e: FlowUIElement) =>
          e.text && e.text.toLowerCase().includes(queryLower)
        );
        if (dpEl) {
          await sessions.sendCommand(deviceId, { type: "tap", x: dpEl.center[0], y: dpEl.center[1] });
          return { success: true, message: `Dismissed popup by tapping "${dpEl.text}"` };
        }
        // Button not in tree (e.g., credentialmanager) — press Back to dismiss
        await sessions.sendCommand(deviceId, { type: "back" });
        await new Promise((r) => setTimeout(r, 800));
        return { success: true, message: `No popup button "${value}" found, pressed Back to dismiss` };
      }
      case "find_and_tap": {
        // Scroll down to find the element, just like the agent skill does
        const query = String(value).toLowerCase();
        const maxScrolls = 8;

        // 1. Check current screen
        const fatScreenRes = await sessions.sendCommand(deviceId, { type: "get_screen" }) as any;
        let fatElements = (fatScreenRes?.elements ?? []) as FlowUIElement[];
        let fatEl = fatElements.find((e: FlowUIElement) =>
          e.text && e.text.toLowerCase().includes(query)
        );

        // 2. If not found, scroll down and re-check
        if (!fatEl) {
          for (let s = 0; s < maxScrolls; s++) {
            await sessions.sendCommand(deviceId, { type: "scroll", direction: "down" });
            await new Promise((r) => setTimeout(r, 1200));
            const freshRes = await sessions.sendCommand(deviceId, { type: "get_screen" }) as any;
            fatElements = (freshRes?.elements ?? []) as FlowUIElement[];
            fatEl = fatElements.find((e: FlowUIElement) =>
              e.text && e.text.toLowerCase().includes(query)
            );
            if (fatEl) break;
          }
        }

        if (!fatEl) {
          const available = fatElements.filter((e: FlowUIElement) => e.text).map((e: FlowUIElement) => e.text).slice(0, 10);
          return { success: false, message: `Element "${value}" not found after scrolling. Available: ${available.join(", ")}` };
        }

        await sessions.sendCommand(deviceId, { type: "tap", x: fatEl.center[0], y: fatEl.center[1] });
        return { success: true, message: `Found and tapped "${fatEl.text}" at (${fatEl.center[0]}, ${fatEl.center[1]})` };
      }
      default:
        return { success: false, message: `Unknown command: ${command}` };
    }
  }

  return { success: false, message: `Invalid step: ${JSON.stringify(step)}` };
}

export async function runFlowServer(options: RunFlowOptions): Promise<void> {
  const { runId, deviceId, persistentDeviceId, userId, name, steps, appId, signal } = options;
  const stepResults: Array<{ command: string; success: boolean; message: string }> = [];

  /** Send a JSON message to the device WebSocket (if still connected) */
  const sendToDevice = (msg: Record<string, unknown>) => {
    const d = sessions.getDevice(deviceId) ?? sessions.getDeviceByPersistentId(persistentDeviceId ?? "");
    if (!d) return;
    try { d.ws.send(JSON.stringify(msg)); } catch { /* disconnected */ }
  };

  // Notify device so it hides the overlay / shows running state
  sendToDevice({ type: "goal_started", goal: `Flow: ${name}` });

  sessions.notifyDashboard(userId, {
    type: "workflow_started",
    runId,
    name,
    wfType: "flow",
    totalSteps: steps.length,
    stepGoals: steps.map((s) => {
      if (typeof s === 'string') return { goal: s };
      if (typeof s === 'object' && s !== null) {
        const [cmd, val] = Object.entries(s)[0] ?? [];
        return { goal: cmd ? `${cmd}: ${val}` : JSON.stringify(s) };
      }
      return { goal: String(s) };
    }),
  } as any);

  for (let i = 0; i < steps.length; i++) {
    if (signal.aborted) {
      await db.update(workflowRun).set({ status: "stopped", completedAt: new Date() }).where(eq(workflowRun.id, runId));
      sessions.notifyDashboard(userId, { type: "workflow_stopped", runId } as any);
      sendToDevice({ type: "goal_completed", success: false, stepsUsed: 0 });
      return;
    }

    const step = steps[i];
    const label = typeof step === "string" ? step : Object.entries(step)[0].join(": ");

    sessions.notifyDashboard(userId, {
      type: "workflow_step_start",
      runId,
      stepIndex: i,
      command: label,
    } as any);

    try {
      const result = await executeFlowStepWs(deviceId, step, appId);
      stepResults.push({ command: label, success: result.success, message: result.message });

      await db.update(workflowRun).set({
        currentStep: i + 1,
        stepResults,
      }).where(eq(workflowRun.id, runId));

      sessions.notifyDashboard(userId, {
        type: "workflow_step_done",
        runId,
        stepIndex: i,
        success: result.success,
        resolvedBy: "flow",
        message: result.message,
      } as any);

      if (!result.success) {
        await db.update(workflowRun).set({
          status: "failed",
          stepResults,
          completedAt: new Date(),
        }).where(eq(workflowRun.id, runId));
        sessions.notifyDashboard(userId, {
          type: "workflow_completed",
          runId,
          success: false,
          stepResults,
        } as any);
        sendToDevice({ type: "goal_completed", success: false, stepsUsed: stepResults.length });
        return;
      }

      // Brief pause between steps for UI to settle
      if (i < steps.length - 1 && typeof step !== "string") {
        await new Promise((r) => setTimeout(r, 800));
      }
    } catch (err) {
      stepResults.push({ command: label, success: false, message: String(err) });
      await db.update(workflowRun).set({
        status: "failed",
        stepResults,
        completedAt: new Date(),
      }).where(eq(workflowRun.id, runId));
      sessions.notifyDashboard(userId, {
        type: "workflow_completed",
        runId,
        success: false,
        stepResults,
      } as any);
      sendToDevice({ type: "goal_completed", success: false, stepsUsed: stepResults.length });
      return;
    }
  }

  await db.update(workflowRun).set({
    status: "completed",
    stepResults,
    completedAt: new Date(),
  }).where(eq(workflowRun.id, runId));

  sessions.notifyDashboard(userId, {
    type: "workflow_completed",
    runId,
    success: true,
    stepResults,
  } as any);
  sendToDevice({ type: "goal_completed", success: true, stepsUsed: stepResults.length });
}
