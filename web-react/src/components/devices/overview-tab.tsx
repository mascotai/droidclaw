import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DeviceInfo } from '@/lib/api';
import type { CachedFlowEntry, QueueItem } from '@/types/devices';
import { Package, Layers, Clock } from 'lucide-react';
import { ActiveWorkflows } from '@/components/workflows/active-workflows';
import { StatusBadge, TimeAgo } from '@/components/shared';
import { toast } from 'sonner';

interface OverviewTabProps {
	deviceId: string;
	device: DeviceInfo;
}

export function OverviewTab({ deviceId, device }: OverviewTabProps) {
	const queryClient = useQueryClient();

	const { data: queueState } = useQuery({
		queryKey: ['queueState', deviceId],
		queryFn: () => api.getQueueState(deviceId),
		refetchInterval: 5000,
	});

	const { data: cachedFlows, isLoading: flowsLoading } = useQuery({
		queryKey: ['cachedFlows', deviceId],
		queryFn: () => api.listCachedFlows(deviceId),
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
		mutationFn: (flowId: string) => api.deleteCachedFlow(flowId),
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: ['cachedFlows', deviceId] });
			toast.success('Cached flow deleted');
		},
	});

	const queue = (queueState?.queue as QueueItem[] | undefined) ?? [];

	return (
		<div className="space-y-6">
			{/* Queue status */}
			<div className="rounded-xl border border-stone-200 bg-white p-6">
				<div className="flex items-center gap-2">
					<Layers className="h-4 w-4 text-stone-400" />
					<h3 className="text-sm font-semibold text-stone-900">Queue status</h3>
				</div>
				<div className="mt-3">
					{queue.length > 0 ? (
						<div className="space-y-2">
							{queue.map((item, i) => (
								<div
									key={item.runId ?? i}
									className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2.5"
								>
									<div className="min-w-0 flex-1">
										<p className="truncate text-sm font-medium text-stone-700">
											{item.name || 'Workflow'}
										</p>
										<div className="mt-0.5 flex items-center gap-2 text-xs text-stone-400">
											<span>{item.totalSteps} step{item.totalSteps !== 1 ? 's' : ''}</span>
											{item.scheduledFor ? (
												<>
													<span className="text-stone-200">&middot;</span>
													<span className="flex items-center gap-0.5">
														<Clock className="h-3 w-3" />
														<TimeAgo date={item.scheduledFor} />
													</span>
												</>
											) : null}
										</div>
									</div>
									<StatusBadge status={i === 0 ? 'running' : 'pending'} size="sm" />
								</div>
							))}
						</div>
					) : (
						<p className="text-sm text-stone-400">No active or queued workflows</p>
					)}
				</div>
			</div>

			{/* Cached workflows */}
			<ActiveWorkflows
				flows={(cachedFlows as CachedFlowEntry[] | undefined) ?? []}
				loading={flowsLoading}
				runningFlowId={null}
				onRun={(flow) => runCachedFlow.mutate(flow)}
				onDelete={(id) => deleteCachedFlow.mutate(id)}
			/>

			{/* Installed apps */}
			{device.installedApps && device.installedApps.length > 0 && (
				<div className="rounded-xl border border-stone-200 bg-white p-6">
					<h3 className="text-sm font-semibold text-stone-900">Installed apps</h3>
					<div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
						{device.installedApps.map((app) => (
							<div
								key={app.packageName}
								className="flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2"
							>
								<Package className="h-4 w-4 text-stone-400" />
								<div className="min-w-0">
									<p className="truncate text-xs font-medium text-stone-700">
										{app.label}
									</p>
									<p className="truncate text-[10px] text-stone-400">
										{app.packageName}
									</p>
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
