import { sessions } from "../ws/sessions.js";
import { db } from "../db.js";
import { workflowRun } from "../schema.js";
import { eq } from "drizzle-orm";

type FlowStep = string | { [key: string]: string | number | [number, number] };

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

interface UIElement {
  text: string;
  hint?: string;
  id?: string;
  bounds: { left: number; top: number; right: number; bottom: number };
  center: [number, number];
}

function parseUITree(xmlStr: string): UIElement[] {
  const elements: UIElement[] = [];
  const nodeRegex = /<node[^>]*>/g;
  let match: RegExpExecArray | null;
  while ((match = nodeRegex.exec(xmlStr)) !== null) {
    const node = match[0];
    const text = (node.match(/text="([^"]*)"/) ?? [])[1] ?? "";
    const hint = (node.match(/content-desc="([^"]*)"/) ?? [])[1] ?? "";
    const id = (node.match(/resource-id="([^"]*)"/) ?? [])[1] ?? "";
    const boundsStr = (node.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) ?? []);
    if (!boundsStr[1]) continue;
    const left = parseInt(boundsStr[1]);
    const top = parseInt(boundsStr[2]);
    const right = parseInt(boundsStr[3]);
    const bottom = parseInt(boundsStr[4]);
    const cx = Math.round((left + right) / 2);
    const cy = Math.round((top + bottom) / 2);
    if (text || hint || id) {
      elements.push({
        text,
        hint: hint || undefined,
        id: id || undefined,
        bounds: { left, top, right, bottom },
        center: [cx, cy],
      });
    }
  }
  return elements;
}

function findElementByText(elements: UIElement[], query: string): UIElement | null {
  const q = query.toLowerCase();
  const exact = elements.find((el) => el.text && el.text.toLowerCase() === q);
  if (exact) return exact;
  const matches = elements
    .filter((el) => el.text && el.text.toLowerCase().includes(q))
    .sort((a, b) => a.text.length - b.text.length);
  if (matches.length > 0) return matches[0];
  const hintMatch = elements.find((el) => el.hint && el.hint.toLowerCase().includes(q));
  if (hintMatch) return hintMatch;
  const idMatch = elements.find((el) => el.id && el.id.toLowerCase().includes(q));
  if (idMatch) return idMatch;
  return null;
}

async function executeFlowStepWs(
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
      case "done":
        return { success: true, message: "Flow complete" };
      default:
        return { success: false, message: `Unknown step: ${step}` };
    }
  }

  if (typeof step === "object" && step !== null) {
    const [command, value] = Object.entries(step)[0];
    switch (command) {
      case "tap": {
        if (Array.isArray(value)) {
          await sessions.sendCommand(deviceId, { type: "tap", x: value[0], y: value[1] });
          return { success: true, message: `Tapped (${value[0]}, ${value[1]})` };
        }
        const treeRes = await sessions.sendCommand(deviceId, { type: "get_ui_tree" }) as any;
        const xml = treeRes?.xml ?? treeRes?.result ?? "";
        const elements = parseUITree(String(xml));
        const el = findElementByText(elements, String(value));
        if (!el) {
          const available = elements.filter((e) => e.text).map((e) => e.text).slice(0, 10);
          return { success: false, message: `Element "${value}" not found. Available: ${available.join(", ")}` };
        }
        await sessions.sendCommand(deviceId, { type: "tap", x: el.center[0], y: el.center[1] });
        return { success: true, message: `Tapped "${el.text}" at (${el.center[0]}, ${el.center[1]})` };
      }
      case "longpress": {
        if (Array.isArray(value)) {
          await sessions.sendCommand(deviceId, { type: "longpress", x: value[0], y: value[1] });
          return { success: true, message: `Long-pressed (${value[0]}, ${value[1]})` };
        }
        const treeRes = await sessions.sendCommand(deviceId, { type: "get_ui_tree" }) as any;
        const xml = treeRes?.xml ?? treeRes?.result ?? "";
        const elements = parseUITree(String(xml));
        const el = findElementByText(elements, String(value));
        if (!el) return { success: false, message: `Element "${value}" not found for longpress` };
        await sessions.sendCommand(deviceId, { type: "longpress", x: el.center[0], y: el.center[1] });
        return { success: true, message: `Long-pressed "${el.text}"` };
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
      default:
        return { success: false, message: `Unknown command: ${command}` };
    }
  }

  return { success: false, message: `Invalid step: ${JSON.stringify(step)}` };
}

export async function runFlowServer(options: RunFlowOptions): Promise<void> {
  const { runId, deviceId, userId, name, steps, appId, signal } = options;
  const stepResults: Array<{ command: string; success: boolean; message: string }> = [];

  sessions.notifyDashboard(userId, {
    type: "workflow_started",
    runId,
    name,
    wfType: "flow",
    totalSteps: steps.length,
  } as any);

  for (let i = 0; i < steps.length; i++) {
    if (signal.aborted) {
      await db.update(workflowRun).set({ status: "stopped", completedAt: new Date() }).where(eq(workflowRun.id, runId));
      sessions.notifyDashboard(userId, { type: "workflow_stopped", runId } as any);
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
}
