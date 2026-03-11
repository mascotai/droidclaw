<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import Icon from '@iconify/svelte';

	interface Props {
		status: string;
		/** Show pulsing dot for live statuses (running, online) */
		pulse?: boolean;
		/** Size variant */
		size?: 'sm' | 'default';
		class?: string;
	}

	let { status, pulse, size = 'default', class: cls = '' }: Props = $props();

	const config = $derived.by(() => {
		const s = status.toLowerCase();
		switch (s) {
			case 'online':
				return {
					label: 'Online',
					variant: 'outline' as const,
					colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
					dotClass: 'bg-emerald-500',
					icon: 'solar:check-circle-bold-duotone'
				};
			case 'offline':
				return {
					label: 'Offline',
					variant: 'outline' as const,
					colorClass: 'bg-stone-100 text-stone-500 border-stone-200',
					dotClass: 'bg-stone-400',
					icon: 'solar:close-circle-bold-duotone'
				};
			case 'completed':
				return {
					label: 'Completed',
					variant: 'outline' as const,
					colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200',
					dotClass: 'bg-emerald-500',
					icon: 'solar:check-circle-bold-duotone'
				};
			case 'running':
				return {
					label: 'Running',
					variant: 'outline' as const,
					colorClass: 'bg-violet-50 text-violet-700 border-violet-200',
					dotClass: 'bg-violet-500',
					icon: 'solar:refresh-circle-bold-duotone'
				};
			case 'failed':
				return {
					label: 'Failed',
					variant: 'outline' as const,
					colorClass: 'bg-red-50 text-red-700 border-red-200',
					dotClass: 'bg-red-500',
					icon: 'solar:close-circle-bold-duotone'
				};
			case 'stopped':
				return {
					label: 'Stopped',
					variant: 'outline' as const,
					colorClass: 'bg-stone-100 text-stone-500 border-stone-200',
					dotClass: 'bg-stone-400',
					icon: 'solar:stop-circle-bold-duotone'
				};
			case 'pending':
				return {
					label: 'Pending',
					variant: 'outline' as const,
					colorClass: 'bg-stone-50 text-stone-500 border-stone-200',
					dotClass: 'bg-stone-300',
					icon: 'solar:clock-circle-bold-duotone'
				};
			case 'queued':
				return {
					label: 'Queued',
					variant: 'outline' as const,
					colorClass: 'bg-amber-50 text-amber-700 border-amber-200',
					dotClass: 'bg-amber-500',
					icon: 'solar:clock-circle-bold-duotone'
				};
			case 'cached':
				return {
					label: 'Cached',
					variant: 'outline' as const,
					colorClass: 'bg-cyan-50 text-cyan-700 border-cyan-200',
					dotClass: 'bg-cyan-500',
					icon: 'solar:bolt-bold-duotone'
				};
			default:
				return {
					label: status,
					variant: 'outline' as const,
					colorClass: 'bg-stone-100 text-stone-600 border-stone-200',
					dotClass: 'bg-stone-400',
					icon: 'solar:info-circle-bold-duotone'
				};
		}
	});

	const showPulse = $derived(pulse ?? (status === 'running' || status === 'online'));
	const sizeClass = $derived(size === 'sm' ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2.5 py-0.5');
</script>

<Badge variant={config.variant} class="inline-flex items-center gap-1.5 font-medium transition-colors duration-300 {config.colorClass} {sizeClass} {cls}">
	{#if showPulse}
		<span class="relative flex h-1.5 w-1.5">
			<span class="absolute inline-flex h-full w-full animate-ping rounded-full {config.dotClass} opacity-60"></span>
			<span class="relative inline-flex h-1.5 w-1.5 rounded-full {config.dotClass}"></span>
		</span>
	{:else}
		<Icon icon={config.icon} class="h-3 w-3" />
	{/if}
	{config.label}
</Badge>
