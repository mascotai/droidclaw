import { Menu, LogOut, User as UserIcon } from 'lucide-react';
import { useWebSocketStore } from '@/stores/websocket';

interface HeaderProps {
	user: { name: string; email: string; id: string };
	onMenuClick: () => void;
	onSignOut: () => void;
}

export function Header({ user, onMenuClick, onSignOut }: HeaderProps) {
	const wsConnected = useWebSocketStore((s) => s.connected);

	return (
		<header className="flex h-14 items-center justify-between border-b border-stone-200 bg-white px-4">
			<button
				onClick={onMenuClick}
				className="rounded-md p-1.5 text-stone-500 hover:text-stone-700 lg:hidden"
			>
				<Menu className="h-5 w-5" />
			</button>

			<div className="flex-1" />

			<div className="flex items-center gap-4">
				{/* WebSocket status indicator */}
				<div className="flex items-center gap-1.5">
					<div
						className={`h-2 w-2 rounded-full ${wsConnected ? 'bg-emerald-500' : 'bg-stone-300'}`}
					/>
					<span className="text-xs text-stone-400">
						{wsConnected ? 'Live' : 'Offline'}
					</span>
				</div>

				{/* User info */}
				<div className="flex items-center gap-2">
					<div className="flex h-8 w-8 items-center justify-center rounded-full bg-stone-100">
						<UserIcon className="h-4 w-4 text-stone-600" />
					</div>
					<div className="hidden sm:block">
						<p className="text-sm font-medium text-stone-900">{user.name}</p>
						<p className="text-xs text-stone-500">{user.email}</p>
					</div>
				</div>

				{/* Sign out */}
				<button
					onClick={onSignOut}
					className="rounded-md p-1.5 text-stone-400 hover:text-stone-600"
					title="Sign out"
					data-umami-event="auth-signout"
				>
					<LogOut className="h-4 w-4" />
				</button>
			</div>
		</header>
	);
}
