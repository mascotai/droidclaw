<script lang="ts">
	import Icon from '@iconify/svelte';
	import { DEVICE_CARD_CLICK } from '$lib/analytics/events';
	import { StatusBadge, TimeAgo } from '$lib/components/shared';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';

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
</script>

<a
	href="/dashboard/devices/{deviceId}"
	aria-label={model ?? name}
	data-umami-event={DEVICE_CARD_CLICK}
	data-umami-event-device={model ?? name}
	class="group block transition-all hover:scale-[1.01] active:scale-[0.98]"
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
			<!-- Device info -->
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
