import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { WorkflowRun } from '@/lib/api';
import { useState } from 'react';
import {
	ChevronDown,
	ChevronRight,
	CheckCircle2,
	XCircle,
	Clock,
	Loader2,
	Square,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { track } from '@/lib/analytics/track';
import { DEVICE_WORKFLOW_STOP } from '@/lib/analytics/events';

interface WorkflowsTabProps {
	deviceId: string;
}

export function WorkflowsTab({ deviceId }: WorkflowsTabProps) {
	const queryClient = useQueryClient();
	const [page, setPage] = useState(1);
	const [expandedRun, setExpandedRun] = useState<string | null>(null);

	const { data: runs } = useQuery({
		queryKey: ['workflowRuns', deviceId, page],
		queryFn: () => api.listWorkflowRuns(deviceId, page),
		refetchInterval: 5000,
	});

	const stopWorkflow = useMutation({
		mutationFn: (runId?: string) => api.stopWorkflow(deviceId, runId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['workflowRuns', deviceId] });
		},
	});

	return (
		<div className="space-y-4">
			<div className="rounded-xl border border-stone-200 bg-white p-6">
				<h3 className="text-sm font-semibold text-stone-900">Workflow runs</h3>

				{runs?.items && runs.items.length > 0 ? (
					<div className="mt-3 space-y-2">
						{runs.items.map((run) => (
							<WorkflowRunRow
								key={run.id}
								run={run}
								deviceId={deviceId}
								expanded={expandedRun === run.id}
								onToggle={() =>
									setExpandedRun(expandedRun === run.id ? null : run.id)
								}
								onStop={() => {
									track(DEVICE_WORKFLOW_STOP);
									stopWorkflow.mutate(run.id);
								}}
							/>
						))}

						{/* Pagination */}
						{runs.total > 20 && (
							<div className="flex items-center justify-between pt-4">
								<button
									onClick={() => setPage((p) => Math.max(1, p - 1))}
									disabled={page === 1}
									className="text-sm text-stone-500 hover:text-stone-700 disabled:opacity-50"
								>
									Previous
								</button>
								<span className="text-sm text-stone-400">
									Page {page} of {Math.ceil(runs.total / 20)}
								</span>
								<button
									onClick={() => setPage((p) => p + 1)}
									disabled={page * 20 >= runs.total}
									className="text-sm text-stone-500 hover:text-stone-700 disabled:opacity-50"
								>
									Next
								</button>
							</div>
						)}
					</div>
				) : (
					<p className="mt-3 text-sm text-stone-400">No workflow runs yet</p>
				)}
			</div>
		</div>
	);
}

function WorkflowRunRow({
	run,
	deviceId,
	expanded,
	onToggle,
	onStop,
}: {
	run: WorkflowRun;
	deviceId: string;
	expanded: boolean;
	onToggle: () => void;
	onStop: () => void;
}) {
	const { data: fullRun } = useQuery({
		queryKey: ['workflowRun', deviceId, run.id],
		queryFn: () => api.getWorkflowRun(deviceId, run.id),
		enabled: expanded,
	});

	const statusIcon =
		run.status === 'completed' ? (
			<CheckCircle2 className="h-4 w-4 text-emerald-500" />
		) : run.status === 'failed' ? (
			<XCircle className="h-4 w-4 text-red-500" />
		) : run.status === 'running' ? (
			<Loader2 className="h-4 w-4 animate-spin text-violet-500" />
		) : (
			<Clock className="h-4 w-4 text-stone-400" />
		);

	return (
		<div className="rounded-lg border border-stone-100">
			<div className="flex items-center gap-3 px-3 py-2.5">
				<button onClick={onToggle} className="flex flex-1 items-center gap-3 text-left">
					{expanded ? (
						<ChevronDown className="h-4 w-4 text-stone-400" />
					) : (
						<ChevronRight className="h-4 w-4 text-stone-400" />
					)}
					{statusIcon}
					<span className="flex-1 truncate text-sm font-medium text-stone-700">
						{run.name}
					</span>
					<span className="text-xs text-stone-400">
						{run.currentStep ?? 0}/{run.totalSteps} steps
					</span>
					<span className="text-xs text-stone-400">
						{formatDistanceToNow(new Date(run.startedAt), { addSuffix: true })}
					</span>
				</button>

				{run.status === 'running' && (
					<button
						onClick={onStop}
						className="rounded p-1 text-red-400 hover:text-red-600"
						title="Stop workflow"
					>
						<Square className="h-3.5 w-3.5" />
					</button>
				)}
			</div>

			{expanded && fullRun && (
				<div className="border-t border-stone-100 px-3 py-3">
					<div className="space-y-2">
						{(fullRun.stepResults || []).map((sr, i) => {
							const stepResult = sr as Record<string, unknown>;
							return (
								<div key={i} className="rounded bg-stone-50 px-3 py-2 text-xs">
									<div className="flex items-center justify-between">
										<span className="font-medium text-stone-700">
											Step {i + 1}: {String(stepResult.goal || stepResult.command || 'Step')}
										</span>
										<span
											className={
												stepResult.success
													? 'text-emerald-600'
													: 'text-red-500'
											}
										>
											{stepResult.success ? 'Success' : 'Failed'}
										</span>
									</div>
									{stepResult.error ? (
										<p className="mt-1 text-red-500">
											{String(stepResult.error)}
										</p>
									) : null}
									{stepResult.stepsUsed ? (
										<p className="mt-1 text-stone-400">
											{Number(stepResult.stepsUsed)} agent steps
										</p>
									) : null}
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}
