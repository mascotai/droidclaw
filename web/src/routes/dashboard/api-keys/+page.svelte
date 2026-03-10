<script lang="ts">
	import { listKeys, createKey, deleteKey } from '$lib/api/api-keys.remote';
	import Icon from '@iconify/svelte';
	import { toast } from '$lib/toast';
	import { track } from '$lib/analytics/track';
	import { APIKEY_CREATE, APIKEY_COPY, APIKEY_DELETE } from '$lib/analytics/events';

	let newKeyValue = $state<string | null>(null);
	let keysPromise = $state(listKeys());
	let showUsage = $state(false);
	let confirmingDelete = $state<string | null>(null);
</script>

<h2 class="mb-2 text-xl md:text-2xl font-bold">API Keys</h2>
<p class="mb-6 text-sm text-stone-500">
	Create Bearer tokens for external API access. Use these to call the DroidClaw API from scripts, CI/CD, or other services.
</p>

<!-- Create new key -->
<p class="mb-3 text-sm font-medium text-stone-500">Create new key</p>
<div class="mb-8 rounded-2xl bg-white p-6">
	<form
		{...createKey.enhance(async ({ submit }) => {
			await submit().updates(listKeys());
			newKeyValue = createKey.result?.key ?? null;
			keysPromise = listKeys();
			toast.success('API key created');
			track(APIKEY_CREATE);
		})}
		class="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4"
	>
		<label class="flex flex-1 flex-col gap-1">
			<span class="text-sm text-stone-600">Key Name</span>
			<input
				{...createKey.fields.name.as('text')}
				placeholder="e.g. Production, CI/CD, Workflow Automation"
				class="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
			/>
			{#each createKey.fields.name.issues() ?? [] as issue (issue.message)}
				<p class="text-sm text-red-600">{issue.message}</p>
			{/each}
		</label>
		<label class="flex flex-col gap-1">
			<span class="text-sm text-stone-600">Type</span>
			<div class="flex gap-1 rounded-lg border border-stone-200 bg-stone-50 p-0.5">
				<label class="flex-1">
					<input {...createKey.fields.type.as('radio')} value="user" class="peer sr-only" checked />
					<span class="flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-stone-500 transition-colors peer-checked:bg-white peer-checked:text-violet-700 peer-checked:shadow-sm">
						<Icon icon="solar:user-bold-duotone" class="h-3.5 w-3.5" />
						User
					</span>
				</label>
				<label class="flex-1">
					<input {...createKey.fields.type.as('radio')} value="device" class="peer sr-only" />
					<span class="flex cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-stone-500 transition-colors peer-checked:bg-white peer-checked:text-blue-700 peer-checked:shadow-sm">
						<Icon icon="solar:smartphone-bold-duotone" class="h-3.5 w-3.5" />
						Device
					</span>
				</label>
			</div>
		</label>
		<button
			type="submit"
			class="flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition-transform hover:bg-stone-800 active:scale-[0.98]"
		>
			<Icon icon="solar:add-circle-bold-duotone" class="h-4 w-4" />
			Create
		</button>
	</form>
</div>

<!-- Newly created key warning -->
{#if newKeyValue}
	<div class="mb-8 rounded-2xl bg-amber-50 p-6">
		<div class="mb-2 flex items-center gap-2">
			<Icon icon="solar:danger-triangle-bold-duotone" class="h-5 w-5 text-amber-600" />
			<h3 class="font-semibold text-amber-800">Save your API key</h3>
		</div>
		<p class="mb-3 text-sm text-amber-700">
			Copy this key now. It will not be shown again.
		</p>
		<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
			<code class="flex-1 rounded-lg bg-amber-100 px-3 py-2 font-mono text-sm break-all">
				{newKeyValue}
			</code>
			<button
				onclick={() => {
					navigator.clipboard.writeText(newKeyValue!);
					toast.success('Copied to clipboard');
					track(APIKEY_COPY);
				}}
				class="flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-amber-300 px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
			>
				<Icon icon="solar:copy-bold-duotone" class="h-4 w-4" />
				Copy
			</button>
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
			<div class="mt-3 rounded-lg bg-stone-900 p-4 text-sm">
				<p class="mb-2 text-stone-400"># Run a workflow with Bearer auth</p>
				<pre class="overflow-x-auto text-stone-100"><code>curl -X POST https://droidclaw.stack.mascott.ai/workflows/run \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {newKeyValue}" \
  -d '{JSON.stringify({ deviceId: '<your-device-id>', name: 'My Workflow', steps: [{ app: 'com.example.app', goal: 'Open the app', maxSteps: 10 }] }, null, 2)}'</code></pre>
			</div>
		{/if}

		<button
			onclick={() => {
				newKeyValue = null;
				showUsage = false;
			}}
			class="mt-3 text-sm text-amber-600 hover:text-amber-800"
		>
			Dismiss
		</button>
	</div>
{/if}

<!-- Existing keys list -->
<p class="mb-3 text-sm font-medium text-stone-500">Your keys</p>
<div class="rounded-2xl bg-white">
	{#await keysPromise}
		<div class="flex items-center justify-center gap-2 px-6 py-8 text-sm text-stone-500">
			<Icon icon="solar:refresh-circle-bold-duotone" class="h-5 w-5 animate-spin text-stone-400" />
			Loading keys...
		</div>
	{:then keys}
		{#if keys && keys.length > 0}
			{#each keys as key, i (key.id)}
				<div class="flex items-center justify-between px-4 md:px-6 py-4
					{i > 0 ? 'border-t border-stone-100' : ''}">
					<div class="flex items-center gap-3">
						<div class="flex h-9 w-9 items-center justify-center rounded-full bg-amber-100">
							<Icon icon="solar:key-bold-duotone" class="h-4 w-4 text-amber-600" />
						</div>
						<div>
							<div class="flex items-center gap-2">
								<p class="font-medium text-stone-900">{key.name ?? 'Unnamed Key'}</p>
								{#if key.type === 'device'}
									<span class="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700">Device</span>
								{:else}
									<span class="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700">User</span>
								{/if}
								{#if key.enabled}
									<span class="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Active</span>
								{:else}
									<span class="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-stone-500">Disabled</span>
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
						{#if confirmingDelete === key.id}
							<span class="text-xs text-stone-500">Delete?</span>
							<form
								{...deleteKey.enhance(async ({ submit }) => {
									await submit().updates(listKeys());
									keysPromise = listKeys();
									confirmingDelete = null;
									toast.success('API key deleted');
									track(APIKEY_DELETE);
								})}
							>
								<input type="hidden" name="keyId" value={key.id} />
								<button
									type="submit"
									class="rounded-lg px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
								>
									Yes
								</button>
							</form>
							<button
								onclick={() => (confirmingDelete = null)}
								class="rounded-lg px-2 py-1 text-xs font-medium text-stone-500 hover:bg-stone-100"
							>
								No
							</button>
						{:else}
							<button
								onclick={() => (confirmingDelete = key.id)}
								class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-red-500 hover:bg-red-50"
							>
								<Icon icon="solar:trash-bin-trash-bold-duotone" class="h-4 w-4" />
								<span class="hidden sm:inline">Delete</span>
							</button>
						{/if}
					</div>
				</div>
			{/each}
		{:else}
			<div class="px-6 py-10 text-center">
				<Icon icon="solar:key-bold-duotone" class="mx-auto mb-3 h-8 w-8 text-stone-300" />
				<p class="text-sm text-stone-500">No API keys yet. Create one above.</p>
				<p class="mt-1 text-xs text-stone-400">API keys let you call the DroidClaw API with <code class="rounded bg-stone-100 px-1.5 py-0.5">Authorization: Bearer &lt;key&gt;</code></p>
			</div>
		{/if}
	{:catch}
		<div class="flex items-center justify-center gap-2 px-6 py-8 text-sm text-red-600">
			<Icon icon="solar:danger-triangle-bold-duotone" class="h-5 w-5" />
			Failed to load keys. Please try again.
		</div>
	{/await}
</div>
