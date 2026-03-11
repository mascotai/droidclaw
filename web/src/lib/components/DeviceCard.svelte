<script lang="ts">
	import Icon from '@iconify/svelte';
	import { DEVICE_CARD_CLICK } from '$lib/analytics/events';
	import { StatusBadge, TimeAgo } from '$lib/components/shared';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import * as HoverCard from '$lib/components/ui/hover-card';
	import { toast } from '$lib/toast';

	interface Props {
		deviceId: string;
		name: string;
		status: 'online' | 'offline';
		model: string | null;
		manufacturer: string | null;
		androidVersion: string | null;
		screenWidth: number | null;
		screenHeight: number | null;
		batteryLevel: number | null;
		isCharging: boolean;
		lastSeen: string;
		lastGoal: { goal: string; status: string; startedAt: string } | null;
	}

	let {
		deviceId,
		name,
		status,
		model,
		manufacturer,
		androidVersion,
		batteryLevel,
		isCharging,
		screenWidth,
		screenHeight,
		lastSeen,
		lastGoal
	}: Props = $props();

	function batteryIcon(level: number | null, charging: boolean): string {
		if (level === null || level < 0) return 'solar:battery-charge-bold-duotone';
		if (charging) return 'solar:battery-charge-bold-duotone';
		if (level > 75) return 'solar:battery-full-bold-duotone';
		if (level > 50) return 'solar:battery-half-bold-duotone';
		if (level > 25) return 'solar:battery-low-bold-duotone';
		return 'solar:battery-low-bold-duotone';
	}

	/** Sanitize goal text: truncate and strip potential credentials */
	function sanitizeGoalText(text: string): string {
		const credentialPatterns = /\b(type\s*'|password|secret|token|credential|api.?key)\b.*/gi;
		let safe = text.replace(credentialPatterns, '***');
		if (safe.length > 60) safe = safe.slice(0, 60) + '…';
		return safe;
	}

	function copyDeviceId() {
		navigator.clipboard.writeText(deviceId);
		toast.success('Device ID copied');
	}
</script>

<a
	href="/dashboard/devices/{deviceId}"
	aria-label={model ?? name}
	data-umami-event={DEVICE_CARD_CLICK}
	data-umami-event-device={model ?? name}
	class="group block transition-all duration-200 hover:scale-[1.01] hover:shadow-md active:scale-[0.98]"
>
	<Card.Root class="flex min-h-[280px] flex-col overflow-hidden">
		<Card.Header class="pb-3">
			<div class="flex items-center justify-between">
				<StatusBadge {status} size="sm" />
				{#if batteryLevel !== null && batteryLevel >= 0}
					<Badge variant="outline" class="gap-1 text-[11px] {batteryLevel <= 20 ? 'border-red-200 bg-red-50 text-red-600' : 'text-stone-500'}">
						<Icon
							icon={batteryIcon(batteryLevel, isCharging)}
							class="h-3.5 w-3.5"
						/>
						{batteryLevel}%
					</Badge>
				{/if}
			</div>
		</Card.Header>

		<Card.Content class="flex-1 space-y-4">
			<!-- Device info with HoverCard -->
			<HoverCard.Root>
				<HoverCard.Trigger>
					<div class="flex items-center gap-3">
						<div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full {status === 'online' ? 'bg-emerald-100' : 'bg-stone-100'}">
							<Icon icon="solar:smartphone-bold-duotone" class="h-5 w-5 {status === 'online' ? 'text-emerald-600' : 'text-stone-400'}" />
						</div>
						<div class="min-w-0">
							<Card.Title class="truncate text-sm">{model ?? name}</Card.Title>
							{#if manufacturer}
								<Card.Description class="text-xs">{manufacturer}</Card.Description>
							{/if}
						</div>
					</div>
				</HoverCard.Trigger>
				<HoverCard.Content class="w-72">
					<div class="space-y-3">
						<div class="flex items-center gap-3">
							<div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full {status === 'online' ? 'bg-emerald-100' : 'bg-stone-100'}">
								<Icon icon="solar:smartphone-bold-duotone" class="h-5 w-5 {status === 'online' ? 'text-emerald-600' : 'text-stone-400'}" />
							</div>
							<div class="min-w-0">
								<p class="font-semibold text-sm text-stone-900">{model ?? name}</p>
								{#if manufacturer}
									<p class="text-xs text-stone-500">{manufacturer}</p>
								{/if}
							</div>
						</div>
						<div class="space-y-1.5 text-xs">
							<div class="flex items-center justify-between">
								<span class="text-stone-400">Device ID</span>
								<button
									onclick={(e) => { e.preventDefault(); e.stopPropagation(); copyDeviceId(); }}
									class="font-mono text-stone-600 hover:text-stone-900 flex items-center gap-1"
								>
									{deviceId.slice(0, 8)}...
									<Icon icon="solar:copy-bold-duotone" class="h-3 w-3" />
								</button>
							</div>
							{#if androidVersion}
								<div class="flex items-center justify-between">
									<span class="text-stone-400">Android</span>
									<span class="text-stone-600">{androidVersion}</span>
								</div>
							{/if}
							{#if screenWidth && screenHeight}
								<div class="flex items-center justify-between">
									<span class="text-stone-400">Screen</span>
									<span class="text-stone-600">{screenWidth}&times;{screenHeight}</span>
								</div>
							{/if}
							<div class="flex items-center justify-between">
								<span class="text-stone-400">Last seen</span>
								<TimeAgo date={lastSeen} />
							</div>
						</div>
					</div>
				</HoverCard.Content>
			</HoverCard.Root>

			<!-- Specs -->
			<div class="flex flex-wrap gap-1.5">
				{#if androidVersion}
					<Badge variant="secondary" class="text-[10px] font-normal">
						Android {androidVersion}
					</Badge>
				{/if}
				{#if screenWidth && screenHeight}
					<Badge variant="secondary" class="text-[10px] font-normal">
						{screenWidth}&times;{screenHeight}
					</Badge>
				{/if}
			</div>
		</Card.Content>

		<!-- Last goal -->
		<Card.Footer class="flex-col items-stretch border-t border-stone-100 pt-3">
			{#if lastGoal}
				<p class="truncate text-xs text-stone-500">{sanitizeGoalText(lastGoal.goal)}</p>
				<div class="mt-1 flex items-center justify-between">
					<StatusBadge status={lastGoal.status} size="sm" />
					<TimeAgo date={lastGoal.startedAt} />
				</div>
			{:else}
				<p class="text-xs text-stone-400">No goals yet</p>
			{/if}
		</Card.Footer>
	</Card.Root>
</a>
