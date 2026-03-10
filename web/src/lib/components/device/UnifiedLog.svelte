<script lang="ts">
	import Icon from '@iconify/svelte';
	import WorkflowRunRow from './WorkflowRunRow.svelte';
	import StepDetailModal from './StepDetailModal.svelte';
	import type {
		WorkflowRun,
		WorkflowLiveProgress,
		StepResult,
		WorkflowStepConfig,
		Step
	} from './types';

	interface Props {
		runs: WorkflowRun[];
		liveProgress: Record<string, WorkflowLiveProgress>;
		loaded: boolean;
		page: number;
		totalPages: number;
		onpagechange: (page: number) => void;
		/** Callback to load agent steps for a session */
		loadSessionSteps: (sessionId: string) => Promise<Step[]>;
	}

	let { runs, liveProgress, loaded, page, totalPages, onpagechange, loadSessionSteps }: Props =
		$props();

	// Filter state
	type Filter = 'all' | 'single' | 'multi';
	let filter = $state<Filter>('all');

	const filteredRuns = $derived(
		filter === 'all'
			? runs
			: filter === 'single'
				? runs.filter((r) => r.totalSteps === 1)
				: runs.filter((r) => r.totalSteps > 1)
	);

	// Expansion state
	let expandedRunId = $state<string | null>(null);

	function toggleExpand(runId: string) {
		expandedRunId = expandedRunId === runId ? null : runId;
	}

	// Step detail modal state
	let modalData = $state<{
		stepIdx: number;
		stepResult: StepResult;
		config: WorkflowStepConfig | null;
	} | null>(null);
	let modalSteps = $state<Step[]>([]);
	let modalStepsLoading = $state(false);
	let modalRun = $state<WorkflowRun | null>(null);

	function getStepConfig(run: WorkflowRun, stepIdx: number): WorkflowStepConfig | null {
		const step = run.steps?.[stepIdx];
		if (!step) return null;
		if (typeof step === 'string') return { goal: step };
		if (typeof step === 'object' && 'goal' in step) return step as WorkflowStepConfig;
		const [cmd, val] = Object.entries(step)[0] ?? [];
		return cmd ? { goal: `${cmd}: ${val}` } : null;
	}

	async function handleStepClick(run: WorkflowRun, stepIdx: number) {
		const stepResult = (run.stepResults as StepResult[] | null)?.[stepIdx];
		if (!stepResult) return;
		const config = getStepConfig(run, stepIdx);
		modalData = { stepIdx, stepResult, config };
		modalRun = run;
		modalSteps = [];
		modalStepsLoading = false;

		if (stepResult.sessionId) {
			modalStepsLoading = true;
			try {
				modalSteps = await loadSessionSteps(stepResult.sessionId);
			} catch {
				// ignore
			}
			modalStepsLoading = false;
		}
	}

	function closeModal() {
		modalData = null;
		modalSteps = [];
		modalRun = null;
	}

	const screenWidth = $derived(modalRun ? 1080 : 0);
	const screenHeight = $derived(modalRun ? 2340 : 0);
</script>

<div>
	<!-- Header with filter -->
	<div class="mb-4 flex items-center justify-between">
		<div class="flex items-center gap-2">
			<Icon icon="solar:history-bold-duotone" class="h-4 w-4 text-stone-400" />
			<p class="text-sm font-medium text-stone-700">Run History</p>
		</div>
		<div class="flex gap-1 rounded-lg bg-stone-100 p-0.5">
			{#each [
				{ id: 'all' as Filter, label: 'All' },
				{ id: 'single' as Filter, label: 'Single' },
				{ id: 'multi' as Filter, label: 'Multi' }
			] as f}
				<button
					onclick={() => (filter = f.id)}
					class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors
						{filter === f.id
						? 'bg-white text-stone-700 shadow-sm'
						: 'text-stone-400 hover:text-stone-600'}"
				>
					{f.label}
				</button>
			{/each}
		</div>
	</div>

	<!-- Content -->
	{#if !loaded}
		<div class="space-y-3">
			{#each [1, 2, 3] as _}
				<div class="animate-pulse rounded-2xl bg-white p-4">
					<div class="h-4 w-48 rounded bg-stone-200"></div>
					<div class="mt-2 h-3 w-32 rounded bg-stone-100"></div>
				</div>
			{/each}
		</div>
	{:else if filteredRuns.length === 0}
		<div class="rounded-2xl bg-white px-6 py-12 text-center">
			<Icon icon="solar:history-bold-duotone" class="mx-auto mb-3 h-10 w-10 text-stone-200" />
			<p class="text-sm text-stone-400">
				{filter === 'all' ? 'No workflow runs yet.' : `No ${filter === 'single' ? 'single-step' : 'multi-step'} runs found.`}
			</p>
			{#if filter !== 'all'}
				<button
					onclick={() => (filter = 'all')}
					class="mt-2 text-xs text-blue-500 hover:text-blue-700"
				>
					Show all runs
				</button>
			{/if}
		</div>
	{:else}
		<div class="space-y-2">
			{#each filteredRuns as run (run.id)}
				<WorkflowRunRow
					{run}
					liveProgress={liveProgress[run.id]}
					onexpand={toggleExpand}
					onstepclick={handleStepClick}
					expanded={expandedRunId === run.id}
				/>
			{/each}
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<div class="mt-4 flex items-center justify-center gap-2">
				<button
					onclick={() => onpagechange(page - 1)}
					disabled={page <= 1}
					class="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors
						{page <= 1 ? 'text-stone-300 cursor-not-allowed' : 'text-stone-500 hover:bg-white hover:text-stone-700'}"
				>
					<Icon icon="solar:alt-arrow-left-linear" class="h-3.5 w-3.5" />
					Prev
				</button>
				<span class="text-xs text-stone-400">
					Page {page} of {totalPages}
				</span>
				<button
					onclick={() => onpagechange(page + 1)}
					disabled={page >= totalPages}
					class="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors
						{page >= totalPages ? 'text-stone-300 cursor-not-allowed' : 'text-stone-500 hover:bg-white hover:text-stone-700'}"
				>
					Next
					<Icon icon="solar:alt-arrow-right-linear" class="h-3.5 w-3.5" />
				</button>
			</div>
		{/if}
	{/if}
</div>

<!-- Step detail modal -->
{#if modalData}
	<StepDetailModal
		data={modalData}
		steps={modalSteps}
		stepsLoading={modalStepsLoading}
		{screenWidth}
		{screenHeight}
		onclose={closeModal}
	/>
{/if}
