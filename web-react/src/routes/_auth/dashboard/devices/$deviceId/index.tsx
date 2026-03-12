import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod/v4';
import { useCallback, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { WorkflowRun, WorkflowLiveProgress, Step } from '@/types/devices';
import type { WsMessage, WorkflowStepDoneEvent, WorkflowCompletedEvent } from '@/stores/websocket';
import { useWsSubscription } from '@/hooks/use-websocket';
import { DeviceHeader } from '@/components/devices/device-header';
import { OverviewTab } from '@/components/devices/overview-tab';
import { WorkflowsTab } from '@/components/workflows/workflows-tab';
import { UnifiedLog } from '@/components/workflows/unified-log';
import { track } from '@/lib/analytics/track';
import { DEVICE_TAB_CHANGE } from '@/lib/analytics/events';

const searchSchema = z.object({
	tab: z.enum(['overview', 'workflows', 'log']).default('overview'),
	runId: z.string().optional(),
});

export const Route = createFileRoute('/_auth/dashboard/devices/$deviceId/')({
	validateSearch: searchSchema,
	component: DeviceDetailPage,
});

function DeviceDetailPage() {
	const { deviceId } = Route.useParams();
	const { tab, runId } = Route.useSearch();
	const navigate = useNavigate();
	const queryClient = useQueryClient();

	const { data: device, isLoading: deviceLoading } = useQuery({
		queryKey: ['device', deviceId],
		queryFn: () => api.getDevice(deviceId),
		refetchInterval: 10000,
	});

	const { data: stats } = useQuery({
		queryKey: ['deviceStats', deviceId],
		queryFn: () => api.getDeviceStats(deviceId),
	});

	// ── Log tab data ──

	const [logPage, setLogPage] = useState(1);

	const { data: logRunsData, isLoading: logRunsLoading } = useQuery({
		queryKey: ['workflowRuns', deviceId, logPage],
		queryFn: () => api.listWorkflowRuns(deviceId, logPage),
		enabled: tab === 'log',
		refetchInterval: tab === 'log' ? 10000 : false,
	});

	const logRuns = useMemo(
		() => (logRunsData?.items as WorkflowRun[] | undefined) ?? [],
		[logRunsData],
	);

	const logTotalPages = useMemo(
		() => (logRunsData ? Math.ceil(logRunsData.total / 20) : 1),
		[logRunsData],
	);

	// Track live workflow progress for the log tab
	const [liveProgress, setLiveProgress] = useState<Record<string, WorkflowLiveProgress>>({});

	useWsSubscription(
		['workflow_step_done', 'workflow_completed'],
		useCallback(
			(msg: WsMessage) => {
				if (tab !== 'log') return;

				if (msg.type === 'workflow_step_done') {
					const evt = msg as WorkflowStepDoneEvent;
					setLiveProgress((prev) => ({
						...prev,
						[evt.runId]: {
							...(prev[evt.runId] ?? {
								activeStepGoal: '',
								attempt: 1,
								totalAttempts: 1,
								stepsUsedInAttempt: 0,
							}),
							activeStepIndex: evt.stepIndex + 1,
							stepsUsedInAttempt: evt.stepsUsed ?? 0,
						},
					}));
				}

				if (msg.type === 'workflow_completed') {
					const evt = msg as WorkflowCompletedEvent;
					setLiveProgress((prev) => {
						const next = { ...prev };
						delete next[evt.runId];
						return next;
					});
					queryClient.invalidateQueries({ queryKey: ['workflowRuns', deviceId] });
				}
			},
			[tab, deviceId, queryClient],
		),
	);

	const loadSessionSteps = useCallback(
		async (sessionId: string): Promise<Step[]> => {
			const steps = await api.listSessionSteps(deviceId, sessionId);
			return steps.map((s) => ({
				id: s.id,
				stepNumber: s.stepNumber,
				action: s.action,
				reasoning: s.reasoning,
				result: s.result,
			}));
		},
		[deviceId],
	);

	function setTab(newTab: 'overview' | 'workflows' | 'log') {
		track(DEVICE_TAB_CHANGE, { tab: newTab });
		navigate({
			to: '/dashboard/devices/$deviceId',
			params: { deviceId },
			search: { tab: newTab },
			replace: true,
		});
	}

	// Deeplink: update URL when selecting a run
	const setSelectedRunId = useCallback(
		(newRunId: string | null) => {
			navigate({
				to: '/dashboard/devices/$deviceId',
				params: { deviceId },
				search: { tab: 'workflows', runId: newRunId ?? undefined },
				replace: true,
			});
		},
		[navigate, deviceId],
	);

	if (deviceLoading) {
		return (
			<div className="mx-auto max-w-5xl space-y-6">
				<div className="h-32 animate-pulse rounded-xl border border-stone-200 bg-white" />
				<div className="h-64 animate-pulse rounded-xl border border-stone-200 bg-white" />
			</div>
		);
	}

	if (!device) {
		return (
			<div className="mx-auto max-w-5xl">
				<div className="rounded-xl border border-stone-200 bg-white p-12 text-center">
					<h2 className="text-lg font-semibold text-stone-900">
						Device not found
					</h2>
					<p className="mt-1 text-sm text-stone-500">
						This device may have been removed or is no longer accessible.
					</p>
				</div>
			</div>
		);
	}

	const tabs = [
		{ key: 'overview' as const, label: 'Overview' },
		{ key: 'workflows' as const, label: 'Workflows' },
		{ key: 'log' as const, label: 'Log' },
	];

	return (
		<div className="mx-auto max-w-5xl space-y-6">
			{/* Device header */}
			<DeviceHeader device={device} stats={stats ?? null} />

			{/* Tab navigation */}
			<div className="border-b border-stone-200">
				<nav className="-mb-px flex gap-6">
					{tabs.map((t) => (
						<button
							key={t.key}
							onClick={() => setTab(t.key)}
							className={`border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
								tab === t.key
									? 'border-stone-900 text-stone-900'
									: 'border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-700'
							}`}
						>
							{t.label}
						</button>
					))}
				</nav>
			</div>

			{/* Tab content */}
			{tab === 'overview' && (
				<OverviewTab deviceId={deviceId} device={device} />
			)}
			{tab === 'workflows' && (
				<WorkflowsTab
					deviceId={deviceId}
					selectedRunId={runId ?? null}
					onSelectRun={setSelectedRunId}
				/>
			)}
			{tab === 'log' && (
				<UnifiedLog
					runs={logRuns}
					liveProgress={liveProgress}
					loaded={!logRunsLoading}
					page={logPage}
					totalPages={logTotalPages}
					onPageChange={setLogPage}
					loadSessionSteps={loadSessionSteps}
				/>
			)}
		</div>
	);
}
