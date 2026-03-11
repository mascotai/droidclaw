import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod/v4';
import { api } from '@/lib/api';
import { DeviceHeader } from '@/components/devices/device-header';
import { OverviewTab } from '@/components/devices/overview-tab';
import { GoalsTab } from '@/components/goals/goals-tab';
import { WorkflowsTab } from '@/components/workflows/workflows-tab';
import { RunTab } from '@/components/workflows/run-tab';
import { track } from '@/lib/analytics/track';
import { DEVICE_TAB_CHANGE } from '@/lib/analytics/events';

const searchSchema = z.object({
	tab: z.enum(['overview', 'goals', 'workflows', 'run']).default('overview'),
	runId: z.string().optional(),
});

export const Route = createFileRoute('/_auth/dashboard/devices/$deviceId/')({
	validateSearch: searchSchema,
	component: DeviceDetailPage,
});

function DeviceDetailPage() {
	const { deviceId } = Route.useParams();
	const { tab } = Route.useSearch();
	const navigate = useNavigate();

	const { data: device, isLoading: deviceLoading } = useQuery({
		queryKey: ['device', deviceId],
		queryFn: () => api.getDevice(deviceId),
		refetchInterval: 10000,
	});

	const { data: stats } = useQuery({
		queryKey: ['deviceStats', deviceId],
		queryFn: () => api.getDeviceStats(deviceId),
	});

	function setTab(newTab: 'overview' | 'goals' | 'workflows' | 'run') {
		track(DEVICE_TAB_CHANGE, { tab: newTab });
		navigate({
			to: '/dashboard/devices/$deviceId',
			params: { deviceId },
			search: { tab: newTab },
			replace: true,
		});
	}

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
		{ key: 'goals' as const, label: 'Goals' },
		{ key: 'workflows' as const, label: 'Workflows' },
		{ key: 'run' as const, label: 'Run' },
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
			{tab === 'goals' && <GoalsTab deviceId={deviceId} />}
			{tab === 'workflows' && <WorkflowsTab deviceId={deviceId} />}
			{tab === 'run' && <RunTab deviceId={deviceId} />}
		</div>
	);
}
