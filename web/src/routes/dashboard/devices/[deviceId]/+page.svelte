<script lang="ts">
	import { page } from '$app/state';
	import {
		getDevice,
		listDeviceSessions,
		listSessionSteps,
		getDeviceStats,
		listWorkflowRuns,
		submitGoal as submitGoalCmd,
		stopGoal as stopGoalCmd,
		investigateSession as investigateSessionCmd,
		deleteAppHint as deleteAppHintCmd,
		cancelScheduledGoal
	} from '$lib/api/devices.remote';
	import { dashboardWs } from '$lib/stores/dashboard-ws.svelte';
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { track } from '$lib/analytics/track';
	import { renderAsciiScreen } from '$lib/utils/ascii-screen';
	import {
		DEVICE_TAB_CHANGE,
		DEVICE_GOAL_SUBMIT,
		DEVICE_GOAL_STOP,
		DEVICE_GOAL_COMPLETE,
		DEVICE_SESSION_EXPAND,
		DEVICE_WORKFLOW_EXPAND
	} from '$lib/analytics/events';

	const deviceId = page.params.deviceId!;

	// Tabs
	const tabs = [
		{ id: 'overview' as const, label: 'Overview', icon: 'solar:info-circle-bold-duotone' },
		{ id: 'goals' as const, label: 'Goals', icon: 'solar:history-bold-duotone' },
		{ id: 'workflows' as const, label: 'Workflows', icon: 'solar:layers-bold-duotone' },
		{ id: 'run' as const, label: 'Run', icon: 'solar:play-bold-duotone' }
	];

	// Tab deeplinking via URL search params
	const urlTab = new URL(page.url).searchParams.get('tab');
	let activeTab = $state<'overview' | 'goals' | 'workflows' | 'run'>(
		tabs.some((t) => t.id === urlTab) ? (urlTab as 'overview' | 'goals' | 'workflows' | 'run') : 'overview'
	);
	const urlPage = Number(new URL(page.url).searchParams.get('page')) || 1;

	function setTab(tabId: typeof activeTab) {
		activeTab = tabId;
		const u = new URL(window.location.href);
		u.searchParams.set('tab', tabId);
		u.searchParams.delete('page'); // reset page on tab switch
		history.replaceState({}, '', u);
		track(DEVICE_TAB_CHANGE, { tab: tabId });
		if (tabId === 'workflows' && !workflowsLoaded) loadWorkflowRuns();
	}

	// Device data from DB
	const deviceData = (await getDevice(deviceId)) as {
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
		installedApps: Array<{ packageName: string; label: string }>;
	} | null;

	// Device stats
	const stats = (await getDeviceStats(deviceId)) as {
		totalSessions: number;
		successRate: number;
		avgSteps: number;
	} | null;

	// Session history
	interface Session {
		id: string;
		goal: string;
		status: string;
		stepsUsed: number | null;
		startedAt: Date;
		completedAt: Date | null;
		scheduledFor: Date | null;
		scheduledDelay: number | null;
	}
	interface Step {
		id: string;
		stepNumber: number;
		action: unknown;
		reasoning: string | null;
		result: string | null;
	}
	const initialResult = await listDeviceSessions({ deviceId, page: urlTab === 'goals' ? urlPage : 1 });
	let sessions = $state<Session[]>(initialResult.items as Session[]);
	let goalsPage = $state(urlTab === 'goals' ? urlPage : 1);
	let goalsTotalPages = $state(Math.ceil(initialResult.total / 20) || 1);
	let expandedSession = $state<string | null>(null);
	let sessionSteps = $state<Map<string, Step[]>>(new Map());

	// Investigate state
	let investigating = $state<string | null>(null);
	let investigateResults = $state<
		Map<string, { packageName: string; hints: { id: string; hint: string }[]; analysis: string }>
	>(new Map());
	let investigateError = $state<string | null>(null);

	// Workflow runs state
	interface WorkflowStepConfig {
		goal: string;
		app?: string;
		maxSteps?: number;
		retries?: number;
	}
	interface StepResult {
		goal?: string;
		command?: string;
		success: boolean;
		stepsUsed?: number;
		sessionId?: string;
		resolvedBy?: string;
		message?: string;
		error?: string;
		observations?: Array<{ stepNumber?: number; elements: unknown[]; packageName?: string; activityName?: string }>;
	}
	interface WorkflowRun {
		id: string;
		name: string;
		type: string;
		status: string;
		totalSteps: number;
		currentStep: number | null;
		steps: Array<WorkflowStepConfig | string | Record<string, unknown>>;
		stepResults: StepResult[] | null;
		startedAt: Date;
		completedAt: Date | null;
	}
	let workflowRuns = $state<WorkflowRun[]>([]);
	let expandedWorkflow = $state<string | null>(null);
	let expandedElementSets = $state<Set<string>>(new Set());
	let asciiViewKeys = $state<Set<string>>(new Set());
	let workflowsLoaded = $state(false);
	let workflowsPage = $state(urlTab === 'workflows' ? urlPage : 1);
	let workflowsTotalPages = $state(1);

	// Modal state for step deep-dive
	let modalStep = $state<{ run: WorkflowRun; stepIdx: number; stepResult: StepResult; config: WorkflowStepConfig | null } | null>(null);
	let modalSteps = $state<Step[]>([]);
	let modalStepsLoading = $state(false);

	async function loadGoals(p: number) {
		goalsPage = p;
		const result = await listDeviceSessions({ deviceId, page: p });
		sessions = result.items as Session[];
		goalsTotalPages = Math.ceil(result.total / 20) || 1;
		const u = new URL(window.location.href);
		u.searchParams.set('tab', 'goals');
		if (p > 1) {
			u.searchParams.set('page', String(p));
		} else {
			u.searchParams.delete('page');
		}
		history.replaceState({}, '', u);
	}

	async function loadWorkflowRuns(p?: number) {
		if (p !== undefined) workflowsPage = p;
		const result = await listWorkflowRuns({ deviceId, page: workflowsPage });
		workflowRuns = result.items as WorkflowRun[];
		workflowsTotalPages = Math.ceil(result.total / 20) || 1;
		workflowsLoaded = true;
		const u = new URL(window.location.href);
		u.searchParams.set('tab', 'workflows');
		if (workflowsPage > 1) {
			u.searchParams.set('page', String(workflowsPage));
		} else {
			u.searchParams.delete('page');
		}
		history.replaceState({}, '', u);
	}

	function toggleWorkflow(runId: string) {
		if (expandedWorkflow === runId) {
			expandedWorkflow = null;
		} else {
			expandedWorkflow = runId;
			track(DEVICE_WORKFLOW_EXPAND);
		}
	}

	function getStepConfig(run: WorkflowRun, stepIdx: number): WorkflowStepConfig | null {
		const step = run.steps?.[stepIdx];
		if (!step) return null;
		if (typeof step === 'string') return { goal: step };
		if (typeof step === 'object' && 'goal' in step) return step as WorkflowStepConfig;
		const [cmd, val] = Object.entries(step)[0] ?? [];
		return cmd ? { goal: `${cmd}: ${val}` } : null;
	}

	async function openStepModal(run: WorkflowRun, stepIdx: number) {
		const stepResult = run.stepResults?.[stepIdx];
		if (!stepResult) return;
		const config = getStepConfig(run, stepIdx);
		modalStep = { run, stepIdx, stepResult, config };
		modalSteps = [];
		modalStepsLoading = false;

		// Load agent steps if we have a sessionId
		if (stepResult.sessionId) {
			modalStepsLoading = true;
			try {
				const loaded = await listSessionSteps({ deviceId, sessionId: stepResult.sessionId });
				modalSteps = loaded as Step[];
			} catch {
				// ignore
			}
			modalStepsLoading = false;
		}
	}

	function closeStepModal() {
		modalStep = null;
		modalSteps = [];
	}

	function formatDuration(startedAt: Date | string, completedAt: Date | string | null): string {
		if (!completedAt) return 'running...';
		const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
		const secs = Math.floor(ms / 1000);
		if (secs < 60) return `${secs}s`;
		const mins = Math.floor(secs / 60);
		const remSecs = secs % 60;
		return `${mins}m${remSecs > 0 ? `${remSecs}s` : ''}`;
	}

	async function handleInvestigate(sessionId: string) {
		investigating = sessionId;
		investigateError = null;
		try {
			const result = (await investigateSessionCmd({ sessionId })) as {
				packageName: string;
				hints: { id: string; hint: string }[];
				analysis: string;
			};
			investigateResults.set(sessionId, result);
			investigateResults = new Map(investigateResults);
		} catch (e: any) {
			investigateError = e.message ?? String(e);
		} finally {
			investigating = null;
		}
	}

	async function handleDeleteHint(sessionId: string, hintId: string) {
		try {
			await deleteAppHintCmd({ hintId });
			const result = investigateResults.get(sessionId);
			if (result) {
				result.hints = result.hints.filter((h) => h.id !== hintId);
				investigateResults = new Map(investigateResults);
			}
		} catch {
			// ignore
		}
	}

	// Run tab state
	let goal = $state('');
	let runStatus = $state<'idle' | 'running' | 'completed' | 'failed'>('idle');

	const exampleGoals = [
		'Open YouTube and search for lofi beats',
		'Open Settings and enable Wi-Fi',
		'Open Google Maps and search for nearby coffee shops',
		'Open the calculator and compute 42 x 17',
		'Take a screenshot and save it',
		'Open Chrome and search for today\'s weather'
	];
	let currentGoal = $state('');
	let steps = $state<Array<{ step: number; action: string; reasoning: string }>>([]);

	// Real-time battery from WS
	let liveBattery = $state<number | null>(null);
	let liveCharging = $state(false);

	async function toggleSession(sessionId: string) {
		if (expandedSession === sessionId) {
			expandedSession = null;
			return;
		}
		expandedSession = sessionId;
		track(DEVICE_SESSION_EXPAND);
		if (!sessionSteps.has(sessionId)) {
			const loadedSteps = await listSessionSteps({ deviceId, sessionId });
			sessionSteps.set(sessionId, loadedSteps as Step[]);
			sessionSteps = new Map(sessionSteps);
		}
	}

	let runError = $state('');

	async function submitGoal() {
		if (!goal.trim()) return;
		runStatus = 'running';
		runError = '';
		currentGoal = goal;
		steps = [];
		track(DEVICE_GOAL_SUBMIT);

		try {
			await submitGoalCmd({ deviceId, goal });
		} catch (e: any) {
			runError = e.message ?? String(e);
			runStatus = 'failed';
		}
	}

	async function stopGoal() {
		try {
			await stopGoalCmd({ deviceId });
			runStatus = 'failed';
			runError = 'Stopped by user';
			track(DEVICE_GOAL_STOP);
		} catch {
			// ignore
		}
	}

	onMount(() => {
		// Load workflows if deeplinked to workflows tab
		if (activeTab === 'workflows' && !workflowsLoaded) {
			loadWorkflowRuns(urlPage);
		}

		const unsub = dashboardWs.subscribe((msg) => {
			switch (msg.type) {
				case 'device_status': {
					if (msg.deviceId === deviceId) {
						liveBattery = msg.batteryLevel as number;
						liveCharging = msg.isCharging as boolean;
					}
					break;
				}
				case 'goal_started': {
					if (msg.deviceId === deviceId) {
						runStatus = 'running';
						currentGoal = msg.goal as string;
						steps = [];
						activeTab = 'run';
					}
					break;
				}
				case 'step': {
					const action = msg.action as Record<string, unknown>;
					const actionStr = action?.action
						? `${action.action}${action.coordinates ? `(${(action.coordinates as number[]).join(',')})` : ''}`
						: JSON.stringify(action);
					steps = [
						...steps,
						{
							step: msg.step as number,
							action: actionStr,
							reasoning: (msg.reasoning as string) ?? ''
						}
					];
					break;
				}
				case 'goal_completed': {
					const success = msg.success as boolean;
					runStatus = success ? 'completed' : 'failed';
					track(DEVICE_GOAL_COMPLETE, { success });
					listDeviceSessions({ deviceId, page: goalsPage }).then((r) => {
						sessions = r.items as Session[];
						goalsTotalPages = Math.ceil(r.total / 20) || 1;
					});
					break;
				}
				case 'goal_scheduled': {
					listDeviceSessions({ deviceId, page: goalsPage }).then((r) => {
						sessions = r.items as Session[];
						goalsTotalPages = Math.ceil(r.total / 20) || 1;
					});
					break;
				}
				case 'goal_cancelled': {
					listDeviceSessions({ deviceId, page: goalsPage }).then((r) => {
						sessions = r.items as Session[];
						goalsTotalPages = Math.ceil(r.total / 20) || 1;
					});
					break;
				}
				case 'workflow_started': {
					if (workflowsLoaded) {
						loadWorkflowRuns();
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
							// Ensure we have enough entries
							while (run.stepResults.length <= stepIdx) {
								run.stepResults.push({ success: false });
							}
							run.stepResults[stepIdx] = {
								...run.stepResults[stepIdx],
								success: stepSuccess,
								stepsUsed: (msg.stepsUsed as number) ?? 0
							};
						}
						workflowRuns = [...workflowRuns];
					}
					break;
				}
				case 'workflow_completed': {
					if (workflowsLoaded) {
						loadWorkflowRuns();
					}
					break;
				}
			}
		});
		return unsub;
	});

	function formatTime(d: string | Date) {
		return (d instanceof Date ? d : new Date(d)).toLocaleString();
	}

	function relativeTime(iso: string) {
		const diff = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		return `${days}d ago`;
	}

	let appSearch = $state('');
	const filteredApps = $derived(
		(deviceData?.installedApps ?? []).filter(
			(a) =>
				!appSearch ||
				a.label.toLowerCase().includes(appSearch.toLowerCase()) ||
				a.packageName.toLowerCase().includes(appSearch.toLowerCase())
		)
	);

	const battery = $derived(liveBattery ?? (deviceData?.batteryLevel as number | null));
	const charging = $derived(liveCharging || (deviceData?.isCharging as boolean));
