<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		open: boolean;
		title?: string;
		description: string;
		confirmLabel?: string;
		cancelLabel?: string;
		variant?: 'destructive' | 'default';
		onconfirm: () => void;
		oncancel: () => void;
	}

	let {
		open = $bindable(),
		title = 'Are you sure?',
		description,
		confirmLabel = 'Confirm',
		cancelLabel = 'Cancel',
		variant = 'destructive',
		onconfirm,
		oncancel
	}: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>{title}</Dialog.Title>
			<Dialog.Description>{description}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="flex gap-2 pt-4">
			<Button variant="outline" onclick={() => { open = false; oncancel(); }}>
				{cancelLabel}
			</Button>
			<Button
				variant={variant === 'destructive' ? 'destructive' : 'default'}
				onclick={() => { open = false; onconfirm(); }}
			>
				{confirmLabel}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
