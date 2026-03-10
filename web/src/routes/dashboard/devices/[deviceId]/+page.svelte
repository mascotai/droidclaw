<script lang="ts">
	import WorkflowBuilder from '$lib/components/device/WorkflowBuilder.svelte';
	import ExecutionPipeline from '$lib/components/device/ExecutionPipeline.svelte';
	import ActiveWorkflows from '$lib/components/device/ActiveWorkflows.svelte';
	import { getDeviceContext } from '$lib/components/device/context';

	const ctx = getDeviceContext();
</script>

<div class="space-y-8">
	<!-- Workflow Builder -->
	<WorkflowBuilder
		disabled={ctx.liveWorkflowRun?.status === 'running'}
		onsubmit={ctx.handleWorkflowSubmit}
		onstop={ctx.handleWorkflowStop}
		isRunning={ctx.liveWorkflowRun?.status === 'running'}
	/>

	<!-- Execution Pipeline (only visible when something is running/queued) -->
	<ExecutionPipeline
		liveRun={ctx.liveWorkflowRun}
		queued={ctx.queuedItems}
		onstop={ctx.handleWorkflowStop}
		oncancel={ctx.handleQueueCancel}
		runningCachedFlow={ctx.runningCachedFlow}
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
