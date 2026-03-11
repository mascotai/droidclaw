import { useMemo } from 'react';
import { Inbox, Zap, History } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusBadge, TimeAgo, DurationDisplay } from '@/components/shared';
import type { WorkflowRun, LiveWorkflowRun, StepResult } from '@/types/devices';
import { cn } from '@/lib/utils';

interface RunsListProps {
	runs: WorkflowRun[];
	liveRun: LiveWorkflowRun | null;
	selectedRunId: string | null;
	onSelect: (runId: string) => void;
}

function durationMs(startedAt: Date | string, completedAt: Date | string | null): number {
	if (!completedAt) return -1;
	return new Date(completedAt).getTime() - new Date(startedAt).getTime();
}

function countCacheHits(stepResults: StepResult[] | null): number {
	if (!stepResults) return 0;
	return stepResults.filter((r) => r?.resolvedBy === 'cached_flow').length;
}

export function RunsList({ runs, liveRun, selectedRunId, onSelect }: RunsListProps) {
	const liveCacheHits = useMemo(
		() => (liveRun ? liveRun.stepResults.filter((r) => r?.resolvedBy === 'cached_flow').length : 0),
		[liveRun],
	);

	const historicalRuns = useMemo(
		() => (liveRun ? runs.filter((r) => r.id !== liveRun.runId) : runs),
		[runs, liveRun],
	);

	return (
		<Card>
			<CardHeader className="pb-2">
				<div className="flex items-center gap-2">
					<History className="h-3.5 w-3.5 text-stone-400" />
					<CardTitle className="text-xs font-medium text-stone-500">Recent Runs</CardTitle>
				</div>
			</CardHeader>
			<CardContent className="px-2 pb-2">
				<div className="max-h-[60vh] space-y-1 overflow-y-auto">
					{/* Live run at top */}
					{liveRun ? (
						<button
							onClick={() => onSelect(liveRun.runId)}
							className={cn(
								'flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all',
								selectedRunId === liveRun.runId
									? 'bg-violet-50 ring-1 ring-violet-200'
									: 'hover:bg-stone-50',
							)}
						>
							<div className="mt-1.5 shrink-0">
								{liveRun.status === 'running' ? (
									<span className="relative flex h-2.5 w-2.5">
										<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-60" />
										<span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-violet-500" />
									</span>
								) : (
									<StatusBadge status={liveRun.status} size="sm" />
								)}
							</div>
							<div className="min-w-0 flex-1">
								<p className="truncate text-xs font-medium text-stone-800">{liveRun.name}</p>
								<div className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-400">
									<span>
										{liveRun.totalSteps} step{liveRun.totalSteps !== 1 ? 's' : ''}
									</span>
									{liveRun.status === 'running' ? (
										<>
											<span className="text-stone-300">&middot;</span>
											<span className="text-violet-500">live</span>
										</>
									) : null}
									{liveCacheHits > 0 ? (
										<>
											<span className="text-stone-300">&middot;</span>
											<span className="flex items-center gap-0.5 text-cyan-500">
												<Zap className="h-2.5 w-2.5" />
												{liveCacheHits}
											</span>
										</>
									) : null}
								</div>
							</div>
						</button>
					) : null}

					{/* Historical runs */}
					{historicalRuns.map((run) => {
						const cacheHits = countCacheHits(run.stepResults as StepResult[] | null);
						const durMs = durationMs(run.startedAt, run.completedAt);
						return (
							<button
								key={run.id}
								onClick={() => onSelect(run.id)}
								className={cn(
									'flex w-full items-start gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all',
									selectedRunId === run.id
										? 'bg-stone-100 ring-1 ring-stone-200'
										: 'hover:bg-stone-50',
								)}
							>
								<StatusBadge status={run.status} size="sm" pulse={false} className="mt-0.5" />
								<div className="min-w-0 flex-1">
									<p className="truncate text-xs font-medium text-stone-800">{run.name}</p>
									<div className="mt-0.5 flex items-center gap-1.5 text-xs text-stone-400">
										<span>
											{run.totalSteps} step{run.totalSteps !== 1 ? 's' : ''}
										</span>
										<span className="text-stone-300">&middot;</span>
										{durMs >= 0 ? (
											<DurationDisplay ms={durMs} />
										) : (
											<span>running...</span>
										)}
										{cacheHits > 0 ? (
											<>
												<span className="text-stone-300">&middot;</span>
												<span className="flex items-center gap-0.5 text-cyan-500">
													<Zap className="h-2.5 w-2.5" />
													{cacheHits}
												</span>
											</>
										) : null}
										<span className="text-stone-300">&middot;</span>
										<TimeAgo date={run.startedAt} />
									</div>
								</div>
							</button>
						);
					})}

					{!liveRun && runs.length === 0 ? (
						<div className="rounded-xl border border-dashed border-stone-200 px-4 py-6 text-center">
							<Inbox className="mx-auto mb-1.5 h-6 w-6 text-stone-300" />
							<p className="text-xs text-stone-400">No runs yet</p>
						</div>
					) : null}
				</div>
			</CardContent>
		</Card>
	);
}
