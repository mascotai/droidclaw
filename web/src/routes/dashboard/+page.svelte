<script lang="ts">
	import Icon from '@iconify/svelte';
	import { DASHBOARD_CARD_CLICK } from '$lib/analytics/events';
	import { getConfig } from '$lib/api/settings.remote';
	import { listDevices } from '$lib/api/devices.remote';
	import { dashboardWs } from '$lib/stores/dashboard-ws.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Progress } from '$lib/components/ui/progress';
	import { Badge } from '$lib/components/ui/badge';

	let { data } = $props();

	const cards = [
		{
			href: '/dashboard/devices',
			icon: 'solar:smartphone-bold-duotone',
			title: 'Devices',
			desc: 'Manage connected phones',
			color: 'bg-emerald-100 text-emerald-600'
		},
		{
			href: '/dashboard/api-keys',
			icon: 'solar:key-bold-duotone',
			title: 'API Keys',
			desc: 'Create keys for your devices',
			color: 'bg-amber-100 text-amber-600'
		},
		{
			href: '/dashboard/settings',
			icon: 'solar:settings-bold-duotone',
			title: 'Settings',
			desc: 'Configure LLM provider',
			color: 'bg-violet-100 text-violet-600'
		}
	];

	// Setup checklist data
	const [config, devices] = await Promise.all([getConfig(), listDevices()]);
	const hasConfig = config !== null;
	const deviceList = devices as Array<{ status?: string }>;
	const hasDevice = deviceList.length > 0;
	const onlineCount = deviceList.filter((d) => d.status === 'online').length;

	const checklist = [
		{
			label: 'Configure LLM provider',
			desc: 'Choose your AI model and add credentials',
			href: '/dashboard/settings',
			done: hasConfig
		},
		{
			label: 'Install the Android app',
			desc: 'Download and install DroidClaw on your phone',
			href: 'https://github.com/unitedbyai/droidclaw/releases/latest',
			done: hasDevice
		},
		{
			label: 'Connect your device',
			desc: 'Pair your phone with the dashboard',
			href: '/dashboard/devices?pair',
			done: hasDevice
		}
	];

	const completedCount = checklist.filter((s) => s.done).length;
	const allComplete = completedCount === checklist.length;
	const progressPercent = (completedCount / checklist.length) * 100;
</script>

<h2 class="mb-1 text-xl font-bold md:text-2xl">Dashboard</h2>
<p class="mb-6 text-stone-500">Welcome back, {data.user.name}.</p>

