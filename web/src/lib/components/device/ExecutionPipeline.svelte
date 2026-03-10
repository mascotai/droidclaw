<script lang="ts">
	import Icon from '@iconify/svelte';
	import CurrentRun from './CurrentRun.svelte';
	import type { LiveWorkflowRun, QueueItem, CachedFlowEntry } from './types';

	interface Props {
		liveRun: LiveWorkflowRun | null;
		queued: QueueItem[];
		onstop: () => void;
		oncancel: (runId: string) => void;
		/** If the current run was triggered from a cached flow card */
		runningCachedFlow: CachedFlowEntry | null;
	}

	let { liveRun, queued, onstop, oncancel, runningCachedFlow = null }: Props = $props();

	const isActive = $derived(!!(liveRun || queued.length > 0));
</script>

{#if isActive}
	<div class="space-y-4">
		<!-- Section header -->
		<div class="flex items-center gap-2">
			<Icon icon="solar:traffic-economy-bold-duotone" class="h-4 w-4 text-stone-400" />
			<p class="text-sm font-medium text-stone-700">Execution Pipeline</p>
			{#if queued.length > 0}
				<span class="rounded-full bg-stone-200 px-2 py-0.5 text-[10px] font-medium text-stone-500">
					{queued.length} queued
				</span>
			{/if}
		</div>

		<!-- Currently running -->
		{#if liveRun}
			<CurrentRun
				run={liveRun}
				{onstop}
				cachedFlowMeta={runningCachedFlow
					? {
							goalKey: runningCachedFlow.goalKey,
							stepCount: runningCachedFlow.stepCount,
							successCount: runningCachedFlow.successCount ?? 0
						}
					: null}
			/>
		{/if}

		<!-- Queued items -->
		{#if queued.length > 0}
			<div class="relative ml-4 space-y-2 border-l-2 border-stone-200 pl-4">
				{#each queued as item (item.runId)}
					<div
						class="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 opacity-60"
					>
						<Icon icon="solar:clock-circle-bold-duotone" class="h-4 w-4 shrink-0 text-stone-400" />
						<div class="min-w-0 flex-1">
							<p class="truncate text-xs font-medium text-stone-700">{item.name}</p>
							<p class="text-[10px] text-stone-400">
								{item.totalSteps} step{item.totalSteps !== 1 ? 's' : ''}
								{#if item.scheduledFor}
									· scheduled
								{/if}
							</p>
						</div>
						<button
							onclick={() => oncancel(item.runId)}
							class="shrink-0 rounded-lg p-1.5 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500"
							title="Cancel"
						>
							<Icon icon="solar:close-circle-bold-duotone" class="h-4 w-4" />
						</button>
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}
