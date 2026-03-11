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
	CachedFlowEntry,
} from '@/types/devices';
import { RunsList } from '@/components/workflows/runs-list';
import { RunViewer } from '@/components/workflows/run-viewer';
import { ActiveWorkflows } from '@/components/workflows/active-workflows';
import { toast } from 'sonner';
import { track } from '@/lib/analytics/track';
import { DEVICE_WORKFLOW_STOP } from '@/lib/analytics/events';

interface WorkflowsTabProps {
	deviceId: string;
}

export function WorkflowsTab({ deviceId }: WorkflowsTabProps) {
	const queryClient = useQueryClient();
	const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
	const [liveRun, setLiveRun] = useState<LiveWorkflowRun | null>(null);

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

	const { data: cachedFlows, isLoading: flowsLoading } = useQuery({
		queryKey: ['cachedFlows', deviceId],
		queryFn: () => api.listCachedFlows(deviceId),
	});

	const selectedRun = useMemo(
		() => runs.find((r) => r.id === selectedRunId) ?? null,
		[runs, selectedRunId],
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

	const runCachedFlow = useMutation({
		mutationFn: (flow: CachedFlowEntry) =>
			api.submitWorkflow({
				deviceId,
				name: `Cached: ${flow.goalKey}`,
				steps: [{ goal: flow.goalKey, ...(flow.appPackage && { app: flow.appPackage }), cache: true }],
			}),
		onSuccess: (result) => {
			toast.success('Cached flow started', { description: `Run ID: ${result.runId}` });
			queryClient.invalidateQueries({ queryKey: ['workflowRuns', deviceId] });
		},
		onError: (err) => {
			toast.error('Failed to start cached flow', { description: err.message });
		},
	});

	const deleteCachedFlow = useMutation({
		mutationFn: (flowId: string) => api.deleteCachedFlow(flowId, deviceId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['cachedFlows', deviceId] });
			toast.success('Cached flow deleted');
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
					setSelectedRunId(evt.runId);
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
					queryClient.invalidateQueries({ queryKey: ['cachedFlows', deviceId] });
				}
			},
			[liveRun, deviceId, queryClient],
		),
	);

	// Determine which run to show as "live" in RunViewer
	const viewerLiveRun = liveRun && selectedRunId === liveRun.runId ? liveRun : null;

	// Cached flow meta for RunViewer header
	const cachedFlowMeta = useMemo(() => {
		if (!selectedRun || !cachedFlows) return null;
		// Try to match by name
		const match = cachedFlows.find((f) =>
			selectedRun.name?.includes(f.goalKey),
		);
		if (!match) return null;
		return {
			goalKey: match.goalKey,
			stepCount: match.stepCount,
			successCount: match.successCount ?? 0,
		};
	}, [selectedRun, cachedFlows]);

	// The running flow ID for ActiveWorkflows ghost placeholder
	const runningFlowId = useMemo(() => {
		if (!liveRun || liveRun.status !== 'running') return null;
		if (!cachedFlows) return null;
		const match = cachedFlows.find((f) =>
			liveRun.name?.includes(f.goalKey),
		);
		return match?.id ?? null;
	}, [liveRun, cachedFlows]);

	return (
		<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
			{/* Left: Runs list + Cached Flows */}
			<div className="space-y-4 lg:col-span-1">
				<RunsList
					runs={runs}
					liveRun={liveRun}
					selectedRunId={selectedRunId}
					onSelect={setSelectedRunId}
				/>

				<ActiveWorkflows
					flows={(cachedFlows as CachedFlowEntry[] | undefined) ?? []}
					loading={flowsLoading}
					runningFlowId={runningFlowId}
					onRun={(flow) => runCachedFlow.mutate(flow)}
					onDelete={(id) => deleteCachedFlow.mutate(id)}
				/>
			</div>

			{/* Right: Run detail viewer */}
			<div className="lg:col-span-2">
				<RunViewer
					run={(runDetail as WorkflowRun | undefined) ?? null}
					liveRun={viewerLiveRun}
					loading={runDetailLoading}
					onStop={() => {
						track(DEVICE_WORKFLOW_STOP);
						stopWorkflow.mutate(liveRun?.runId ?? selectedRunId ?? undefined);
					}}
					cachedFlowMeta={cachedFlowMeta}
				/>
			</div>
		</div>
	);
}
