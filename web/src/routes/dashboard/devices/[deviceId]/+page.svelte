<script lang="ts">
	import Icon from '@iconify/svelte';
	import WorkflowBuilder from '$lib/components/device/WorkflowBuilder.svelte';
	import ExecutionPipeline from '$lib/components/device/ExecutionPipeline.svelte';
	import ActiveWorkflows from '$lib/components/device/ActiveWorkflows.svelte';
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
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="space-y-6">
	<!-- Run a task button -->
	<button
		onclick={() => (showBuilder = true)}
		disabled={ctx.liveWorkflowRun?.status === 'running'}
		class="inline-flex items-center gap-2 rounded-xl bg-stone-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-40"
	>
		<Icon icon="solar:play-bold" class="h-3.5 w-3.5" />
		Run a task
	</button>

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
