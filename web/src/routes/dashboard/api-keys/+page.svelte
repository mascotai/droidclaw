<script lang="ts">
	import { listKeys, createKey, deleteKey } from '$lib/api/api-keys.remote';
	import Icon from '@iconify/svelte';
	import { toast } from '$lib/toast';
	import { track } from '$lib/analytics/track';
	import { APIKEY_CREATE, APIKEY_COPY, APIKEY_DELETE } from '$lib/analytics/events';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import * as Alert from '$lib/components/ui/alert';
	import { Separator } from '$lib/components/ui/separator';
	import { EmptyState } from '$lib/components/shared';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { Spinner } from '$lib/components/ui/spinner';

	let newKeyValue = $state<string | null>(null);
	let keysPromise = $state(listKeys());
	let showUsage = $state(false);
	let submitting = $state(false);

	// Delete confirmation state
	let deleteConfirmOpen = $state(false);
	let deleteKeyId = $state<string | null>(null);

	// ToggleGroup key type state
	let keyType = $state('user');

	function confirmDelete(id: string) {
		deleteKeyId = id;
		deleteConfirmOpen = true;
	}
</script>

<h2 class="mb-2 text-xl font-bold md:text-2xl">API Keys</h2>
<p class="mb-6 text-sm text-stone-500">
	Create Bearer tokens for external API access. Use these to call the DroidClaw API from scripts, CI/CD, or other services.
</p>

