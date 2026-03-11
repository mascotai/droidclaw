<script lang="ts">
	import Icon from '@iconify/svelte';
	import { StatusBadge, TimeAgo, DurationDisplay } from '$lib/components/shared';
	import * as Card from '$lib/components/ui/card';
	import type { WorkflowRun, LiveWorkflowRun, StepResult } from './types';

	interface Props {
		runs: WorkflowRun[];
		liveRun: LiveWorkflowRun | null;
		selectedRunId: string | null;
		onselect: (runId: string) => void;
	}

	let { runs, liveRun, selectedRunId, onselect }: Props = $props();

	function durationMs(startedAt: Date | string, completedAt: Date | string | null): number {
		if (!completedAt) return -1;
		return new Date(completedAt).getTime() - new Date(startedAt).getTime();
	}

	function countCacheHits(stepResults: StepResult[] | null): number {
		if (!stepResults) return 0;
		return stepResults.filter((r) => r?.resolvedBy === 'cached_flow').length;
	}

	const liveCacheHits = $derived(
		liveRun ? liveRun.stepResults.filter((r) => r?.resolvedBy === 'cached_flow').length : 0
	);

	// Filter out the live run from historical runs to avoid duplicates
	const historicalRuns = $derived(
		liveRun ? runs.filter((r) => r.id !== liveRun.runId) : runs
	);
</script>

<Card.Root>
	<Card.Header class="pb-2">
		<div class="flex items-center gap-2">
			<Icon icon="solar:history-bold-duotone" class="h-3.5 w-3.5 text-stone-400" />
			<Card.Title class="text-xs font-medium text-stone-500">Recent Runs</Card.Title>
		</div>
	</Card.Header>
	<Card.Content class="px-2 pb-2">
		<div class="max-h-[60vh] overflow-y-auto">
				<div class="space-y-1">
					<!-- Live run at top -->
					{#if liveRun}
						<button
							onclick={() => onselect(liveRun!.runId)}
							class="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all
								{selectedRunId === liveRun.runId
									? 'bg-violet-50 ring-1 ring-violet-200'
									: 'hover:bg-stone-50'}"
						>
							<!-- Pulsing live indicator -->
							<div class="mt-1.5 shrink-0">
								{#if liveRun.status === 'running'}
									<span class="relative flex h-2.5 w-2.5">
										<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60"></span>
										<span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-violet-500"></span>
									</span>
								{:else}
									<StatusBadge status={liveRun.status} size="sm" />
								{/if}
							</div>
							<div class="min-w-0 flex-1">
								<p class="truncate text-xs font-medium text-stone-800">{liveRun.name}</p>
								<div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-stone-400">
									<span>{liveRun.totalSteps} step{liveRun.totalSteps !== 1 ? 's' : ''}</span>
									{#if liveRun.status === 'running'}
										<span class="text-stone-300">&middot;</span>
										<span class="text-violet-500">live</span>
									{/if}
									{#if liveCacheHits > 0}
										<span class="text-stone-300">&middot;</span>
										<span class="flex items-center gap-0.5 text-cyan-500">
											<Icon icon="solar:bolt-bold-duotone" class="h-2.5 w-2.5" />
											{liveCacheHits}
										</span>
									{/if}
								</div>
							</div>
						</button>
					{/if}

					<!-- Historical runs -->
					{#each historicalRuns as run (run.id)}
						{@const cacheHits = countCacheHits(run.stepResults as StepResult[] | null)}
						{@const durMs = durationMs(run.startedAt, run.completedAt)}
						<button
							onclick={() => onselect(run.id)}
							class="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all
								{selectedRunId === run.id
									? 'bg-stone-100 ring-1 ring-stone-200'
									: 'hover:bg-stone-50'}"
						>
							<StatusBadge status={run.status} size="sm" pulse={false} class="mt-0.5" />
							<div class="min-w-0 flex-1">
								<p class="truncate text-xs font-medium text-stone-800">{run.name}</p>
								<div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-stone-400">
									<span>{run.totalSteps} step{run.totalSteps !== 1 ? 's' : ''}</span>
									{#if durMs >= 0}
										<span class="text-stone-300">&middot;</span>
										<DurationDisplay ms={durMs} />
									{:else}
										<span class="text-stone-300">&middot;</span>
										<span>running...</span>
									{/if}
									{#if cacheHits > 0}
										<span class="text-stone-300">&middot;</span>
										<span class="flex items-center gap-0.5 text-cyan-500">
											<Icon icon="solar:bolt-bold-duotone" class="h-2.5 w-2.5" />
											{cacheHits}
										</span>
									{/if}
									<span class="text-stone-300">&middot;</span>
									<TimeAgo date={run.startedAt} />
								</div>
							</div>
						</button>
					{/each}

					{#if !liveRun && runs.length === 0}
						<div class="rounded-xl border border-dashed border-stone-200 px-4 py-6 text-center">
							<Icon icon="solar:inbox-bold-duotone" class="mx-auto mb-1.5 h-6 w-6 text-stone-300" />
							<p class="text-[11px] text-stone-400">No runs yet</p>
						</div>
					{/if}
				</div>
		</div>
	</Card.Content>
</Card.Root>
