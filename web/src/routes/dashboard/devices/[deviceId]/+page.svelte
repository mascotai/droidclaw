<script lang="ts">
	import Icon from '@iconify/svelte';
	import WorkflowBuilder from '$lib/components/device/WorkflowBuilder.svelte';
	import ActiveWorkflows from '$lib/components/device/ActiveWorkflows.svelte';
	import RunsList from '$lib/components/device/RunsList.svelte';
	import RunDetail from '$lib/components/device/RunDetail.svelte';
	import { getDeviceContext } from '$lib/components/device/context';

	const ctx = getDeviceContext();

	let showBuilder = $state(false);

	function handleSubmit(steps: Parameters<typeof ctx.handleWorkflowSubmit>[0], variables: Parameters<typeof ctx.handleWorkflowSubmit>[1]) {
		showBuilder = false;
		ctx.handleWorkflowSubmit(steps, variables);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') showBuilder = false;
	}

	// Determine if the selected run is the live run
	const isLiveSelected = $derived(
		ctx.liveWorkflowRun && ctx.selectedRunId === ctx.liveWorkflowRun.runId
	);
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex flex-col gap-6 lg:flex-row">
	<!-- ═══════════ Left sidebar ═══════════ -->
	<div class="w-full shrink-0 space-y-6 lg:w-72 xl:w-80">
		<!-- Run a task button -->
		<button
			onclick={() => (showBuilder = true)}
			disabled={ctx.liveWorkflowRun?.status === 'running'}
			class="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-2.5 text-xs font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-40"
		>
			<Icon icon="solar:play-bold" class="h-3.5 w-3.5" />
			Run a task
		</button>

		<!-- Recent runs sidebar -->
		<RunsList
			runs={ctx.workflowRuns}
			liveRun={ctx.liveWorkflowRun}
			selectedRunId={ctx.selectedRunId}
			onselect={(runId) => ctx.selectRun(runId)}
		/>

		<!-- Active Workflows (cached flows) -->
		<ActiveWorkflows
			flows={ctx.cachedFlows}
			loading={!ctx.cachedFlowsLoaded}
			runningFlowId={ctx.runningCachedFlowId}
			onrun={ctx.handleCachedFlowRun}
			ondelete={ctx.handleCachedFlowDelete}
		/>
	</div>

	<!-- ═══════════ Center detail panel ═══════════ -->
	<div class="min-w-0 flex-1">
		{#if ctx.selectedRunId}
			<RunDetail
				run={isLiveSelected ? null : ctx.selectedRunDetail}
				liveRun={isLiveSelected ? ctx.liveWorkflowRun : null}
				loading={ctx.selectedRunLoading}
				onstop={ctx.handleWorkflowStop}
				cachedFlowMeta={isLiveSelected && ctx.runningCachedFlow
					? {
							goalKey: ctx.runningCachedFlow.goalKey,
							stepCount: ctx.runningCachedFlow.stepCount,
							successCount: ctx.runningCachedFlow.successCount ?? 0
						}
					: null}
			/>
		{:else}
			<!-- Empty state -->
			<div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-200 py-16">
				<Icon icon="solar:inbox-bold-duotone" class="mb-3 h-10 w-10 text-stone-300" />
				<p class="text-sm text-stone-400">Select a run or start a new task</p>
				<p class="mt-1 text-xs text-stone-300">Runs will appear in the sidebar</p>
			</div>
		{/if}
	</div>
</div>

<!-- Workflow Builder Modal -->
{#if showBuilder}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
		onclick={(e) => { if (e.target === e.currentTarget) showBuilder = false; }}
	>
		<div
			class="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-stone-50 p-1 shadow-2xl"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- Close button -->
			<button
				onclick={() => (showBuilder = false)}
				class="absolute right-3 top-3 z-10 rounded-full p-1.5 text-stone-400 transition-colors hover:bg-stone-200 hover:text-stone-600"
			>
				<Icon icon="solar:close-circle-bold-duotone" class="h-5 w-5" />
			</button>

			<WorkflowBuilder
				disabled={ctx.liveWorkflowRun?.status === 'running'}
				onsubmit={handleSubmit}
				onstop={() => { showBuilder = false; ctx.handleWorkflowStop(); }}
				isRunning={ctx.liveWorkflowRun?.status === 'running'}
			/>
		</div>
	</div>
{/if}
