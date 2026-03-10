<script lang="ts">
	import UnifiedLog from '$lib/components/device/UnifiedLog.svelte';
	import { getDeviceContext } from '$lib/components/device/context';

	const ctx = getDeviceContext();
</script>

<UnifiedLog
	runs={ctx.workflowRuns}
	liveProgress={ctx.workflowLiveProgress}
	loaded={ctx.workflowsLoaded}
	page={ctx.workflowsPage}
	totalPages={ctx.workflowsTotalPages}
	onpagechange={ctx.handleLogPageChange}
	loadSessionSteps={ctx.loadSessionSteps}
/>