</script>

<!-- Header -->
<div class="mb-6 flex items-center gap-3">
	<a
		href="/dashboard/devices"
		class="flex h-9 w-9 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-white hover:text-stone-600"
	>
		<Icon icon="solar:alt-arrow-left-linear" class="h-5 w-5" />
	</a>
	<div class="flex items-center gap-3">
		<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full {deviceData?.status === 'online' ? 'bg-emerald-100' : 'bg-stone-200'}">
			<Icon icon="solar:smartphone-bold-duotone" class="h-5 w-5 {deviceData?.status === 'online' ? 'text-emerald-600' : 'text-stone-400'}" />
		</div>
		<div>
			<h2 class="text-xl md:text-2xl font-bold">{deviceData?.model ?? deviceId.slice(0, 8)}</h2>
			{#if deviceData?.manufacturer}
				<p class="text-sm text-stone-500">{deviceData.manufacturer}</p>
			{/if}
		</div>
		<span
			class="ml-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium
				{deviceData?.status === 'online'
				? 'bg-emerald-50 text-emerald-700'
				: 'bg-stone-200 text-stone-500'}"
		>
			<span
				class="inline-block h-1.5 w-1.5 rounded-full {deviceData?.status === 'online'
					? 'bg-emerald-500'
					: 'bg-stone-400'}"
			></span>
			{deviceData?.status === 'online' ? 'Online' : 'Offline'}
		</span>
	</div>