<!-- Create new key -->
<Card.Root class="mb-8">
	<Card.Header>
		<Card.Title class="text-sm">Create new key</Card.Title>
	</Card.Header>
	<Card.Content>
		<form
			{...createKey.enhance(async ({ submit }) => {
				submitting = true;
				try {
					await submit().updates(listKeys());
					newKeyValue = createKey.result?.key ?? null;
					keysPromise = listKeys();
					toast.success('API key created');
					track(APIKEY_CREATE);
				} finally {
					submitting = false;
				}
			})}
			class="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4"
		>
			<div class="flex flex-1 flex-col gap-1.5">
				<Label for="key-name">Key Name</Label>
				<Input
					{...createKey.fields.name.as('text')}
					id="key-name"
					placeholder="e.g. Production, CI/CD, Workflow Automation"
				/>
				{#each createKey.fields.name.issues() ?? [] as issue (issue.message)}
					<p class="text-sm text-red-600">{issue.message}</p>
				{/each}
			</div>
			<div class="flex flex-col gap-1.5">
				<Label>Type</Label>
				<ToggleGroup.Root
					type="single"
					value={keyType}
					onValueChange={(v) => { if (v) keyType = v; }}
					variant="outline"
					class="rounded-lg border border-stone-200 bg-stone-50 p-0.5"
				>
					<ToggleGroup.Item value="user" class="gap-1.5 text-xs data-[state=on]:bg-white data-[state=on]:text-violet-700 data-[state=on]:shadow-sm">
						<Icon icon="solar:user-bold-duotone" class="h-3.5 w-3.5" />
						User
					</ToggleGroup.Item>
					<ToggleGroup.Item value="device" class="gap-1.5 text-xs data-[state=on]:bg-white data-[state=on]:text-blue-700 data-[state=on]:shadow-sm">
						<Icon icon="solar:smartphone-bold-duotone" class="h-3.5 w-3.5" />
						Device
					</ToggleGroup.Item>
				</ToggleGroup.Root>
				<input type="hidden" {...createKey.fields.type.as('text')} value={keyType} />
			</div>
			<Button type="submit" class="gap-2" disabled={submitting}>
				{#if submitting}
					<Spinner class="h-4 w-4" />
				{:else}
					<Icon icon="solar:add-circle-bold-duotone" class="h-4 w-4" />
				{/if}
				Create
			</Button>
		</form>
	</Card.Content>
</Card.Root>

<!-- Newly created key warning -->
{#if newKeyValue}
	<Alert.Root class="mb-8 border-amber-200 bg-amber-50">
		<Icon icon="solar:danger-triangle-bold-duotone" class="h-5 w-5 text-amber-600" />
		<Alert.Title class="text-amber-800">Save your API key</Alert.Title>
		<Alert.Description class="text-amber-700">
			Copy this key now. It will not be shown again.
		</Alert.Description>
		<div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
			<code class="flex-1 rounded-lg bg-amber-100 px-3 py-2 font-mono text-sm break-all">
				{newKeyValue}
			</code>
			<Tooltip.Root>
				<Tooltip.Trigger>
					<Button
						variant="outline"
						size="sm"
						onclick={() => {
							navigator.clipboard.writeText(newKeyValue!);
							toast.success('Copied to clipboard');
							track(APIKEY_COPY);
						}}
						class="shrink-0 gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-100"
					>
						<Icon icon="solar:copy-bold-duotone" class="h-4 w-4" />
						Copy
					</Button>
				</Tooltip.Trigger>
				<Tooltip.Content>Copy API key</Tooltip.Content>
			</Tooltip.Root>
		</div>

		<!-- Usage example -->
		<button
			onclick={() => (showUsage = !showUsage)}
			class="mt-4 flex items-center gap-1.5 text-sm font-medium text-amber-700 hover:text-amber-900"
		>
			<Icon icon={showUsage ? 'solar:alt-arrow-up-bold' : 'solar:alt-arrow-down-bold'} class="h-4 w-4" />
			{showUsage ? 'Hide' : 'Show'} usage example
		</button>

		{#if showUsage}
			<div class="mt-3 overflow-hidden rounded-lg bg-stone-900">
				<div class="flex items-center justify-between border-b border-stone-700 px-4 py-2">
					<span class="text-xs font-medium text-stone-400">bash</span>
					<Button
						variant="ghost"
						size="sm"
						onclick={() => {
							const code = `curl -X POST https://droidclaw.stack.mascott.ai/workflows/run \\\n  -H "Content-Type: application/json" \\\n  -H "Authorization: Bearer ${newKeyValue}" \\\n  -d '${JSON.stringify({ deviceId: '<your-device-id>', name: 'My Workflow', steps: [{ app: 'com.example.app', goal: 'Open the app', maxSteps: 10 }] }, null, 2)}'`;
							navigator.clipboard.writeText(code);
							toast.success('Code copied');
						}}
						class="h-6 gap-1 text-stone-400 hover:text-white hover:bg-stone-700"
					>
						<Icon icon="solar:copy-bold-duotone" class="h-3 w-3" />
						<span class="text-[10px]">Copy</span>
					</Button>
				</div>
				<div class="p-4 text-sm overflow-x-auto">
					<p class="mb-2 text-stone-400"># Run a workflow with Bearer auth</p>
					<pre class="text-stone-100"><code>curl -X POST https://droidclaw.stack.mascott.ai/workflows/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {newKeyValue}" \
  -d '{JSON.stringify({ deviceId: '<your-device-id>', name: 'My Workflow', steps: [{ app: 'com.example.app', goal: 'Open the app', maxSteps: 10 }] }, null, 2)}'</code></pre>
				</div>
			</div>
		{/if}

		<Button
			variant="ghost"
			size="sm"
			onclick={() => {
				newKeyValue = null;
				showUsage = false;
			}}
			class="mt-3 text-amber-600 hover:text-amber-800"
		>
			Dismiss
		</Button>
	</Alert.Root>
{/if}

<!-- Existing keys list -->
<Card.Root>
	<Card.Header>
		<Card.Title class="text-sm">Your keys</Card.Title>
	</Card.Header>
	<Card.Content class="p-0">
		{#await keysPromise}
			<div class="space-y-3 px-6 py-6">
				{#each [1, 2] as _, i}
					<div class="flex items-center gap-3" style="animation-delay: {i * 150}ms">
						<Skeleton class="h-9 w-9 rounded-full" />
						<div class="space-y-1.5">
							<Skeleton class="h-4 w-32" />
							<Skeleton class="h-3 w-48" />
						</div>
					</div>
				{/each}
			</div>
		{:then keys}
			{#if keys && keys.length > 0}
				{#each keys as key, i (key.id)}
					{#if i > 0}
						<Separator />
					{/if}
					<div class="flex items-center justify-between px-6 py-4">
						<div class="flex items-center gap-3">
							<div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100">
								<Icon icon="solar:key-bold-duotone" class="h-4 w-4 text-amber-600" />
							</div>
							<div>
								<div class="flex items-center gap-2">
									<p class="font-medium text-stone-900">{key.name ?? 'Unnamed Key'}</p>
									{#if key.type === 'device'}
										<Badge variant="outline" class="border-blue-200 bg-blue-50 text-blue-700 text-[10px]">Device</Badge>
									{:else}
										<Badge variant="outline" class="border-violet-200 bg-violet-50 text-violet-700 text-[10px]">User</Badge>
									{/if}
									{#if key.enabled}
										<Badge variant="outline" class="border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px]">Active</Badge>
									{:else}
										<Badge variant="secondary" class="text-[10px]">Disabled</Badge>
									{/if}
								</div>
								<div class="mt-0.5 flex items-center gap-3 text-sm text-stone-500">
									{#if key.start}
										<span class="font-mono">{key.start}...</span>
									{/if}
									<span>
										Created {new Date(key.createdAt).toLocaleDateString()}
									</span>
								</div>
							</div>
						</div>
						<div class="flex items-center gap-2">
							<Tooltip.Root>
								<Tooltip.Trigger>
									<Button
										variant="ghost"
										size="sm"
										onclick={() => confirmDelete(key.id)}
										class="gap-1.5 text-red-500 hover:bg-red-50 hover:text-red-600"
									>
										<Icon icon="solar:trash-bin-trash-bold-duotone" class="h-4 w-4" />
										<span class="hidden sm:inline">Delete</span>
									</Button>
								</Tooltip.Trigger>
								<Tooltip.Content>Delete key</Tooltip.Content>
							</Tooltip.Root>
						</div>
					</div>
				{/each}
			{:else}
				<div class="px-6 py-8">
					<EmptyState
						icon="solar:key-bold-duotone"
						title="No API keys yet"
						description="Create one above. API keys let you call the DroidClaw API with Authorization: Bearer <key>"
					/>
				</div>
			{/if}
		{:catch}
			<div class="flex items-center justify-center gap-2 px-6 py-8 text-sm text-red-600">
				<Icon icon="solar:danger-triangle-bold-duotone" class="h-5 w-5" />
				Failed to load keys. Please try again.
			</div>
		{/await}
	</Card.Content>
</Card.Root>

<!-- Delete confirmation dialog -->
<Dialog.Root bind:open={deleteConfirmOpen} onOpenChange={(open) => { if (!open) deleteKeyId = null; }}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>Delete API key?</Dialog.Title>
			<Dialog.Description>This action cannot be undone. Any scripts or integrations using this key will stop working.</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer class="flex gap-2 pt-4">
			<Button variant="outline" onclick={() => { deleteConfirmOpen = false; deleteKeyId = null; }}>
				Cancel
			</Button>
			{#if deleteKeyId}
				<form
					{...deleteKey.enhance(async ({ submit }) => {
						await submit().updates(listKeys());
						keysPromise = listKeys();
						deleteConfirmOpen = false;
						deleteKeyId = null;
						toast.success('API key deleted');
						track(APIKEY_DELETE);
					})}
				>
					<input type="hidden" name="keyId" value={deleteKeyId} />
					<Button type="submit" variant="destructive">
						Delete
					</Button>
				</form>
			{/if}
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
