<script lang="ts">
	import Icon from '@iconify/svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
</script>

<div class="flex min-h-screen items-center justify-center bg-neutral-50">
	<Card.Root class="w-full max-w-sm">
		<Card.Header class="items-center text-center">
			<div class="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-900">
				<Icon icon="ph:envelope-duotone" class="h-6 w-6 text-white" />
			</div>
			<Card.Title class="text-2xl">Check your email</Card.Title>
			<Card.Description>
				We sent a verification link to your email address. Click the link to verify your account.
			</Card.Description>
		</Card.Header>

		<Card.Content class="text-center">
			<p class="text-sm text-neutral-400">
				Didn't receive it? Check your spam folder or
				<a href="/signup" class="font-medium text-neutral-700 hover:text-neutral-900">
					try signing up again</a
				>.
			</p>
		</Card.Content>

		<Card.Footer class="justify-center">
			<Button variant="ghost" href="/login" class="gap-2">
				<Icon icon="ph:arrow-left" class="h-4 w-4" />
				Back to login
			</Button>
		</Card.Footer>
	</Card.Root>
</div>
