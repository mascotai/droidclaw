<script lang="ts">
	import { signup } from '$lib/api/auth.remote';
	import Icon from '@iconify/svelte';
	import { AUTH_LOGIN_SUBMIT, AUTH_SIGNUP_SUBMIT } from '$lib/analytics/events';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Label } from '$lib/components/ui/label';
	import { Spinner } from '$lib/components/ui/spinner';
	import * as InputGroup from '$lib/components/ui/input-group';

	let submitting = $state(false);
	let showPassword = $state(false);
</script>

<div class="flex min-h-screen items-center justify-center bg-gradient-to-b from-stone-50 to-stone-100">
	<Card.Root class="auth-card-enter w-full max-w-sm shadow-lg border-stone-200/50">
		<Card.Header class="items-center text-center">
			<Card.Title class="text-2xl">Create your account</Card.Title>
			<Card.Description>Get started with DroidClaw</Card.Description>
		</Card.Header>

		<Card.Content>
			<form
				{...signup.enhance(async ({ submit }) => {
					submitting = true;
					try {
						await submit();
					} finally {
						submitting = false;
					}
				})}
				class="space-y-4"
			>
				<div class="space-y-2">
					<Label for="name" class="flex items-center gap-1.5">
						<Icon icon="ph:user-duotone" class="h-4 w-4 text-stone-400" />
						Username
					</Label>
					<InputGroup.Root>
						<InputGroup.Input
							{...signup.fields.name.as('text')}
							id="name"
							aria-invalid={signup.fields.name.issues()?.length ? true : undefined}
							aria-describedby={signup.fields.name.issues()?.length ? 'name-error' : undefined}
						/>
					</InputGroup.Root>
					{#each signup.fields.name.issues() ?? [] as issue (issue.message)}
						<p id="name-error" class="flex items-center gap-1.5 text-sm text-red-600">
							<Icon icon="solar:danger-triangle-bold" class="h-3.5 w-3.5 shrink-0" />
							{issue.message}
						</p>
					{/each}
				</div>

				<div class="space-y-2">
					<Label for="email" class="flex items-center gap-1.5">
						<Icon icon="ph:envelope-duotone" class="h-4 w-4 text-stone-400" />
						Email
					</Label>
					<InputGroup.Root>
						<InputGroup.Input
							{...signup.fields.email.as('text')}
							id="email"
							aria-invalid={signup.fields.email.issues()?.length ? true : undefined}
							aria-describedby={signup.fields.email.issues()?.length ? 'email-error' : undefined}
						/>
					</InputGroup.Root>
					{#each signup.fields.email.issues() ?? [] as issue (issue.message)}
						<p id="email-error" class="flex items-center gap-1.5 text-sm text-red-600">
							<Icon icon="solar:danger-triangle-bold" class="h-3.5 w-3.5 shrink-0" />
							{issue.message}
						</p>
					{/each}
				</div>

				<div class="space-y-2">
					<Label for="password" class="flex items-center gap-1.5">
						<Icon icon="ph:lock-duotone" class="h-4 w-4 text-stone-400" />
						Password
					</Label>
					<InputGroup.Root>
						<InputGroup.Input
							{...signup.fields.password.as(showPassword ? 'text' : 'password')}
							id="password"
							aria-invalid={signup.fields.password.issues()?.length ? true : undefined}
							aria-describedby={signup.fields.password.issues()?.length ? 'password-error' : undefined}
						/>
						<InputGroup.Button
							size="icon-sm"
							variant="ghost"
							onclick={() => (showPassword = !showPassword)}
							aria-label={showPassword ? 'Hide password' : 'Show password'}
						>
							<Icon icon={showPassword ? 'ph:eye-slash-duotone' : 'ph:eye-duotone'} class="h-4 w-4 text-stone-400" />
						</InputGroup.Button>
					</InputGroup.Root>
					{#each signup.fields.password.issues() ?? [] as issue (issue.message)}
						<p id="password-error" class="flex items-center gap-1.5 text-sm text-red-600">
							<Icon icon="solar:danger-triangle-bold" class="h-3.5 w-3.5 shrink-0" />
							{issue.message}
						</p>
					{/each}
				</div>

				<Button type="submit" class="w-full gap-2" disabled={submitting} data-umami-event={AUTH_SIGNUP_SUBMIT}>
					{#if submitting}
						<Spinner class="h-4 w-4" />
					{:else}
						<Icon icon="ph:user-plus-duotone" class="h-4 w-4" />
					{/if}
					Sign up
				</Button>
			</form>
		</Card.Content>

		<Card.Footer class="justify-center">
			<p class="text-sm text-stone-500">
				Already have an account?
				<a href="/login" data-umami-event={AUTH_LOGIN_SUBMIT} data-umami-event-source="signup-page" class="font-medium text-stone-700 hover:text-stone-900">Log in</a>
			</p>
		</Card.Footer>
	</Card.Root>
</div>
