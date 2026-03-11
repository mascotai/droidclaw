<script lang="ts">
	import Icon from '@iconify/svelte';
	import { StatusBadge, TimeAgo, DurationDisplay } from '$lib/components/shared';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import type { WorkflowRun, StepResult, WorkflowStepConfig, WorkflowLiveProgress } from './types';

	interface Props {
		run: WorkflowRun;
		liveProgress?: WorkflowLiveProgress;
		onexpand: (runId: string) => void;
		onstepclick: (run: WorkflowRun, stepIdx: number) => void;
		expanded: boolean;
	}

	let { run, liveProgress, onexpand, onstepclick, expanded }: Props = $props();

	function durationMs(startedAt: Date | string, completedAt: Date | string | null): number {
		if (!completedAt) return -1;
		return new Date(completedAt).getTime() - new Date(startedAt).getTime();
	}

	function countCacheHits(): number {
		if (!run.stepResults) return 0;
		return (run.stepResults as StepResult[]).filter((r) => r?.resolvedBy === 'cached_flow').length;
	}

	function getStepGoal(stepIdx: number): string {
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

	function getStepBadgeClass(stepIdx: number): string {
		const stepResult = (run.stepResults as StepResult[] | null)?.[stepIdx];
		if (stepResult) return stepResult.success ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700';
		if (liveProgress && liveProgress.activeStepIndex === stepIdx && run.status === 'running')
			return 'bg-amber-100 text-amber-700';
		return 'bg-stone-200 text-stone-500';
	}

	function getStepRowClass(stepIdx: number): string {
		const stepResult = (run.stepResults as StepResult[] | null)?.[stepIdx];
		const isActive =
			liveProgress && liveProgress.activeStepIndex === stepIdx && run.status === 'running';
		const isPending = !stepResult && !isActive;
		let cls = 'flex w-full items-start gap-2.5 rounded-xl px-3 py-3 text-left transition-colors ';
		cls += isActive ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-stone-50 hover:bg-stone-100';
		if (isPending) cls += ' opacity-50';
		return cls;
	}

	function isStepActive(stepIdx: number): boolean {
		return !!(
			liveProgress &&
			liveProgress.activeStepIndex === stepIdx &&
			run.status === 'running'
		);
	}

	const cacheHits = $derived(countCacheHits());
	const durMs = $derived(durationMs(run.startedAt, run.completedAt));
</script>

<Card.Root>
	<!-- Row header -->
	<button
		onclick={() => onexpand(run.id)}
		class="flex w-full items-center justify-between rounded-2xl px-4 py-4 text-left transition-colors hover:bg-stone-50 md:px-6"
	>
		<div class="min-w-0 flex-1">
			<div class="flex items-center gap-2">
				<Icon
					icon={run.type === 'flow' ? 'solar:programming-bold-duotone' : 'solar:layers-bold-duotone'}
					class="h-4 w-4 shrink-0 {run.status === 'completed' ? 'text-emerald-500' : run.status === 'running' ? 'text-amber-500' : 'text-red-500'}"
				/>
				<p class="truncate text-sm font-medium text-stone-900">{run.name}</p>
			</div>
			<div class="mt-0.5 flex items-center gap-1.5 pl-6 text-xs text-stone-400">
				<TimeAgo date={run.startedAt} />
				<span class="text-stone-300">&middot;</span>
				<span>{run.totalSteps} goal{run.totalSteps !== 1 ? 's' : ''}</span>
				{#if cacheHits > 0}
					<span class="text-stone-300">&middot;</span>
					<span class="inline-flex items-center gap-0.5 text-cyan-600">
						<Icon icon="solar:bolt-bold-duotone" class="h-3 w-3" />
						{cacheHits}/{run.totalSteps} cached
					</span>
				{/if}
				<span class="text-stone-300">&middot;</span>
				{#if durMs >= 0}
					<DurationDisplay ms={durMs} />
				{:else}
					<span>running...</span>
				{/if}
			</div>
			{#if run.status === 'running' && liveProgress}
				<p class="mt-1 flex items-center gap-1.5 pl-6 text-xs text-amber-600">
					<Icon icon="solar:play-circle-bold-duotone" class="h-3.5 w-3.5 animate-pulse" />
					Step {liveProgress.activeStepIndex + 1}/{run.totalSteps}
					{#if liveProgress.totalAttempts > 1}
						<span class="text-amber-400">&middot;</span>
						Attempt {liveProgress.attempt}/{liveProgress.totalAttempts}
					{/if}
				</p>
			{/if}
		</div>
		<div class="ml-3 flex shrink-0 items-center gap-2">
			<StatusBadge status={run.status} pulse={run.status === 'running'} />
			<Icon
				icon={expanded ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'}
				class="h-4 w-4 text-stone-400"
			/>
		</div>
	</button>

	<!-- Expanded step results -->
	{#if expanded}
		<div class="border-t border-stone-100 px-4 py-4 md:px-6">
			<div class="space-y-2">
				{#each Array.from({ length: run.totalSteps }, (_, i) => i) as stepIdx}
					{@const stepResult = (run.stepResults as StepResult[] | null)?.[stepIdx]}
					<button
						onclick={() => (stepResult ? onstepclick(run, stepIdx) : null)}
						class={getStepRowClass(stepIdx)}
						disabled={!stepResult}
					>
						<span
							class="mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-mono text-xs {getStepBadgeClass(stepIdx)}"
						>
							{stepIdx + 1}
						</span>
						<div class="min-w-0 flex-1">
							<p class="text-xs leading-relaxed text-stone-800">
								{getStepGoal(stepIdx)}
							</p>
							{#if stepResult?.error || (stepResult?.message && !stepResult?.success)}
								<p class="mt-1 text-xs text-red-500">
									{stepResult?.error ?? stepResult?.message}
								</p>
							{/if}
							{#if isStepActive(stepIdx) && liveProgress && liveProgress.totalAttempts > 1}
								<p class="mt-1 text-xs text-amber-600">
									Attempt {liveProgress.attempt}/{liveProgress.totalAttempts}
								</p>
							{/if}
						</div>
						<div class="flex shrink-0 flex-col items-end gap-1">
							{#if stepResult}
								<span class="flex items-center gap-1 text-xs font-medium {stepResult.success ? 'text-emerald-600' : 'text-red-600'}">
									<Icon
										icon={stepResult.success ? 'solar:check-circle-bold-duotone' : 'solar:close-circle-bold-duotone'}
										class="h-3.5 w-3.5"
									/>
									{stepResult.success ? 'OK' : 'Failed'}
								</span>
								{#if stepResult.stepsUsed !== undefined}
									<span class="text-xs text-stone-400">
										{stepResult.stepsUsed} step{stepResult.stepsUsed !== 1 ? 's' : ''}
									</span>
								{/if}
								{#if stepResult.resolvedBy}
									{#if stepResult.resolvedBy === 'cached_flow'}
										<Badge variant="outline" class="bg-cyan-50 text-cyan-700 border-cyan-200 gap-0.5 text-[9px]">
											<Icon icon="solar:bolt-bold-duotone" class="h-2.5 w-2.5" />
											cached
										</Badge>
									{:else}
										<Badge variant="outline" class="text-[9px]">{stepResult.resolvedBy}</Badge>
									{/if}
								{/if}
							{:else if isStepActive(stepIdx)}
								<span class="flex items-center gap-1 text-xs font-medium text-amber-600">
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
						{#if stepResult}
							<Icon icon="solar:alt-arrow-right-linear" class="mt-0.5 h-4 w-4 shrink-0 text-stone-300" />
						{/if}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</Card.Root>
