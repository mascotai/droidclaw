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
	// Devices — all under /v2/devices via proxy /api/devices
	listDevices: () => request<DeviceInfo[]>('/devices'),
	getDevice: (deviceId: string) => request<DeviceInfo>(`/devices/${deviceId}`),
	getDeviceStats: (_deviceId: string): Promise<DeviceStats> =>
		Promise.resolve({ totalSessions: 0, successRate: 0, avgSteps: 0 }),
	getDeviceVersion: (deviceId: string) => request<{ version: string }>(`/devices/${deviceId}/version`),
	getDeviceScreen: (deviceId: string) => request<unknown>(`/devices/${deviceId}/screen`),

	// Sessions (Goals) — v2 uses workflow runs with goals, not standalone sessions
	listSessions: (deviceId: string, page = 1) =>
		request<PaginatedResponse<AgentSession>>(`/devices/${deviceId}/sessions?page=${page}`),
	listSessionSteps: (deviceId: string, sessionId: string) =>
		request<AgentStep[]>(`/devices/${deviceId}/sessions/${sessionId}/steps`),

	// Goals — submit via workflow run with single step
	submitGoal: async (deviceId: string, goal: string) => {
		const result = await request<{ runId: string; status: string }>(`/devices/${deviceId}/workflows/run`, {
			method: 'POST',
			body: JSON.stringify({ name: goal, steps: [{ goal }] }),
		});
		// Map runId to sessionId for backward compat with goals-tab
		return { sessionId: result.runId, ...result };
	},
	stopGoal: (deviceId: string) =>
		request(`/devices/${deviceId}/workflows/stop`, {
			method: 'POST',
		}),
	cancelScheduledGoal: (sessionId: string) =>
		request(`/goals/${sessionId}/schedule`, { method: 'DELETE' }),

	// Workflows — all under /v2/devices/:deviceId/workflows
	submitWorkflow: (data: {
		deviceId: string;
		name?: string;
		type?: string;
		steps: Record<string, unknown>[];
		variables?: Record<string, unknown>;
		llmModel?: string;
	}) =>
		request<{ runId: string; status: string }>(`/devices/${data.deviceId}/workflows/run`, {
			method: 'POST',
			body: JSON.stringify(data),
		}),
	stopWorkflow: (deviceId: string, runId?: string) =>
		runId
			? request(`/devices/${deviceId}/workflows/runs/${runId}/stop`, { method: 'POST' })
			: request(`/devices/${deviceId}/workflows/stop`, { method: 'POST' }),
	listWorkflowRuns: async (deviceId: string, page = 1) => {
		const offset = (page - 1) * 10;
		const data = await request<{ runs: Array<Record<string, unknown>>; total: number }>(`/devices/${deviceId}/workflows/runs?limit=10&offset=${offset}`);
		return {
			items: data.runs.map((r) => ({ ...r, id: r.runId as string })) as unknown as WorkflowRun[],
			total: data.total,
		} as PaginatedResponse<WorkflowRun>;
	},
	getWorkflowRun: async (deviceId: string, runId: string) => {
		const data = await request<Record<string, unknown>>(`/devices/${deviceId}/workflows/runs/${runId}?expand=steps`);
		// Map v2 goals[] to stepResults[] + steps[] for frontend compat
		const goals = data.goals as Array<Record<string, unknown>> | undefined;
		if (goals && !data.stepResults) {
			data.steps = goals.map((g) => ({
				goal: g.text as string,
				app: g.app as string | undefined,
			}));
			data.stepResults = goals.map((g) => ({
				goal: g.text as string,
				goalId: g.goalId as string,
				success: g.success as boolean,
				stepsUsed: g.stepsUsed as number | undefined,
				resolvedBy: g.resolvedBy as string | undefined,
				error: g.error as string | undefined,
				message: g.message as string | undefined,
				status: g.status as string,
				evalPassed: g.evalPassed as boolean | null,
				skipped: g.skipped as boolean,
				sessionId: g.sessionId as string | undefined,
				agentSteps: g.agentSteps as Array<Record<string, unknown>> | undefined,
			}));
		}
		return { ...data, id: data.runId as string } as unknown as WorkflowRun;
	},
	getGoalSteps: async (deviceId: string, runId: string, goalIndex: number) => {
		const data = await request<{ steps: Array<Record<string, unknown>>; totalSteps: number; stepsUsed: number; note?: string }>(`/devices/${deviceId}/workflows/runs/${runId}/goals/${goalIndex}/steps`);
		return data;
	},
	getQueueState: (_deviceId: string): Promise<{ queue: unknown[] }> =>
		Promise.resolve({ queue: [] }),

	// Cached Flows — under /v2/devices/:deviceId/workflows/cached
	listCachedFlows: async (deviceId: string) => {
		const data = await request<{ flows: Array<Record<string, unknown>> }>(`/devices/${deviceId}/workflows/cached`);
		return data.flows.map((f) => ({
			...f,
			stepCount: f.stepsCount as number ?? f.stepCount as number ?? 0,
		})) as unknown as CachedFlow[];
	},
	deleteCachedFlow: (flowId: string, deviceId?: string) =>
		deviceId
			? request(`/devices/${deviceId}/workflows/cached/${flowId}`, { method: 'DELETE' })
			: request(`/workflows/cached/${flowId}`, { method: 'DELETE' }),

	// Investigation
	investigateSession: (sessionId: string) =>
		request(`/investigate/${sessionId}`, { method: 'POST' }),

	// Pairing — under /pairing (not /v2)
	createPairingCode: () =>
		request<{ code: string; expiresAt: string }>('/pairing/create', { method: 'POST' }),
	getPairingStatus: () =>
		request<{ paired: boolean; expired?: boolean }>('/pairing/status'),

	// Settings — v2 doesn't have settings routes, stub for now
	getConfig: (): Promise<LlmConfig | null> => Promise.resolve(null),
	updateConfig: (_data: { provider: string; apiKey: string; model?: string }): Promise<{ saved: boolean }> =>
		Promise.resolve({ saved: false }),

	// API Keys — v2 doesn't have api-keys routes, stub for now
	listApiKeys: (): Promise<ApiKeyInfo[]> => Promise.resolve([]),
	createApiKey: (_name: string, _type = 'user'): Promise<{ key: string }> =>
		Promise.reject(new Error('API keys not available in v2')),
	deleteApiKey: (_keyId: string): Promise<{ deleted: boolean }> =>
		Promise.reject(new Error('API keys not available in v2')),

	// License — under /license (not /v2)
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

	// Shell — under /v2/devices/:deviceId/shell
	runShell: (deviceId: string, command: string) =>
		request<{ output: string }>(`/devices/${deviceId}/shell`, {
			method: 'POST',
			body: JSON.stringify({ command }),
		}),

	// Diagnostics
	diagnoseDevice: (deviceId: string) =>
		request(`/devices/${deviceId}/diagnose`, { method: 'POST' }),
};
