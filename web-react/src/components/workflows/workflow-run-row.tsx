import { useMemo, useState, useEffect } from 'react';
import {
	CheckCircle2,
	XCircle,
	Loader2,
	Clock,
	ChevronDown,
	ChevronUp,
	Layers,
	Code2,
	FileText,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge, TimeAgo, DurationDisplay } from '@/components/shared';
import { StepDetailModal } from '@/components/workflows/step-detail-modal';
import { api } from '@/lib/api';
import type { WorkflowRun, StepResult, WorkflowStepConfig, WorkflowLiveProgress } from '@/types/devices';
import { cn } from '@/lib/utils';

interface WorkflowRunRowProps {
	run: WorkflowRun;
	deviceId: string;
	liveProgress?: WorkflowLiveProgress;
	onExpand: (runId: string) => void;
	expanded: boolean;
}

function durationMs(startedAt: Date | string, completedAt: Date | string | null): number {
	if (!completedAt) return -1;
	return new Date(completedAt).getTime() - new Date(startedAt).getTime();
}

function getStepGoal(run: WorkflowRun, stepIdx: number): string {
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

export function WorkflowRunRow({ run, deviceId, liveProgress, onExpand, expanded }: WorkflowRunRowProps) {
	const [modalStep, setModalStep] = useState<{ idx: number; result: StepResult; config: WorkflowStepConfig | null } | null>(null);

	// Fetch full run detail when expanded (list API doesn't include goals/stepResults)
	const [detailedRun, setDetailedRun] = useState<WorkflowRun | null>(null);
	const [detailLoading, setDetailLoading] = useState(false);

	useEffect(() => {
		if (expanded && !detailedRun && !detailLoading && run.status !== 'running') {
			setDetailLoading(true);
			api.getWorkflowRun(deviceId, run.id)
				.then((data) => {
					setDetailedRun(data as unknown as WorkflowRun);
					setDetailLoading(false);
				})
				.catch(() => {
					setDetailLoading(false);
				});
		}
	}, [expanded, detailedRun, detailLoading, deviceId, run.id, run.status]);

	// Reset detail when run changes
	useEffect(() => {
		setDetailedRun(null);
		setModalStep(null);
	}, [run.id]);

	// Use detailed run data when available, fall back to list data
	const activeRun = detailedRun ?? run;

	const cacheHits = useMemo(() => {
		if (!activeRun.stepResults) return 0;
		return (activeRun.stepResults as StepResult[]).filter((r) => r?.resolvedBy === 'cached_flow').length;
	}, [activeRun.stepResults]);

	const durMs = durationMs(run.startedAt, run.completedAt);

	const hasStepResults = !!(activeRun.stepResults as StepResult[] | null)?.some((r) => r != null);

	return (
		<Card>
			{/* Row header */}
			<button
				onClick={() => onExpand(run.id)}
				className="flex w-full items-center justify-between rounded-2xl px-4 py-4 text-left transition-colors hover:bg-stone-50 md:px-6"
			>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						{run.type === 'flow' ? (
							<Code2 className={cn('h-4 w-4 shrink-0', run.status === 'completed' ? 'text-emerald-500' : run.status === 'running' ? 'text-amber-500' : 'text-red-500')} />
						) : (
							<Layers className={cn('h-4 w-4 shrink-0', run.status === 'completed' ? 'text-emerald-500' : run.status === 'running' ? 'text-amber-500' : 'text-red-500')} />
						)}
						<p className="truncate text-sm font-medium text-stone-900">{run.name}</p>
					</div>
					<div className="mt-0.5 flex items-center gap-1.5 pl-6 text-xs text-stone-400">
						<TimeAgo date={run.startedAt} />
						<span className="text-stone-300">&middot;</span>
						<span>{run.totalSteps} goal{run.totalSteps !== 1 ? 's' : ''}</span>
						{cacheHits > 0 ? (
							<>
								<span className="text-stone-300">&middot;</span>
								<span className="text-stone-500">
									{cacheHits}/{run.totalSteps} cached
								</span>
							</>
						) : null}
						<span className="text-stone-300">&middot;</span>
						{durMs >= 0 ? <DurationDisplay ms={durMs} /> : <span>running...</span>}
					</div>
					{run.status === 'running' && liveProgress ? (
						<p className="mt-1 flex items-center gap-1.5 pl-6 text-xs text-amber-600">
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
							Step {liveProgress.activeStepIndex + 1}/{run.totalSteps}
							{liveProgress.totalAttempts > 1 ? (
								<>
									<span className="text-amber-400">&middot;</span>
									Attempt {liveProgress.attempt}/{liveProgress.totalAttempts}
								</>
							) : null}
						</p>
					) : null}
				</div>
				<div className="ml-3 flex shrink-0 items-center gap-2">
					<StatusBadge status={run.status} pulse={run.status === 'running'} />
					{expanded ? (
						<ChevronUp className="h-4 w-4 text-stone-400" />
					) : (
						<ChevronDown className="h-4 w-4 text-stone-400" />
					)}
				</div>
			</button>

			{/* Expanded step results */}
			{expanded ? (
				<div className="border-t border-stone-100 px-4 py-4 md:px-6">
					{detailLoading ? (
						<div className="space-y-2">
							<Skeleton className="h-12 w-full rounded-xl" />
							<Skeleton className="h-12 w-full rounded-xl" />
							<Skeleton className="h-12 w-full rounded-xl" />
						</div>
					) : !hasStepResults ? (
						<p className="py-4 text-center text-xs text-stone-400">No goal data available.</p>
					) : (
						<div className="space-y-2">
							{Array.from({ length: activeRun.totalSteps }, (_, stepIdx) => {
								const stepResult = (activeRun.stepResults as StepResult[] | null)?.[stepIdx];
								const isActive = !!(liveProgress && liveProgress.activeStepIndex === stepIdx && run.status === 'running');
								const isPending = !stepResult && !isActive;
								const canOpenModal = !!stepResult;

								const badgeClass = stepResult
									? stepResult.success ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
									: isActive ? 'bg-amber-100 text-amber-700' : 'bg-stone-200 text-stone-500';

								return (
									<div key={stepIdx} className={cn(
										'rounded-xl transition-colors',
										isActive ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-stone-50',
										isPending && 'opacity-50',
									)}>
										<button
											onClick={() => {
												if (canOpenModal && stepResult) {
													const stepDef = activeRun.steps?.[stepIdx];
													const config: WorkflowStepConfig | null =
														stepDef && typeof stepDef === 'object' && 'goal' in stepDef
															? (stepDef as WorkflowStepConfig)
															: null;
													setModalStep({ idx: stepIdx, result: stepResult, config });
												}
											}}
											disabled={!canOpenModal}
											className={cn(
												'flex w-full items-start gap-2.5 px-3 py-3 text-left',
												canOpenModal ? 'cursor-pointer hover:bg-stone-100 rounded-xl' : 'cursor-default',
											)}
										>
											<span className={cn('mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-mono text-xs', badgeClass)}>
												{stepIdx + 1}
											</span>
											<div className="min-w-0 flex-1">
												<p className="text-xs leading-relaxed text-stone-800">
													{getStepGoal(activeRun, stepIdx)}
												</p>
												{(stepResult?.error || (stepResult?.message && !stepResult?.success)) ? (
													<p className="mt-1 text-xs text-red-500">
														{stepResult?.error ?? stepResult?.message}
													</p>
												) : null}
												{isActive && liveProgress && liveProgress.totalAttempts > 1 ? (
													<p className="mt-1 text-xs text-amber-600">
														Attempt {liveProgress.attempt}/{liveProgress.totalAttempts}
													</p>
												) : null}
											</div>
											<div className="flex shrink-0 items-center gap-2">
												<div className="flex flex-col items-end gap-1">
													{stepResult ? (
														<>
															<span className={cn('flex items-center gap-1 text-xs font-medium', stepResult.success ? 'text-emerald-600' : 'text-red-600')}>
																{stepResult.success ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
																{stepResult.success ? 'OK' : 'Failed'}
															</span>
															{stepResult.stepsUsed !== undefined ? (
																<span className="text-xs text-stone-400">
																	{stepResult.stepsUsed} step{stepResult.stepsUsed !== 1 ? 's' : ''}
																</span>
															) : null}
															{stepResult.resolvedBy ? (
																<span className="rounded bg-stone-100 px-1.5 py-0.5 text-[9px] font-medium text-stone-500">
																	{stepResult.resolvedBy === 'cached_flow' ? 'cached' : stepResult.resolvedBy}
																</span>
															) : null}
														</>
													) : isActive ? (
														<span className="flex items-center gap-1 text-xs font-medium text-amber-600">
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
												{canOpenModal ? (
													<FileText className="h-3.5 w-3.5 text-stone-300" />
												) : null}
											</div>
										</button>
									</div>
								);
							})}
						</div>
					)}
				</div>
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
					runId={run.id}
				/>
			) : null}
		</Card>
	);
}
