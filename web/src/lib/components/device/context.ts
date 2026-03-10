/**
 * Shared context for the device page layout → child route communication.
 * The layout owns all shared state (device data, WS events, live run, cached flows, etc.)
 * and exposes it to child pages (Home / Log) via Svelte context.
 */

import { getContext, setContext } from 'svelte';
import type {
	DeviceData,
	WorkflowRun,
	WorkflowLiveProgress,
	WorkflowStepConfig,
	LiveWorkflowRun,
	CachedFlowEntry,
	QueueItem,
	Step
} from './types';

const DEVICE_CTX_KEY = Symbol('device-page-context');

export interface DevicePageContext {
	// ─── Identifiers ────────────────────────────────────
	readonly deviceId: string;

	// ─── Device data ────────────────────────────────────
	readonly deviceData: DeviceData | null;
	readonly battery: number | null;
	readonly charging: boolean;

	// ─── Live workflow run ──────────────────────────────
	readonly liveWorkflowRun: LiveWorkflowRun | null;

	// ─── Cached flows ──────────────────────────────────
	readonly cachedFlows: CachedFlowEntry[];
	readonly cachedFlowsLoaded: boolean;
	readonly runningCachedFlowId: string | null;
	readonly runningCachedFlow: CachedFlowEntry | null;

	// ─── Queue ─────────────────────────────────────────
	readonly queuedItems: QueueItem[];

	// ─── Workflow runs (Log tab) ────────────────────────
	readonly workflowRuns: WorkflowRun[];
	readonly workflowLiveProgress: Record<string, WorkflowLiveProgress>;
	readonly workflowsLoaded: boolean;
	readonly workflowsPage: number;
	readonly workflowsTotalPages: number;

	// ─── Actions ────────────────────────────────────────
	handleWorkflowSubmit: (steps: WorkflowStepConfig[], variables: Record<string, string>) => Promise<void>;
	handleWorkflowStop: () => Promise<void>;
	handleCachedFlowRun: (flow: CachedFlowEntry) => Promise<void>;
	handleCachedFlowDelete: (flowId: string) => Promise<void>;
	handleQueueCancel: (runId: string) => void;
	handleLogPageChange: (page: number) => void;
	loadSessionSteps: (sessionId: string) => Promise<Step[]>;
}

export function setDeviceContext(ctx: DevicePageContext) {
	setContext(DEVICE_CTX_KEY, ctx);
}

export function getDeviceContext(): DevicePageContext {
	return getContext<DevicePageContext>(DEVICE_CTX_KEY);
}
