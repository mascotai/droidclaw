import { createFileRoute, Outlet, redirect, useNavigate } from '@tanstack/react-router';
import { authClient } from '@/lib/auth-client';
import { useWebSocket } from '@/hooks/use-websocket';
import { Sidebar } from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { useState } from 'react';

export const Route = createFileRoute('/_auth')({
	beforeLoad: async () => {
		try {
			const session = await authClient.getSession();
			if (!session?.data?.user) {
				throw redirect({ to: '/login', search: { redirect: window.location.pathname } });
			}
			return { user: session.data.user, session: session.data.session };
		} catch (err) {
			if (err && typeof err === 'object' && 'to' in err) throw err;
			throw redirect({ to: '/login' });
		}
	},
	component: DashboardLayout,
});

function DashboardLayout() {
	const { user, session } = Route.useRouteContext();
	const navigate = useNavigate();
	const [sidebarOpen, setSidebarOpen] = useState(false);

	// Connect WebSocket for real-time updates
	useWebSocket(session?.token);

	async function handleSignOut() {
		await authClient.signOut();
		navigate({ to: '/login' });
	}

	return (
		<div className="flex min-h-screen bg-stone-100">
			<Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
			<div className="flex flex-1 flex-col">
				<Header
					user={user}
					onMenuClick={() => setSidebarOpen(true)}
					onSignOut={handleSignOut}
				/>
				<main className="flex-1 p-6">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
