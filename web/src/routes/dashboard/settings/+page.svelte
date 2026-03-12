<script lang="ts">
	import { getConfig, updateConfig } from '$lib/api/settings.remote';
	import { signout } from '$lib/api/auth.remote';
	import { page } from '$app/state';
	import Icon from '@iconify/svelte';
	import { toast } from '$lib/toast';
	import { track } from '$lib/analytics/track';
	import { SETTINGS_SAVE, AUTH_SIGNOUT } from '$lib/analytics/events';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import * as Select from '$lib/components/ui/select';
	import { Spinner } from '$lib/components/ui/spinner';

	const PROVIDER_MODELS: Record<string, { id: string; label: string; recommended?: boolean }[]> = {
		openai: [
			{ id: 'gpt-4.1', label: 'GPT-4.1', recommended: true },
			{ id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
			{ id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
			{ id: 'gpt-4o', label: 'GPT-4o' },
			{ id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
			{ id: 'o3', label: 'o3' },
			{ id: 'o3-mini', label: 'o3 Mini' },
			{ id: 'o4-mini', label: 'o4 Mini' },
		],
		groq: [
			{ id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', recommended: true },
			{ id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant' },
			{ id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout 17B' },
			{ id: 'qwen/qwen3-32b', label: 'Qwen3 32B' },
		],
		openrouter: [
			{ id: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', recommended: true },
			{ id: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
			{ id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite' },
			{ id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
			{ id: 'anthropic/claude-4.5-sonnet-20250929', label: 'Claude 4.5 Sonnet' },
			{ id: 'anthropic/claude-4-sonnet-20250522', label: 'Claude 4 Sonnet' },
			{ id: 'deepseek/deepseek-chat-v3.1', label: 'DeepSeek V3.1' },
			{ id: 'x-ai/grok-4-fast', label: 'Grok 4 Fast' },
			{ id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B' },
			{ id: 'openai/gpt-4.1-mini-2025-04-14', label: 'GPT-4.1 Mini' },
		],
		ollama: [],
		bedrock: [],
	};

	const PROVIDERS = [
		{ id: 'openai', label: 'OpenAI' },
		{ id: 'groq', label: 'Groq' },
		{ id: 'ollama', label: 'Ollama' },
		{ id: 'bedrock', label: 'AWS Bedrock' },
		{ id: 'openrouter', label: 'OpenRouter' },
	];

	function getModels(provider: string) {
		return PROVIDER_MODELS[provider] ?? [];
	}

	function getDefaultModel(provider: string) {
		const models = getModels(provider);
		return models.find((m) => m.recommended)?.id ?? models[0]?.id ?? '';
	}

	const initialConfig = await getConfig();
	let config = $state(initialConfig);
	const layoutData = page.data;
	let submitting = $state(false);

	// Compute initial values from the saved config (non-reactive, one-time)
	const initProvider = initialConfig?.provider ?? 'openai';
	const initModel = initialConfig?.model ?? '';
	const initModels = PROVIDER_MODELS[initProvider] ?? [];
	const initIsCustom = !!initModel && !initModels.some((m) => m.id === initModel);

	let selectedProvider = $state(initProvider);
	let customModel = $state(initIsCustom ? initModel : '');
	let useCustomModel = $state(initIsCustom);
	let selectedModel = $state(initModel || getDefaultModel(initProvider));

	function handleProviderChange(value: string) {
		selectedProvider = value;
		useCustomModel = false;
		customModel = '';
		selectedModel = getDefaultModel(value);
	}

	function handleModelChange(value: string) {
		if (value === '__custom__') {
			useCustomModel = true;
			selectedModel = customModel;
		} else {
			useCustomModel = false;
			customModel = '';
			selectedModel = value;
		}
	}
</script>

<h2 class="mb-6 text-xl font-bold md:text-2xl">Settings</h2>

<!-- Account -->
<Card.Root class="mb-8">
	<Card.Header>
		<Card.Title class="text-sm">Account</Card.Title>
	</Card.Header>
	<Card.Content class="space-y-0 p-0">
		<div class="flex items-center justify-between px-6 py-4">
			<span class="text-sm text-stone-500">Email</span>
			<span class="text-sm font-medium text-stone-900">{layoutData.user.email}</span>
		</div>
		{#if layoutData.plan}
			<Separator />
			<div class="flex items-center justify-between px-6 py-4">
				<span class="text-sm text-stone-500">Plan</span>
				<Badge variant="outline" class="border-emerald-200 bg-emerald-50 text-emerald-700 gap-1">
					<Icon icon="solar:verified-check-bold-duotone" class="h-3.5 w-3.5" />
					{layoutData.plan === 'ltd' ? 'Lifetime' : layoutData.plan}
				</Badge>
			</div>
		{/if}
		{#if layoutData.licenseKey}
			<Separator />
			<div class="flex items-center justify-between px-6 py-4">
				<span class="text-sm text-stone-500">License</span>
				<span class="font-mono text-sm text-stone-600">{layoutData.licenseKey}</span>
			</div>
		{/if}
	</Card.Content>
</Card.Root>

<!-- AI Configuration -->
<div class="mb-3 mt-2 flex items-center gap-2">
	<Icon icon="solar:cpu-bolt-bold-duotone" class="h-4 w-4 text-violet-500" />
	<div>
		<p class="text-sm font-medium text-stone-700">AI Configuration</p>
		<p class="text-xs text-stone-400">Configure your AI model for device automation.</p>
	</div>
</div>
<Card.Root>
	<Card.Header>
		<Card.Title class="text-sm">LLM Provider</Card.Title>
		<Card.Description>Configure your AI model for running tasks on devices.</Card.Description>
	</Card.Header>
	<Card.Content>
		<form
			{...updateConfig.enhance(async ({ submit }) => {
				submitting = true;
				try {
					await submit().updates(getConfig());
					config = await getConfig();
					toast.success('Settings saved');
					track(SETTINGS_SAVE);
				} finally {
					submitting = false;
				}
			})}
			class="space-y-4"
		>
			<div class="space-y-2">
				<Label for="provider">Provider</Label>
				<Select.Root
					type="single"
					value={selectedProvider}
					onValueChange={(value) => { if (value) handleProviderChange(value); }}
				>
					<Select.Trigger class="w-full">
						{PROVIDERS.find((p) => p.id === selectedProvider)?.label ?? 'Select provider'}
					</Select.Trigger>
					<Select.Content>
						{#each PROVIDERS as provider}
							<Select.Item value={provider.id} label={provider.label} />
						{/each}
					</Select.Content>
				</Select.Root>
				<input type="hidden" {...updateConfig.fields.provider.as('text')} value={selectedProvider} />
				{#each updateConfig.fields.provider.issues() ?? [] as issue (issue.message)}
					<p class="text-sm text-red-600">{issue.message}</p>
				{/each}
			</div>

			<div class="space-y-2">
				<Label for="apiKey">API Key</Label>
				<Input
					{...updateConfig.fields.apiKey.as('password')}
					id="apiKey"
					placeholder={config?.apiKey ?? 'Enter your API key'}
				/>
				{#each updateConfig.fields.apiKey.issues() ?? [] as issue (issue.message)}
					<p class="text-sm text-red-600">{issue.message}</p>
				{/each}
			</div>

			<div class="space-y-2">
				<Label for="model">Model</Label>
				{#if getModels(selectedProvider).length > 0}
					<Select.Root
						type="single"
						value={useCustomModel ? '__custom__' : selectedModel}
						onValueChange={(value) => { if (value) handleModelChange(value); }}
					>
						<Select.Trigger class="w-full">
							{#if useCustomModel}
								Custom model ID...
							{:else}
								{@const current = getModels(selectedProvider).find((m) => m.id === selectedModel)}
								{current ? `${current.label}${current.recommended ? ' (Recommended)' : ''}` : selectedModel || 'Select model'}
							{/if}
						</Select.Trigger>
						<Select.Content>
							{#each getModels(selectedProvider) as model}
								<Select.Item value={model.id} label="{model.label}{model.recommended ? ' (Recommended)' : ''}" />
							{/each}
							<Select.Item value="__custom__" label="Custom model ID..." />
						</Select.Content>
					</Select.Root>
					{#if useCustomModel}
						<Input
							bind:value={customModel}
							oninput={() => (selectedModel = customModel)}
							placeholder="Enter model ID"
						/>
					{/if}
				{:else}
					<Input
						bind:value={selectedModel}
						placeholder="Enter model ID"
					/>
				{/if}
				<input type="hidden" name="model" value={selectedModel} />
			</div>

			<Button type="submit" class="gap-2" disabled={submitting}>
				{#if submitting}
					<Spinner class="h-4 w-4" />
				{:else}
					<Icon icon="solar:diskette-bold-duotone" class="h-4 w-4" />
				{/if}
				Save
			</Button>
		</form>

		{#if config}
			<div class="mt-4 flex items-center gap-2 rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-500">
				<Icon icon="solar:info-circle-bold-duotone" class="h-4 w-4 shrink-0 text-stone-400" />
				Current: {config.provider} &middot; Key: configured ✓
				{#if config.model} &middot; Model: {config.model}{/if}
			</div>
		{/if}
	</Card.Content>
</Card.Root>

<!-- Mobile sign out (sidebar hidden on mobile) -->
<div class="mt-8 md:hidden">
	<form {...signout}>
		<Button
			type="submit"
			variant="outline"
			class="w-full gap-2"
			data-umami-event={AUTH_SIGNOUT}
		>
			<Icon icon="solar:logout-2-bold-duotone" class="h-4 w-4" />
			Sign out
		</Button>
	</form>
</div>
