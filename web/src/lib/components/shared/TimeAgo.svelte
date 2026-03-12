<script lang="ts">
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { onMount } from 'svelte';

	interface Props {
		date: Date | string;
		/** Update interval in ms (default: 30000 = 30s) */
		interval?: number;
		class?: string;
	}

	let { date, interval = 30000, class: cls = '' }: Props = $props();

	let now = $state(Date.now());

	onMount(() => {
		const timer = setInterval(() => {
			now = Date.now();
		}, interval);
		return () => clearInterval(timer);
	});

	const dateObj = $derived(date instanceof Date ? date : new Date(date));

	const relative = $derived.by(() => {
		const diff = now - dateObj.getTime();
		const secs = Math.floor(diff / 1000);
		if (secs < 5) return 'just now';
		if (secs < 60) return `${secs}s ago`;
		const mins = Math.floor(secs / 60);
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		if (days < 30) return `${days}d ago`;
		const months = Math.floor(days / 30);
		return `${months}mo ago`;
	});

	const absolute = $derived(dateObj.toLocaleString());
</script>

<Tooltip.Provider>
	<Tooltip.Root>
		<Tooltip.Trigger class="cursor-default {cls}">
			<time datetime={dateObj.toISOString()}>{relative}</time>
		</Tooltip.Trigger>
		<Tooltip.Content>
			<p>{absolute}</p>
		</Tooltip.Content>
	</Tooltip.Root>
</Tooltip.Provider>
