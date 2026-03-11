<script lang="ts">
	import { activateLicense, activateFromCheckout } from '$lib/api/license.remote';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Icon from '@iconify/svelte';
	import { LICENSE_ACTIVATE_CHECKOUT, LICENSE_ACTIVATE_MANUAL, LICENSE_PURCHASE_CLICK } from '$lib/analytics/events';
	import * as Card from '$lib/components/ui/card';
	import * as Alert from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Spinner } from '$lib/components/ui/spinner';

	const checkoutId = page.url.searchParams.get('checkout_id');

	let showKeyInput = $state(false);
	let checkoutStatus = $state<'activating' | 'error' | 'idle'>('idle');
	let checkoutError = $state('');
	let submitting = $state(false);

	async function activateCheckout() {
		if (!checkoutId) return;
		checkoutStatus = 'activating';
		checkoutError = '';
		try {
			await activateFromCheckout({ checkoutId });
			goto('/dashboard');
		} catch (e: any) {
			checkoutError = e.message ?? 'Failed to activate from checkout';
			checkoutStatus = 'error';
		}
	}

	onMount(() => {
		if (checkoutId) activateCheckout();
	});
</script>

<div class="flex min-h-[60vh] items-center justify-center">
{#if checkoutId}
	<!-- Auto-activate from Polar checkout -->
	<Card.Root class="w-full max-w-md shadow-lg border-stone-200/50">
		<Card.Header class="items-center text-center">
			{#if checkoutStatus === 'activating'}
				<div class="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-stone-100">
					<Spinner class="h-6 w-6 text-stone-600" />
				</div>
				<Card.Title class="text-2xl">Activating your license...</Card.Title>
				<Card.Description>
					We're setting up your account. This will only take a moment.
				</Card.Description>
			{:else if checkoutStatus === 'error'}
				<div class="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-red-50">
					<Icon icon="ph:warning-duotone" class="h-6 w-6 text-red-500" />
				</div>
				<Card.Title class="text-2xl">Activation failed</Card.Title>
				<Card.Description>{checkoutError}</Card.Description>
			{/if}
		</Card.Header>

		<Card.Content class="space-y-4">
			{#if checkoutStatus === 'error'}
				<Button
					onclick={activateCheckout}
					data-umami-event={LICENSE_ACTIVATE_CHECKOUT}
					class="w-full gap-2"
				>
					<Icon icon="ph:arrow-clockwise-duotone" class="h-4 w-4" />
					Retry
				</Button>
			{/if}

			<Alert.Root class="border-stone-200 bg-stone-50">
				<Icon icon="solar:info-circle-bold-duotone" class="h-5 w-5 text-stone-400" />
				<Alert.Description class="text-stone-500">
					If activation doesn't work automatically, check your email for the license key and enter it manually below.
				</Alert.Description>
			</Alert.Root>

			<div class="text-center">
				<p class="text-sm font-medium text-stone-400">Or activate manually</p>
			</div>

			<form
				{...activateLicense.enhance(async ({ submit }) => {
					submitting = true;
					try {
						await submit();
						goto('/dashboard');
					} finally {
						submitting = false;
					}
				})}
				class="space-y-4"
			>
				<div class="space-y-2">
					<Label for="key" class="flex items-center gap-1.5">
						<Icon icon="ph:key-duotone" class="h-4 w-4 text-stone-400" />
						License Key
					</Label>
					<Input
						{...activateLicense.fields.key.as('text')}
						id="key"
						placeholder="DROIDCLAW-XXXX-XXXX-XXXX"
					/>
					{#each activateLicense.fields.key.issues() ?? [] as issue (issue.message)}
						<p class="text-sm text-red-600">{issue.message}</p>
					{/each}
				</div>

				<Button type="submit" class="w-full gap-2" disabled={submitting} data-umami-event={LICENSE_ACTIVATE_MANUAL}>
					{#if submitting}
						<Spinner class="h-4 w-4" />
					{:else}
						<Icon icon="ph:seal-check-duotone" class="h-4 w-4" />
					{/if}
					Activate
				</Button>
			</form>
		</Card.Content>
	</Card.Root>
{:else}
	<!-- Purchase-first flow -->
	<Card.Root class="w-full max-w-md shadow-lg border-stone-200/50">
		<Card.Header class="items-center text-center">
			<Card.Title class="text-2xl">Get started with DroidClaw</Card.Title>
			<Card.Description>Unlock AI-powered Android device control.</Card.Description>
		</Card.Header>

		<Card.Content class="space-y-4">
			<Button
				href="https://buy.polar.sh/polar_cl_jCKKpL4dSdvLZr9H6JYeeCiXjTH98Rf9b4kKM2VqvG2"
				data-umami-event={LICENSE_PURCHASE_CLICK}
				class="w-full gap-2 text-base"
			>
				<Icon icon="ph:credit-card-duotone" class="h-5 w-5" />
				Purchase Now
			</Button>

			<div class="pt-4">
				<button
					type="button"
					onclick={() => showKeyInput = !showKeyInput}
					class="flex w-full items-center justify-center gap-1.5 text-sm text-stone-400 hover:text-stone-600"
				>
					Already have a license key?
					<Icon
						icon="ph:caret-down"
						class="h-3.5 w-3.5 transition-transform {showKeyInput ? 'rotate-180' : ''}"
					/>
				</button>

				{#if showKeyInput}
					<div class="mt-4">
						<form
							{...activateLicense.enhance(async ({ submit }) => {
								submitting = true;
								try {
									await submit();
									goto('/dashboard');
								} finally {
									submitting = false;
								}
							})}
							class="space-y-4"
						>
							<div class="space-y-2">
								<Label for="key-manual" class="flex items-center gap-1.5">
									<Icon icon="ph:key-duotone" class="h-4 w-4 text-stone-400" />
									License Key
								</Label>
								<Input
									{...activateLicense.fields.key.as('text')}
									id="key-manual"
									placeholder="DROIDCLAW-XXXX-XXXX-XXXX"
								/>
								{#each activateLicense.fields.key.issues() ?? [] as issue (issue.message)}
									<p class="text-sm text-red-600">{issue.message}</p>
								{/each}
							</div>

							<Button type="submit" variant="outline" class="w-full gap-2" disabled={submitting} data-umami-event={LICENSE_ACTIVATE_MANUAL}>
								{#if submitting}
									<Spinner class="h-4 w-4" />
								{:else}
									<Icon icon="ph:seal-check-duotone" class="h-4 w-4" />
								{/if}
								Activate
							</Button>
						</form>
					</div>
				{/if}
			</div>
		</Card.Content>
	</Card.Root>
{/if}
</div>
