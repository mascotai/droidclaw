import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useState } from 'react';
import {
	Smartphone,
	Wifi,
	WifiOff,
	Battery,
	CheckCircle2,
	XCircle,
	Clock,
	ShieldAlert,
	Trash2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { track } from '@/lib/analytics/track';
import { DEVICE_CARD_CLICK } from '@/lib/analytics/events';

export const Route = createFileRoute('/_auth/dashboard/devices/')({
	component: DevicesPage,
});

function DevicesPage() {
	const queryClient = useQueryClient();
	const [revokeConfirm, setRevokeConfirm] = useState<string | null>(null);

	const { data: devices, isLoading } = useQuery({
		queryKey: ['devices'],
		queryFn: () => api.listDevices(),
		refetchInterval: 10000,
	});

	const { data: pendingDevices } = useQuery({
		queryKey: ['devices', 'pending'],
		queryFn: () => api.listPendingDevices(),
		refetchInterval: 10000,
	});

	const approveMutation = useMutation({
		mutationFn: (deviceId: string) => api.approveDevice(deviceId),
		onSuccess: () => {
			toast.success('Device approved');
			queryClient.invalidateQueries({ queryKey: ['devices'] });
		},
		onError: (err) => {
			toast.error('Failed to approve device', { description: err.message });
		},
	});

	const rejectMutation = useMutation({
		mutationFn: (deviceId: string) => api.rejectDevice(deviceId),
		onSuccess: () => {
			toast.success('Device rejected');
			queryClient.invalidateQueries({ queryKey: ['devices'] });
		},
		onError: (err) => {
			toast.error('Failed to reject device', { description: err.message });
		},
	});

	const revokeMutation = useMutation({
		mutationFn: (deviceId: string) => api.revokeDevice(deviceId),
		onSuccess: () => {
			toast.success('Device revoked');
			setRevokeConfirm(null);
			queryClient.invalidateQueries({ queryKey: ['devices'] });
		},
		onError: (err) => {
			toast.error('Failed to revoke device', { description: err.message });
		},
	});

	const hasPending = pendingDevices && pendingDevices.length > 0;

	return (
		<div className="mx-auto max-w-5xl space-y-6">
			{/* Header */}
			<div>
				<h1 className="text-2xl font-bold text-stone-900">Devices</h1>
				<p className="mt-1 text-sm text-stone-500">
					Manage your connected Android devices
				</p>
			</div>

			{/* Pending Approval Section */}
			{hasPending && (
				<div className="space-y-3">
					<div className="flex items-center gap-2">
						<ShieldAlert className="h-4 w-4 text-amber-500" />
						<h2 className="text-sm font-semibold text-stone-900">
							Pending Approval
						</h2>
						<span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
							{pendingDevices.length}
						</span>
					</div>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{pendingDevices.map((device) => (
							<div
								key={device.id}
								className="rounded-xl border border-amber-200 bg-amber-50/50 p-5"
							>
								<div className="flex items-start justify-between">
									<div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
										<Smartphone className="h-5 w-5 text-amber-600" />
									</div>
									<div className="flex items-center gap-1.5">
										<Clock className="h-3.5 w-3.5 text-amber-500" />
										<span className="text-xs font-medium text-amber-600">
											Pending
										</span>
									</div>
								</div>

								<div className="mt-3">
									<h3 className="text-sm font-semibold text-stone-900">
										{device.name}
									</h3>
									<p className="mt-0.5 text-xs text-stone-500">
										{device.model || 'Unknown model'}
									</p>
								</div>

								<div className="mt-2 flex items-center gap-4 text-xs text-stone-400">
									{device.androidVersion && (
										<span>Android {device.androidVersion}</span>
									)}
									<span>
										Requested{' '}
										{formatDistanceToNow(new Date(device.createdAt), {
											addSuffix: true,
										})}
									</span>
								</div>

								<div className="mt-4 flex items-center gap-2">
									<button
										onClick={() => approveMutation.mutate(device.id)}
										disabled={approveMutation.isPending}
										className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
									>
										<CheckCircle2 className="h-3.5 w-3.5" />
										Approve
									</button>
									<button
										onClick={() => rejectMutation.mutate(device.id)}
										disabled={rejectMutation.isPending}
										className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
									>
										<XCircle className="h-3.5 w-3.5" />
										Reject
									</button>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Device grid */}
			{isLoading ? (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{[1, 2, 3].map((i) => (
						<div
							key={i}
							className="h-40 animate-pulse rounded-xl border border-stone-200 bg-white"
						/>
					))}
				</div>
			) : devices && devices.length > 0 ? (
				<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
					{devices.map((device) => {
						const isOnline = device.status === 'online';
						return (
							<div
								key={device.deviceId}
								className="group relative rounded-xl border border-stone-200 bg-white p-5 transition-shadow hover:shadow-md"
							>
								{/* Revoke button */}
								{revokeConfirm === device.deviceId ? (
									<div className="absolute right-3 top-3 flex items-center gap-1.5">
										<button
											onClick={(e) => {
												e.preventDefault();
												revokeMutation.mutate(device.deviceId);
											}}
											className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
										>
											Confirm
										</button>
										<button
											onClick={(e) => {
												e.preventDefault();
												setRevokeConfirm(null);
											}}
											className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-50"
										>
											Cancel
										</button>
									</div>
								) : (
									<button
										onClick={(e) => {
											e.preventDefault();
											setRevokeConfirm(device.deviceId);
										}}
										className="absolute right-3 top-3 rounded p-1.5 text-stone-300 opacity-0 hover:text-red-500 group-hover:opacity-100"
										title="Revoke device"
									>
										<Trash2 className="h-4 w-4" />
									</button>
								)}

								<Link
									to="/dashboard/devices/$deviceId"
									params={{ deviceId: device.deviceId }}
									onClick={() => track(DEVICE_CARD_CLICK)}
									className="block"
								>
									<div className="flex items-start justify-between">
										<div
											className={`flex h-10 w-10 items-center justify-center rounded-lg ${
												isOnline ? 'bg-emerald-50' : 'bg-stone-100'
											}`}
										>
											<Smartphone
												className={`h-5 w-5 ${isOnline ? 'text-emerald-600' : 'text-stone-400'}`}
											/>
										</div>
										<div className="flex items-center gap-1.5">
											{isOnline ? (
												<>
													<Wifi className="h-3.5 w-3.5 text-emerald-500" />
													<span className="text-xs font-medium text-emerald-600">
														Online
													</span>
												</>
											) : (
												<>
													<WifiOff className="h-3.5 w-3.5 text-stone-300" />
													<span className="text-xs text-stone-400">Offline</span>
												</>
											)}
										</div>
									</div>

									<div className="mt-3">
										<h3 className="text-sm font-semibold text-stone-900 group-hover:text-violet-700">
											{device.name}
										</h3>
										<p className="mt-0.5 text-xs text-stone-500">
											{device.model || 'Unknown model'}
										</p>
									</div>

									<div className="mt-3 flex items-center gap-4 text-xs text-stone-400">
										{device.batteryLevel !== null && (
											<span className="flex items-center gap-1">
												<Battery className="h-3 w-3" />
												{device.batteryLevel}%
											</span>
										)}
										{device.androidVersion && (
											<span>Android {device.androidVersion}</span>
										)}
									</div>

									{!isOnline && (
										<p className="mt-2 text-xs text-stone-400">
											Last seen{' '}
											{formatDistanceToNow(new Date(device.lastSeen), {
												addSuffix: true,
											})}
										</p>
									)}

									{device.lastGoal && (
										<div className="mt-3 border-t border-stone-100 pt-2">
											<p className="truncate text-xs text-stone-500">
												<span
													className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${
														device.lastGoal.status === 'completed'
															? 'bg-emerald-500'
															: device.lastGoal.status === 'running'
																? 'bg-violet-500'
																: 'bg-red-400'
													}`}
												/>
												{device.lastGoal.goal}
											</p>
										</div>
									)}
								</Link>
							</div>
						);
					})}
				</div>
			) : (
				<div className="rounded-xl border border-stone-200 bg-white p-12 text-center">
					<Smartphone className="mx-auto h-10 w-10 text-stone-300" />
					<h3 className="mt-3 text-sm font-semibold text-stone-900">
						No devices connected
					</h3>
					<p className="mt-1 text-sm text-stone-500">
						Install the DroidClaw Android app to register a device
					</p>
				</div>
			)}
		</div>
	);
}
