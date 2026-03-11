<script lang="ts">
	import Icon from '@iconify/svelte';

	interface Props {
		icon?: string;
		title: string;
		description?: string;
		animate?: boolean;
		class?: string;
	}

	let { icon = 'solar:inbox-bold-duotone', title, description, animate = false, class: cls = '' }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-stone-200 bg-white/50 py-12 px-6 {cls}">
	<Icon {icon} class="mb-3 h-10 w-10 text-stone-300 {animate ? 'animate-empty-float' : ''}" />
	<p class="text-sm font-medium text-stone-400">{title}</p>
	{#if description}
		<p class="mt-1 text-xs text-stone-300">{description}</p>
	{/if}
</div>