</div>

<!-- Tabs -->
<div class="mb-6 flex gap-1 rounded-full bg-white p-1">
	{#each tabs as tab}
		<button
			onclick={() => setTab(tab.id)}
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
			{#if tab.id === 'run' && runStatus === 'running'}
				<span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400"></span>
			{/if}
		</button>
	{/each}
</div>

<!-- Overview Tab -->
{#if activeTab === 'overview'}
	<div class="grid gap-4 sm:grid-cols-2">
		<!-- Device Specs -->
		<div>
			<p class="mb-3 text-sm font-medium text-stone-500">Device info</p>
			<div class="rounded-2xl bg-white">
				{#if deviceData?.model}
					<div class="flex justify-between px-4 md:px-6 py-3.5 text-sm">
						<span class="text-stone-500">Model</span>
						<span class="font-medium text-stone-900">{deviceData.model}</span>
					</div>
				{/if}
				{#if deviceData?.manufacturer}
					<div class="flex justify-between border-t border-stone-100 px-4 md:px-6 py-3.5 text-sm">
						<span class="text-stone-500">Manufacturer</span>
						<span class="font-medium text-stone-900">{deviceData.manufacturer}</span>
					</div>
				{/if}
				{#if deviceData?.androidVersion}
					<div class="flex justify-between border-t border-stone-100 px-4 md:px-6 py-3.5 text-sm">
						<span class="text-stone-500">Android</span>
						<span class="font-medium text-stone-900">{deviceData.androidVersion}</span>
					</div>
				{/if}
				{#if deviceData?.screenWidth && deviceData?.screenHeight}
					<div class="flex justify-between border-t border-stone-100 px-4 md:px-6 py-3.5 text-sm">
						<span class="text-stone-500">Resolution</span>
						<span class="font-medium text-stone-900">{deviceData.screenWidth} &times; {deviceData.screenHeight}</span>
					</div>
				{/if}
				{#if battery !== null && battery >= 0}
					<div class="flex justify-between border-t border-stone-100 px-4 md:px-6 py-3.5 text-sm">
						<span class="text-stone-500">Battery</span>
						<span class="flex items-center gap-1.5 font-medium {battery <= 20 ? 'text-red-600' : 'text-stone-900'}">
							<Icon
								icon={charging ? 'solar:battery-charge-bold-duotone' : battery > 50 ? 'solar:battery-full-bold-duotone' : 'solar:battery-low-bold-duotone'}
								class="h-4 w-4"
							/>
							{battery}%{charging ? ' Charging' : ''}
						</span>
					</div>
				{/if}
				<div class="flex justify-between border-t border-stone-100 px-4 md:px-6 py-3.5 text-sm">
					<span class="text-stone-500">Last seen</span>
					<span class="font-medium text-stone-900">
						{deviceData ? relativeTime(deviceData.lastSeen) : '\u2014'}
					</span>
				</div>
			</div>
		</div>

		<!-- Stats -->
		<div>
			<p class="mb-3 text-sm font-medium text-stone-500">Stats</p>
			<div class="rounded-2xl bg-white p-5">
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
					<div class="rounded-xl bg-stone-50 p-4">
						<div class="mb-1.5 flex justify-center">
							<div class="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100">
								<Icon icon="solar:layers-bold-duotone" class="h-4 w-4 text-blue-600" />
							</div>
						</div>
						<p class="text-2xl font-bold text-stone-900">{stats?.totalSessions ?? 0}</p>
						<p class="text-xs text-stone-500">Goals</p>
					</div>
					<div class="rounded-xl bg-stone-50 p-4">
						<div class="mb-1.5 flex justify-center">
							<div class="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100">
								<Icon icon="solar:chart-2-bold-duotone" class="h-4 w-4 text-emerald-600" />
							</div>
						</div>
						<p class="text-2xl font-bold text-stone-900">{stats?.successRate ?? 0}%</p>
						<p class="text-xs text-stone-500">Success</p>
					</div>
					<div class="rounded-xl bg-stone-50 p-4">
						<div class="mb-1.5 flex justify-center">
							<div class="flex h-9 w-9 items-center justify-center rounded-full bg-purple-100">
								<Icon icon="solar:routing-bold-duotone" class="h-4 w-4 text-purple-600" />
							</div>
						</div>
						<p class="text-2xl font-bold text-stone-900">{stats?.avgSteps ?? 0}</p>
						<p class="text-xs text-stone-500">Avg Steps</p>
					</div>
				</div>
			</div>
		</div>
	</div>

	<!-- Installed Apps -->
	{#if deviceData && deviceData.installedApps.length > 0}
		<div class="mt-6">
			<div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<p class="text-sm font-medium text-stone-500">
					Installed apps
					<span class="text-stone-400">({deviceData.installedApps.length})</span>
				</p>
				<div class="relative">
					<Icon
						icon="solar:magnifer-bold-duotone"
						class="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-stone-400"
					/>
					<input
						type="text"
						bind:value={appSearch}
						placeholder="Search apps..."
						class="w-full sm:w-48 rounded-lg border border-stone-200 bg-white py-1.5 pl-8 pr-2.5 text-xs focus:border-stone-400 focus:outline-none"
					/>
				</div>
			</div>
			<div class="max-h-72 overflow-y-auto rounded-2xl bg-white">
				{#each filteredApps as app, i (app.packageName)}
					<div
						class="flex items-center justify-between px-4 md:px-6 py-3 text-sm hover:bg-stone-50
							{i > 0 ? 'border-t border-stone-100' : ''}"
					>
						<span class="font-medium text-stone-900">{app.label}</span>
						<span class="font-mono text-xs text-stone-400">{app.packageName}</span>
					</div>
				{:else}
					<p class="px-4 md:px-6 py-4 text-xs text-stone-400">No apps match "{appSearch}"</p>
				{/each}
			</div>
		</div>
	{/if}

<!-- Goals Tab -->
{:else if activeTab === 'goals'}
	{#if sessions.length === 0}
		<div class="rounded-2xl bg-white p-10 text-center">
			<div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-stone-100">
				<Icon icon="solar:history-bold-duotone" class="h-6 w-6 text-stone-400" />
			</div>
			<p class="text-sm text-stone-500">No goals yet. Go to the Run tab to send a goal.</p>
		</div>
	{:else}
		<p class="mb-3 text-sm font-medium text-stone-500">Goal history</p>
		<div class="rounded-2xl bg-white">
			{#each sessions as sess, i (sess.id)}
				<div class={i > 0 ? 'border-t border-stone-100' : ''}>
					<button
						onclick={() => toggleSession(sess.id)}
						class="flex w-full items-center justify-between px-4 md:px-6 py-4 text-left transition-colors hover:bg-stone-50
							{i === 0 ? 'rounded-t-2xl' : ''}
							{i === sessions.length - 1 && expandedSession !== sess.id ? 'rounded-b-2xl' : ''}"
					>
						<div class="min-w-0 flex-1">
							<p class="truncate text-sm font-medium text-stone-900">{sess.goal}</p>
							<p class="mt-0.5 flex items-center gap-1.5 text-xs text-stone-400">
								<Icon icon="solar:clock-circle-bold-duotone" class="h-3.5 w-3.5" />
								{#if sess.status === 'scheduled' && sess.scheduledFor}
									Scheduled for {new Date(sess.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
								{:else}
									{formatTime(sess.startedAt)} &middot; {sess.stepsUsed} steps
								{/if}
							</p>
						</div>
						<span
							class="ml-3 flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium
								{sess.status === 'completed' ? 'bg-emerald-50 text-emerald-700'
								: sess.status === 'running' ? 'bg-amber-50 text-amber-700'
								: sess.status === 'scheduled' ? 'bg-blue-50 text-blue-700'
								: sess.status === 'cancelled' ? 'bg-stone-100 text-stone-500'
								: 'bg-red-50 text-red-700'}"
						>
							<Icon
								icon={sess.status === 'completed' ? 'solar:check-circle-bold-duotone'
									: sess.status === 'running' ? 'solar:refresh-circle-bold-duotone'
									: sess.status === 'scheduled' ? 'solar:clock-circle-bold-duotone'
									: sess.status === 'cancelled' ? 'solar:close-circle-bold-duotone'
									: 'solar:close-circle-bold-duotone'}
								class="h-3.5 w-3.5"
							/>
							{sess.status === 'completed' ? 'Success'
								: sess.status === 'running' ? 'Running'
								: sess.status === 'scheduled' ? 'Scheduled'
								: sess.status === 'cancelled' ? 'Cancelled'
								: 'Failed'}
						</span>
					</button>
					{#if expandedSession === sess.id}
						<div class="border-t border-stone-100 bg-stone-50 px-4 md:px-6 py-4
							{i === sessions.length - 1 ? 'rounded-b-2xl' : ''}">
							{#if sess.status === 'scheduled'}
								<div class="flex items-center gap-3 py-2">
									<Icon icon="solar:clock-circle-bold-duotone" class="h-5 w-5 text-blue-500" />
									<div class="flex-1">
										<p class="text-sm font-medium text-stone-700">
											Fires at {sess.scheduledFor ? new Date(sess.scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'unknown'}
										</p>
										<p class="text-xs text-stone-400">
											{sess.scheduledDelay ? `${Math.ceil(sess.scheduledDelay / 60)} min delay` : ''}
										</p>
									</div>
									<button
										onclick={async () => {
											await cancelScheduledGoal({ sessionId: sess.id });
											const r = await listDeviceSessions({ deviceId, page: goalsPage });
											sessions = r.items as Session[];
											goalsTotalPages = Math.ceil(r.total / 20) || 1;
										}}
										class="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
									>
										Cancel
									</button>
								</div>
							{:else if sessionSteps.has(sess.id)}
								<div class="space-y-2.5">
									{#each sessionSteps.get(sess.id) ?? [] as s (s.id)}
										{@const action = typeof s.action === 'object' && s.action !== null ? (s.action as Record<string, unknown>) : null}
										{@const actionType = action?.action as string ?? (typeof s.action === 'string' ? s.action : 'unknown')}
										{@const coords = action?.coordinates as number[] | undefined}
										{@const text = action?.text as string | undefined}
										{@const direction = action?.direction as string | undefined}
										<div class="flex items-start gap-2.5">
											<span
												class="mt-0.5 shrink-0 rounded-full bg-stone-200 px-2 py-0.5 font-mono text-[10px] text-stone-500"
											>
												{s.stepNumber}
											</span>
											<div class="min-w-0 flex-1">
												<div class="flex flex-wrap items-center gap-1.5">
													<span class="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide
														{actionType === 'tap' ? 'bg-blue-100 text-blue-700'
														: actionType === 'type' ? 'bg-violet-100 text-violet-700'
														: actionType === 'swipe' || actionType === 'scroll' ? 'bg-amber-100 text-amber-700'
														: actionType === 'back' || actionType === 'home' ? 'bg-stone-200 text-stone-600'
														: actionType === 'done' ? 'bg-emerald-100 text-emerald-700'
														: actionType === 'wait' ? 'bg-cyan-100 text-cyan-700'
														: actionType === 'long_press' ? 'bg-pink-100 text-pink-700'
														: 'bg-stone-100 text-stone-600'}">
														{actionType}
													</span>
													{#if coords && coords.length >= 2}
														<span class="font-mono text-[11px] text-stone-400">({coords[0]}, {coords[1]})</span>
													{/if}
													{#if text}
														<span class="rounded bg-white px-1.5 py-0.5 text-[11px] text-stone-700">"{text}"</span>
													{/if}
													{#if direction}
														<span class="text-[11px] text-stone-400">{direction}</span>
													{/if}
												</div>
												{#if s.reasoning}
													<p class="mt-0.5 truncate text-xs text-stone-400">
														{s.reasoning}
													</p>
												{/if}
											</div>
										</div>
									{/each}
								</div>

								<!-- Investigate & Fix -->
								{#if sess.status === 'completed' || sess.status === 'failed'}
									<div class="mt-4 border-t border-stone-200 pt-4">
										{#if investigateResults.has(sess.id)}
											{@const result = investigateResults.get(sess.id)!}
											<div class="space-y-3">
												<div class="flex items-center gap-2">
													<Icon icon="solar:cpu-bolt-bold-duotone" class="h-4 w-4 text-violet-600" />
													<span class="text-xs font-medium text-violet-700">Analysis</span>
													<span class="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-medium text-violet-600">
														{result.packageName}
													</span>
												</div>
												{#if result.analysis}
													<p class="text-xs text-stone-600">{result.analysis}</p>
												{/if}
												<div class="space-y-1.5">
													{#each result.hints as hint (hint.id)}
														<div class="flex items-start gap-2 rounded-lg bg-white px-3 py-2">
															<Icon icon="solar:lightbulb-bolt-bold-duotone" class="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
															<span class="flex-1 text-xs text-stone-700">{hint.hint}</span>
															<button
																onclick={() => handleDeleteHint(sess.id, hint.id)}
																class="shrink-0 text-stone-300 transition-colors hover:text-red-500"
																title="Remove hint"
															>
																<Icon icon="solar:trash-bin-minimalistic-bold-duotone" class="h-3.5 w-3.5" />
															</button>
														</div>
													{/each}
												</div>
											</div>
										{:else}
											<button
												onclick={() => handleInvestigate(sess.id)}
												disabled={investigating === sess.id}
												class="flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
											>
												{#if investigating === sess.id}
													<Icon icon="solar:refresh-circle-bold-duotone" class="h-3.5 w-3.5 animate-spin" />
													Analyzing...
												{:else}
													<Icon icon="solar:cpu-bolt-bold-duotone" class="h-3.5 w-3.5" />
													Investigate & Fix
												{/if}
											</button>
											{#if investigateError && investigating === null}
												<p class="mt-2 text-xs text-red-600">{investigateError}</p>
											{/if}
										{/if}
									</div>
								{/if}
							{:else}
								<p class="text-xs text-stone-400">Loading steps...</p>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
		{#if goalsTotalPages > 1}
			<div class="mt-3 flex items-center justify-between rounded-2xl bg-white px-4 md:px-6 py-3">
				<button onclick={() => loadGoals(goalsPage - 1)} disabled={goalsPage <= 1}
					class="text-sm text-stone-500 hover:text-stone-700 disabled:opacity-30 transition-colors">
					← Previous
				</button>
				<span class="text-xs text-stone-400">Page {goalsPage} of {goalsTotalPages}</span>
				<button onclick={() => loadGoals(goalsPage + 1)} disabled={goalsPage >= goalsTotalPages}
					class="text-sm text-stone-500 hover:text-stone-700 disabled:opacity-30 transition-colors">
					Next →
				</button>
			</div>
		{/if}
	{/if}

<!-- Workflows Tab -->
{:else if activeTab === 'workflows'}
	{#if !workflowsLoaded}
		<div class="rounded-2xl bg-white p-10 text-center">
			<Icon icon="solar:refresh-circle-bold-duotone" class="mx-auto mb-3 h-6 w-6 animate-spin text-stone-400" />
			<p class="text-sm text-stone-500">Loading workflows...</p>
		</div>
	{:else if workflowRuns.length === 0}
		<div class="rounded-2xl bg-white p-10 text-center">
			<div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-stone-100">
				<Icon icon="solar:layers-bold-duotone" class="h-6 w-6 text-stone-400" />
			</div>
			<p class="text-sm text-stone-500">No workflow runs yet. Trigger a workflow via the API.</p>
		</div>
	{:else}
		<p class="mb-3 text-sm font-medium text-stone-500">Workflow runs</p>
		<div class="space-y-3">
			{#each workflowRuns as run (run.id)}
				<div class="rounded-2xl bg-white">
					<!-- Workflow header -->
					<button
						onclick={() => toggleWorkflow(run.id)}
						class="flex w-full items-center justify-between rounded-2xl px-4 md:px-6 py-4 text-left transition-colors hover:bg-stone-50"
					>
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<Icon
									icon={run.type === 'flow' ? 'solar:programming-bold-duotone' : 'solar:layers-bold-duotone'}
									class="h-4 w-4 shrink-0 {run.status === 'completed' ? 'text-emerald-500' : run.status === 'running' ? 'text-amber-500' : 'text-red-500'}"
								/>
								<p class="truncate text-sm font-medium text-stone-900">{run.name}</p>
							</div>
							<p class="mt-0.5 flex items-center gap-1.5 pl-6 text-xs text-stone-400">
								<Icon icon="solar:clock-circle-bold-duotone" class="h-3.5 w-3.5" />
								{formatTime(run.startedAt)}
								<span class="text-stone-300">&middot;</span>
								{run.totalSteps} goal{run.totalSteps !== 1 ? 's' : ''}
								<span class="text-stone-300">&middot;</span>
								{formatDuration(run.startedAt, run.completedAt)}
							</p>
						</div>
						<div class="ml-3 flex shrink-0 items-center gap-2">
							<span
								class="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium
									{run.status === 'completed' ? 'bg-emerald-50 text-emerald-700'
									: run.status === 'running' ? 'bg-amber-50 text-amber-700'
									: run.status === 'stopped' ? 'bg-stone-100 text-stone-500'
									: 'bg-red-50 text-red-700'}"
							>
								<Icon
									icon={run.status === 'completed' ? 'solar:check-circle-bold-duotone'
										: run.status === 'running' ? 'solar:refresh-circle-bold-duotone'
										: 'solar:close-circle-bold-duotone'}
									class="h-3.5 w-3.5 {run.status === 'running' ? 'animate-spin' : ''}"
								/>
								{run.status === 'completed' ? 'Completed'
									: run.status === 'running' ? 'Running'
									: run.status === 'stopped' ? 'Stopped'
									: 'Failed'}
							</span>
							<Icon
								icon={expandedWorkflow === run.id ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'}
								class="h-4 w-4 text-stone-400"
							/>
						</div>
					</button>

					<!-- Expanded goal results -->
					{#if expandedWorkflow === run.id && run.stepResults}
						<div class="border-t border-stone-100 px-4 md:px-6 py-4">
							<div class="space-y-2">
								{#each run.stepResults as stepResult, stepIdx}
									<button
										onclick={() => openStepModal(run, stepIdx)}
										class="flex w-full items-start gap-2.5 rounded-xl bg-stone-50 px-3 py-3 text-left transition-colors hover:bg-stone-100"
									>
										<!-- Goal number badge -->
										<span
											class="mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px]
												{stepResult.success ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}"
										>
											{stepIdx + 1}
										</span>
										<!-- Full goal text -->
										<div class="min-w-0 flex-1">
											<p class="text-xs leading-relaxed text-stone-800">
												{stepResult.goal ?? stepResult.command ?? `Goal ${stepIdx + 1}`}
											</p>
											{#if stepResult.error || (stepResult.message && !stepResult.success)}
												<p class="mt-1 text-[11px] text-red-500">
													{stepResult.error ?? stepResult.message}
												</p>
											{/if}
										</div>
										<!-- Right side: status + meta -->
										<div class="flex shrink-0 flex-col items-end gap-1">
											<span class="flex items-center gap-1 text-xs font-medium {stepResult.success ? 'text-emerald-600' : 'text-red-600'}">
												<Icon
													icon={stepResult.success ? 'solar:check-circle-bold-duotone' : 'solar:close-circle-bold-duotone'}
													class="h-3.5 w-3.5"
												/>
												{stepResult.success ? 'OK' : 'Failed'}
											</span>
											{#if stepResult.stepsUsed !== undefined}
												<span class="text-[10px] text-stone-400">
													{stepResult.stepsUsed} step{stepResult.stepsUsed !== 1 ? 's' : ''}
												</span>
											{/if}
											{#if stepResult.resolvedBy}
												<span class="rounded bg-stone-200 px-1.5 py-0.5 text-[9px] text-stone-500">{stepResult.resolvedBy}</span>
											{/if}
										</div>
										<!-- Open indicator -->
										<Icon icon="solar:alt-arrow-right-linear" class="mt-0.5 h-4 w-4 shrink-0 text-stone-300" />
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>
		{#if workflowsTotalPages > 1}
			<div class="mt-3 flex items-center justify-between rounded-2xl bg-white px-4 md:px-6 py-3">
				<button onclick={() => loadWorkflowRuns(workflowsPage - 1)} disabled={workflowsPage <= 1}
					class="text-sm text-stone-500 hover:text-stone-700 disabled:opacity-30 transition-colors">
					← Previous
				</button>
				<span class="text-xs text-stone-400">Page {workflowsPage} of {workflowsTotalPages}</span>
				<button onclick={() => loadWorkflowRuns(workflowsPage + 1)} disabled={workflowsPage >= workflowsTotalPages}
					class="text-sm text-stone-500 hover:text-stone-700 disabled:opacity-30 transition-colors">
					Next →
				</button>
			</div>
		{/if}
	{/if}

<!-- Step Detail Modal -->
{#if modalStep}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onclick={closeStepModal}>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div
			class="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- Modal header -->
			<div class="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl border-b border-stone-100 bg-white px-6 py-4">
				<div class="flex items-center gap-3">
					<span
						class="rounded-full px-2.5 py-0.5 font-mono text-xs
							{modalStep.stepResult.success ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}"
					>
						Goal {modalStep.stepIdx + 1}
					</span>
					<span class="flex items-center gap-1 text-sm font-medium {modalStep.stepResult.success ? 'text-emerald-700' : 'text-red-700'}">
						<Icon
							icon={modalStep.stepResult.success ? 'solar:check-circle-bold-duotone' : 'solar:close-circle-bold-duotone'}
							class="h-4 w-4"
						/>
						{modalStep.stepResult.success ? 'Succeeded' : 'Failed'}
					</span>
				</div>
				<button onclick={closeStepModal} class="rounded-full p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600">
					<Icon icon="solar:close-circle-bold-duotone" class="h-5 w-5" />
				</button>
			</div>

			<div class="space-y-5 px-6 py-5">
				<!-- Goal -->
				<div>
					<p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">Goal</p>
					<p class="whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
						{modalStep.stepResult.goal ?? modalStep.config?.goal ?? modalStep.stepResult.command ?? 'N/A'}
					</p>
				</div>

				<!-- Step Config -->
				{#if modalStep.config}
					<div>
						<p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">Configuration</p>
						<div class="flex flex-wrap gap-2">
							{#if modalStep.config.app}
								<span class="flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-xs text-blue-700">
									<Icon icon="solar:box-bold-duotone" class="h-3.5 w-3.5" />
									{modalStep.config.app}
								</span>
							{/if}
							{#if modalStep.config.maxSteps}
								<span class="rounded-lg bg-stone-100 px-2.5 py-1 text-xs text-stone-600">Max {modalStep.config.maxSteps} steps</span>
							{/if}
							{#if modalStep.config.retries}
								<span class="rounded-lg bg-stone-100 px-2.5 py-1 text-xs text-stone-600">{modalStep.config.retries} retries</span>
							{/if}
							{#if modalStep.stepResult.resolvedBy}
								<span class="rounded-lg bg-violet-50 px-2.5 py-1 text-xs text-violet-700">Resolved by: {modalStep.stepResult.resolvedBy}</span>
							{/if}
							{#if modalStep.stepResult.stepsUsed !== undefined}
								<span class="rounded-lg bg-stone-100 px-2.5 py-1 text-xs text-stone-600">Used {modalStep.stepResult.stepsUsed} steps</span>
							{/if}
						</div>
					</div>
				{/if}

				<!-- Error -->
				{#if modalStep.stepResult.error || (modalStep.stepResult.message && !modalStep.stepResult.success)}
					<div>
						<p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-400">Error</p>
						<div class="rounded-lg bg-red-50 px-3 py-2.5">
							<p class="text-xs text-red-700">{modalStep.stepResult.error ?? modalStep.stepResult.message}</p>
						</div>
					</div>
				{/if}

				<!-- Agent Journey (steps from agentStep table) -->
				<div>
					<p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">Agent Journey</p>
					{#if modalStepsLoading}
						<div class="flex items-center gap-2 py-3 text-xs text-stone-400">
							<Icon icon="solar:refresh-circle-bold-duotone" class="h-4 w-4 animate-spin" />
							Loading steps...
						</div>
					{:else if modalSteps.length > 0}
						<div class="space-y-1.5">
							{#each modalSteps as s, sIdx (s.id)}
								{@const action = typeof s.action === 'object' && s.action !== null ? (s.action as Record<string, unknown>) : null}
								{@const actionType = action?.action as string ?? (typeof s.action === 'string' ? s.action : 'unknown')}
								{@const coords = action?.coordinates as number[] | undefined}
								{@const text = action?.text as string | undefined}
								{@const direction = action?.direction as string | undefined}
								{@const scrollAmount = action?.scrollAmount as number | undefined}
								{@const allObs = modalStep?.stepResult.observations ?? []}
								{@const hasStepNumbers = allObs.some(o => o.stepNumber != null)}
								{@const matchingObs = hasStepNumbers
									? allObs.filter(o => o.stepNumber === s.stepNumber)
									: (sIdx < allObs.length ? [allObs[sIdx]] : [])}
								<div class="rounded-lg bg-stone-50 px-3 py-2.5">
									<div class="flex items-center gap-2">
										<span class="shrink-0 rounded-full bg-stone-200 px-2 py-0.5 font-mono text-[10px] text-stone-500">
											{s.stepNumber}
										</span>
										<!-- Action type badge -->
										<span class="shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide
											{actionType === 'tap' ? 'bg-blue-100 text-blue-700'
											: actionType === 'type' ? 'bg-violet-100 text-violet-700'
											: actionType === 'swipe' || actionType === 'scroll' ? 'bg-amber-100 text-amber-700'
											: actionType === 'back' || actionType === 'home' ? 'bg-stone-200 text-stone-600'
											: actionType === 'done' ? 'bg-emerald-100 text-emerald-700'
											: actionType === 'wait' ? 'bg-cyan-100 text-cyan-700'
											: actionType === 'long_press' ? 'bg-pink-100 text-pink-700'
											: 'bg-stone-100 text-stone-600'}">
											{actionType}
										</span>
										<!-- Action parameters inline -->
										<div class="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-600">
											{#if coords && coords.length >= 2}
												<span class="font-mono text-stone-400">({coords[0]}, {coords[1]})</span>
											{/if}
											{#if text}
												<span class="rounded bg-white px-1.5 py-0.5 text-stone-700">"{text}"</span>
											{/if}
											{#if direction}
												<span class="text-stone-400">{direction}{scrollAmount ? ` ×${scrollAmount}` : ''}</span>
											{/if}
										</div>
									</div>
									{#if s.reasoning}
										<p class="mt-1 pl-8 text-xs leading-relaxed text-stone-500">{s.reasoning}</p>
									{/if}
									<!-- Inline screen observation for this step -->
									{#if matchingObs.length > 0}
										{#each matchingObs as obs, obsIdx}
											{@const asciiKey = `ascii-inline-${sIdx}-${obsIdx}`}
											{@const showAscii = asciiViewKeys.has(asciiKey)}
											<div class="mt-2 ml-8 rounded-md border border-stone-200 bg-white px-2.5 py-2">
												<div class="flex flex-wrap items-center gap-1.5 text-[10px]">
													<Icon icon="solar:monitor-smartphone-bold-duotone" class="h-3 w-3 text-blue-500" />
													{#if obs.packageName}
														<span class="font-medium text-blue-700">{obs.packageName}</span>
													{/if}
													{#if obs.activityName}
														<span class="text-stone-300">&rsaquo;</span>
														<span class="font-medium text-violet-600">{obs.activityName.split('.').pop()}</span>
													{/if}
													<span class="text-stone-300">·</span>
													<span class="text-stone-400">{obs.elements.length} element{obs.elements.length !== 1 ? 's' : ''}</span>
													{#if obs.elements.length > 0}
														<button
															class="ml-auto rounded px-1.5 py-0.5 font-medium cursor-pointer transition-colors {showAscii ? 'bg-blue-100 text-blue-700' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'}"
															onclick={() => {
																const next = new Set(asciiViewKeys);
																if (next.has(asciiKey)) next.delete(asciiKey); else next.add(asciiKey);
																asciiViewKeys = next;
															}}
														>
															{showAscii ? '☰ List' : '⊞ ASCII'}
														</button>
													{/if}
												</div>
												{#if obs.elements.length > 0}
													{#if showAscii}
														<pre class="mt-1.5 font-mono text-[9px] leading-tight overflow-x-auto bg-stone-900 text-stone-300 rounded-lg p-3">{renderAsciiScreen(obs.elements as Record<string, unknown>[], deviceData?.screenWidth ?? 1080, deviceData?.screenHeight ?? 2400)}</pre>
													{:else}
														{@const elemKey = `inline-${sIdx}-${obsIdx}`}
														{@const isExpanded = expandedElementSets.has(elemKey)}
														<div class="mt-1 space-y-0.5" class:max-h-24={!isExpanded} class:overflow-y-auto={!isExpanded}>
															{#each isExpanded ? obs.elements : obs.elements.slice(0, 15) as el}
																{@const elem = el as Record<string, unknown>}
																<p class="truncate font-mono text-[10px] text-stone-500">
																	{#if elem.type}<span class="text-stone-300">[{(elem.type as string).split('.').pop()}]</span>{/if}
																	{#if elem.action}<span class="text-amber-500/70"> {elem.action}</span>{/if}
																	{#if elem.text}<span class="text-stone-700"> "{elem.text}"</span>{/if}
																	{#if elem.hint}<span class="text-stone-400 italic"> {elem.hint}</span>{/if}
																	{#if elem.id}<span class="text-blue-400"> #{(elem.id as string).split('/').pop()}</span>{/if}
																	{#if elem.center}<span class="text-emerald-500"> @{JSON.stringify(elem.center)}</span>{/if}
																	{#if elem.bounds}<span class="text-stone-300"> [{typeof elem.bounds === 'string' ? elem.bounds : (elem.bounds as number[]).join(',')}]</span>{/if}
																	{#if elem.checked}<span class="text-orange-400"> checked</span>{/if}
																	{#if elem.focused}<span class="text-cyan-400"> focused</span>{/if}
																	{#if elem.selected}<span class="text-purple-400"> selected</span>{/if}
																	{#if elem.enabled === false}<span class="text-red-400"> disabled</span>{/if}
																	{#if elem.scrollable}<span class="text-teal-400"> scrollable</span>{/if}
																</p>
															{/each}
															{#if obs.elements.length > 15}
																<button
																	class="mt-0.5 text-[10px] text-blue-500 hover:text-blue-700 italic cursor-pointer"
																	onclick={() => {
																		const next = new Set(expandedElementSets);
																		if (next.has(elemKey)) next.delete(elemKey); else next.add(elemKey);
																		expandedElementSets = next;
																	}}
																>
																	{isExpanded ? '▲ Show fewer elements' : `... +${obs.elements.length - 15} more elements`}
																</button>
															{/if}
														</div>
													{/if}
												{/if}
											</div>
										{/each}
									{/if}
								</div>
							{/each}
						</div>
					{:else if !modalStep.stepResult.sessionId}
						<p class="text-xs text-stone-400">No session linked — resolved by {modalStep.stepResult.resolvedBy ?? 'parser/classifier'} without UI agent.</p>
					{:else}
						<p class="text-xs text-stone-400">No step data available.</p>
					{/if}
				</div>

				<!-- Unmatched Screen Observations (observations without a corresponding agent step) -->
				{#if modalStep.stepResult.observations && modalStep.stepResult.observations.length > 0}
					{@const allObs = modalStep.stepResult.observations}
					{@const hasStepNumbers = allObs.some(o => o.stepNumber != null)}
					{@const unmatchedObs = modalSteps.length > 0
						? (hasStepNumbers
							? allObs.filter(o => !o.stepNumber || !modalSteps.some(s => s.stepNumber === o.stepNumber))
							: allObs.slice(modalSteps.length))
						: allObs}
					{#if unmatchedObs.length > 0}
						<div>
							<p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
								{modalSteps.length > 0 ? 'Additional ' : ''}Screen Observations ({unmatchedObs.length})
							</p>
							<div class="space-y-2">
								{#each unmatchedObs as obs, obsIdx}
									{@const asciiKey = `ascii-unmatched-${obsIdx}`}
									{@const showAscii = asciiViewKeys.has(asciiKey)}
									<div class="rounded-lg bg-stone-50 px-3 py-2.5">
										<div class="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
											<Icon icon="solar:monitor-smartphone-bold-duotone" class="h-3.5 w-3.5 text-blue-500" />
											{#if obs.stepNumber}
												<span class="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-stone-500">Step {obs.stepNumber}</span>
											{/if}
											{#if obs.packageName}
												<span class="font-medium text-blue-700">{obs.packageName}</span>
											{/if}
											{#if obs.activityName}
												<span class="text-stone-300">&rsaquo;</span>
												<span class="font-medium text-violet-600">{obs.activityName.split('.').pop()}</span>
											{/if}
											<span class="text-stone-300">·</span>
											<span class="text-stone-400">{obs.elements.length} element{obs.elements.length !== 1 ? 's' : ''}</span>
											{#if obs.elements.length > 0}
												<button
													class="ml-auto rounded px-1.5 py-0.5 font-medium cursor-pointer transition-colors {showAscii ? 'bg-blue-100 text-blue-700' : 'bg-stone-100 text-stone-500 hover:bg-stone-200'}"
													onclick={() => {
														const next = new Set(asciiViewKeys);
														if (next.has(asciiKey)) next.delete(asciiKey); else next.add(asciiKey);
														asciiViewKeys = next;
													}}
												>
													{showAscii ? '☰ List' : '⊞ ASCII'}
												</button>
											{/if}
										</div>
										{#if obs.elements.length > 0}
											{#if showAscii}
												<pre class="font-mono text-[9px] leading-tight overflow-x-auto bg-stone-900 text-stone-300 rounded-lg p-3">{renderAsciiScreen(obs.elements as Record<string, unknown>[], deviceData?.screenWidth ?? 1080, deviceData?.screenHeight ?? 2400)}</pre>
											{:else}
												{@const elemKey = `unmatched-${obsIdx}`}
												{@const isExpanded = expandedElementSets.has(elemKey)}
												<div class="space-y-0.5" class:max-h-32={!isExpanded} class:overflow-y-auto={!isExpanded}>
													{#each isExpanded ? obs.elements : obs.elements.slice(0, 20) as el}
														{@const elem = el as Record<string, unknown>}
														<p class="truncate font-mono text-[10px] text-stone-500">
															{#if elem.type}<span class="text-stone-300">[{(elem.type as string).split('.').pop()}]</span>{/if}
															{#if elem.action}<span class="text-amber-500/70"> {elem.action}</span>{/if}
															{#if elem.text}<span class="text-stone-700"> "{elem.text}"</span>{/if}
															{#if elem.hint}<span class="text-stone-400 italic"> {elem.hint}</span>{/if}
															{#if elem.id}<span class="text-blue-400"> #{(elem.id as string).split('/').pop()}</span>{/if}
															{#if elem.center}<span class="text-emerald-500"> @{JSON.stringify(elem.center)}</span>{/if}
															{#if elem.bounds}<span class="text-stone-300"> [{typeof elem.bounds === 'string' ? elem.bounds : (elem.bounds as number[]).join(',')}]</span>{/if}
															{#if elem.checked}<span class="text-orange-400"> checked</span>{/if}
															{#if elem.focused}<span class="text-cyan-400"> focused</span>{/if}
															{#if elem.selected}<span class="text-purple-400"> selected</span>{/if}
															{#if elem.enabled === false}<span class="text-red-400"> disabled</span>{/if}
															{#if elem.scrollable}<span class="text-teal-400"> scrollable</span>{/if}
														</p>
													{/each}
													{#if obs.elements.length > 20}
														<button
															class="mt-0.5 text-[10px] text-blue-500 hover:text-blue-700 italic cursor-pointer"
															onclick={() => {
																const next = new Set(expandedElementSets);
																if (next.has(elemKey)) next.delete(elemKey); else next.add(elemKey);
																expandedElementSets = next;
															}}
														>
															{isExpanded ? '▲ Show fewer elements' : `... +${obs.elements.length - 20} more elements`}
														</button>
													{/if}
												</div>
											{/if}
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
				{/if}

				<!-- Session ID for debugging -->
				{#if modalStep.stepResult.sessionId}
					<div class="border-t border-stone-100 pt-3">
						<p class="text-[10px] text-stone-400">
							Session ID: <span class="font-mono">{modalStep.stepResult.sessionId}</span>
						</p>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- Run Tab -->
{:else if activeTab === 'run'}
	<!-- Goal Input -->
	<p class="mb-3 text-sm font-medium text-stone-500">Send a goal</p>
	<div class="mb-6 rounded-2xl bg-white p-6">
		<div class="flex flex-col gap-3 sm:flex-row">
			<input
				type="text"
				bind:value={goal}
				placeholder="e.g., Open YouTube and search for lofi beats"
				class="flex-1 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
				disabled={runStatus === 'running'}
				onkeydown={(e) => e.key === 'Enter' && submitGoal()}
			/>
			{#if runStatus === 'running'}
				<button
					onclick={stopGoal}
					class="flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
				>
					<Icon icon="solar:stop-bold" class="h-4 w-4" />
					Stop
				</button>
			{:else}
				<button
					onclick={submitGoal}
					class="flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
				>
					<Icon icon="solar:play-bold" class="h-4 w-4" />
					Run
				</button>
			{/if}
		</div>
	</div>

	<!-- Example Goals -->
	{#if runStatus === 'idle' && !goal.trim()}
		<div class="mb-6">
			<p class="mb-2 text-xs font-medium text-stone-400">Try an example</p>
			<div class="flex flex-wrap gap-2">
				{#each exampleGoals as example}
					<button
						onclick={() => (goal = example)}
						class="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 transition-colors hover:border-stone-300 hover:bg-stone-50"
					>
						{example}
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Live Steps -->
	{#if steps.length > 0 || runStatus !== 'idle'}
		<p class="mb-3 text-sm font-medium text-stone-500">
			{currentGoal ? currentGoal : 'Current run'}
		</p>
		<div class="rounded-2xl bg-white">
			<!-- Status bar -->
			<div class="flex items-center justify-between px-4 md:px-6 py-3.5">
				<span class="text-sm font-medium text-stone-900">
					{steps.length} step{steps.length !== 1 ? 's' : ''}
				</span>
				{#if runStatus === 'running'}
					<span class="flex items-center gap-1.5 text-xs font-medium text-amber-600">
						<span
							class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"
						></span>
						Running
					</span>
				{:else if runStatus === 'completed'}
					<span class="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
						<Icon icon="solar:check-circle-bold-duotone" class="h-4 w-4" />
						Completed
					</span>
				{:else if runStatus === 'failed'}
					<span class="flex items-center gap-1.5 text-xs font-medium text-red-600">
						<Icon icon="solar:close-circle-bold-duotone" class="h-4 w-4" />
						Failed
					</span>
				{/if}
			</div>

			{#if runError}
				<div class="flex items-center gap-2 border-t border-red-100 bg-red-50 px-4 md:px-6 py-3 text-xs text-red-700">
					<Icon icon="solar:danger-triangle-bold-duotone" class="h-4 w-4 shrink-0" />
					{runError}
				</div>
			{/if}

			{#if steps.length > 0}
				{#each steps as s (s.step)}
					<div class="border-t border-stone-100 px-4 md:px-6 py-3">
						<div class="flex items-baseline gap-2.5">
							<span
								class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 font-mono text-[10px] text-stone-500"
							>
								{s.step}
							</span>
							<span class="font-mono text-xs font-medium text-stone-800">{s.action}</span>
						</div>
						{#if s.reasoning}
							<p class="mt-0.5 pl-8 text-xs text-stone-500">{s.reasoning}</p>
						{/if}
					</div>
				{/each}
			{:else}
				<div class="flex items-center gap-2 border-t border-stone-100 px-4 md:px-6 py-4 text-xs text-stone-400">
					<Icon icon="solar:refresh-circle-bold-duotone" class="h-4 w-4 animate-spin" />
					Waiting for first step...
				</div>
			{/if}
		</div>
	{/if}
{/if}
