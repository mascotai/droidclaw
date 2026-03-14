import { createFileRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
	Smartphone,
	Settings,
	Wifi,
	WifiOff,
	CheckCircle2,
	ArrowRight,
	Zap,
	ShieldAlert,
} from 'lucide-react';
import { track } from '@/lib/analytics/track';
import { DASHBOARD_CARD_CLICK } from '@/lib/analytics/events';

export const Route = createFileRoute('/_auth/dashboard/')({
	component: DashboardPage,
});

function DashboardPage() {
	const { data: devices, isLoading } = useQuery({
		queryKey: ['devices'],
		queryFn: () => api.listDevices(),
	});

	const { data: config } = useQuery({
		queryKey: ['config'],
		queryFn: () => api.getConfig(),
	});

	const { data: pendingDevices } = useQuery({
		queryKey: ['devices', 'pending'],
		queryFn: () => api.listPendingDevices(),
	});

	const onlineDevices = devices?.filter((d) => d.status === 'online') ?? [];
	const hasDevices = (devices?.length ?? 0) > 0;
	const hasConfig = !!config;
	const hasPending = (pendingDevices?.length ?? 0) > 0;

	return (
		<div className="mx-auto max-w-5xl space-y-8">
			{/* Page header */}
			<div>
				<h1 className="text-2xl font-bold text-stone-900">Dashboard</h1>
				<p className="mt-1 text-sm text-stone-500">
					Overview of your DroidClaw setup
				</p>
			</div>

			{/* Setup checklist */}
			{(!hasDevices || !hasConfig) && (
				<div className="rounded-xl border border-amber-200 bg-amber-50 p-6">
					<h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
						<Zap className="h-4 w-4" />
						Getting started
					</h2>
					<div className="mt-4 space-y-3">
						<ChecklistItem
							done={hasConfig}
							label="Configure LLM provider"
							to="/dashboard/settings"
						/>
						<ChecklistItem
							done={hasDevices}
							label="Connect a device"
							to="/dashboard/devices"
						/>
					</div>
				</div>
			)}

			{/* Stat cards */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
				<StatCard
					label="Total devices"
					value={isLoading ? '...' : String(devices?.length ?? 0)}
					icon={<Smartphone className="h-5 w-5 text-stone-400" />}
				/>
				<StatCard
					label="Online now"
					value={isLoading ? '...' : String(onlineDevices.length)}
					icon={<Wifi className="h-5 w-5 text-emerald-500" />}
				/>
				<StatCard
					label="Pending approval"
					value={String(pendingDevices?.length ?? 0)}
					icon={<ShieldAlert className="h-5 w-5 text-amber-500" />}
				/>
			</div>

			{/* Quick nav cards */}
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
				<NavCard
					to="/dashboard/devices"
					title="Devices"
					description="View and manage your connected Android devices"
					icon={<Smartphone className="h-6 w-6 text-violet-600" />}
				/>
				<NavCard
					to="/dashboard/settings"
					title="Settings"
					description="Configure your LLM provider and preferences"
					icon={<Settings className="h-6 w-6 text-violet-600" />}
				/>
			</div>

			{/* Devices quick list */}
			{hasDevices && (
				<div className="rounded-xl border border-stone-200 bg-white p-6">
					<div className="flex items-center justify-between">
						<h2 className="text-sm font-semibold text-stone-900">Devices</h2>
						<Link
							to="/dashboard/devices"
							className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700"
						>
							View all <ArrowRight className="h-3 w-3" />
						</Link>
					</div>
					<div className="mt-4 space-y-2">
						{devices?.slice(0, 5).map((device) => (
							<Link
								key={device.deviceId}
								to="/dashboard/devices/$deviceId"
								params={{ deviceId: device.deviceId }}
								className="flex items-center justify-between rounded-lg bg-stone-50 px-3 py-2 hover:bg-stone-100"
							>
								<div className="flex items-center gap-3">
									{device.status === 'online' ? (
										<Wifi className="h-4 w-4 text-emerald-500" />
									) : (
										<WifiOff className="h-4 w-4 text-stone-300" />
									)}
									<span className="text-sm font-medium text-stone-700">
										{device.name}
									</span>
								</div>
								<span className="text-xs text-stone-400">
									{device.model || 'Unknown'}
								</span>
							</Link>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function ChecklistItem({
	done,
	label,
	to,
}: {
	done: boolean;
	label: string;
	to: string;
}) {
	return (
		<Link
			to={to}
			className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-amber-100"
		>
			<CheckCircle2
				className={`h-4 w-4 ${done ? 'text-emerald-500' : 'text-stone-300'}`}
			/>
			<span
				className={`text-sm ${done ? 'text-stone-500 line-through' : 'font-medium text-stone-700'}`}
			>
				{label}
			</span>
		</Link>
	);
}

function StatCard({
	label,
	value,
	icon,
}: {
	label: string;
	value: string;
	icon: React.ReactNode;
}) {
	return (
		<div className="rounded-xl border border-stone-200 bg-white p-5">
			<div className="flex items-center justify-between">
				<p className="text-sm text-stone-500">{label}</p>
				{icon}
			</div>
			<p className="mt-2 text-2xl font-bold text-stone-900">{value}</p>
		</div>
	);
}

function NavCard({
	to,
	title,
	description,
	icon,
}: {
	to: string;
	title: string;
	description: string;
	icon: React.ReactNode;
}) {
	return (
		<Link
			to={to}
			onClick={() => track(DASHBOARD_CARD_CLICK, { card: title })}
			className="group rounded-xl border border-stone-200 bg-white p-5 transition-shadow hover:shadow-md"
		>
			<div className="flex items-start gap-3">
				<div className="rounded-lg bg-violet-50 p-2">{icon}</div>
				<div>
					<h3 className="text-sm font-semibold text-stone-900 group-hover:text-violet-700">
						{title}
					</h3>
					<p className="mt-1 text-xs text-stone-500">{description}</p>
				</div>
			</div>
		</Link>
	);
}
