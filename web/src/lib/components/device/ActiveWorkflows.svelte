<script lang="ts">
	import Icon from '@iconify/svelte';
	import type { CachedFlowEntry } from './types';

	interface Props {
		flows: CachedFlowEntry[];
		loading: boolean;
		/** ID of the cached flow currently running in the pipeline (shows placeholder) */
		runningFlowId: string | null;
		onrun: (flow: CachedFlowEntry) => void;
		ondelete: (flowId: string) => void;
	}

	let { flows, loading, runningFlowId = null, onrun, ondelete }: Props = $props();

	// Track known flow IDs to detect newly-added cards (for glow animation)
	let knownFlowIds = $state<Set<string>>(new Set());
	let newFlowIds = $state<Set<string>>(new Set());

	$effect(() => {
		const currentIds = new Set(flows.map((f) => f.id));
		const freshIds = new Set<string>();
		for (const id of currentIds) {
			if (!knownFlowIds.has(id)) {
				freshIds.add(id);
			}
		}
		if (freshIds.size > 0) {
			newFlowIds = freshIds;
			// Clear glow after animation completes
			setTimeout(() => {
				newFlowIds = new Set();
			}, 1500);
		}
		knownFlowIds = currentIds;
	});

	function relativeTime(iso: string | Date) {
		const d = iso instanceof Date ? iso : new Date(iso);
		const diff = Date.now() - d.getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		return `${days}d ago`;
	}

	const visibleFlows = $derived(flows);
</script>

<div>
	<div class="mb-3 flex items-center gap-2">
		<Icon icon="solar:bolt-bold-duotone" class="h-4 w-4 text-cyan-500" />
		<p class="text-sm font-medium text-stone-700">Active Workflows</p>
		{#if flows.length > 0}
			<span class="text-[10px] text-stone-400">({flows.length})</span>
		{/if}
	</div>

	{#if loading}
		<!-- Skeleton -->
		<div class="grid gap-3 sm:grid-cols-2">
			{#each [1, 2] as _}
				<div class="animate-pulse rounded-xl border border-stone-200 bg-white p-4">
					<div class="h-3.5 w-32 rounded bg-stone-200"></div>
					<div class="mt-2 h-2.5 w-20 rounded bg-stone-100"></div>
				</div>
			{/each}
		</div>
	{:else if flows.length === 0}
		<div class="rounded-xl border border-dashed border-stone-300 bg-white px-6 py-8 text-center">
			<Icon icon="solar:bolt-bold-duotone" class="mx-auto mb-2 h-8 w-8 text-stone-300" />
			<p class="text-xs text-stone-400">
				Run workflows to discover new automations.<br />
				Successful tasks get saved here for instant replay.
			</p>
		</div>
	{:else}
		<div class="grid gap-3 sm:grid-cols-2">
			{#each visibleFlows as flow (flow.id)}
				{#if runningFlowId === flow.id}
					<!-- Ghost placeholder — card is lifted into pipeline -->
					<div
						class="flex items-center justify-center rounded-xl border-2 border-dashed border-cyan-200 bg-cyan-50/30 px-4 py-6"
					>
						<div class="flex items-center gap-1.5 text-xs text-cyan-400">
							<Icon icon="solar:arrow-up-bold" class="h-3.5 w-3.5" />
							Running above
						</div>
					</div>
				{:else}
					<!-- Frozen card -->
					<div
						class="group rounded-xl border border-cyan-200 bg-gradient-to-br from-cyan-50/50 to-white p-4 shadow-[0_0_0_1px_rgba(6,182,212,0.08)] transition-all hover:shadow-md {newFlowIds.has(flow.id) ? 'new-card-glow' : ''}"
					>
						<div class="mb-2 flex items-start justify-between gap-2">
							<div class="min-w-0 flex-1">
								<p class="truncate text-xs font-medium text-stone-800">{flow.goalKey}</p>
								{#if flow.appPackage}
									<span
										class="mt-1 inline-flex items-center gap-0.5 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-600"
									>
										<Icon icon="solar:box-bold-duotone" class="h-2.5 w-2.5" />
										{flow.appPackage}
									</span>
								{/if}
							</div>
							<Icon icon="solar:bolt-bold-duotone" class="h-4 w-4 shrink-0 text-cyan-400" />
						</div>

						<!-- Stats row -->
						<div class="mb-3 flex flex-wrap items-center gap-2 text-[10px] text-stone-400">
							<span>{flow.stepCount} step{flow.stepCount !== 1 ? 's' : ''}</span>
							<span class="text-stone-200">·</span>
							<span class="text-emerald-600">{flow.successCount ?? 0} hits</span>
							{#if (flow.failCount ?? 0) > 0}
								<span class="text-stone-200">·</span>
								<span class="text-red-500">{flow.failCount} fails</span>
							{/if}
							{#if flow.lastUsedAt}
								<span class="text-stone-200">·</span>
								<span>{relativeTime(flow.lastUsedAt)}</span>
							{/if}
						</div>

						<!-- Actions -->
						<div class="flex items-center gap-2">
							<button
								onclick={() => onrun(flow)}
								class="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-cyan-500"
							>
								<Icon icon="solar:play-bold" class="h-3 w-3" />
								Run
							</button>
							<button
								onclick={() => ondelete(flow.id)}
								class="shrink-0 rounded-lg p-1.5 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500 opacity-0 group-hover:opacity-100"
								title="Delete cached flow"
							>
								<Icon icon="solar:trash-bin-minimalistic-bold-duotone" class="h-3.5 w-3.5" />
							</button>
						</div>
					</div>
				{/if}
			{/each}
		</div>
	{/if}
</div>

<style>
	/* Glow animation for newly-compiled cached flow cards */
	@keyframes card-glow {
		0% {
			box-shadow: 0 0 0 0 rgba(6, 182, 212, 0), 0 0 0 1px rgba(6, 182, 212, 0.08);
		}
		30% {
			box-shadow: 0 0 16px 4px rgba(6, 182, 212, 0.25), 0 0 0 1px rgba(6, 182, 212, 0.2);
		}
		100% {
			box-shadow: 0 0 0 0 rgba(6, 182, 212, 0), 0 0 0 1px rgba(6, 182, 212, 0.08);
		}
	}

	:global(.new-card-glow) {
		animation: card-glow 1.5s ease-out;
	}
</style>
