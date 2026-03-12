import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod/v4';
import { useCallback, useMemo } from 'react';
import { api } from '@/lib/api';
import type { WorkflowRun, StepResult } from '@/types/devices';
import { DeviceHeader } from '@/components/devices/device-header';
import { OverviewTab } from '@/components/devices/overview-tab';
import { WorkflowsTab } from '@/components/workflows/workflows-tab';
import { track } from '@/lib/analytics/track';
import { DEVICE_TAB_CHANGE } from '@/lib/analytics/events';

const searchSchema = z.object({
	tab: z.enum(['overview', 'workflows']).default('overview'),
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

	const { data: device, isLoading: deviceLoading } = useQuery({
		queryKey: ['device', deviceId],
		queryFn: () => api.getDevice(deviceId),
		refetchInterval: 10000,
	});

	// ── Compute device stats from workflow runs ──

	const { data: allRunsData } = useQuery({
		queryKey: ['workflowRuns', deviceId],
		queryFn: () => api.listWorkflowRuns(deviceId),
		refetchInterval: 30000,
	});

	const stats = useMemo(() => {
		const runs = (allRunsData?.items as WorkflowRun[] | undefined) ?? [];
		if (runs.length === 0) return null;
		const total = allRunsData?.total ?? runs.length;
		const completed = runs.filter((r) => r.status === 'completed' || r.status === 'failed');
		const successful = completed.filter((r) => r.status === 'completed');
		const successRate = completed.length > 0 ? Math.round((successful.length / completed.length) * 100) : 0;
		const stepsArr = runs
			.filter((r) => r.stepResults)
			.flatMap((r) => (r.stepResults as StepResult[])?.filter((sr) => sr?.stepsUsed != null).map((sr) => sr.stepsUsed!) ?? []);
		const avgSteps = stepsArr.length > 0 ? Math.round(stepsArr.reduce((a, b) => a + b, 0) / stepsArr.length) : 0;
		return { totalSessions: total, successRate, avgSteps };
	}, [allRunsData]);

	function setTab(newTab: 'overview' | 'workflows') {
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
		{ key: 'workflows' as const, label: 'Runs' },
	];

	return (
		<div className="mx-auto flex h-full max-w-5xl flex-col">
			{/* Device header — fixed */}
			<div className="shrink-0">
				<DeviceHeader device={device} stats={stats ?? null} />
			</div>

			{/* Tab navigation — fixed */}
			<div className="shrink-0 border-b border-stone-200 mt-6">
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

			{/* Tab content — scrollable */}
			<div className="min-h-0 flex-1 overflow-y-auto pt-4">
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
			</div>
		</div>
	);
}
