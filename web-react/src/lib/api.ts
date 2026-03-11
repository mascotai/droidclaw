/**
 * Typed fetch wrapper for all DroidClaw API endpoints.
 * All requests go through /api/* which the proxy forwards to the Hono backend.
 */

class ApiError extends Error {
	status: number;
	constructor(
		status: number,
		message: string,
	) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
	}
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
	const res = await fetch(`/api${path}`, {
		...options,
		headers: {
			'Content-Type': 'application/json',
			...options?.headers,
		},
	});

	if (!res.ok) {
		const data = await res.json().catch(() => ({ error: `Error ${res.status}` }));
		throw new ApiError(res.status, data.error ?? `Error ${res.status}`);
	}

	return res.json();
}

// ── Devices ──

export interface DeviceInfo {
	deviceId: string;
	name: string;
	status: string;
	model: string | null;
	manufacturer: string | null;
	androidVersion: string | null;
	screenWidth: number | null;
	screenHeight: number | null;
	batteryLevel: number | null;
	isCharging: boolean;
	lastSeen: string;
	installedApps?: Array<{ packageName: string; label: string }>;
	lastGoal?: { goal: string; status: string; startedAt: string } | null;
}

export interface DeviceStats {
	totalSessions: number;
	successRate: number;
	avgSteps: number;
}

export interface AgentSession {
	id: string;
	userId: string;
	deviceId: string;
	goal: string;
	status: string;
	stepsUsed: number | null;
	startedAt: string;
	completedAt: string | null;
	qstashMessageId: string | null;
	scheduledFor: string | null;
	scheduledDelay: number | null;
}

export interface AgentStep {
	id: string;
	sessionId: string;
	stepNumber: number;
	screenHash: string | null;
	action: Record<string, unknown> | null;
	reasoning: string | null;
	result: string | null;
	packageName: string | null;
	durationMs: number | null;
	timestamp: string;
}

export interface WorkflowRun {
	id: string;
	userId: string;
	deviceId: string;
	name: string;
	type: string;
	steps: Record<string, unknown>[];
	status: string;
	currentStep: number | null;
	totalSteps: number;
	stepResults: Record<string, unknown>[] | null;
	startedAt: string;
	completedAt: string | null;
	qstashMessageId: string | null;
	scheduledFor: string | null;
}

export interface CachedFlow {
	id: string;
	goalKey: string;
	appPackage: string | null;
	stepCount: number;
	successCount: number | null;
	failCount: number | null;
	createdAt: string;
	lastUsedAt: string | null;
}

export interface PaginatedResponse<T> {
	items: T[];
	total: number;
}

export interface LlmConfig {
	id: string;
	userId: string;
	provider: string;
	apiKey: string; // masked
	model: string | null;
}

export interface ApiKeyInfo {
	id: string;
	name: string | null;
	start: string | null;
	enabled: boolean | null;
	createdAt: string;
	type: string | null;
}

// ── API functions ──

export const api = {
	// Devices
	listDevices: () => request<DeviceInfo[]>('/devices'),
	getDevice: (deviceId: string) => request<DeviceInfo>(`/devices/${deviceId}`),
	getDeviceStats: (deviceId: string) => request<DeviceStats>(`/devices/${deviceId}/stats`),
	getDeviceVersion: (deviceId: string) => request<{ version: string }>(`/devices/${deviceId}/version`),

	// Sessions (Goals)
	listSessions: (deviceId: string, page = 1) =>
		request<PaginatedResponse<AgentSession>>(`/devices/${deviceId}/sessions?page=${page}`),
	listSessionSteps: (deviceId: string, sessionId: string) =>
		request<AgentStep[]>(`/devices/${deviceId}/sessions/${sessionId}/steps`),

	// Goals
	submitGoal: (deviceId: string, goal: string) =>
		request<{ sessionId: string }>('/goals', {
			method: 'POST',
			body: JSON.stringify({ deviceId, goal }),
		}),
	stopGoal: (deviceId: string) =>
		request('/goals/stop', {
			method: 'POST',
			body: JSON.stringify({ deviceId }),
		}),
	cancelScheduledGoal: (sessionId: string) =>
		request(`/goals/${sessionId}/schedule`, { method: 'DELETE' }),

	// Workflows
	submitWorkflow: (data: {
		deviceId: string;
		name?: string;
		type?: string;
		steps: Record<string, unknown>[];
		variables?: Record<string, unknown>;
		llmModel?: string;
	}) =>
		request<{ runId: string; status: string }>('/workflows/run', {
			method: 'POST',
			body: JSON.stringify(data),
		}),
	stopWorkflow: (deviceId: string, runId?: string) =>
		request('/workflows/stop', {
			method: 'POST',
			body: JSON.stringify({ deviceId, ...(runId && { runId }) }),
		}),
	listWorkflowRuns: (deviceId: string, page = 1) =>
		request<PaginatedResponse<WorkflowRun>>(`/workflows/runs/${deviceId}?page=${page}`),
	getWorkflowRun: (deviceId: string, runId: string) =>
		request<WorkflowRun>(`/workflows/runs/${deviceId}/${runId}?expand=steps`),
	getQueueState: (deviceId: string) =>
		request<{ queue: unknown[] }>(`/workflows/queue/${deviceId}`),

	// Cached Flows
	listCachedFlows: (deviceId: string) =>
		request<CachedFlow[]>(`/workflows/cached/${deviceId}`),
	deleteCachedFlow: (flowId: string) =>
		request(`/workflows/cached/${flowId}`, { method: 'DELETE' }),

	// Investigation
	investigateSession: (sessionId: string) =>
		request(`/investigate/${sessionId}`, { method: 'POST' }),

	// Pairing
	createPairingCode: () =>
		request<{ code: string; expiresAt: string }>('/pairing/create', { method: 'POST' }),
	getPairingStatus: () =>
		request<{ paired: boolean; expired?: boolean }>('/pairing/status'),

	// Settings
	getConfig: () => request<LlmConfig | null>('/settings/config'),
	updateConfig: (data: { provider: string; apiKey: string; model?: string }) =>
		request<{ saved: boolean }>('/settings/config', {
			method: 'POST',
			body: JSON.stringify(data),
		}),

	// API Keys
	listApiKeys: () => request<ApiKeyInfo[]>('/api-keys'),
	createApiKey: (name: string, type = 'user') =>
		request<{ key: string }>('/api-keys', {
			method: 'POST',
			body: JSON.stringify({ name, type }),
		}),
	deleteApiKey: (keyId: string) =>
		request<{ deleted: boolean }>(`/api-keys/${keyId}`, { method: 'DELETE' }),

	// License
	activateLicense: (key: string) =>
		request('/license/activate', {
			method: 'POST',
			body: JSON.stringify({ key }),
		}),
	activateFromCheckout: (checkoutId: string) =>
		request('/license/activate-checkout', {
			method: 'POST',
			body: JSON.stringify({ checkoutId }),
		}),

	// Shell
	runShell: (deviceId: string, command: string) =>
		request<{ output: string }>(`/devices/${deviceId}/shell`, {
			method: 'POST',
			body: JSON.stringify({ command }),
		}),

	// Diagnostics
	diagnoseDevice: (deviceId: string) =>
		request(`/devices/${deviceId}/diagnose`, { method: 'POST' }),
};
