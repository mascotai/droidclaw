<script lang="ts">
	import Icon from '@iconify/svelte';
	import type { DeviceData } from './types';

	interface Props {
		deviceData: DeviceData | null;
		deviceId: string;
		battery: number | null;
		charging: boolean;
	}

	let { deviceData, deviceId, battery, charging }: Props = $props();

	let detailsOpen = $state(false);
	let appSearch = $state('');

	const filteredApps = $derived(
		(deviceData?.installedApps ?? []).filter(
			(a) =>
				!appSearch ||
				a.label.toLowerCase().includes(appSearch.toLowerCase()) ||
				a.packageName.toLowerCase().includes(appSearch.toLowerCase())
		)
	);

	function relativeTime(iso: string) {
		const diff = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		return `${days}d ago`;
	}
</script>

<div class="mb-6">
	<!-- Top row: back button + device name + status -->
	<div class="flex items-center gap-3">
		<a
			href="/dashboard/devices"
			class="flex h-9 w-9 items-center justify-center rounded-full text-stone-400 transition-colors hover:bg-white hover:text-stone-600"
		>
			<Icon icon="solar:alt-arrow-left-linear" class="h-5 w-5" />
		</a>
		<div class="flex items-center gap-3">
			<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full {deviceData?.status === 'online' ? 'bg-emerald-100' : 'bg-stone-200'}">
				<Icon icon="solar:smartphone-bold-duotone" class="h-5 w-5 {deviceData?.status === 'online' ? 'text-emerald-600' : 'text-stone-400'}" />
			</div>
			<div>
				<h2 class="text-xl font-bold md:text-2xl">{deviceData?.model ?? deviceId.slice(0, 8)}</h2>
				{#if deviceData?.manufacturer}
					<p class="text-sm text-stone-500">{deviceData.manufacturer}</p>
				{/if}
			</div>
			<span
				class="ml-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium
					{deviceData?.status === 'online'
					? 'bg-emerald-50 text-emerald-700'
					: 'bg-stone-200 text-stone-500'}"
			>
				<span
					class="inline-block h-1.5 w-1.5 rounded-full {deviceData?.status === 'online'
						? 'bg-emerald-500'
						: 'bg-stone-400'}"
				></span>
				{deviceData?.status === 'online' ? 'Online' : 'Offline'}
			</span>
		</div>

		<!-- Battery + details toggle -->
		<div class="ml-auto flex items-center gap-2">
			{#if battery !== null && battery >= 0}
				<span class="flex items-center gap-1 text-xs font-medium {battery <= 20 ? 'text-red-600' : 'text-stone-500'}">
					<Icon
						icon={charging ? 'solar:battery-charge-bold-duotone' : battery > 50 ? 'solar:battery-full-bold-duotone' : 'solar:battery-low-bold-duotone'}
						class="h-4 w-4"
					/>
					{battery}%
				</span>
			{/if}
			<button
				onclick={() => (detailsOpen = !detailsOpen)}
				class="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-stone-400 transition-colors hover:bg-white hover:text-stone-600"
			>
				<Icon icon="solar:info-circle-bold-duotone" class="h-3.5 w-3.5" />
				<Icon icon={detailsOpen ? 'solar:alt-arrow-up-linear' : 'solar:alt-arrow-down-linear'} class="h-3 w-3" />
			</button>
		</div>
	</div>

	<!-- Collapsible details panel -->
	{#if detailsOpen}
		<div class="mt-4 rounded-2xl bg-white p-5">
			<div class="grid gap-4 sm:grid-cols-2">
				<!-- Device Specs -->
				<div>
					<p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400">Specs</p>
					<div class="space-y-1.5 text-sm">
						{#if deviceData?.androidVersion}
							<div class="flex justify-between">
								<span class="text-stone-500">Android</span>
								<span class="font-medium text-stone-900">{deviceData.androidVersion}</span>
							</div>
						{/if}
						{#if deviceData?.screenWidth && deviceData?.screenHeight}
							<div class="flex justify-between">
								<span class="text-stone-500">Resolution</span>
								<span class="font-medium text-stone-900">{deviceData.screenWidth} &times; {deviceData.screenHeight}</span>
							</div>
						{/if}
						{#if battery !== null && battery >= 0}
							<div class="flex justify-between">
								<span class="text-stone-500">Battery</span>
								<span class="flex items-center gap-1.5 font-medium {battery <= 20 ? 'text-red-600' : 'text-stone-900'}">
									<Icon
										icon={charging ? 'solar:battery-charge-bold-duotone' : battery > 50 ? 'solar:battery-full-bold-duotone' : 'solar:battery-low-bold-duotone'}
										class="h-4 w-4"
									/>
									{battery}%{charging ? ' Charging' : ''}
								</span>
							</div>
						{/if}
						<div class="flex justify-between">
							<span class="text-stone-500">Last seen</span>
							<span class="font-medium text-stone-900">{deviceData ? relativeTime(deviceData.lastSeen) : '\u2014'}</span>
						</div>
					</div>
				</div>

				<!-- Installed Apps -->
				{#if deviceData && deviceData.installedApps.length > 0}
					<div>
						<div class="mb-2 flex items-center justify-between">
							<p class="text-[10px] font-semibold uppercase tracking-wider text-stone-400">
								Apps ({deviceData.installedApps.length})
							</p>
							<div class="relative">
								<Icon icon="solar:magnifer-bold-duotone" class="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-stone-400" />
								<input
									type="text"
									bind:value={appSearch}
									placeholder="Search..."
									class="w-32 rounded-md border border-stone-200 bg-stone-50 py-1 pl-6 pr-2 text-[10px] focus:border-stone-400 focus:outline-none"
								/>
							</div>
						</div>
						<div class="max-h-40 space-y-0.5 overflow-y-auto">
							{#each filteredApps.slice(0, 50) as app (app.packageName)}
								<div class="flex items-center justify-between rounded-md px-2 py-1 text-xs hover:bg-stone-50">
									<span class="font-medium text-stone-800">{app.label}</span>
									<span class="font-mono text-[10px] text-stone-400">{app.packageName}</span>
								</div>
							{:else}
								<p class="py-2 text-[10px] text-stone-400 italic">No apps match</p>
							{/each}
							{#if filteredApps.length > 50}
								<p class="py-1 text-[10px] text-stone-400 italic">+{filteredApps.length - 50} more</p>
							{/if}
						</div>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
