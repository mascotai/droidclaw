<script lang="ts">
	import Icon from '@iconify/svelte';
	import ActionBadge from './ActionBadge.svelte';
	import LiveAgentSteps from './LiveAgentSteps.svelte';
	import type {
		WorkflowRun,
		LiveWorkflowRun,
		StepResult,
		WorkflowStepConfig,
		AgentStepDetail
	} from './types';

	interface Props {
		/** The historical run loaded from the server (null when showing live) */
		run: WorkflowRun | null;
		/** Live run (when selectedRunId matches liveWorkflowRun.runId) */
		liveRun: LiveWorkflowRun | null;
		/** Whether we're currently loading the run detail */
		loading: boolean;
		/** Stop callback for live runs */
		onstop: () => void;
		/** Whether this run was triggered from a cached flow */
		cachedFlowMeta?: { goalKey: string; stepCount: number; successCount: number } | null;
	}

	let { run, liveRun, loading, onstop, cachedFlowMeta = null }: Props = $props();

	// Which steps have their agent detail expanded (historical mode)
	let expandedSteps = $state<Set<number>>(new Set());

	function toggleStep(idx: number) {
		const next = new Set(expandedSteps);
		if (next.has(idx)) next.delete(idx);
		else next.add(idx);
		expandedSteps = next;
	}

	// Track frozen step indices for shimmer animation (live mode)
	let frozenStepIndices = $state<Set<number>>(new Set());
	$effect(() => {
		if (!liveRun) return;
		liveRun.stepResults.forEach((result, idx) => {
			if (result?.resolvedBy === 'cached_flow' && !frozenStepIndices.has(idx)) {
				frozenStepIndices = new Set([...frozenStepIndices, idx]);
			}
		});
	});

	// Reset expanded steps when run changes
	$effect(() => {
		const _runId = run?.id ?? liveRun?.runId;
		expandedSteps = new Set();
	});

	// ─── Live mode helpers ──────────────────────────────────────
	function liveStepCardClass(idx: number): string {
		if (!liveRun) return '';
		const result = liveRun.stepResults[idx];
		const isActive = liveRun.activeStepIndex === idx && liveRun.status === 'running';

		let cls = 'rounded-xl transition-all duration-500 ';
		if (result?.resolvedBy === 'cached_flow') {
			cls += 'bg-cyan-50 border border-cyan-200 shadow-[0_0_0_1px_rgba(6,182,212,0.1)] freeze-shimmer';
		} else if (isActive) {
			cls += 'bg-violet-50 border border-violet-200 ring-1 ring-violet-200 shadow-sm';
		} else if (result) {
			cls += 'bg-white border border-stone-200';
		} else {
			cls += 'bg-white border border-stone-200 opacity-50';
		}
		return cls;
	}

	// ─── Historical mode helpers ────────────────────────────────
	function histStepCardClass(idx: number): string {
		if (!run) return '';
		const results = run.stepResults as StepResult[] | null;
		const result = results?.[idx];
		let cls = 'rounded-xl transition-all duration-200 ';
		if (result?.resolvedBy === 'cached_flow') {
			cls += 'bg-cyan-50 border border-cyan-200';
		} else if (result) {
			cls += 'bg-white border border-stone-200 hover:border-stone-300';
		} else {
			cls += 'bg-white border border-stone-200 opacity-50';
		}
		return cls;
	}

	function resolvedByIcon(resolvedBy?: string): string {
		if (resolvedBy === 'cached_flow') return 'solar:bolt-bold-duotone';
		return 'solar:cpu-bolt-bold-duotone';
	}

	function resolvedByLabel(resolvedBy?: string): string {
		if (resolvedBy === 'cached_flow') return 'Cached';
		if (resolvedBy) return resolvedBy;
		return 'Agent';
	}

	function resolvedByClass(resolvedBy?: string): string {
		if (resolvedBy === 'cached_flow') return 'bg-cyan-100 text-cyan-700';
		return 'bg-violet-100 text-violet-700';
	}

	function getStepGoal(stepIdx: number): string {
		if (!run) return '';
		const stepResult = (run.stepResults as StepResult[] | null)?.[stepIdx];
		if (stepResult?.goal) return stepResult.goal;
		if (stepResult?.command) return stepResult.command ?? '';
		const step = run.steps?.[stepIdx];
		if (!step) return `Goal ${stepIdx + 1}`;
		if (typeof step === 'string') return step;
		if (typeof step === 'object' && 'goal' in step) return (step as WorkflowStepConfig).goal;
		const [cmd, val] = Object.entries(step)[0] ?? [];
		return cmd ? `${cmd}: ${val}` : `Goal ${stepIdx + 1}`;
	}

	function getStepApp(stepIdx: number): string | null {
		if (!run) return null;
		const step = run.steps?.[stepIdx];
		if (!step || typeof step === 'string') return null;
		if (typeof step === 'object' && 'app' in step) return (step as WorkflowStepConfig).app ?? null;
		return null;
	}

	function parseAction(action: unknown): {
		type: string;
		coords?: number[];
		text?: string;
		direction?: string;
	} {
		if (typeof action === 'string') return { type: action };
		if (typeof action === 'object' && action !== null) {
			const a = action as Record<string, unknown>;
			return {
				type: (a.action as string) ?? 'unknown',
				coords: a.coordinates as number[] | undefined,
				text: a.text as string | undefined,
				direction: a.direction as string | undefined,
			};
		}
		return { type: 'unknown' };
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

	// Status for the overall run
	function statusLabel(s: string): string {
		switch (s) {
			case 'completed': return 'Completed';
			case 'running': return 'Running';
			case 'stopped': return 'Stopped';
			default: return 'Failed';
		}
	}

	function statusColorClass(s: string): string {
		switch (s) {
			case 'completed': return 'text-emerald-600';
			case 'running': return 'text-violet-600';
			case 'stopped': return 'text-stone-500';
			default: return 'text-red-600';
		}
	}

	function statusIconName(s: string): string {
		switch (s) {
			case 'completed': return 'solar:check-circle-bold-duotone';
			case 'running': return 'solar:refresh-circle-bold-duotone';
			case 'stopped': return 'solar:stop-circle-bold-duotone';
			default: return 'solar:close-circle-bold-duotone';
		}
	}
</script>

{#if loading}
	<!-- Loading skeleton -->
	<div class="space-y-3">
		<div class="h-8 w-48 animate-pulse rounded-lg bg-stone-200"></div>
		<div class="h-24 animate-pulse rounded-xl bg-stone-100"></div>
		<div class="h-24 animate-pulse rounded-xl bg-stone-100"></div>
	</div>
{:else if liveRun}
	<!-- ═══════════ LIVE MODE ═══════════ -->
	<div>
		<!-- Header -->
		<div class="mb-4 flex items-center justify-between">
			<div class="flex items-center gap-2.5">
				{#if cachedFlowMeta}
					<Icon icon="solar:bolt-bold-duotone" class="h-4.5 w-4.5 text-cyan-500" />
				{:else}
					<Icon
						icon={liveRun.wfType === 'flow' ? 'solar:programming-bold-duotone' : 'solar:layers-bold-duotone'}
						class="h-4.5 w-4.5 {liveRun.status === 'completed' ? 'text-emerald-500' : liveRun.status === 'running' ? 'text-violet-500' : 'text-red-500'}"
					/>
				{/if}
				<p class="text-sm font-medium text-stone-800">{liveRun.name}</p>
				{#if cachedFlowMeta}
					<span class="text-[10px] text-stone-400">
						{cachedFlowMeta.stepCount} steps · {cachedFlowMeta.successCount} hits
					</span>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				{#if liveRun.status === 'running'}
					<span class="flex items-center gap-1.5 text-xs font-medium text-violet-600">
						<span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-violet-500"></span>
						Running
					</span>
					<button
						onclick={onstop}
						class="flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-100"
					>
						<Icon icon="solar:stop-bold" class="h-3 w-3" />
						Stop
					</button>
				{:else}
					<span class="flex items-center gap-1.5 text-xs font-medium {statusColorClass(liveRun.status)}">
						<Icon icon={statusIconName(liveRun.status)} class="h-4 w-4" />
						{statusLabel(liveRun.status)}
					</span>
				{/if}
			</div>
		</div>

		<!-- Steps -->
		<div class="space-y-2">
			{#each liveRun.stepGoals as stepGoal, stepIdx (stepIdx)}
				{@const result = liveRun.stepResults[stepIdx]}
				{@const isActive = liveRun.activeStepIndex === stepIdx && liveRun.status === 'running'}
				<div class={liveStepCardClass(stepIdx)}>
					<div class="flex items-start gap-2.5 px-4 py-3">
						<!-- Step number badge -->
						<span
							class="mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px]
								{result
									? result.success ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
									: isActive ? 'bg-violet-100 text-violet-700'
									: 'bg-stone-200 text-stone-500'}"
						>
							{stepIdx + 1}
						</span>

						<!-- Goal + details -->
						<div class="min-w-0 flex-1">
							<p class="text-xs leading-relaxed text-stone-800">{stepGoal.goal}</p>
							{#if stepGoal.app}
								<span class="mt-0.5 inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">
									<Icon icon="solar:box-bold-duotone" class="h-2.5 w-2.5" />
									{stepGoal.app}
								</span>
							{/if}

							<!-- Active step: show live state -->
							{#if isActive}
								<div class="mt-1.5 flex items-center gap-1.5">
									<Icon icon="solar:refresh-circle-bold-duotone" class="h-3.5 w-3.5 animate-spin text-violet-500" />
									<span class="text-[11px] text-violet-600">
										Discovering...
										{#if liveRun.totalAttempts > 1}
											<span class="text-violet-400">&middot;</span>
											Attempt {liveRun.attempt}/{liveRun.totalAttempts}
										{/if}
									</span>
								</div>
								<LiveAgentSteps steps={liveRun.liveSteps} variant="live" />
							{/if}

							<!-- Error message -->
							{#if result && !result.success && (result.error || result.message)}
								<p class="mt-1 text-[11px] text-red-500">{result.error ?? result.message}</p>
							{/if}
						</div>

						<!-- Right side: status + resolvedBy -->
						<div class="flex shrink-0 flex-col items-end gap-1">
							{#if result}
								<span class="flex items-center gap-1 text-xs font-medium {result.success ? 'text-emerald-600' : 'text-red-600'}">
									<Icon
										icon={result.success ? 'solar:check-circle-bold-duotone' : 'solar:close-circle-bold-duotone'}
										class="h-3.5 w-3.5"
									/>
									{result.success ? 'OK' : 'Failed'}
								</span>
								{#if result.stepsUsed !== undefined && result.stepsUsed > 0}
									<span class="text-[10px] text-stone-400">
										{result.stepsUsed} step{result.stepsUsed !== 1 ? 's' : ''}
									</span>
								{/if}
								{#if result.resolvedBy}
									<span class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-medium {resolvedByClass(result.resolvedBy)}">
										<Icon icon={resolvedByIcon(result.resolvedBy)} class="h-2.5 w-2.5" />
										{resolvedByLabel(result.resolvedBy)}
									</span>
								{/if}
							{:else if isActive}
								<span class="flex items-center gap-1 text-xs font-medium text-violet-600">
									<Icon icon="solar:refresh-circle-bold-duotone" class="h-3.5 w-3.5 animate-spin" />
									Running
								</span>
							{:else}
								<span class="flex items-center gap-1 text-xs font-medium text-stone-400">
									<Icon icon="solar:clock-circle-bold-duotone" class="h-3.5 w-3.5" />
									Pending
								</span>
							{/if}
						</div>
					</div>
				</div>
			{/each}
		</div>

		<!-- Summary bar -->
		{#if liveRun.status !== 'running'}
			{@const completedSteps = liveRun.stepResults.filter((r) => r !== null)}
			{@const successSteps = completedSteps.filter((r) => r?.success)}
			{@const cachedSteps = completedSteps.filter((r) => r?.resolvedBy === 'cached_flow')}
			<div class="mt-3 flex items-center gap-3 rounded-xl bg-stone-50 px-4 py-2.5 text-xs text-stone-500">
				<span>{successSteps.length}/{liveRun.totalSteps} passed</span>
				{#if cachedSteps.length > 0}
					<span class="text-stone-300">&middot;</span>
					<span class="flex items-center gap-0.5 text-cyan-600">
						<Icon icon="solar:bolt-bold-duotone" class="h-3 w-3" />
						{cachedSteps.length} cached
					</span>
				{/if}
			</div>
		{/if}
	</div>
{:else if run}
	<!-- ═══════════ HISTORICAL MODE ═══════════ -->
	<div>
		<!-- Header -->
		<div class="mb-4 flex items-center justify-between">
			<div class="flex items-center gap-2.5">
				<Icon
					icon={run.type === 'flow' ? 'solar:programming-bold-duotone' : 'solar:layers-bold-duotone'}
					class="h-4.5 w-4.5 {run.status === 'completed' ? 'text-emerald-500' : run.status === 'running' ? 'text-violet-500' : 'text-red-500'}"
				/>
				<p class="text-sm font-medium text-stone-800">{run.name}</p>
			</div>
			<div class="flex items-center gap-3">
				<span class="text-[11px] text-stone-400">
					{formatDuration(run.startedAt, run.completedAt)}
				</span>
				<span class="flex items-center gap-1.5 text-xs font-medium {statusColorClass(run.status)}">
					<Icon icon={statusIconName(run.status)} class="h-4 w-4" />
					{statusLabel(run.status)}
				</span>
			</div>
		</div>

		<!-- Steps -->
		<div class="space-y-2">
			{#each Array.from({ length: run.totalSteps }, (_, i) => i) as stepIdx}
				{@const results = run.stepResults as StepResult[] | null}
				{@const result = results?.[stepIdx]}
				{@const hasAgentSteps = result?.agentSteps && result.agentSteps.length > 0}
				{@const isExpanded = expandedSteps.has(stepIdx)}
				{@const app = getStepApp(stepIdx)}
				<div class={histStepCardClass(stepIdx)}>
					<!-- Step row (clickable to expand agent steps) -->
					<button
						onclick={() => hasAgentSteps ? toggleStep(stepIdx) : null}
						class="flex w-full items-start gap-2.5 px-4 py-3 text-left {hasAgentSteps ? 'cursor-pointer' : 'cursor-default'}"
						disabled={!hasAgentSteps}
					>
						<!-- Step number badge -->
						<span
							class="mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px]
								{result
									? result.success ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
									: 'bg-stone-200 text-stone-500'}"
						>
							{stepIdx + 1}
						</span>

						<!-- Goal -->
						<div class="min-w-0 flex-1">
							<p class="text-xs leading-relaxed text-stone-800">{getStepGoal(stepIdx)}</p>
							{#if app}
								<span class="mt-0.5 inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600">
									<Icon icon="solar:box-bold-duotone" class="h-2.5 w-2.5" />
									{app}
								</span>
							{/if}
							{#if result && !result.success && (result.error || result.message)}
								<p class="mt-1 text-[11px] text-red-500">{result.error ?? result.message}</p>
							{/if}
						</div>

						<!-- Right side: status + resolvedBy + expand chevron -->
						<div class="flex shrink-0 items-center gap-2">
							<div class="flex flex-col items-end gap-1">
								{#if result}
									<span class="flex items-center gap-1 text-xs font-medium {result.success ? 'text-emerald-600' : 'text-red-600'}">
										<Icon
											icon={result.success ? 'solar:check-circle-bold-duotone' : 'solar:close-circle-bold-duotone'}
											class="h-3.5 w-3.5"
										/>
										{result.success ? 'OK' : 'Failed'}
									</span>
									{#if result.stepsUsed !== undefined && result.stepsUsed > 0}
										<span class="text-[10px] text-stone-400">
											{result.stepsUsed} step{result.stepsUsed !== 1 ? 's' : ''}
										</span>
									{/if}
									{#if result.resolvedBy}
										<span class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-medium {resolvedByClass(result.resolvedBy)}">
											<Icon icon={resolvedByIcon(result.resolvedBy)} class="h-2.5 w-2.5" />
											{resolvedByLabel(result.resolvedBy)}
										</span>
									{/if}
								{:else}
									<span class="flex items-center gap-1 text-xs font-medium text-stone-400">
										<Icon icon="solar:clock-circle-bold-duotone" class="h-3.5 w-3.5" />
										Pending
									</span>
								{/if}
							</div>
							{#if hasAgentSteps}
								<Icon
									icon={isExpanded ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'}
									class="h-3.5 w-3.5 text-stone-300"
								/>
							{/if}
						</div>
					</button>

					<!-- Expanded agent steps -->
					{#if isExpanded && result?.agentSteps}
						<div class="border-t border-stone-100 px-4 pb-3 pt-2">
							<div class="space-y-1 border-l-2 border-stone-200 pl-3">
								{#each result.agentSteps as agentStep (agentStep.id)}
									{@const act = parseAction(agentStep.action)}
									<div class="flex items-start gap-1.5">
										<span class="mt-0.5 shrink-0 rounded bg-stone-100 px-1 py-0.5 font-mono text-[9px] text-stone-500">
											{agentStep.stepNumber}
										</span>
										<div class="min-w-0 flex-1">
											<div class="flex items-center gap-1.5">
												<ActionBadge action={act.type} />
												{#if act.coords && act.coords.length >= 2}
													<span class="font-mono text-[10px] text-stone-400">({act.coords[0]}, {act.coords[1]})</span>
												{/if}
												{#if act.text}
													<span class="rounded bg-stone-50 px-1 py-0.5 text-[10px] text-stone-700">"{act.text}"</span>
												{/if}
												{#if act.direction}
													<span class="text-[10px] text-stone-400">{act.direction}</span>
												{/if}
											</div>
											{#if agentStep.reasoning}
												<p class="mt-0.5 text-[11px] leading-relaxed text-stone-500">{agentStep.reasoning}</p>
											{/if}
											{#if agentStep.result}
												<p class="mt-0.5 text-[10px] text-stone-400">{agentStep.result}</p>
											{/if}
										</div>
										{#if agentStep.durationMs}
											<span class="shrink-0 text-[9px] text-stone-300">{Math.round(agentStep.durationMs / 1000)}s</span>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Summary bar -->
		{#if run.stepResults}
			{@const allResults = (run.stepResults as StepResult[]) ?? []}
			{@const completedSteps = allResults.filter((r) => r != null)}
			{@const successSteps = completedSteps.filter((r) => r?.success)}
			{@const cachedSteps = completedSteps.filter((r) => r?.resolvedBy === 'cached_flow')}
			<div class="mt-3 flex items-center gap-3 rounded-xl bg-stone-50 px-4 py-2.5 text-xs text-stone-500">
				<span>{successSteps.length}/{run.totalSteps} passed</span>
			{#if cachedSteps.length > 0}
				<span class="text-stone-300">&middot;</span>
				<span class="flex items-center gap-0.5 text-cyan-600">
					<Icon icon="solar:bolt-bold-duotone" class="h-3 w-3" />
					{cachedSteps.length} cached
				</span>
			{/if}
			<span class="text-stone-300">&middot;</span>
			<span>{formatDuration(run.startedAt, run.completedAt)}</span>
		</div>
		{/if}
	</div>
{:else}
	<!-- Empty state (should not normally show — loading handles the transition) -->
	<div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-200 py-16">
		<Icon icon="solar:inbox-bold-duotone" class="mb-3 h-10 w-10 text-stone-300" />
		<p class="text-sm text-stone-400">Select a run to view details</p>
	</div>
{/if}

<style>
	/* Freeze shimmer — one-time sweep when a step gets the cached_flow treatment */
	@keyframes freeze-shimmer {
		0% {
			background-position: -200% 0;
		}
		100% {
			background-position: 200% 0;
		}
	}

	:global(.freeze-shimmer) {
		position: relative;
		overflow: hidden;
	}

	:global(.freeze-shimmer::after) {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			transparent 0%,
			rgba(6, 182, 212, 0.12) 40%,
			rgba(6, 182, 212, 0.2) 50%,
			rgba(6, 182, 212, 0.12) 60%,
			transparent 100%
		);
		background-size: 200% 100%;
		animation: freeze-shimmer 1.2s ease-out forwards;
		pointer-events: none;
		border-radius: inherit;
	}
</style>
