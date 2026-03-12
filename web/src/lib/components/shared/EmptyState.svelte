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

<div class="flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-200 bg-white/50 py-12 px-6 {cls}">
	<div class="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-stone-100/80">
		<Icon {icon} class="h-8 w-8 text-stone-300 {animate ? 'animate-empty-float' : ''}" />
	</div>
	<p class="text-sm font-medium text-stone-400">{title}</p>
	{#if description}
		<p class="mt-1 max-w-xs text-center text-sm text-stone-300">{description}</p>
	{/if}
</div>
