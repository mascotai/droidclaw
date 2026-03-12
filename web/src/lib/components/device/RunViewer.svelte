<script lang="ts">
	import Icon from '@iconify/svelte';
	import ActionBadge from './ActionBadge.svelte';
	import LiveAgentSteps from './LiveAgentSteps.svelte';
	import { StatusBadge, DurationDisplay, EmptyState } from '$lib/components/shared';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Progress } from '$lib/components/ui/progress';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { ScrollArea } from '$lib/components/ui/scroll-area';
	import type {
		WorkflowRun,
		LiveWorkflowRun,
		StepResult,
		WorkflowStepConfig,
		AgentStepDetail
	} from './types';

	interface Props {
		/** The historical run loaded from the server (null when showing live) */
		run: WorkflowRun | null;
		/** Live run (when selectedRunId matches liveWorkflowRun.runId) */
		liveRun: LiveWorkflowRun | null;
		/** Whether we're currently loading the run detail */
		loading: boolean;
		/** Stop callback for live runs */
		onstop: () => void;
		/** Whether this run was triggered from a cached flow */
		cachedFlowMeta?: { goalKey: string; stepCount: number; successCount: number } | null;
	}

	let { run, liveRun, loading, onstop, cachedFlowMeta = null }: Props = $props();

	// Which steps have their agent detail expanded (historical mode)
	let expandedSteps = $state<Set<number>>(new Set());

	function toggleStep(idx: number) {
		const next = new Set(expandedSteps);
		if (next.has(idx)) next.delete(idx);
		else next.add(idx);
		expandedSteps = next;
	}

	// Track frozen step indices for shimmer animation (live mode)
	let frozenStepIndices = $state<Set<number>>(new Set());
	$effect(() => {
		if (!liveRun) return;
		liveRun.stepResults.forEach((result, idx) => {
			if (result?.resolvedBy === 'cached_flow' && !frozenStepIndices.has(idx)) {
				frozenStepIndices = new Set([...frozenStepIndices, idx]);
			}
		});
	});

	// Reset expanded steps when run changes
	$effect(() => {
		const _runId = run?.id ?? liveRun?.runId;
		expandedSteps = new Set();
	});

	// ─── Shared helpers ────────────────────────────────────────

	/** Determine if we're in live mode */
	const isLive = $derived(!!liveRun);

	/** Active data source */
	const activeStatus = $derived(liveRun?.status ?? run?.status ?? 'pending');
	const activeName = $derived(liveRun?.name ?? run?.name ?? 'Run');
	const activeType = $derived(liveRun?.wfType ?? run?.type ?? 'workflow');
	const activeTotalSteps = $derived(liveRun?.totalSteps ?? run?.totalSteps ?? 0);

	/** Progress for live runs */
	const completedCount = $derived(
		liveRun
			? liveRun.stepResults.filter((r) => r !== null).length
			: ((run?.stepResults as StepResult[]) ?? []).filter((r) => r != null).length
	);
	const progressPercent = $derived(activeTotalSteps > 0 ? (completedCount / activeTotalSteps) * 100 : 0);

	// ─── Step card styling ─────────────────────────────────────

	function stepCardClass(idx: number, isLiveMode: boolean): string {
		const result = isLiveMode ? liveRun?.stepResults[idx] : (run?.stepResults as StepResult[] | null)?.[idx];
		const isActive = isLiveMode && liveRun?.activeStepIndex === idx && liveRun?.status === 'running';

		let cls = 'rounded-xl transition-all duration-500 ';
		if (result?.resolvedBy === 'cached_flow') {
			cls += 'bg-cyan-50 border border-cyan-200 shadow-[0_0_0_1px_rgba(6,182,212,0.1)] freeze-shimmer';
		} else if (isActive) {
			cls += 'bg-violet-50 border border-violet-200 ring-1 ring-violet-200 shadow-sm';
		} else if (result) {
			cls += 'bg-white border border-stone-200' + (isLiveMode ? '' : ' hover:border-stone-300');
		} else {
			cls += 'bg-white border border-stone-200 opacity-50';
		}
		return cls;
	}

	function resolvedByIcon(resolvedBy?: string): string {
		if (resolvedBy === 'cached_flow') return 'solar:bolt-bold-duotone';
		return 'solar:cpu-bolt-bold-duotone';
	}

	function resolvedByLabel(resolvedBy?: string): string {
		if (resolvedBy === 'cached_flow') return 'Cached';
		if (resolvedBy) return resolvedBy;
		return 'Agent';
	}

	function resolvedByClass(resolvedBy?: string): string {
		if (resolvedBy === 'cached_flow') return 'bg-cyan-100 text-cyan-700';
		return 'bg-violet-100 text-violet-700';
	}

	function getStepGoal(stepIdx: number): string {
		if (liveRun) return liveRun.stepGoals[stepIdx]?.goal ?? `Goal ${stepIdx + 1}`;
		if (!run) return '';
		const stepResult = (run.stepResults as StepResult[] | null)?.[stepIdx];
		if (stepResult?.goal) return stepResult.goal;
		if (stepResult?.command) return stepResult.command ?? '';
		const step = run.steps?.[stepIdx];
		if (!step) return `Goal ${stepIdx + 1}`;
		if (typeof step === 'string') return step;
		if (typeof step === 'object' && 'goal' in step) return (step as WorkflowStepConfig).goal;
		const [cmd, val] = Object.entries(step)[0] ?? [];
		return cmd ? `${cmd}: ${val}` : `Goal ${stepIdx + 1}`;
	}

	function getStepApp(stepIdx: number): string | null {
		if (liveRun) return liveRun.stepGoals[stepIdx]?.app ?? null;
		if (!run) return null;
		const step = run.steps?.[stepIdx];
		if (!step || typeof step === 'string') return null;
		if (typeof step === 'object' && 'app' in step) return (step as WorkflowStepConfig).app ?? null;
		return null;
	}

	function parseAction(action: unknown): {
		type: string;
		coords?: number[];
		text?: string;
		direction?: string;
	} {
		if (typeof action === 'string') return { type: action };
		if (typeof action === 'object' && action !== null) {
			const a = action as Record<string, unknown>;
			return {
				type: (a.action as string) ?? 'unknown',
				coords: a.coordinates as number[] | undefined,
				text: a.text as string | undefined,
				direction: a.direction as string | undefined,
			};
		}
		return { type: 'unknown' };
	}

	function durationMs(startedAt: Date | string, completedAt: Date | string | null): number {
		if (!completedAt) return -1;
		return new Date(completedAt).getTime() - new Date(startedAt).getTime();
	}

	/** Summary stats */
	const summaryStats = $derived.by(() => {
		const results = liveRun
			? liveRun.stepResults
			: ((run?.stepResults as StepResult[]) ?? []);
		const completed = results.filter((r) => r != null);
		const success = completed.filter((r) => r?.success);
		const cached = completed.filter((r) => r?.resolvedBy === 'cached_flow');
		return {
			total: activeTotalSteps,
			completed: completed.length,
			success: success.length,
			cached: cached.length,
		};
	});
