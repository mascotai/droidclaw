<script lang="ts">
	import Icon from '@iconify/svelte';
	import WorkflowRunRow from './WorkflowRunRow.svelte';
	import StepDetailModal from './StepDetailModal.svelte';
	import { EmptyState } from '$lib/components/shared';
	import { Button } from '$lib/components/ui/button';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as Tabs from '$lib/components/ui/tabs';
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
		loadSessionSteps: (sessionId: string) => Promise<Step[]>;
	}

	let { runs, liveProgress, loaded, page, totalPages, onpagechange, loadSessionSteps }: Props = $props();

	// Filter state
	let filter = $state<string>('all');

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
	<!-- Header with tabs filter -->
	<div class="mb-4 flex items-center justify-between">
		<div class="flex items-center gap-2">
			<Icon icon="solar:history-bold-duotone" class="h-4 w-4 text-stone-400" />
			<p class="text-sm font-medium text-stone-700">Run History</p>
		</div>
		<Tabs.Root bind:value={filter}>
			<Tabs.List class="h-8">
				<Tabs.Trigger value="all" class="text-[11px] px-2.5 py-1">All</Tabs.Trigger>
				<Tabs.Trigger value="single" class="text-[11px] px-2.5 py-1">Single</Tabs.Trigger>
				<Tabs.Trigger value="multi" class="text-[11px] px-2.5 py-1">Multi</Tabs.Trigger>
			</Tabs.List>
		</Tabs.Root>
	</div>

	<!-- Content -->
	{#if !loaded}
		<div class="space-y-3">
			{#each [1, 2, 3] as _}
				<Skeleton class="h-20 w-full rounded-2xl" />
			{/each}
		</div>
	{:else if filteredRuns.length === 0}
		<EmptyState
			icon="solar:history-bold-duotone"
			title={filter === 'all' ? 'No workflow runs yet.' : `No ${filter === 'single' ? 'single-step' : 'multi-step'} runs found.`}
		/>
		{#if filter !== 'all'}
			<div class="mt-2 text-center">
				<Button variant="link" size="sm" onclick={() => (filter = 'all')}>
					Show all runs
				</Button>
			</div>
		{/if}
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
				<Button
					variant="ghost"
					size="sm"
					onclick={() => onpagechange(page - 1)}
					disabled={page <= 1}
					class="gap-1 text-xs"
				>
					<Icon icon="solar:alt-arrow-left-linear" class="h-3.5 w-3.5" />
					Prev
				</Button>
				<span class="text-xs text-stone-400">
					Page {page} of {totalPages}
				</span>
				<Button
					variant="ghost"
					size="sm"
					onclick={() => onpagechange(page + 1)}
					disabled={page >= totalPages}
					class="gap-1 text-xs"
				>
					Next
					<Icon icon="solar:alt-arrow-right-linear" class="h-3.5 w-3.5" />
				</Button>
			</div>
		{/if}
	{/if}
</div>

<!-- Step detail sheet -->
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
