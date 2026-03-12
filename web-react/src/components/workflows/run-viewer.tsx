import { useState, useMemo, useEffect, useCallback } from 'react';
import {
	CheckCircle2,
	XCircle,
	Loader2,
	Clock,
	ChevronDown,
	ChevronUp,
	Zap,
	Layers,
	Code2,
	Square,
	Package,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { StatusBadge, DurationDisplay, EmptyState, ActionBadge } from '@/components/shared';
import { LiveAgentSteps } from '@/components/goals/live-agent-steps';
import { api } from '@/lib/api';
import type {
	WorkflowRun,
	LiveWorkflowRun,
	StepResult,
	WorkflowStepConfig,
} from '@/types/devices';
import { cn } from '@/lib/utils';

interface RunViewerProps {
	/** Historical run loaded from the server (null when showing live) */
	run: WorkflowRun | null;
	/** Live run (when selectedRunId matches liveWorkflowRun.runId) */
	liveRun: LiveWorkflowRun | null;
	/** Whether we're currently loading the run detail */
	loading: boolean;
	/** Stop callback for live runs */
	onStop: () => void;
	/** Device ID for fetching goal steps */
	deviceId: string;
	/** Whether this run was triggered from a cached flow */
	cachedFlowMeta?: { goalKey: string; stepCount: number; successCount: number } | null;
}

interface GoalStepData {
	steps: Array<{
		step: number;
		action: Record<string, unknown>;
		reasoning: string;
		result: string | null;
		package: string;
		durationMs: number;
	}>;
	note?: string;
	loading: boolean;
}

function durationMs(startedAt: Date | string, completedAt: Date | string | null): number {
	if (!completedAt) return -1;
	return new Date(completedAt).getTime() - new Date(startedAt).getTime();
}

function resolvedByLabel(resolvedBy?: string): string {
	if (resolvedBy === 'cached_flow') return 'cached';
	if (resolvedBy) return resolvedBy;
	return 'agent';
}

function parseAction(action: unknown): {
	type: string;
	coords?: number[];
	text?: string;
	direction?: string;
	target?: string;
	reason?: string;
	think?: string;
} {
	if (typeof action === 'string') return { type: action };
	if (typeof action === 'object' && action !== null) {
		const a = action as Record<string, unknown>;
		return {
			type: (a.action as string) ?? 'unknown',
			coords: a.coordinates as number[] | undefined,
			text: a.text as string | undefined,
			direction: a.direction as string | undefined,
			target: a.target as string | undefined,
			reason: a.reason as string | undefined,
			think: a.think as string | undefined,
		};
	}
	return { type: 'unknown' };
}

export function RunViewer({ run, liveRun, loading, onStop, deviceId, cachedFlowMeta = null }: RunViewerProps) {
	const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
	const [goalSteps, setGoalSteps] = useState<Record<number, GoalStepData>>({});

	// Reset expanded steps when run changes
	useEffect(() => {
		setExpandedSteps(new Set());
		setGoalSteps({});
	}, [run?.id, liveRun?.runId]);

	const fetchGoalSteps = useCallback(async (goalIdx: number) => {
		const runId = run?.id ?? liveRun?.runId;
		if (!runId) return;

		setGoalSteps((prev) => ({
			...prev,
			[goalIdx]: { steps: [], loading: true },
		}));

		try {
			const data = await api.getGoalSteps(deviceId, runId, goalIdx);
			setGoalSteps((prev) => ({
				...prev,
				[goalIdx]: {
					steps: (data.steps ?? []) as GoalStepData['steps'],
					note: data.note,
					loading: false,
				},
			}));
		} catch {
			setGoalSteps((prev) => ({
				...prev,
				[goalIdx]: { steps: [], note: 'Failed to load steps', loading: false },
			}));
		}
	}, [run?.id, liveRun?.runId, deviceId]);

	function toggleStep(idx: number) {
		setExpandedSteps((prev) => {
			const next = new Set(prev);
			if (next.has(idx)) {
				next.delete(idx);
			} else {
				next.add(idx);
				// Fetch steps if not already loaded
				if (!goalSteps[idx]) {
					fetchGoalSteps(idx);
				}
			}
			return next;
		});
	}

	const isLive = !!liveRun;
	const activeStatus = liveRun?.status ?? run?.status ?? 'pending';
	const activeName = liveRun?.name ?? run?.name ?? 'Run';
	const activeType = liveRun?.wfType ?? run?.type ?? 'workflow';
	const activeTotalSteps = liveRun?.totalSteps ?? run?.totalSteps ?? 0;

	const completedCount = useMemo(() => {
		if (liveRun) return liveRun.stepResults.filter((r) => r !== null).length;
		return ((run?.stepResults as StepResult[]) ?? []).filter((r) => r != null).length;
	}, [liveRun, run?.stepResults]);

	const progressPercent = activeTotalSteps > 0 ? (completedCount / activeTotalSteps) * 100 : 0;

	const summaryStats = useMemo(() => {
		const results = liveRun ? liveRun.stepResults : ((run?.stepResults as StepResult[]) ?? []);
		const completed = results.filter((r) => r != null);
		const success = completed.filter((r) => r?.success);
		const cached = completed.filter((r) => r?.resolvedBy === 'cached_flow');
		return {
			total: activeTotalSteps,
			completed: completed.length,
			success: success.length,
			cached: cached.length,
		};
	}, [liveRun, run?.stepResults, activeTotalSteps]);

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

	function stepCardClass(idx: number): string {
		const result = isLive ? liveRun?.stepResults[idx] : (run?.stepResults as StepResult[] | null)?.[idx];
		const isActive = isLive && liveRun?.activeStepIndex === idx && liveRun?.status === 'running';

		let cls = 'rounded-xl transition-all duration-500 ';
		if (isActive) {
			cls += 'bg-violet-50 border border-violet-200 ring-1 ring-violet-200 shadow-sm';
		} else if (result) {
			cls += 'bg-white border border-stone-200 hover:border-stone-300';
		} else {
			cls += 'bg-white border border-stone-200 opacity-50';
		}
		return cls;
	}

	if (loading) {
		return (
			<div className="space-y-3">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-24 w-full" />
				<Skeleton className="h-24 w-full" />
			</div>
		);
	}

	if (!liveRun && !run) {
		return <EmptyState title="Select a run to view details" />;
	}

	return (
		<div>
			{/* Header Card */}
			<Card className="mb-4">
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2.5">
							{cachedFlowMeta ? (
								<Zap className="h-4.5 w-4.5 text-stone-400" />
							) : activeType === 'flow' ? (
								<Code2 className={cn('h-4.5 w-4.5', activeStatus === 'completed' ? 'text-emerald-500' : activeStatus === 'running' ? 'text-violet-500' : 'text-red-500')} />
							) : (
								<Layers className={cn('h-4.5 w-4.5', activeStatus === 'completed' ? 'text-emerald-500' : activeStatus === 'running' ? 'text-violet-500' : 'text-red-500')} />
							)}
							<CardTitle className="text-sm">{activeName}</CardTitle>
							{cachedFlowMeta ? (
								<span className="text-xs text-stone-400">
									{cachedFlowMeta.stepCount} steps &middot; {cachedFlowMeta.successCount} hits
								</span>
							) : null}
						</div>
						<div className="flex items-center gap-2">
							{run?.completedAt ? (
								<DurationDisplay ms={durationMs(run.startedAt, run.completedAt)} className="text-xs text-stone-400" />
							) : null}
							{activeStatus === 'running' ? (
								<>
									<StatusBadge status="running" />
									<Button variant="destructive" size="sm" onClick={onStop} className="h-7 gap-1 text-xs">
										<Square className="h-3 w-3" />
										Stop
									</Button>
								</>
							) : (
								<StatusBadge status={activeStatus} pulse={false} />
							)}
						</div>
					</div>
				</CardHeader>

				{/* Progress bar for live runs */}
				{activeStatus === 'running' && activeTotalSteps > 0 ? (
					<div className="px-6 pb-4">
						<div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
							<div
								className="h-full rounded-full bg-violet-500 transition-all duration-500"
								style={{ width: `${progressPercent}%` }}
							/>
						</div>
						<p className="mt-1 text-xs text-stone-400">
							Step {completedCount + 1} of {activeTotalSteps}
						</p>
					</div>
				) : null}
			</Card>

			{/* Steps list */}
			<ScrollArea className="max-h-[65vh]">
				<div className="space-y-2">
					{Array.from({ length: activeTotalSteps }, (_, stepIdx) => {
						const result = isLive ? liveRun?.stepResults[stepIdx] : (run?.stepResults as StepResult[] | null)?.[stepIdx];
						const isActive = isLive && liveRun?.activeStepIndex === stepIdx && liveRun?.status === 'running';
						const canExpand = !isLive && result != null;
						const isExpanded = expandedSteps.has(stepIdx);
						const app = getStepApp(stepIdx);
						const stepsData = goalSteps[stepIdx];

						return (
							<div key={stepIdx} className={stepCardClass(stepIdx)}>
								{/* Step row */}
								<button
									onClick={() => canExpand ? toggleStep(stepIdx) : undefined}
									className={cn(
										'flex w-full items-start gap-2.5 px-4 py-3 text-left',
										canExpand ? 'cursor-pointer' : 'cursor-default',
									)}
									disabled={!canExpand && !isActive}
								>
									{/* Step number badge */}
									<span className={cn(
										'mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-mono text-xs',
										result
											? result.success ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
											: isActive ? 'bg-violet-100 text-violet-700' : 'bg-stone-200 text-stone-500',
									)}>
										{stepIdx + 1}
									</span>

									{/* Goal + details */}
									<div className="min-w-0 flex-1">
										<p className="text-xs leading-relaxed text-stone-800">{getStepGoal(stepIdx)}</p>
										{app ? (
											<span className="mt-0.5 inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-600">
												<Package className="h-2.5 w-2.5" />
												{app}
											</span>
										) : null}

										{/* Active step: live state */}
										{isActive && liveRun ? (
											<>
												<div className="mt-1.5 flex items-center gap-1.5">
													<Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
													<span className="text-xs text-violet-600">
														Discovering...
														{liveRun.totalAttempts > 1 ? (
															<>
																<span className="text-violet-400"> &middot; </span>
																Attempt {liveRun.attempt}/{liveRun.totalAttempts}
															</>
														) : null}
													</span>
												</div>
												<LiveAgentSteps steps={liveRun.liveSteps} variant="live" />
											</>
										) : null}

										{/* Error message */}
										{result && !result.success && (result.error || result.message) ? (
											<p className="mt-1 text-xs text-red-500">{result.error ?? result.message}</p>
										) : null}
									</div>

									{/* Right side: status + resolvedBy + expand chevron */}
									<div className="flex shrink-0 items-center gap-2">
										<div className="flex flex-col items-end gap-1">
											{result ? (
												<>
													<span className={cn('flex items-center gap-1 text-xs font-medium', result.success ? 'text-emerald-600' : 'text-red-600')}>
														{result.success ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
														{result.success ? 'OK' : 'Failed'}
													</span>
													{result.stepsUsed !== undefined && result.stepsUsed > 0 ? (
														<span className="text-xs text-stone-400">{result.stepsUsed} step{result.stepsUsed !== 1 ? 's' : ''}</span>
													) : null}
													{result.resolvedBy ? (
														<span className="rounded bg-stone-100 px-1.5 py-0.5 text-[9px] font-medium text-stone-500">
															{resolvedByLabel(result.resolvedBy)}
														</span>
													) : null}
												</>
											) : isActive ? (
												<span className="flex items-center gap-1 text-xs font-medium text-violet-600">
													<Loader2 className="h-3.5 w-3.5 animate-spin" />
													Running
												</span>
											) : (
												<span className="flex items-center gap-1 text-xs font-medium text-stone-400">
													<Clock className="h-3.5 w-3.5" />
													Pending
												</span>
											)}
										</div>
										{canExpand ? (
											isExpanded ? (
												<ChevronUp className="h-3.5 w-3.5 text-stone-300" />
											) : (
												<ChevronDown className="h-3.5 w-3.5 text-stone-300" />
											)
										) : null}
									</div>
								</button>

								{/* Expanded agent steps — fetched from per-goal API */}
								{isExpanded && canExpand ? (
									<div className="border-t border-stone-100 px-4 pb-3 pt-2">
										{stepsData?.loading ? (
											<div className="space-y-2 py-2">
												<Skeleton className="h-6 w-full" />
												<Skeleton className="h-6 w-3/4" />
												<Skeleton className="h-6 w-5/6" />
											</div>
										) : stepsData?.note && stepsData.steps.length === 0 ? (
											<p className="py-2 text-xs text-stone-400 italic">{stepsData.note}</p>
										) : stepsData && stepsData.steps.length > 0 ? (
											<div className="space-y-1 border-l-2 border-stone-200 pl-3">
												{stepsData.steps.map((agentStep) => {
													const act = parseAction(agentStep.action);
													return (
														<div key={agentStep.step} className="flex items-start gap-1.5 py-0.5">
															<span className="mt-0.5 shrink-0 rounded bg-stone-100 px-1 py-0.5 font-mono text-[9px] text-stone-500">
																{agentStep.step}
															</span>
															<div className="min-w-0 flex-1">
																<div className="flex flex-wrap items-center gap-1.5">
																	<ActionBadge action={act.type} />
																	{act.target ? (
																		<span className="text-xs text-stone-600">{act.target}</span>
																	) : null}
																	{act.coords && act.coords.length >= 2 ? (
																		<span className="font-mono text-xs text-stone-400">({act.coords[0]}, {act.coords[1]})</span>
																	) : null}
																	{act.text ? (
																		<span className="rounded bg-stone-50 px-1 py-0.5 text-xs text-stone-700">&quot;{act.text}&quot;</span>
																	) : null}
																	{act.direction ? (
																		<span className="text-xs text-stone-400">{act.direction}</span>
																	) : null}
																</div>
																{agentStep.reasoning ? (
																	<p className="mt-0.5 text-xs leading-relaxed text-stone-500">{agentStep.reasoning}</p>
																) : null}
																{agentStep.package ? (
																	<span className="mt-0.5 inline-flex items-center gap-0.5 text-[10px] text-stone-400">
																		<Package className="h-2.5 w-2.5" />
																		{agentStep.package}
																	</span>
																) : null}
															</div>
															{agentStep.durationMs ? (
																<span className="shrink-0 text-[9px] text-stone-300">{Math.round(agentStep.durationMs / 1000)}s</span>
															) : null}
														</div>
													);
												})}
											</div>
										) : (
											<p className="py-2 text-xs text-stone-400">No step data available.</p>
										)}
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			</ScrollArea>

			{/* Summary bar */}
			{activeStatus !== 'running' && summaryStats.completed > 0 ? (
				<Card className="mt-3">
					<CardContent className="flex items-center gap-3 py-2.5 text-xs text-stone-500">
						<span>{summaryStats.success}/{summaryStats.total} passed</span>
						{summaryStats.cached > 0 ? (
							<>
								<span className="text-stone-300">&middot;</span>
								<span className="text-stone-500">
									{summaryStats.cached} cached
								</span>
							</>
						) : null}
						{run?.completedAt ? (
							<>
								<span className="text-stone-300">&middot;</span>
								<DurationDisplay ms={durationMs(run.startedAt, run.completedAt)} />
							</>
						) : null}
					</CardContent>
				</Card>
			) : null}
		</div>
	);
}
