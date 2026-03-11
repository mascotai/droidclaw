import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DeviceInfo } from '@/lib/api';
import { Package } from 'lucide-react';

interface OverviewTabProps {
	deviceId: string;
	device: DeviceInfo;
}

export function OverviewTab({ deviceId, device }: OverviewTabProps) {
	const { data: queueState } = useQuery({
		queryKey: ['queueState', deviceId],
		queryFn: () => api.getQueueState(deviceId),
		refetchInterval: 5000,
	});

	return (
		<div className="space-y-6">
			{/* Active workflows / queue */}
			<div className="rounded-xl border border-stone-200 bg-white p-6">
				<h3 className="text-sm font-semibold text-stone-900">Queue status</h3>
				<div className="mt-3">
					{queueState?.queue && Array.isArray(queueState.queue) && queueState.queue.length > 0 ? (
						<div className="space-y-2">
							{(queueState.queue as Array<Record<string, unknown>>).map(
								(item, i) => (
									<div
										key={i}
										className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 text-sm"
									>
										<span className="text-stone-700">
											{(item.name as string) || 'Workflow'}
										</span>
										<span className="text-xs text-stone-400">
											{(item.status as string) || 'queued'}
										</span>
									</div>
								),
							)}
						</div>
					) : (
						<p className="text-sm text-stone-400">No active or queued workflows</p>
					)}
				</div>
			</div>

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
