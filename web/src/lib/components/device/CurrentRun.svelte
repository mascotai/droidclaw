<script lang="ts">
	import Icon from '@iconify/svelte';
	import LiveAgentSteps from './LiveAgentSteps.svelte';
	import type { LiveWorkflowRun } from './types';

	interface Props {
		run: LiveWorkflowRun;
		onstop: () => void;
		/** If this run was triggered from a cached flow card */
		cachedFlowMeta?: { goalKey: string; stepCount: number; successCount: number } | null;
	}

	let { run, onstop, cachedFlowMeta = null }: Props = $props();

	// Track which steps have been seen as completed (for shimmer trigger)
	let frozenStepIndices = $state<Set<number>>(new Set());

	// Detect newly-frozen steps: when a result appears with resolvedBy=cached_flow
	// and we haven't seen it before → trigger shimmer
	$effect(() => {
		run.stepResults.forEach((result, idx) => {
			if (result?.resolvedBy === 'cached_flow' && !frozenStepIndices.has(idx)) {
				frozenStepIndices = new Set([...frozenStepIndices, idx]);
			}
		});
	});

	/** CSS transition class for the freeze animation:
	 *  cached_flow → cyan/frozen look with shimmer on first appearance
	 *  agent / undefined → violet/live look (while running), then transitions on completion */
	function stepCardClass(idx: number): string {
		const result = run.stepResults[idx];
		const isActive = run.activeStepIndex === idx && run.status === 'running';
		const isPending = !result && !isActive;

		let cls = 'rounded-xl transition-all duration-500 ';
		if (result?.resolvedBy === 'cached_flow') {
			// Frozen — instant replay with shimmer overlay
			cls += 'bg-cyan-50 border border-cyan-200 shadow-[0_0_0_1px_rgba(6,182,212,0.1)] freeze-shimmer';
		} else if (isActive) {
			// Live AI discovery — pulsing violet
			cls += 'bg-violet-50 border border-violet-200 ring-1 ring-violet-200 shadow-sm';
		} else if (result) {
			// Completed but not cached — neutral
			cls += 'bg-white border border-stone-200';
		} else {
			// Pending
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
</script>

<div class="mb-6">
	<!-- Workflow header with status -->
	<div class="mb-3 flex items-center justify-between">
		<div class="flex items-center gap-2">
			{#if cachedFlowMeta}
				<Icon icon="solar:bolt-bold-duotone" class="h-4 w-4 text-cyan-500" />
			{:else}
				<Icon
					icon={run.wfType === 'flow' ? 'solar:programming-bold-duotone' : 'solar:layers-bold-duotone'}
					class="h-4 w-4 {run.status === 'completed' ? 'text-emerald-500' : run.status === 'running' ? 'text-violet-500' : 'text-red-500'}"
				/>
			{/if}
			<p class="text-sm font-medium text-stone-700">{run.name}</p>
			{#if cachedFlowMeta}
				<span class="text-[10px] text-stone-400">
					{cachedFlowMeta.stepCount} steps · {cachedFlowMeta.successCount} hits
				</span>
			{/if}
		</div>
		<div class="flex items-center gap-2">
			{#if run.status === 'running'}
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
			{:else if run.status === 'completed'}
				<span class="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
					<Icon icon="solar:check-circle-bold-duotone" class="h-4 w-4" />
					Completed
				</span>
			{:else if run.status === 'stopped'}
				<span class="flex items-center gap-1.5 text-xs font-medium text-stone-500">
					<Icon icon="solar:stop-circle-bold-duotone" class="h-4 w-4" />
					Stopped
				</span>
			{:else}
				<span class="flex items-center gap-1.5 text-xs font-medium text-red-600">
					<Icon icon="solar:close-circle-bold-duotone" class="h-4 w-4" />
					Failed
				</span>
			{/if}
		</div>
	</div>

	<!-- Step list — all steps shown upfront, filled in as they complete -->
	<div class="space-y-2">
		{#each run.stepGoals as stepGoal, stepIdx (stepIdx)}
			{@const result = run.stepResults[stepIdx]}
			{@const isActive = run.activeStepIndex === stepIdx && run.status === 'running'}
			<div class={stepCardClass(stepIdx)}>
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
									{#if run.totalAttempts > 1}
										<span class="text-violet-400">&middot;</span>
										Attempt {run.attempt}/{run.totalAttempts}
									{/if}
								</span>
							</div>
							<!-- Live agent steps -->
							<LiveAgentSteps steps={run.liveSteps} variant="live" />
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
	{#if run.status !== 'running'}
		{@const completedSteps = run.stepResults.filter((r) => r !== null)}
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
		</div>
	{/if}
</div>

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
