import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useState, useCallback, useMemo } from 'react';
import { useWsSubscription } from '@/hooks/use-websocket';
import type {
	WsMessage,
	WorkflowStartedEvent,
	WorkflowStepDoneEvent,
	WorkflowCompletedEvent,
	StepEvent,
} from '@/stores/websocket';
import type {
	WorkflowRun,
	LiveWorkflowRun,
	LiveAgentStep,
} from '@/types/devices';
import { RunViewer } from '@/components/workflows/run-viewer';
import { WorkflowBuilderModal } from '@/components/workflows/workflow-builder-modal';
import { StatusBadge, DurationDisplay, TimeAgo } from '@/components/shared';
import { toast } from 'sonner';
import { track } from '@/lib/analytics/track';
import { DEVICE_WORKFLOW_STOP, DEVICE_WORKFLOW_SUBMIT } from '@/lib/analytics/events';
import { Plus, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface WorkflowsTabProps {
	deviceId: string;
	selectedRunId: string | null;
	onSelectRun: (runId: string | null) => void;
}

export function WorkflowsTab({ deviceId, selectedRunId, onSelectRun }: WorkflowsTabProps) {
	const queryClient = useQueryClient();
	const [liveRun, setLiveRun] = useState<LiveWorkflowRun | null>(null);
	const [builderOpen, setBuilderOpen] = useState(false);

	// ── Data queries ──

	const { data: runsData } = useQuery({
		queryKey: ['workflowRuns', deviceId],
		queryFn: () => api.listWorkflowRuns(deviceId),
		refetchInterval: 10000,
	});

	const runs = useMemo(
		() => (runsData?.items as WorkflowRun[] | undefined) ?? [],
		[runsData],
	);

	// ── Fetch detail for selected historical run ──

	const { data: runDetail, isLoading: runDetailLoading } = useQuery({
		queryKey: ['workflowRun', deviceId, selectedRunId],
		queryFn: () => api.getWorkflowRun(deviceId, selectedRunId!),
		enabled: !!selectedRunId && selectedRunId !== liveRun?.runId,
	});

	// ── Mutations ──

	const stopWorkflow = useMutation({
		mutationFn: (runId?: string) => api.stopWorkflow(deviceId, runId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['workflowRuns', deviceId] });
		},
	});

	const submitWorkflow = useMutation({
		mutationFn: (data: { steps: Array<Record<string, unknown>>; name?: string; variables?: Record<string, string> }) =>
			api.submitWorkflow({
				deviceId,
				name: data.name,
				steps: data.steps,
				variables: data.variables,
			}),
		onSuccess: (result) => {
			toast.success('Workflow started', { description: `Run ID: ${result.runId}` });
			queryClient.invalidateQueries({ queryKey: ['workflowRuns', deviceId] });
			setBuilderOpen(false);
		},
		onError: (err) => {
			toast.error('Failed to start workflow', { description: err.message });
		},
	});

	// ── WebSocket live tracking ──

	useWsSubscription(
		['workflow_started', 'workflow_step_done', 'workflow_completed', 'step'],
		useCallback(
			(msg: WsMessage) => {
				if (msg.type === 'workflow_started') {
					const evt = msg as WorkflowStartedEvent;
					const newLive: LiveWorkflowRun = {
						runId: evt.runId,
						name: evt.name,
						wfType: evt.wfType,
						totalSteps: evt.totalSteps,
						stepGoals: [],
						status: 'running',
						stepResults: Array(evt.totalSteps).fill(null),
						activeStepIndex: 0,
						attempt: 1,
						totalAttempts: 1,
						liveSteps: [],
					};
					setLiveRun(newLive);
					onSelectRun(evt.runId);
				}

				if (msg.type === 'step' && liveRun?.status === 'running') {
					const step = msg as StepEvent;
					setLiveRun((prev) => {
						if (!prev) return prev;
						const newStep: LiveAgentStep = {
							step: step.step,
							action: (step.action as Record<string, unknown>)?.action as string ?? 'unknown',
							reasoning: step.reasoning,
						};
						return { ...prev, liveSteps: [...prev.liveSteps, newStep] };
					});
				}

				if (msg.type === 'workflow_step_done') {
					const evt = msg as WorkflowStepDoneEvent;
					setLiveRun((prev) => {
						if (!prev || prev.runId !== evt.runId) return prev;
						const newResults = [...prev.stepResults];
						newResults[evt.stepIndex] = {
							success: evt.success,
							stepsUsed: evt.stepsUsed,
						};
						return {
							...prev,
							stepResults: newResults,
							activeStepIndex: evt.stepIndex + 1,
							liveSteps: [],
						};
					});
				}

				if (msg.type === 'workflow_completed') {
					const evt = msg as WorkflowCompletedEvent;
					setLiveRun((prev) => {
						if (!prev || prev.runId !== evt.runId) return prev;
						return {
							...prev,
							status: evt.success ? 'completed' : 'failed',
							stepResults: evt.stepResults?.map((sr) => ({
								success: sr.success,
								stepsUsed: sr.stepsUsed,
								resolvedBy: undefined,
								error: sr.error,
								message: sr.message,
							})) ?? prev.stepResults,
						};
					});
					queryClient.invalidateQueries({ queryKey: ['workflowRuns', deviceId] });
				}
			},
			[liveRun, deviceId, queryClient, onSelectRun],
		),
	);

	// Determine which run to show as "live" in RunViewer
	const viewerLiveRun = liveRun && selectedRunId === liveRun.runId ? liveRun : null;

	function durationMs(startedAt: string | Date, completedAt: string | Date | null): number {
		if (!completedAt) return -1;
		return new Date(completedAt).getTime() - new Date(startedAt).getTime();
	}

	return (
		<div className="space-y-4">
			{/* Header with New Workflow button */}
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<Clock className="h-4 w-4 text-stone-400" />
					<h3 className="text-sm font-semibold text-stone-900">Recent Runs</h3>
					{runsData?.total ? (
						<span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">
							{runsData.total}
						</span>
					) : null}
				</div>
				<Button
					onClick={() => setBuilderOpen(true)}
					size="sm"
					className="gap-1.5"
				>
					<Plus className="h-3.5 w-3.5" />
					New run
				</Button>
			</div>

			{/* Side-by-side layout: runs list (left) + detail (right) */}
			<div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
				{/* Left panel — Runs list */}
				<div className="lg:col-span-2">
					{runs.length > 0 ? (
						<div className="space-y-1.5 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto lg:pr-1">
							{/* Live run at top */}
							{liveRun && liveRun.status === 'running' && (
								<button
									onClick={() => onSelectRun(liveRun.runId)}
									className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
										selectedRunId === liveRun.runId
											? 'border-violet-300 bg-violet-50 ring-1 ring-violet-200'
											: 'border-stone-200 bg-white hover:border-stone-300'
									}`}
								>
									<div className="relative flex h-2 w-2 shrink-0">
										<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400 opacity-75" />
										<span className="relative inline-flex h-2 w-2 rounded-full bg-violet-500" />
									</div>
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-medium text-stone-800">{liveRun.name}</p>
										<div className="mt-0.5 flex items-center gap-2 text-xs text-stone-400">
											<span>{liveRun.totalSteps} steps</span>
											<span className="text-violet-500 font-medium">live</span>
										</div>
									</div>
									<StatusBadge status="running" />
								</button>
							)}

							{/* Historical runs */}
							{runs.map((run) => {
								// Skip if this is the same as the live run
								if (liveRun && liveRun.status === 'running' && run.id === liveRun.runId) return null;
								const isSelected = selectedRunId === run.id;
								const dur = durationMs(run.startedAt, run.completedAt);

								return (
									<button
										key={run.id}
										onClick={() => onSelectRun(isSelected ? null : run.id)}
										className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
											isSelected
												? 'border-stone-300 bg-stone-50 ring-1 ring-stone-200'
												: 'border-stone-200 bg-white hover:border-stone-300'
										}`}
									>
										<StatusBadge status={run.status} size="sm" />
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium text-stone-800">{run.name}</p>
											<div className="mt-0.5 flex items-center gap-2 text-xs text-stone-400">
												<span>{run.totalSteps} step{run.totalSteps !== 1 ? 's' : ''}</span>
												{dur > 0 && (
													<>
														<span>&middot;</span>
														<DurationDisplay ms={dur} />
													</>
												)}
												<span>&middot;</span>
												<TimeAgo date={run.startedAt} />
											</div>
										</div>
									</button>
								);
							})}
						</div>
					) : (
						<div className="rounded-xl border border-dashed border-stone-200 bg-white px-6 py-12 text-center">
							<p className="text-sm text-stone-500">No workflow runs yet</p>
							<p className="mt-1 text-xs text-stone-400">Click "New run" to create your first workflow</p>
						</div>
					)}
				</div>

				{/* Right panel — Run detail */}
				<div className="lg:col-span-3">
					{selectedRunId ? (
						<div className="rounded-xl border border-stone-200 bg-white p-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto">
							<RunViewer
								run={(runDetail as WorkflowRun | undefined) ?? null}
								liveRun={viewerLiveRun}
								loading={runDetailLoading}
								onStop={() => {
									track(DEVICE_WORKFLOW_STOP);
									stopWorkflow.mutate(liveRun?.runId ?? selectedRunId ?? undefined);
								}}
							/>
						</div>
					) : (
						<div className="hidden lg:flex rounded-xl border border-dashed border-stone-200 bg-white px-6 py-20 text-center items-center justify-center">
							<div>
								<p className="text-sm text-stone-500">Select a run to view details</p>
								<p className="mt-1 text-xs text-stone-400">Click on any run from the list</p>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Workflow Builder Modal */}
			<WorkflowBuilderModal
				open={builderOpen}
				onOpenChange={setBuilderOpen}
				onSubmit={(steps, variables) => {
					track(DEVICE_WORKFLOW_SUBMIT);
					const name = steps.length === 1
						? steps[0].goal
						: `Workflow · ${steps.length} steps`;
					submitWorkflow.mutate({
						name,
						steps: steps.map((s) => ({
							goal: s.goal,
							...(s.app && { app: s.app }),
							...(s.maxSteps !== undefined && s.maxSteps !== 15 && { maxSteps: s.maxSteps }),
							...(s.retries !== undefined && s.retries > 0 && { retries: s.retries }),
							...(s.cache === false && { cache: false }),
							...(s.forceStop && { forceStop: true }),
						})),
						variables,
					});
				}}
				isPending={submitWorkflow.isPending}
			/>
		</div>
	);
}