</script>

{#if loading}
	<!-- Loading skeleton -->
	<div class="space-y-3">
		<Skeleton class="h-8 w-48" />
		<Skeleton class="h-24 w-full" />
		<Skeleton class="h-24 w-full" />
	</div>
{:else if liveRun || run}
	<div>
		<!-- Header Card -->
		<Card.Root class="mb-4">
			<Card.Header class="pb-3">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2.5">
						{#if cachedFlowMeta}
							<Icon icon="solar:bolt-bold-duotone" class="h-4.5 w-4.5 text-cyan-500" />
						{:else}
							<Icon
								icon={activeType === 'flow' ? 'solar:programming-bold-duotone' : 'solar:layers-bold-duotone'}
								class="h-4.5 w-4.5 {activeStatus === 'completed' ? 'text-emerald-500' : activeStatus === 'running' ? 'text-violet-500' : 'text-red-500'}"
							/>
						{/if}
						<Card.Title class="text-sm">{activeName}</Card.Title>
						{#if cachedFlowMeta}
							<span class="text-xs text-stone-400">
								{cachedFlowMeta.stepCount} steps · {cachedFlowMeta.successCount} hits
							</span>
						{/if}
					</div>
					<div class="flex items-center gap-2">
						{#if run && run.completedAt}
							<DurationDisplay ms={durationMs(run.startedAt, run.completedAt)} class="text-xs text-stone-400" />
						{/if}
						{#if activeStatus === 'running'}
							<StatusBadge status="running" />
							<Button variant="destructive" size="sm" onclick={onstop} class="h-7 gap-1 text-xs">
								<Icon icon="solar:stop-bold" class="h-3 w-3" />
								Stop
							</Button>
						{:else}
							<StatusBadge status={activeStatus} pulse={false} />
						{/if}
					</div>
				</div>
			</Card.Header>

			<!-- Progress bar for live runs -->
			{#if activeStatus === 'running' && activeTotalSteps > 0}
				<div class="px-6 pb-4">
					<Progress value={progressPercent} class="h-1.5" />
					<p class="mt-1 text-xs text-stone-400">
						Step {completedCount + 1} of {activeTotalSteps}
					</p>
				</div>
			{/if}
		</Card.Root>

		<!-- Steps list -->
		<ScrollArea class="max-h-[65vh]">
				<div class="space-y-2">
					{#each Array.from({ length: activeTotalSteps }, (_, i) => i) as stepIdx}
						{@const result = isLive ? liveRun?.stepResults[stepIdx] : (run?.stepResults as StepResult[] | null)?.[stepIdx]}
						{@const isActive = isLive && liveRun?.activeStepIndex === stepIdx && liveRun?.status === 'running'}
						{@const hasAgentSteps = !isLive && result && 'agentSteps' in (result as Record<string, unknown>) && (result as StepResult).agentSteps && ((result as StepResult).agentSteps as AgentStepDetail[]).length > 0}
						{@const isExpanded = expandedSteps.has(stepIdx)}
						{@const app = getStepApp(stepIdx)}
						<div class={stepCardClass(stepIdx, isLive)}>
							<!-- Step row -->
							<button
								onclick={() => hasAgentSteps ? toggleStep(stepIdx) : null}
								class="flex w-full items-start gap-2.5 px-4 py-3 text-left {hasAgentSteps ? 'cursor-pointer' : 'cursor-default'}"
								disabled={!hasAgentSteps && !isActive}
							>
								<!-- Step number badge -->
								<span
									class="mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-mono text-xs
										{result
											? result.success ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
											: isActive ? 'bg-violet-100 text-violet-700'
											: 'bg-stone-200 text-stone-500'}"
								>
									{stepIdx + 1}
								</span>

								<!-- Goal + details -->
								<div class="min-w-0 flex-1">
									<p class="text-xs leading-relaxed text-stone-800">{getStepGoal(stepIdx)}</p>
									{#if app}
										<span class="mt-0.5 inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">
											<Icon icon="solar:box-bold-duotone" class="h-2.5 w-2.5" />
											{app}
										</span>
									{/if}

									<!-- Active step: show live state -->
									{#if isActive && liveRun}
										<div class="mt-1.5 flex items-center gap-1.5">
											<Icon icon="solar:refresh-circle-bold-duotone" class="h-3.5 w-3.5 animate-spin text-violet-500" />
											<span class="text-xs text-violet-600">
												Discovering...
												{#if liveRun.totalAttempts > 1}
													<span class="text-violet-400">&middot;</span>
													Attempt {liveRun.attempt}/{liveRun.totalAttempts}
												{/if}
											</span>
										</div>
										<LiveAgentSteps steps={liveRun.liveSteps} variant="live" />
									{/if}

									<!-- Error message -->
									{#if result && !result.success && (result.error || result.message)}
										<p class="mt-1 text-xs text-red-500">{result.error ?? result.message}</p>
									{/if}
								</div>

								<!-- Right side: status + resolvedBy + expand chevron -->
								<div class="flex shrink-0 items-center gap-2">
									<div class="flex flex-col items-end gap-1">
										{#if result}
											<span class="flex items-center gap-1 text-xs font-medium {result.success ? 'text-emerald-600' : 'text-red-600'}">
												<Icon
													icon={result.success ? 'solar:check-circle-bold-duotone' : 'solar:close-circle-bold-duotone'}
													class="h-3.5 w-3.5"
												/>
												{result.success ? 'OK' : 'Failed'}
											</span>
											{#if result.stepsUsed !== undefined && result.stepsUsed > 0}
												<span class="text-xs text-stone-400">
													{result.stepsUsed} step{result.stepsUsed !== 1 ? 's' : ''}
												</span>
											{/if}
											{#if result.resolvedBy}
												<span class="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] font-medium {resolvedByClass(result.resolvedBy)}">
													<Icon icon={resolvedByIcon(result.resolvedBy)} class="h-2.5 w-2.5" />
													{resolvedByLabel(result.resolvedBy)}
												</span>
											{/if}
										{:else if isActive}
											<span class="flex items-center gap-1 text-xs font-medium text-violet-600">
												<Icon icon="solar:refresh-circle-bold-duotone" class="h-3.5 w-3.5 animate-spin" />
												Running
											</span>
										{:else}
											<span class="flex items-center gap-1 text-xs font-medium text-stone-400">
												<Icon icon="solar:clock-circle-bold-duotone" class="h-3.5 w-3.5" />
												Pending
											</span>
										{/if}
									</div>
									{#if hasAgentSteps}
										<Icon
											icon={isExpanded ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'}
											class="h-3.5 w-3.5 text-stone-300"
										/>
									{/if}
								</div>
							</button>

							<!-- Expanded agent steps (historical mode only) -->
							{#if isExpanded && !isLive && result && 'agentSteps' in (result as Record<string, unknown>) && (result as StepResult).agentSteps}
								{@const agentSteps = (result as StepResult).agentSteps as AgentStepDetail[]}
								<div class="border-t border-stone-100 px-4 pb-3 pt-2">
									<div class="space-y-1 border-l-2 border-stone-200 pl-3">
										{#each agentSteps as agentStep (agentStep.id)}
											{@const act = parseAction(agentStep.action)}
											<div class="flex items-start gap-1.5">
												<span class="mt-0.5 shrink-0 rounded bg-stone-100 px-1 py-0.5 font-mono text-[9px] text-stone-500">
													{agentStep.stepNumber}
												</span>
												<div class="min-w-0 flex-1">
													<div class="flex items-center gap-1.5">
														<ActionBadge action={act.type} />
														{#if act.coords && act.coords.length >= 2}
															<span class="font-mono text-xs text-stone-400">({act.coords[0]}, {act.coords[1]})</span>
														{/if}
														{#if act.text}
															<span class="rounded bg-stone-50 px-1 py-0.5 text-xs text-stone-700">"{act.text}"</span>
														{/if}
														{#if act.direction}
															<span class="text-xs text-stone-400">{act.direction}</span>
														{/if}
													</div>
													{#if agentStep.reasoning}
														<p class="mt-0.5 text-xs leading-relaxed text-stone-500">{agentStep.reasoning}</p>
													{/if}
													{#if agentStep.result}
														<p class="mt-0.5 text-xs text-stone-400">{agentStep.result}</p>
													{/if}
												</div>
												{#if agentStep.durationMs}
													<span class="shrink-0 text-[9px] text-stone-300">{Math.round(agentStep.durationMs / 1000)}s</span>
												{/if}
											</div>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
		</ScrollArea>

		<!-- Summary bar -->
		{#if activeStatus !== 'running' && summaryStats.completed > 0}
			<Card.Root class="mt-3">
				<Card.Content class="flex items-center gap-3 py-2.5 text-xs text-stone-500">
					<span>{summaryStats.success}/{summaryStats.total} passed</span>
					{#if summaryStats.cached > 0}
						<span class="text-stone-300">&middot;</span>
						<span class="flex items-center gap-0.5 text-cyan-600">
							<Icon icon="solar:bolt-bold-duotone" class="h-3 w-3" />
							{summaryStats.cached} cached
						</span>
					{/if}
					{#if run?.completedAt}
						<span class="text-stone-300">&middot;</span>
						<DurationDisplay ms={durationMs(run.startedAt, run.completedAt)} />
					{/if}
				</Card.Content>
			</Card.Root>
		{/if}
	</div>
{:else}
	<!-- Empty state -->
	<EmptyState
		title="Select a run to view details"
		icon="solar:inbox-bold-duotone"
	/>
{/if}
