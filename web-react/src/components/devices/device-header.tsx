import {
	Smartphone,
	Battery,
	Wifi,
	WifiOff,
	Activity,
	CheckCircle2,
	Target,
} from 'lucide-react';
import type { DeviceInfo, DeviceStats } from '@/lib/api';
import { formatDistanceToNow } from 'date-fns';

interface DeviceHeaderProps {
	device: DeviceInfo;
	stats: DeviceStats | null;
}

export function DeviceHeader({ device, stats }: DeviceHeaderProps) {
	const isOnline = device.status === 'online';

	return (
		<div className="rounded-xl border border-stone-200 bg-white p-6">
			<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				{/* Device info */}
				<div className="flex items-center gap-4">
					<div
						className={`flex h-14 w-14 items-center justify-center rounded-xl ${
							isOnline ? 'bg-emerald-50' : 'bg-stone-100'
						}`}
					>
						<Smartphone
							className={`h-7 w-7 ${isOnline ? 'text-emerald-600' : 'text-stone-400'}`}
						/>
					</div>
					<div>
						<h1 className="text-xl font-bold text-stone-900">{device.name}</h1>
						<div className="mt-1 flex items-center gap-3 text-sm text-stone-500">
							<span>{device.model || 'Unknown model'}</span>
							{device.androidVersion && (
								<span>Android {device.androidVersion}</span>
							)}
						</div>
					</div>
				</div>

				{/* Status */}
				<div className="flex items-center gap-2">
					{isOnline ? (
						<>
							<Wifi className="h-4 w-4 text-emerald-500" />
							<span className="text-sm font-medium text-emerald-600">Online</span>
						</>
					) : (
						<>
							<WifiOff className="h-4 w-4 text-stone-400" />
							<span className="text-sm text-stone-500">
								Last seen{' '}
								{formatDistanceToNow(new Date(device.lastSeen), { addSuffix: true })}
							</span>
						</>
					)}
				</div>
			</div>

			{/* Stats row */}
			<div className="mt-4 grid grid-cols-2 gap-4 border-t border-stone-100 pt-4 sm:grid-cols-4">
				{device.batteryLevel !== null && (
					<div className="flex items-center gap-2">
						<Battery className="h-4 w-4 text-stone-400" />
						<div>
							<p className="text-xs text-stone-500">Battery</p>
							<p className="text-sm font-medium text-stone-900">
								{device.batteryLevel}%{device.isCharging ? ' ⚡' : ''}
							</p>
						</div>
					</div>
				)}
				{stats && (
					<>
						<div className="flex items-center gap-2">
							<Activity className="h-4 w-4 text-stone-400" />
							<div>
								<p className="text-xs text-stone-500">Total runs</p>
								<p className="text-sm font-medium text-stone-900">
									{stats.totalSessions}
								</p>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<CheckCircle2 className="h-4 w-4 text-stone-400" />
							<div>
								<p className="text-xs text-stone-500">Success rate</p>
								<p className="text-sm font-medium text-stone-900">
									{stats.successRate}%
								</p>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Target className="h-4 w-4 text-stone-400" />
							<div>
								<p className="text-xs text-stone-500">Avg steps</p>
								<p className="text-sm font-medium text-stone-900">
									{stats.avgSteps}
								</p>
							</div>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
