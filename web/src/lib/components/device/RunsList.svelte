<script lang="ts">
	import Icon from '@iconify/svelte';
	import type { WorkflowRun, LiveWorkflowRun, StepResult } from './types';

	interface Props {
		runs: WorkflowRun[];
		liveRun: LiveWorkflowRun | null;
		selectedRunId: string | null;
		onselect: (runId: string) => void;
	}

	let { runs, liveRun, selectedRunId, onselect }: Props = $props();

	function formatDuration(startedAt: Date | string, completedAt: Date | string | null): string {
		if (!completedAt) return 'running...';
		const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
		const secs = Math.floor(ms / 1000);
		if (secs < 60) return `${secs}s`;
		const mins = Math.floor(secs / 60);
		const remSecs = secs % 60;
		return `${mins}m${remSecs > 0 ? `${remSecs}s` : ''}`;
	}

	function relativeTime(d: Date | string): string {
		const date = d instanceof Date ? d : new Date(d);
		const diff = Date.now() - date.getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		return `${days}d ago`;
	}

	function countCacheHits(stepResults: StepResult[] | null): number {
		if (!stepResults) return 0;
		return stepResults.filter((r) => r?.resolvedBy === 'cached_flow').length;
	}

	function statusIcon(status: string): string {
		switch (status) {
			case 'completed': return 'solar:check-circle-bold-duotone';
			case 'running': return 'solar:refresh-circle-bold-duotone';
			case 'stopped': return 'solar:stop-circle-bold-duotone';
			default: return 'solar:close-circle-bold-duotone';
		}
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'completed': return 'text-emerald-500';
			case 'running': return 'text-violet-500';
			case 'stopped': return 'text-stone-400';
			default: return 'text-red-500';
		}
	}

	const liveCacheHits = $derived(
		liveRun ? liveRun.stepResults.filter((r) => r?.resolvedBy === 'cached_flow').length : 0
	);

	// Filter out the live run from historical runs to avoid duplicates
	const historicalRuns = $derived(
		liveRun ? runs.filter((r) => r.id !== liveRun.runId) : runs
	);
</script>

<div>
	<div class="mb-2 flex items-center gap-2">
		<Icon icon="solar:history-bold-duotone" class="h-3.5 w-3.5 text-stone-400" />
		<p class="text-xs font-medium text-stone-500">Recent Runs</p>
	</div>

	<div class="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
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
						<Icon
							icon={statusIcon(liveRun.status)}
							class="h-3.5 w-3.5 {statusColor(liveRun.status)}"
						/>
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
			<button
				onclick={() => onselect(run.id)}
				class="flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all
					{selectedRunId === run.id
						? 'bg-stone-100 ring-1 ring-stone-200'
						: 'hover:bg-stone-50'}"
			>
				<Icon
					icon={statusIcon(run.status)}
					class="mt-0.5 h-3.5 w-3.5 shrink-0 {statusColor(run.status)}"
				/>
				<div class="min-w-0 flex-1">
					<p class="truncate text-xs font-medium text-stone-800">{run.name}</p>
					<div class="mt-0.5 flex items-center gap-1.5 text-[10px] text-stone-400">
						<span>{run.totalSteps} step{run.totalSteps !== 1 ? 's' : ''}</span>
						<span class="text-stone-300">&middot;</span>
						<span>{formatDuration(run.startedAt, run.completedAt)}</span>
						{#if cacheHits > 0}
							<span class="text-stone-300">&middot;</span>
							<span class="flex items-center gap-0.5 text-cyan-500">
								<Icon icon="solar:bolt-bold-duotone" class="h-2.5 w-2.5" />
								{cacheHits}
							</span>
						{/if}
						<span class="text-stone-300">&middot;</span>
						<span>{relativeTime(run.startedAt)}</span>
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
