import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useWebSocket } from '@/hooks/use-websocket';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { useState } from 'react';

export interface AuthUser {
	id: string;
	email: string;
	name: string;
}

async function fetchCurrentUser(): Promise<AuthUser> {
	const res = await fetch('/api/me');
	if (!res.ok) throw new Error('Not authenticated');
	return res.json();
}

export const Route = createFileRoute('/_auth')({
	component: DashboardLayout,
});

function DashboardLayout() {
	const [sidebarOpen, setSidebarOpen] = useState(false);

	const { data: user, isLoading } = useQuery({
		queryKey: ['currentUser'],
		queryFn: fetchCurrentUser,
		retry: false,
		staleTime: Infinity,
	});

	// Connect WebSocket for real-time updates
	useWebSocket(user?.id);

	if (isLoading) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-stone-100">
				<div className="text-sm text-stone-400">Loading...</div>
			</div>
		);
	}

	// If authentik is not in front (e.g. local dev), show a fallback
	const currentUser = user ?? { id: 'dev', email: 'dev@localhost', name: 'Developer' };

	return (
		<div className="flex min-h-screen bg-stone-100">
			<Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
			<div className="flex flex-1 flex-col">
				<Header
					user={currentUser}
					onMenuClick={() => setSidebarOpen(true)}
				/>
				<main className="flex-1 p-6">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