<!-- Stat cards row -->
<div class="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
	<Card.Root>
		<Card.Content class="flex items-center gap-3 py-4">
			<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
				<Icon icon="solar:smartphone-bold-duotone" class="h-5 w-5 text-emerald-600" />
			</div>
			<div>
				<p class="text-2xl font-bold text-stone-900">{deviceList.length}</p>
				<p class="text-xs text-stone-500">
					{#if deviceList.length === 0}
						No devices
					{:else}
						{onlineCount} online
					{/if}
				</p>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Content class="flex items-center gap-3 py-4">
			<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-violet-100">
				<Icon icon="solar:bolt-bold-duotone" class="h-5 w-5 text-violet-600" />
			</div>
			<div>
				<p class="text-2xl font-bold text-stone-900">&mdash;</p>
				<p class="text-xs text-stone-500">Workflow runs</p>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Content class="flex items-center gap-3 py-4">
			<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full {dashboardWs.connected ? 'bg-emerald-100' : 'bg-stone-100'}">
				<span class="relative flex h-2.5 w-2.5">
					{#if dashboardWs.connected}
						<span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"></span>
						<span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
					{:else}
						<span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-stone-300"></span>
					{/if}
				</span>
			</div>
			<div>
				<p class="text-2xl font-bold {dashboardWs.connected ? 'text-emerald-600' : 'text-stone-400'}">
					{dashboardWs.connected ? 'Live' : '...'}
				</p>
				<p class="text-xs text-stone-500">
					{dashboardWs.connected ? 'Connected' : 'Connecting'}
				</p>
			</div>
		</Card.Content>
	</Card.Root>
</div>

{#if data.plan}
	<Card.Root class="mb-6">
		<Card.Content class="flex items-center gap-4 py-4">
			<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
				<Icon icon="solar:verified-check-bold-duotone" class="h-5 w-5 text-emerald-600" />
			</div>
			<div>
				<Card.Title class="text-sm">
					{data.plan === 'ltd' ? 'Lifetime Deal' : data.plan} Plan
				</Card.Title>
				<Card.Description>
					License: {data.licenseKey ?? 'Active'}
				</Card.Description>
			</div>
			<Badge variant="outline" class="ml-auto border-emerald-200 bg-emerald-50 text-emerald-700">
				Active
			</Badge>
		</Card.Content>
	</Card.Root>
{/if}

{#if !allComplete}
	<div class="mb-6">
		<div class="mb-3 flex items-center gap-3">
			<p class="text-sm font-medium text-stone-500">{completedCount} of {checklist.length} complete</p>
			<Progress value={progressPercent} class="h-1.5 max-w-[120px]" />
		</div>
		<Card.Root class="bg-gradient-to-b from-stone-50 to-white">
			{#each checklist as step, i}
				<a
					href={step.href}
					class="flex items-center gap-4 p-5 transition-colors hover:bg-stone-50/80
						{i > 0 ? 'border-t border-stone-100' : ''}
						{i === 0 ? 'rounded-t-xl' : ''}
						{i === checklist.length - 1 ? 'rounded-b-xl' : ''}"
				>
					<div class="flex h-8 w-8 shrink-0 items-center justify-center">
						{#if step.done}
							<Icon icon="solar:check-circle-bold" class="h-6 w-6 text-emerald-500" />
						{:else}
							<Icon icon="solar:circle-linear" class="h-6 w-6 text-stone-300" />
						{/if}
					</div>
					<div class="flex-1">
						<h3 class="text-sm font-semibold {step.done ? 'text-stone-400 line-through' : 'text-stone-900'}">{step.label}</h3>
						<p class="mt-0.5 text-xs text-stone-400">{step.desc}</p>
					</div>
					<Icon icon="solar:alt-arrow-right-linear" class="h-4 w-4 text-stone-300" />
				</a>
			{/each}
		</Card.Root>
	</div>
{:else}
	<!-- All complete celebration -->
	<Card.Root class="mb-6 border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
		<Card.Content class="flex items-center gap-4 py-5">
			<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-100">
				<Icon icon="solar:star-bold-duotone" class="h-5 w-5 text-emerald-600" />
			</div>
			<div>
				<p class="text-sm font-semibold text-emerald-900">All set!</p>
				<p class="text-xs text-emerald-600">Your workspace is ready. Start automating your devices.</p>
			</div>
		</Card.Content>
	</Card.Root>
{/if}

<!-- Nav cards as individual cards in grid -->
<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
	{#each cards as card}
		<a
			href={card.href}
			data-umami-event={DASHBOARD_CARD_CLICK}
			data-umami-event-section={card.title.toLowerCase().replace(' ', '-')}
			class="group block transition-all duration-200 hover:scale-[1.01] hover:shadow-md active:scale-[0.98]"
		>
			<Card.Root class="h-full">
				<Card.Content class="flex flex-col items-center gap-3 py-6 text-center">
					<div class="flex h-12 w-12 items-center justify-center rounded-full {card.color} transition-transform group-hover:scale-110">
						<Icon icon={card.icon} class="h-6 w-6" />
					</div>
					<div>
						<h3 class="font-semibold text-stone-900">{card.title}</h3>
						<p class="mt-0.5 text-sm text-stone-500">{card.desc}</p>
					</div>
				</Card.Content>
			</Card.Root>
		</a>
	{/each}
</div>
