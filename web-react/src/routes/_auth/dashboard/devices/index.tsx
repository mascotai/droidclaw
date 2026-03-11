import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useState, useEffect, useCallback } from 'react';
import {
	Smartphone,
	Wifi,
	WifiOff,
	Plus,
	Battery,
	X,
	Copy,
	CheckCircle2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { track } from '@/lib/analytics/track';
import { DEVICE_CARD_CLICK } from '@/lib/analytics/events';

export const Route = createFileRoute('/_auth/dashboard/devices/')({
	component: DevicesPage,
});

function DevicesPage() {
	const queryClient = useQueryClient();
	const [showPairing, setShowPairing] = useState(false);

	const { data: devices, isLoading } = useQuery({
		queryKey: ['devices'],
		queryFn: () => api.listDevices(),
		refetchInterval: 10000,
	});

	return (
		<div className="mx-auto max-w-5xl space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-stone-900">Devices</h1>
					<p className="mt-1 text-sm text-stone-500">
						Manage your connected Android devices
					</p>
				</div>
				<button
					onClick={() => setShowPairing(true)}
					className="flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
				>
					<Plus className="h-4 w-4" />
					Pair device
				</button>
			</div>

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
							<Link
								key={device.deviceId}
								to="/dashboard/devices/$deviceId"
								params={{ deviceId: device.deviceId }}
								onClick={() => track(DEVICE_CARD_CLICK)}
								className="group rounded-xl border border-stone-200 bg-white p-5 transition-shadow hover:shadow-md"
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
						);
					})}
				</div>
			) : (
				<div className="rounded-xl border border-stone-200 bg-white p-12 text-center">
					<Smartphone className="mx-auto h-10 w-10 text-stone-300" />
					<h3 className="mt-3 text-sm font-semibold text-stone-900">
						No devices paired
					</h3>
					<p className="mt-1 text-sm text-stone-500">
						Pair your first Android device to get started
					</p>
					<button
						onClick={() => setShowPairing(true)}
						className="mt-4 inline-flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
					>
						<Plus className="h-4 w-4" />
						Pair device
					</button>
				</div>
			)}

			{/* Pairing dialog */}
			{showPairing && (
				<PairingDialog
					onClose={() => {
						setShowPairing(false);
						queryClient.invalidateQueries({ queryKey: ['devices'] });
					}}
				/>
			)}
		</div>
	);
}

function PairingDialog({ onClose }: { onClose: () => void }) {
	const [copied, setCopied] = useState(false);
	const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

	const { data: pairing, mutate: createCode, isPending } = useMutation({
		mutationFn: () => api.createPairingCode(),
		onSuccess: (data) => {
			const expires = new Date(data.expiresAt).getTime();
			setSecondsLeft(Math.max(0, Math.floor((expires - Date.now()) / 1000)));
		},
	});

	// Generate code on mount
	useEffect(() => {
		createCode();
	}, [createCode]);

	// Countdown timer
	useEffect(() => {
		if (secondsLeft === null || secondsLeft <= 0) return;
		const timer = setInterval(() => {
			setSecondsLeft((prev) => {
				if (prev === null || prev <= 1) {
					clearInterval(timer);
					return 0;
				}
				return prev - 1;
			});
		}, 1000);
		return () => clearInterval(timer);
	}, [secondsLeft]);

	// Poll pairing status
	const { data: status } = useQuery({
		queryKey: ['pairingStatus'],
		queryFn: () => api.getPairingStatus(),
		refetchInterval: 3000,
		enabled: !!pairing?.code && (secondsLeft ?? 0) > 0,
	});

	const handleCopy = useCallback(() => {
		if (pairing?.code) {
			navigator.clipboard.writeText(pairing.code);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		}
	}, [pairing?.code]);

	const isPaired = status?.paired === true;

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
			<div className="relative w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
				<button
					onClick={onClose}
					className="absolute right-4 top-4 rounded p-1 text-stone-400 hover:text-stone-600"
				>
					<X className="h-5 w-5" />
				</button>

				<h2 className="text-lg font-bold text-stone-900">Pair a device</h2>
				<p className="mt-1 text-sm text-stone-500">
					Enter this code in the DroidClaw Android app to pair your device.
				</p>

				{isPaired ? (
					<div className="mt-6 text-center">
						<CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
						<p className="mt-3 text-sm font-semibold text-emerald-700">
							Device paired successfully!
						</p>
						<button
							onClick={onClose}
							className="mt-4 rounded-lg bg-stone-900 px-6 py-2 text-sm font-medium text-white hover:bg-stone-800"
						>
							Done
						</button>
					</div>
				) : isPending ? (
					<div className="mt-6 flex justify-center">
						<div className="h-8 w-8 animate-spin rounded-full border-2 border-stone-200 border-t-stone-600" />
					</div>
				) : pairing?.code ? (
					<div className="mt-6 space-y-4">
						{/* Code display */}
						<div className="flex items-center justify-center gap-3 rounded-lg bg-stone-50 px-4 py-6">
							<span className="font-mono text-3xl font-bold tracking-[0.3em] text-stone-900">
								{pairing.code}
							</span>
							<button
								onClick={handleCopy}
								className="rounded p-1.5 text-stone-400 hover:text-stone-600"
								title="Copy code"
							>
								{copied ? (
									<CheckCircle2 className="h-5 w-5 text-emerald-500" />
								) : (
									<Copy className="h-5 w-5" />
								)}
							</button>
						</div>

						{/* Timer */}
						{secondsLeft !== null && secondsLeft > 0 ? (
							<p className="text-center text-xs text-stone-400">
								Code expires in{' '}
								<span className="font-medium">
									{Math.floor(secondsLeft / 60)}:
									{String(secondsLeft % 60).padStart(2, '0')}
								</span>
							</p>
						) : (
							<div className="text-center">
								<p className="text-xs text-red-500">Code expired</p>
								<button
									onClick={() => createCode()}
									className="mt-2 text-sm font-medium text-violet-600 hover:text-violet-700"
								>
									Generate new code
								</button>
							</div>
						)}
					</div>
				) : null}
			</div>
		</div>
	);
}
