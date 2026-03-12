<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import {
		getDevice,
		listDeviceSessions,
		listSessionSteps,
		getDeviceStats,
		listWorkflowRuns,
		listCachedFlows,
		getWorkflowRun,
		deleteCachedFlow as deleteCachedFlowCmd,
		submitWorkflow,
		stopWorkflow,
		stopGoal as stopGoalCmd
	} from '$lib/api/devices.remote';
	import { dashboardWs } from '$lib/stores/dashboard-ws.svelte';
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { track } from '$lib/analytics/track';
	import { toast } from '$lib/toast';
	import {
		DEVICE_TAB_CHANGE,
		DEVICE_WORKFLOW_SUBMIT,
		DEVICE_WORKFLOW_STOP,
		DEVICE_CACHED_FLOW_RUN,
		DEVICE_CACHED_FLOW_DELETE,
		DEVICE_CACHED_FLOW_COMPILED,
		DEVICE_WORKFLOW_EXPAND
	} from '$lib/analytics/events';

	// Sub-components
	import DeviceHeader from '$lib/components/device/DeviceHeader.svelte';

	// Types
	import type {
		DeviceData,
		WorkflowRun,
		WorkflowLiveProgress,
		WorkflowStepConfig,
		LiveAgentStep,
		LiveWorkflowRun,
		CachedFlowEntry,
		QueueItem,
		Step
	} from '$lib/components/device/types';

	// Context
	import { setDeviceContext } from '$lib/components/device/context';

	let { children } = $props();

	const deviceId = page.params.deviceId!;

	// ─── Tabs (route-based) ─────────────────────────────────────
	const tabs = [
		{ id: 'home' as const, label: 'Home', icon: 'solar:home-2-bold-duotone', href: `/dashboard/devices/${deviceId}` },
		{ id: 'log' as const, label: 'Log', icon: 'solar:history-bold-duotone', href: `/dashboard/devices/${deviceId}/log` }
	];

	// Use $state + $effect instead of $derived(page.url...) to avoid
	// effect_update_depth_exceeded from SvelteKit's reactive page.url proxy.
	let activeTab = $state<'home' | 'log'>(page.url.pathname.endsWith('/log') ? 'log' : 'home');
	$effect(() => {
		activeTab = page.url.pathname.endsWith('/log') ? 'log' : 'home';
	});

	function navigateTab(tab: typeof tabs[number]) {
		track(DEVICE_TAB_CHANGE, { tab: tab.id });
		if (tab.id === 'log' && !workflowsLoaded) loadWorkflowRuns();
		goto(tab.href);
	}

	// ─── Data loading ───────────────────────────────────────────
	// Extract primitives from page.url at init to avoid reactive proxy issues
	const isLogTab = page.url.pathname.endsWith('/log');
	const urlPage = Number(page.url.searchParams.get('page')) || 1;
	const initialPage = isLogTab ? urlPage : 1;

	// State declarations
	let deviceData = $state<DeviceData | null>(null);
	let stats = $state<{ totalSessions: number; successRate: number; avgSteps: number } | null>(null);
	let workflowRuns = $state<WorkflowRun[]>([]);
	let workflowLiveProgress = $state<Record<string, WorkflowLiveProgress>>({});
	let workflowsLoaded = $state(false);
	let workflowsPage = $state(initialPage);
	let workflowsTotalPages = $state(1);
	// Plain (non-reactive) cache — not rendered in template, only used internally
	const workflowPageCache = new Map<number, { items: WorkflowRun[]; total: number }>();
	let cachedFlows = $state<CachedFlowEntry[]>([]);
	let cachedFlowsLoaded = $state(false);

	// Live workflow run tracking
	let liveWorkflowRun = $state<LiveWorkflowRun | null>(null);

	// Queue state
	let queuedItems = $state<QueueItem[]>([]);

	// Card-lift state: which cached flow card is "lifted" into the pipeline
	let runningCachedFlowId = $state<string | null>(null);
	const runningCachedFlow = $derived(
		runningCachedFlowId ? cachedFlows.find((f) => f.id === runningCachedFlowId) ?? null : null
	);

	// Real-time battery from WS
	let liveBattery = $state<number | null>(null);
	let liveCharging = $state(false);
	const battery = $derived(liveBattery ?? (deviceData?.batteryLevel as number | null));
	const charging = $derived(liveCharging || (deviceData?.isCharging as boolean));

	// ─── Selected run state (Home tab detail panel) ─────────────
	let selectedRunId = $state<string | null>(null);
	let selectedRunDetail = $state<WorkflowRun | null>(null);
	let selectedRunLoading = $state(false);

	async function selectRun(runId: string | null) {
		if (runId === selectedRunId) return;
		selectedRunId = runId;
		selectedRunDetail = null;

		if (!runId) return;

		// If this is the live run, no need to fetch — it's already in liveWorkflowRun
		if (liveWorkflowRun && liveWorkflowRun.runId === runId) return;

		// Fetch full run detail with expanded agent steps
		selectedRunLoading = true;
		try {
			const result = await getWorkflowRun({ deviceId, runId });
			// Only apply if still selected (user may have changed selection)
			if (selectedRunId === runId) {
				selectedRunDetail = result as WorkflowRun;
			}
		} catch (err) {
			console.error('[selectRun] Failed to load run detail:', err);
		} finally {
			if (selectedRunId === runId) {
				selectedRunLoading = false;
			}
		}
	}

	// ─── SessionStorage persistence for live workflow run ────────
	const LIVE_RUN_KEY = `droidclaw:liveRun:${deviceId}`;

	function saveLiveRun(run: LiveWorkflowRun | null) {
		try {
			if (run) {
				sessionStorage.setItem(LIVE_RUN_KEY, JSON.stringify(run));
			} else {
				sessionStorage.removeItem(LIVE_RUN_KEY);
			}
		} catch {
			// sessionStorage might be unavailable
		}
	}

	function restoreLiveRun(): LiveWorkflowRun | null {
		try {
			const saved = sessionStorage.getItem(LIVE_RUN_KEY);
			if (!saved) return null;
			return JSON.parse(saved) as LiveWorkflowRun;
		} catch {
			return null;
		}
	}

	// Persist liveWorkflowRun on every change
	$effect(() => {
		saveLiveRun(liveWorkflowRun);
	});

	// ─── Data operations ────────────────────────────────────────

	async function loadWorkflowRuns(p?: number, bypassCache = false) {
		if (p !== undefined) workflowsPage = p;
		if (!bypassCache && workflowPageCache.has(workflowsPage)) {
			const cached = workflowPageCache.get(workflowsPage)!;
			workflowRuns = cached.items;
			workflowsTotalPages = Math.ceil(cached.total / 20) || 1;
			workflowsLoaded = true;
		} else {
			const result = await listWorkflowRuns({ deviceId, page: workflowsPage });
			workflowRuns = result.items as WorkflowRun[];
			workflowsTotalPages = Math.ceil(result.total / 20) || 1;
			workflowsLoaded = true;
			workflowPageCache.set(workflowsPage, { items: workflowRuns, total: result.total });
		}
		// Update URL with pagination param
		const u = new URL(window.location.href);
		if (workflowsPage > 1) u.searchParams.set('page', String(workflowsPage));
		else u.searchParams.delete('page');
		history.replaceState({}, '', u);
	}

	async function loadCachedFlows() {
		try {
			const rows = await listCachedFlows(deviceId);
			cachedFlows = rows as CachedFlowEntry[];
			cachedFlowsLoaded = true;
		} catch {
			cachedFlowsLoaded = true;
		}
	}

	// ─── Actions ────────────────────────────────────────────────

	async function handleWorkflowSubmit(steps: WorkflowStepConfig[], variables: Record<string, string>) {
		track(DEVICE_WORKFLOW_SUBMIT, { stepCount: steps.length });
		try {
			const name = steps.length === 1
				? steps[0].goal
				: `Workflow (${steps.length} steps)`;
			await submitWorkflow({
				deviceId,
				name,
				type: 'workflow',
				steps: steps.map((s) => {
					const step: Record<string, unknown> = { goal: s.goal };
					if (s.app) step.app = s.app;
					if (s.maxSteps) step.maxSteps = s.maxSteps;
					if (s.retries) step.retries = s.retries;
					if (s.cache !== undefined) step.cache = s.cache;
					if (s.forceStop) step.forceStop = s.forceStop;
					if (s.eval) step.eval = s.eval;
					return step;
				}),
				variables: Object.keys(variables).length > 0 ? variables : undefined,
			});
		} catch {
			// WS events will drive the UI — error is visible via run status
		}
	}

	async function handleWorkflowStop() {
		track(DEVICE_WORKFLOW_STOP);
		try {
			await stopWorkflow({ deviceId });
		} catch {
			// ignore
		}
	}

	async function handleCachedFlowRun(flow: CachedFlowEntry) {
		track(DEVICE_CACHED_FLOW_RUN, { goalKey: flow.goalKey });
		runningCachedFlowId = flow.id;
		try {
			const step: Record<string, unknown> = { goal: flow.goalKey };
			if (flow.appPackage) step.app = flow.appPackage;
			await submitWorkflow({
				deviceId,
				name: flow.goalKey,
				type: 'workflow',
				steps: [step],
			});
		} catch {
			runningCachedFlowId = null;
		}
	}

	async function handleCachedFlowDelete(flowId: string) {
		track(DEVICE_CACHED_FLOW_DELETE);
		try {
			await deleteCachedFlowCmd({ flowId });
			cachedFlows = cachedFlows.filter((f) => f.id !== flowId);
		} catch {
			// ignore
		}
	}

	function handleQueueCancel(runId: string) {
		queuedItems = queuedItems.filter((q) => q.runId !== runId);
	}

	function handleLogPageChange(p: number) {
		loadWorkflowRuns(p);
	}

	async function loadSessionSteps(sessionId: string): Promise<Step[]> {
		const loaded = await listSessionSteps({ deviceId, sessionId });
		return loaded as Step[];
	}

	// ─── WebSocket events + data loading ────────────────────────

	onMount(() => {
		// Restore live run from sessionStorage on page load
		const restored = restoreLiveRun();
		if (restored && restored.status === 'running') {
			liveWorkflowRun = restored;
			// Auto-select the restored live run
			selectedRunId = restored.runId;
		}

		// Load initial data (inside onMount to avoid SSR issues and effect loops)
		getDevice(deviceId).then((r) => { deviceData = r as DeviceData | null; }).catch(() => {});
		getDeviceStats(deviceId).then((s) => { stats = s as typeof stats; }).catch(() => {});
		listWorkflowRuns({ deviceId, page: initialPage }).then((wf) => {
			workflowRuns = wf.items as WorkflowRun[];
			workflowsTotalPages = Math.ceil(wf.total / 20) || 1;
			workflowsLoaded = true;
			workflowPageCache.set(initialPage, { items: workflowRuns, total: wf.total });

			// If we restored a live run, check if the server still shows it as running
			if (liveWorkflowRun && liveWorkflowRun.status === 'running') {
				const serverRun = workflowRuns.find((r) => r.id === liveWorkflowRun!.runId);
				if (serverRun && serverRun.status !== 'running') {
					// Server says it's done — update local state
					liveWorkflowRun = {
						...liveWorkflowRun!,
						status: serverRun.status === 'completed' ? 'completed' : serverRun.status === 'stopped' ? 'stopped' : 'failed',
						activeStepIndex: -1,
					};
				}
			}

			// If no run is selected yet but we have runs, auto-select the most recent
			if (!selectedRunId && workflowRuns.length > 0 && !liveWorkflowRun) {
				selectRun(workflowRuns[0].id);
			}
		}).catch(() => { workflowsLoaded = true; });
		loadCachedFlows().catch(() => {});

		const unsub = dashboardWs.subscribe((msg) => {
			switch (msg.type) {
				case 'device_status': {
					if (msg.deviceId === deviceId) {
						liveBattery = msg.batteryLevel as number;
						liveCharging = msg.isCharging as boolean;
					}
					break;
				}
				case 'reconnected': {
					// WS reconnected after a drop — re-fetch stale data
					workflowPageCache.clear();
					loadWorkflowRuns(undefined, true).catch(() => {});
					loadCachedFlows().catch(() => {});
					break;
				}
				case 'step': {
					// Feed agent step into live workflow run
					if (liveWorkflowRun && liveWorkflowRun.status === 'running' && liveWorkflowRun.activeStepIndex >= 0) {
						const action = msg.action as Record<string, unknown>;
						const actionStr = action?.action
							? `${action.action}${action.coordinates ? `(${(action.coordinates as number[]).join(',')})` : ''}`
							: JSON.stringify(action);
						const agentStep: LiveAgentStep = {
							step: msg.step as number,
							action: actionStr,
							reasoning: (msg.reasoning as string) ?? ''
						};
						liveWorkflowRun = {
							...liveWorkflowRun,
							liveSteps: [...liveWorkflowRun.liveSteps, agentStep],
						};
					}
					break;
				}
				case 'workflow_started': {
					workflowPageCache.clear();
					if (workflowsLoaded) loadWorkflowRuns(undefined, true);
					const wfStepGoals = (msg.stepGoals as Array<{ goal: string; app?: string }>) ?? [];
					const wfTotalSteps = (msg.totalSteps as number) ?? wfStepGoals.length;
					liveWorkflowRun = {
						runId: msg.runId as string,
						name: (msg.name as string) ?? 'Workflow',
						wfType: (msg.wfType as string) ?? 'workflow',
						totalSteps: wfTotalSteps,
						stepGoals: wfStepGoals,
						status: 'running',
						stepResults: Array.from({ length: wfTotalSteps }, () => null),
						activeStepIndex: -1,
						attempt: 1,
						totalAttempts: 1,
						liveSteps: [],
					};
					// Auto-select the new live run
					selectedRunId = msg.runId as string;
					selectedRunDetail = null;
					break;
				}
				case 'workflow_step_start': {
					const runId = msg.runId as string;
					const stepIdx = msg.stepIndex as number;
					const goal = (msg.goal ?? msg.command ?? '') as string;
					const maxRetries = (msg.maxRetries as number) ?? 0;
					workflowLiveProgress = {
						...workflowLiveProgress,
						[runId]: {
							activeStepIndex: stepIdx,
							activeStepGoal: goal,
							attempt: 1,
							totalAttempts: maxRetries + 1,
							stepsUsedInAttempt: 0,
						}
					};
					// Update in-memory run
					const runS = workflowRuns.find((r) => r.id === runId);
					if (runS) {
						runS.currentStep = stepIdx;
						runS.status = 'running';
						workflowRuns = [...workflowRuns];
					}
					// Update live workflow run
					if (liveWorkflowRun && liveWorkflowRun.runId === runId) {
						liveWorkflowRun = {
							...liveWorkflowRun,
							activeStepIndex: stepIdx,
							attempt: 1,
							totalAttempts: maxRetries + 1,
							liveSteps: [],
						};
					}
					break;
				}
				case 'workflow_step_retry': {
					const runId = msg.runId as string;
					const attempt = (msg.attempt as number) ?? 1;
					const totalAttempts = (msg.maxRetries as number) ?? 1;
					const stepsUsed = (msg.stepsUsed as number) ?? 0;
					const prev = workflowLiveProgress[runId];
					if (prev) {
						workflowLiveProgress = {
							...workflowLiveProgress,
							[runId]: { ...prev, attempt: attempt + 1, totalAttempts, stepsUsedInAttempt: stepsUsed }
						};
					}
					if (liveWorkflowRun && liveWorkflowRun.runId === runId) {
						liveWorkflowRun = { ...liveWorkflowRun, attempt: attempt + 1, totalAttempts, liveSteps: [] };
					}
					break;
				}
				case 'workflow_step_done': {
					const runId = msg.runId as string;
					const stepIdx = msg.stepIndex as number;
					const stepSuccess = msg.success as boolean;
					// Update in-memory workflow run
					const run = workflowRuns.find((r) => r.id === runId);
					if (run) {
						run.currentStep = stepIdx + 1;
						if (run.stepResults) {
							while (run.stepResults.length <= stepIdx) run.stepResults.push({ success: false });
							run.stepResults[stepIdx] = {
								...run.stepResults[stepIdx],
								success: stepSuccess,
								stepsUsed: (msg.stepsUsed as number) ?? 0
							};
						}
						workflowRuns = [...workflowRuns];
					}
					// Update live workflow run
					if (liveWorkflowRun && liveWorkflowRun.runId === runId) {
						const newResults = [...liveWorkflowRun.stepResults];
						newResults[stepIdx] = {
							success: stepSuccess,
							stepsUsed: (msg.stepsUsed as number) ?? 0,
							resolvedBy: (msg.resolvedBy as string) ?? undefined,
							error: (msg.error as string) ?? undefined,
							message: (msg.message as string) ?? undefined,
						};
						liveWorkflowRun = { ...liveWorkflowRun, stepResults: newResults };
					}
					break;
				}
				case 'workflow_completed': {
					const completedRunId = msg.runId as string;
					// Clean up live progress
					if (workflowLiveProgress[completedRunId]) {
						const { [completedRunId]: _, ...rest } = workflowLiveProgress;
						workflowLiveProgress = rest;
					}
					workflowPageCache.clear();
					if (workflowsLoaded) loadWorkflowRuns(undefined, true);
					// Update live run status
					if (liveWorkflowRun && liveWorkflowRun.runId === completedRunId) {
						const wfSuccess = msg.success as boolean;
						liveWorkflowRun = {
							...liveWorkflowRun,
							status: wfSuccess ? 'completed' : 'failed',
							activeStepIndex: -1,
						};
						// Clear sessionStorage for completed runs
						saveLiveRun(null);
					}
					// Clear card-lift state and refresh cached flows (stats may have changed)
					if (runningCachedFlowId) {
						runningCachedFlowId = null;
						loadCachedFlows().catch(() => {});
					}
					break;
				}
				case 'workflow_stopped': {
					const stoppedRunId = msg.runId as string;
					if (workflowLiveProgress[stoppedRunId]) {
						const { [stoppedRunId]: _, ...rest } = workflowLiveProgress;
						workflowLiveProgress = rest;
					}
					workflowPageCache.clear();
					if (workflowsLoaded) loadWorkflowRuns(undefined, true);
					if (liveWorkflowRun && liveWorkflowRun.runId === stoppedRunId) {
						liveWorkflowRun = { ...liveWorkflowRun, status: 'stopped', activeStepIndex: -1 };
						// Clear sessionStorage for stopped runs
						saveLiveRun(null);
					}
					if (runningCachedFlowId) {
						runningCachedFlowId = null;
						loadCachedFlows().catch(() => {});
					}
					break;
				}
				case 'cached_flow_compiled': {
					if (msg.deviceId === deviceId) {
						const goalKey = msg.goalKey as string;
						track(DEVICE_CACHED_FLOW_COMPILED, { goalKey });
						toast.success('Workflow saved', `"${goalKey}" is now cached for instant replay`);
						loadCachedFlows().catch(() => {});
					}
					break;
				}
			}
		});
		return unsub;
	});

	// ─── Context ────────────────────────────────────────────────
	// Expose shared state to child pages via Svelte context.
	// We use $derived getters so children always see the latest reactive values.

	setDeviceContext({
		get deviceId() { return deviceId; },
		get deviceData() { return deviceData; },
		get battery() { return battery; },
		get charging() { return charging; },
		get liveWorkflowRun() { return liveWorkflowRun; },
		get cachedFlows() { return cachedFlows; },
		get cachedFlowsLoaded() { return cachedFlowsLoaded; },
		get runningCachedFlowId() { return runningCachedFlowId; },
		get runningCachedFlow() { return runningCachedFlow; },
		get queuedItems() { return queuedItems; },
		get workflowRuns() { return workflowRuns; },
		get workflowLiveProgress() { return workflowLiveProgress; },
		get workflowsLoaded() { return workflowsLoaded; },
		get workflowsPage() { return workflowsPage; },
		get workflowsTotalPages() { return workflowsTotalPages; },
		get selectedRunId() { return selectedRunId; },
		get selectedRunDetail() { return selectedRunDetail; },
		get selectedRunLoading() { return selectedRunLoading; },
		handleWorkflowSubmit,
		handleWorkflowStop,
		handleCachedFlowRun,
		handleCachedFlowDelete,
		handleQueueCancel,
		handleLogPageChange,
		loadSessionSteps,
		selectRun,
	});
</script>

<!-- Device Header -->
<DeviceHeader {deviceData} {deviceId} {battery} {charging} />

<!-- Tab Navigation (shadcn Tabs, URL-driven) -->
<div class="mb-6">
	<div class="flex gap-1 rounded-full bg-white p-1">
		{#each tabs as tab}
			<a
				href={tab.href}
				onclick={(e) => { e.preventDefault(); navigateTab(tab); }}
				class="flex flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors
					{activeTab === tab.id
					? 'bg-stone-900 text-white'
					: 'text-stone-500 hover:text-stone-700'}"
			>
				<Icon
					icon={tab.icon}
					class="h-4 w-4 {activeTab === tab.id ? 'text-white' : 'text-stone-400'}"
				/>
				{tab.label}
				{#if tab.id === 'home' && liveWorkflowRun?.status === 'running'}
					<span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400"></span>
				{/if}
			</a>
		{/each}
	</div>
</div>

<!-- Child page (Home or Log) -->
{@render children?.()}
