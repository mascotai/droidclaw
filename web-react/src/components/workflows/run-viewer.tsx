import { useState, useMemo, useEffect } from 'react';
import {
	CheckCircle2,
	XCircle,
	Loader2,
	Clock,
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
import { StatusBadge, DurationDisplay, EmptyState } from '@/components/shared';
import { LiveAgentSteps } from '@/components/goals/live-agent-steps';
import { StepDetailModal } from '@/components/workflows/step-detail-modal';
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

function durationMs(startedAt: Date | string, completedAt: Date | string | null): number {
	if (!completedAt) return -1;
	return new Date(completedAt).getTime() - new Date(startedAt).getTime();
}

function resolvedByLabel(resolvedBy?: string): string {
	if (resolvedBy === 'cached_flow') return 'cached';
	if (resolvedBy) return resolvedBy;
	return 'agent';
}

export function RunViewer({ run, liveRun, loading, onStop, deviceId, cachedFlowMeta = null }: RunViewerProps) {
	const [modalStep, setModalStep] = useState<{ idx: number; result: StepResult; config: WorkflowStepConfig | null } | null>(null);

	// Reset modal when run changes
	useEffect(() => {
		setModalStep(null);
	}, [run?.id, liveRun?.runId]);

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
						const canOpenModal = !isLive && result != null;
						const app = getStepApp(stepIdx);

						return (
							<div key={stepIdx} className={stepCardClass(stepIdx)}>
								<button
									onClick={() => {
										if (canOpenModal) {
											const stepDef = run?.steps?.[stepIdx];
											const config: WorkflowStepConfig | null =
												stepDef && typeof stepDef === 'object' && 'goal' in stepDef
													? (stepDef as WorkflowStepConfig)
													: null;
											setModalStep({ idx: stepIdx, result: result!, config });
										}
									}}
									className={cn(
										'flex w-full items-start gap-2.5 px-4 py-3 text-left',
										canOpenModal ? 'cursor-pointer' : 'cursor-default',
									)}
									disabled={!canOpenModal && !isActive}
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

									{/* Right side: status + resolvedBy */}
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
									</div>
								</button>
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

			{/* Step detail modal */}
			{modalStep ? (
				<StepDetailModal
					open={!!modalStep}
					onOpenChange={(open) => { if (!open) setModalStep(null); }}
					stepIdx={modalStep.idx}
					stepResult={modalStep.result}
					config={modalStep.config}
					deviceId={deviceId}
					runId={run?.id ?? liveRun?.runId ?? ''}
				/>
			) : null}
		</div>
	);
}
