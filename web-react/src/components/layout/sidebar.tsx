import { Link, useLocation } from '@tanstack/react-router';
import {
	LayoutDashboard,
	Smartphone,
	Key,
	Settings,
	X,
	Cog,
	Target,
	Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface SidebarProps {
	open: boolean;
	onClose: () => void;
}

const navItems = [
	{ label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
	{ label: 'Devices', to: '/dashboard/devices', icon: Smartphone },
	{ label: 'Goals', to: '/dashboard/goals', icon: Target },
	{ label: 'Workflows', to: '/dashboard/workflows', icon: Workflow },
	{ label: 'API Keys', to: '/dashboard/api-keys', icon: Key },
	{ label: 'Settings', to: '/dashboard/settings', icon: Settings },
] as const;

export function Sidebar({ open, onClose }: SidebarProps) {
	const location = useLocation();

	return (
		<>
			{/* Mobile overlay */}
			{open && (
				<div
					className="fixed inset-0 z-40 bg-black/50 lg:hidden"
					onClick={onClose}
				/>
			)}

			{/* Sidebar */}
			<aside
				className={cn(
					'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-stone-200 bg-white transition-transform lg:static lg:translate-x-0',
					open ? 'translate-x-0' : '-translate-x-full',
				)}
			>
				{/* Header */}
				<div className="flex h-14 items-center justify-between border-b border-stone-200 px-4">
					<div className="flex items-center gap-2">
						<Cog className="h-6 w-6 text-violet-600" />
						<span className="text-lg font-bold text-stone-900">DroidClaw</span>
					</div>
					<button
						onClick={onClose}
						className="rounded-md p-1 text-stone-400 hover:text-stone-600 lg:hidden"
					>
						<X className="h-5 w-5" />
					</button>
				</div>

				{/* Navigation */}
				<nav className="flex-1 space-y-1 p-3">
					{navItems.map((item) => {
						const isActive =
							location.pathname === item.to ||
							(item.to !== '/dashboard' && location.pathname.startsWith(item.to));

						return (
							<Link
								key={item.to}
								to={item.to}
								onClick={onClose}
								className={cn(
									'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
									isActive
										? 'bg-stone-100 text-stone-900'
										: 'text-stone-600 hover:bg-stone-50 hover:text-stone-900',
								)}
								data-umami-event="nav-sidebar-click"
								data-umami-event-item={item.label.toLowerCase()}
							>
								<item.icon className="h-4 w-4" />
								{item.label}
							</Link>
						);
					})}
				</nav>
			</aside>
		</>
	);
}
