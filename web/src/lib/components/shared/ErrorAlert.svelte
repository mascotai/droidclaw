<script lang="ts">
	import Icon from '@iconify/svelte';
	import * as Alert from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		title?: string;
		message: string;
		onretry?: (() => void) | null;
		class?: string;
	}

	let { title = 'Something went wrong', message, onretry = null, class: className = '' }: Props = $props();
</script>

<Alert.Root class="border-red-200 bg-red-50 {className}">
	<Icon icon="solar:danger-triangle-bold-duotone" class="h-5 w-5 text-red-600" />
	<Alert.Title class="text-red-800">{title}</Alert.Title>
	<Alert.Description class="text-red-700">{message}</Alert.Description>
	{#if onretry}
		<Button variant="outline" size="sm" onclick={onretry} class="mt-2 gap-1.5 border-red-200 text-red-700 hover:bg-red-100">
			<Icon icon="solar:refresh-bold-duotone" class="h-3.5 w-3.5" />
			Retry
		</Button>
	{/if}
</Alert.Root>
