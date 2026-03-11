<script lang="ts">
	import Icon from '@iconify/svelte';
	import { untrack } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { EmptyState } from '$lib/components/shared';
	import { ConfirmDialog } from '$lib/components/shared';
	import { TimeAgo } from '$lib/components/shared';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import type { CachedFlowEntry } from './types';

	interface Props {
		flows: CachedFlowEntry[];
		loading: boolean;
		runningFlowId: string | null;
		onrun: (flow: CachedFlowEntry) => void;
		ondelete: (flowId: string) => void;
	}

	let { flows, loading, runningFlowId = null, onrun, ondelete }: Props = $props();

	// Track known flow IDs to detect newly-added cards (for glow animation)
	let knownFlowIds = $state<Set<string>>(new Set());
	let newFlowIds = $state<Set<string>>(new Set());

	// Delete confirmation
	let deleteConfirmOpen = $state(false);
	let deleteFlowId = $state<string | null>(null);

	function confirmDelete(flowId: string) {
		deleteFlowId = flowId;
		deleteConfirmOpen = true;
	}

	function handleDeleteConfirm() {
		if (deleteFlowId) {
			ondelete(deleteFlowId);
			deleteFlowId = null;
		}
	}

	$effect(() => {
		const currentIds = new Set(flows.map((f) => f.id));
		const known = untrack(() => knownFlowIds);
		const freshIds = new Set<string>();
		for (const id of currentIds) {
			if (!known.has(id)) {
				freshIds.add(id);
			}
		}
		if (freshIds.size > 0) {
			newFlowIds = freshIds;
			setTimeout(() => {
				newFlowIds = new Set();
			}, 1500);
		}
		knownFlowIds = currentIds;
	});
</script>

<Card.Root>
	<Card.Header class="pb-2">
		<div class="flex items-center gap-2">
			<Icon icon="solar:bolt-bold-duotone" class="h-4 w-4 text-cyan-500" />
			<Card.Title class="text-sm font-medium text-stone-700">Active Workflows</Card.Title>
			{#if flows.length > 0}
				<Badge variant="outline" class="text-[10px]">{flows.length}</Badge>
			{/if}
		</div>
	</Card.Header>
	<Card.Content>
		{#if loading}
			<div class="grid gap-3 sm:grid-cols-2">
				{#each [1, 2] as _}
					<div class="space-y-2 rounded-xl border border-stone-200 p-4">
						<Skeleton class="h-3.5 w-32" />
						<Skeleton class="h-2.5 w-20" />
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
				{#each flows as flow (flow.id)}
					{#if runningFlowId === flow.id}
						<!-- Ghost placeholder — card is lifted into pipeline -->
						<div class="flex items-center justify-center rounded-xl border-2 border-dashed border-cyan-200 bg-cyan-50/30 px-4 py-6">
							<div class="flex items-center gap-1.5 text-xs text-cyan-400">
								<Icon icon="solar:arrow-up-bold" class="h-3.5 w-3.5" />
								Running above
							</div>
						</div>
					{:else}
						<!-- Cached flow card -->
						<Card.Root class="group transition-all hover:shadow-md {newFlowIds.has(flow.id) ? 'new-card-glow' : ''} border-cyan-200 bg-gradient-to-br from-cyan-50/50 to-white">
							<Card.Content class="p-4">
								<div class="mb-2 flex items-start justify-between gap-2">
									<div class="min-w-0 flex-1">
										<p class="truncate text-xs font-medium text-stone-800">{flow.goalKey}</p>
										{#if flow.appPackage}
											<Badge variant="outline" class="mt-1 bg-blue-50 text-blue-600 border-blue-200 gap-0.5 text-[10px]">
												<Icon icon="solar:box-bold-duotone" class="h-2.5 w-2.5" />
												{flow.appPackage}
											</Badge>
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
										<TimeAgo date={flow.lastUsedAt} />
									{/if}
								</div>

								<!-- Actions -->
								<div class="flex items-center gap-2">
									<Button size="sm" onclick={() => onrun(flow)} class="flex-1 gap-1.5 bg-cyan-600 hover:bg-cyan-500 text-[11px] h-7">
										<Icon icon="solar:play-bold" class="h-3 w-3" />
										Run
									</Button>
									<Tooltip.Root>
									<Tooltip.Trigger>
										<Button
											variant="ghost"
											size="icon"
											onclick={() => confirmDelete(flow.id)}
											class="h-7 w-7 text-stone-300 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
										>
											<Icon icon="solar:trash-bin-minimalistic-bold-duotone" class="h-3.5 w-3.5" />
										</Button>
									</Tooltip.Trigger>
									<Tooltip.Content>Delete cached flow</Tooltip.Content>
								</Tooltip.Root>
								</div>
							</Card.Content>
						</Card.Root>
					{/if}
				{/each}
			</div>
		{/if}
	</Card.Content>
</Card.Root>

<!-- Delete confirmation dialog -->
<ConfirmDialog
	bind:open={deleteConfirmOpen}
	title="Delete cached flow?"
	description="This will remove the cached flow. The next run of this goal will use AI discovery instead of instant replay."
	confirmLabel="Delete"
	onconfirm={handleDeleteConfirm}
	oncancel={() => { deleteFlowId = null; }}
/>
