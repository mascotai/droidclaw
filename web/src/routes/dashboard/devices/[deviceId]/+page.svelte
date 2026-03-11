<script lang="ts">
	import Icon from '@iconify/svelte';
	import WorkflowBuilder from '$lib/components/device/WorkflowBuilder.svelte';
	import ActiveWorkflows from '$lib/components/device/ActiveWorkflows.svelte';
	import RunsList from '$lib/components/device/RunsList.svelte';
	import RunViewer from '$lib/components/device/RunViewer.svelte';
	import { EmptyState } from '$lib/components/shared';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { getDeviceContext } from '$lib/components/device/context';

	const ctx = getDeviceContext();

	let showBuilder = $state(false);

	function handleSubmit(steps: Parameters<typeof ctx.handleWorkflowSubmit>[0], variables: Parameters<typeof ctx.handleWorkflowSubmit>[1]) {
		showBuilder = false;
		ctx.handleWorkflowSubmit(steps, variables);
	}

	// Determine if the selected run is the live run
	const isLiveSelected = $derived(
		ctx.liveWorkflowRun && ctx.selectedRunId === ctx.liveWorkflowRun.runId
	);
</script>

<div class="flex flex-col gap-6 lg:flex-row">
	<!-- ═══════════ Left sidebar ═══════════ -->
	<div class="w-full shrink-0 space-y-6 lg:w-72 xl:w-80">
		<!-- Run a task button -->
		<Button
			onclick={() => (showBuilder = true)}
			disabled={ctx.liveWorkflowRun?.status === 'running'}
			class="w-full gap-2"
		>
			<Icon icon="solar:play-bold" class="h-3.5 w-3.5" />
			Run a task
		</Button>

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
			<RunViewer
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
			<EmptyState
				title="Select a run or start a new task"
				description="Runs will appear in the sidebar"
			/>
		{/if}
	</div>
</div>

<!-- Workflow Builder Dialog -->
<Dialog.Root bind:open={showBuilder}>
	<Dialog.Content class="max-h-[85vh] max-w-2xl overflow-y-auto p-4 sm:p-6 bg-white">
		<WorkflowBuilder
			disabled={ctx.liveWorkflowRun?.status === 'running'}
			onsubmit={handleSubmit}
			onstop={() => { showBuilder = false; ctx.handleWorkflowStop(); }}
			isRunning={ctx.liveWorkflowRun?.status === 'running'}
		/>
	</Dialog.Content>
</Dialog.Root>
