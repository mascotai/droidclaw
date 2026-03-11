<script lang="ts">
	import { signup } from '$lib/api/auth.remote';
	import Icon from '@iconify/svelte';
	import { AUTH_LOGIN_SUBMIT, AUTH_SIGNUP_SUBMIT } from '$lib/analytics/events';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
</script>

<div class="flex min-h-screen items-center justify-center bg-neutral-50">
	<Card.Root class="w-full max-w-sm">
		<Card.Header class="items-center text-center">
			<div class="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-neutral-900">
				<Icon icon="ph:robot-duotone" class="h-6 w-6 text-white" />
			</div>
			<Card.Title class="text-2xl">Create your account</Card.Title>
			<Card.Description>Get started with DroidClaw</Card.Description>
		</Card.Header>

		<Card.Content>
			<form {...signup} class="space-y-4">
				<div class="space-y-2">
					<Label for="name" class="flex items-center gap-1.5">
						<Icon icon="ph:user-duotone" class="h-4 w-4 text-neutral-400" />
						Username
					</Label>
					<Input
						{...signup.fields.name.as('text')}
						id="name"
					/>
					{#each signup.fields.name.issues() ?? [] as issue (issue.message)}
						<p class="text-sm text-red-600">{issue.message}</p>
					{/each}
				</div>

				<div class="space-y-2">
					<Label for="email" class="flex items-center gap-1.5">
						<Icon icon="ph:envelope-duotone" class="h-4 w-4 text-neutral-400" />
						Email
					</Label>
					<Input
						{...signup.fields.email.as('text')}
						id="email"
					/>
					{#each signup.fields.email.issues() ?? [] as issue (issue.message)}
						<p class="text-sm text-red-600">{issue.message}</p>
					{/each}
				</div>

				<div class="space-y-2">
					<Label for="password" class="flex items-center gap-1.5">
						<Icon icon="ph:lock-duotone" class="h-4 w-4 text-neutral-400" />
						Password
					</Label>
					<Input
						{...signup.fields.password.as('password')}
						id="password"
					/>
					{#each signup.fields.password.issues() ?? [] as issue (issue.message)}
						<p class="text-sm text-red-600">{issue.message}</p>
					{/each}
				</div>

				<Button type="submit" class="w-full gap-2" data-umami-event={AUTH_SIGNUP_SUBMIT}>
					<Icon icon="ph:user-plus-duotone" class="h-4 w-4" />
					Sign up
				</Button>
			</form>
		</Card.Content>

		<Card.Footer class="justify-center">
			<p class="text-sm text-neutral-500">
				Already have an account?
				<a href="/login" data-umami-event={AUTH_LOGIN_SUBMIT} data-umami-event-source="signup-page" class="font-medium text-neutral-700 hover:text-neutral-900">Log in</a>
			</p>
		</Card.Footer>
	</Card.Root>
</div>
