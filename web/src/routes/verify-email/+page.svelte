<script lang="ts">
	import Icon from '@iconify/svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
</script>

<div class="flex min-h-screen items-center justify-center bg-gradient-to-b from-stone-50 to-stone-100">
	<Card.Root class="auth-card-enter w-full max-w-sm shadow-lg border-stone-200/50">
		<Card.Header class="items-center text-center">
			<Card.Title class="text-2xl">Check your email</Card.Title>
			<Card.Description>
				We sent a verification link to your email address. Click the link to verify your account.
			</Card.Description>
		</Card.Header>

		<Card.Content class="text-center">
			<p class="text-sm text-stone-400">
				Didn't receive it? Check your spam folder or
				<a href="/signup" class="font-medium text-stone-700 hover:text-stone-900">
					try signing up again</a
				>.
			</p>
		</Card.Content>

		<Card.Footer class="justify-center">
			<Button variant="outline" href="/login" class="gap-2">
				<Icon icon="ph:arrow-left" class="h-4 w-4" />
				Back to login
			</Button>
		</Card.Footer>
	</Card.Root>
</div>
