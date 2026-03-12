<script lang="ts">
	import { signout } from '$lib/api/auth.remote';
	import { dashboardWs } from '$lib/stores/dashboard-ws.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import Icon from '@iconify/svelte';
	import { Toaster } from 'svelte-sonner';
	import { AUTH_SIGNOUT, NAV_SIDEBAR_CLICK } from '$lib/analytics/events';
	import { Badge } from '$lib/components/ui/badge';
	import * as Sidebar from '$lib/components/ui/sidebar';

	let { children, data } = $props();

	const navItems = [
		{ href: '/dashboard', label: 'Overview', icon: 'solar:home-2-bold-duotone', exact: true },
		{ href: '/dashboard/devices', label: 'Devices', icon: 'solar:smartphone-bold-duotone' },
		{ href: '/dashboard/api-keys', label: 'API Keys', icon: 'solar:key-bold-duotone' },
		{ href: '/dashboard/settings', label: 'Settings', icon: 'solar:settings-bold-duotone' }
	];

	function isActive(href: string, exact: boolean = false) {
		if (exact) return page.url.pathname === href;
		return page.url.pathname.startsWith(href);
	}

	onMount(() => {
		if (data.sessionToken) {
			dashboardWs.connect(data.sessionToken);
		}
		return () => dashboardWs.disconnect();
	});
</script>

<Sidebar.Provider>
	<Sidebar.Root collapsible="icon" class="border-r-0">
		<Sidebar.Header class="p-4">
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<Sidebar.MenuButton size="lg" class="pointer-events-none">
						<div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-stone-900 text-white">
							<Icon icon="solar:claw-bold-duotone" class="h-4 w-4" />
						</div>
						<div class="flex flex-col gap-0.5 leading-none">
							<span class="font-semibold tracking-tight">DroidClaw<span class="text-stone-400">.ai</span></span>
						</div>
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			</Sidebar.Menu>
		</Sidebar.Header>

		<Sidebar.Content>
			<Sidebar.Group>
				<Sidebar.GroupLabel>Navigation</Sidebar.GroupLabel>
				<Sidebar.GroupContent>
					<Sidebar.Menu>
						{#each navItems as item}
							<Sidebar.MenuItem>
								<Sidebar.MenuButton
									isActive={isActive(item.href, item.exact)}
									tooltipContent={item.label}
								>
									{#snippet child({ props })}
										<a
											href={item.href}
											data-umami-event={NAV_SIDEBAR_CLICK}
											data-umami-event-section={item.label.toLowerCase().replace(' ', '-')}
											{...props}
										>
											<Icon icon={item.icon} class="h-4 w-4" />
											<span>{item.label}</span>
										</a>
									{/snippet}
								</Sidebar.MenuButton>
							</Sidebar.MenuItem>
						{/each}
					</Sidebar.Menu>
				</Sidebar.GroupContent>
			</Sidebar.Group>
		</Sidebar.Content>

		<Sidebar.Footer>
			<!-- Connection status -->
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<Sidebar.MenuButton class="pointer-events-none" size="sm">
						<span class="relative flex h-2 w-2 shrink-0">
							{#if dashboardWs.connected}
								<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"></span>
								<span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
							{:else}
								<span class="relative inline-flex h-2 w-2 rounded-full bg-stone-300"></span>
							{/if}
						</span>
						<span class="text-xs {dashboardWs.connected ? 'text-emerald-600' : 'text-stone-400'}">
							{dashboardWs.connected ? 'Live' : 'Connecting...'}
						</span>
					</Sidebar.MenuButton>
				</Sidebar.MenuItem>
			</Sidebar.Menu>

			{#if data.plan}
				<Sidebar.Menu>
					<Sidebar.MenuItem>
						<Sidebar.MenuButton class="pointer-events-none">
							<Icon icon="ph:seal-check-duotone" class="h-4 w-4 text-emerald-600" />
							<Badge variant="outline" class="border-emerald-200 bg-emerald-50 text-emerald-700 text-xs">
								{data.plan === 'ltd' ? 'Lifetime' : data.plan}
							</Badge>
						</Sidebar.MenuButton>
					</Sidebar.MenuItem>
				</Sidebar.Menu>
			{/if}
			<Sidebar.Menu>
				<Sidebar.MenuItem>
					<form {...signout}>
						<Sidebar.MenuButton tooltipContent="Sign out">
							{#snippet child({ props })}
								<button
									type="submit"
									data-umami-event={AUTH_SIGNOUT}
									{...props}
								>
									<Icon icon="solar:logout-2-bold-duotone" class="h-4 w-4" />
									<span>Sign out</span>
								</button>
							{/snippet}
						</Sidebar.MenuButton>
					</form>
				</Sidebar.MenuItem>
			</Sidebar.Menu>
		</Sidebar.Footer>

		<Sidebar.Rail />
	</Sidebar.Root>

	<Sidebar.Inset>
		<!-- Mobile header with sidebar trigger -->
		<header class="flex h-12 items-center gap-2 border-b px-4 md:hidden">
			<Sidebar.Trigger />
			<span class="font-semibold tracking-tight text-sm">DroidClaw<span class="text-stone-400">.ai</span></span>
		</header>

		<main class="flex-1 overflow-auto p-4 pb-8 md:p-8">
			<div class="mx-auto max-w-5xl">
				{#key page.url.pathname}
					<div class="animate-page-enter">
						{@render children?.()}
					</div>
				{/key}
			</div>
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>

<Toaster position="bottom-right" />
