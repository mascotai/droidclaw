import { useMemo } from 'react';
import {
	CheckCircle2,
	XCircle,
	Loader2,
	Clock,
	ChevronDown,
	ChevronUp,
	ChevronRight,
	Zap,
	Layers,
	Code2,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge, TimeAgo, DurationDisplay } from '@/components/shared';
import type { WorkflowRun, StepResult, WorkflowStepConfig, WorkflowLiveProgress } from '@/types/devices';
import { cn } from '@/lib/utils';

interface WorkflowRunRowProps {
	run: WorkflowRun;
	liveProgress?: WorkflowLiveProgress;
	onExpand: (runId: string) => void;
	onStepClick: (run: WorkflowRun, stepIdx: number) => void;
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

export function WorkflowRunRow({ run, liveProgress, onExpand, onStepClick, expanded }: WorkflowRunRowProps) {
	const cacheHits = useMemo(() => {
		if (!run.stepResults) return 0;
		return (run.stepResults as StepResult[]).filter((r) => r?.resolvedBy === 'cached_flow').length;
	}, [run.stepResults]);

	const durMs = durationMs(run.startedAt, run.completedAt);

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
								<span className="inline-flex items-center gap-0.5 text-cyan-600">
									<Zap className="h-3 w-3" />
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
					<div className="space-y-2">
						{Array.from({ length: run.totalSteps }, (_, stepIdx) => {
							const stepResult = (run.stepResults as StepResult[] | null)?.[stepIdx];
							const isActive = !!(liveProgress && liveProgress.activeStepIndex === stepIdx && run.status === 'running');
							const isPending = !stepResult && !isActive;

							const badgeClass = stepResult
								? stepResult.success ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
								: isActive ? 'bg-amber-100 text-amber-700' : 'bg-stone-200 text-stone-500';

							return (
								<button
									key={stepIdx}
									onClick={() => stepResult ? onStepClick(run, stepIdx) : undefined}
									disabled={!stepResult}
									className={cn(
										'flex w-full items-start gap-2.5 rounded-xl px-3 py-3 text-left transition-colors',
										isActive ? 'bg-amber-50 ring-1 ring-amber-200' : 'bg-stone-50 hover:bg-stone-100',
										isPending && 'opacity-50',
									)}
								>
									<span className={cn('mt-0.5 shrink-0 rounded-full px-2 py-0.5 font-mono text-xs', badgeClass)}>
										{stepIdx + 1}
									</span>
									<div className="min-w-0 flex-1">
										<p className="text-xs leading-relaxed text-stone-800">
											{getStepGoal(run, stepIdx)}
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
									<div className="flex shrink-0 flex-col items-end gap-1">
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
													stepResult.resolvedBy === 'cached_flow' ? (
														<Badge variant="outline" className="gap-0.5 border-cyan-200 bg-cyan-50 text-[9px] text-cyan-700">
															<Zap className="h-2.5 w-2.5" />
															cached
														</Badge>
													) : (
														<Badge variant="outline" className="text-[9px]">{stepResult.resolvedBy}</Badge>
													)
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
									{stepResult ? (
										<ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-stone-300" />
									) : null}
								</button>
							);
						})}
					</div>
				</div>
			) : null}
		</Card>
	);
}
