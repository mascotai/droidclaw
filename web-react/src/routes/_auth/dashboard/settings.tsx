import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import { useState, useEffect } from 'react';
import { Settings, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { track } from '@/lib/analytics/track';
import { SETTINGS_SAVE } from '@/lib/analytics/events';

const configSchema = z.object({
	provider: z.enum(['openai', 'anthropic', 'google', 'openrouter']),
	apiKey: z.string().min(1, 'API key is required'),
	model: z.string().optional(),
});

type ConfigForm = z.infer<typeof configSchema>;

export const Route = createFileRoute('/_auth/dashboard/settings')({
	component: SettingsPage,
});

const PROVIDERS = [
	{
		value: 'openai',
		label: 'OpenAI',
		placeholder: 'sk-...',
		models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
	},
	{
		value: 'anthropic',
		label: 'Anthropic',
		placeholder: 'sk-ant-...',
		models: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250514'],
	},
	{
		value: 'google',
		label: 'Google',
		placeholder: 'AIza...',
		models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-2.5-pro-preview-06-05'],
	},
	{
		value: 'openrouter',
		label: 'OpenRouter',
		placeholder: 'sk-or-...',
		models: [],
	},
] as const;

function SettingsPage() {
	const queryClient = useQueryClient();
	const [showKey, setShowKey] = useState(false);

	const { data: config, isLoading } = useQuery({
		queryKey: ['config'],
		queryFn: () => api.getConfig(),
	});

	const {
		register,
		handleSubmit,
		watch,
		reset,
		formState: { errors, isDirty },
	} = useForm<ConfigForm>({
		resolver: zodResolver(configSchema),
		defaultValues: {
			provider: 'openai',
			apiKey: '',
			model: '',
		},
	});

	// Populate form when config loads
	useEffect(() => {
		if (config) {
			reset({
				provider: config.provider as ConfigForm['provider'],
				apiKey: config.apiKey || '',
				model: config.model || '',
			});
		}
	}, [config, reset]);

	const saveConfig = useMutation({
		mutationFn: (data: ConfigForm) =>
			api.updateConfig({
				provider: data.provider,
				apiKey: data.apiKey,
				model: data.model,
			}),
		onSuccess: () => {
			track(SETTINGS_SAVE);
			queryClient.invalidateQueries({ queryKey: ['config'] });
			toast.success('Settings saved');
		},
		onError: (err) => {
			toast.error('Failed to save settings', { description: err.message });
		},
	});

	const selectedProvider = watch('provider');
	const providerInfo = PROVIDERS.find((p) => p.value === selectedProvider);

	return (
		<div className="mx-auto max-w-2xl space-y-6">
			{/* Header */}
			<div>
				<h1 className="text-2xl font-bold text-stone-900">Settings</h1>
				<p className="mt-1 text-sm text-stone-500">
					Configure your LLM provider for the DroidClaw agent
				</p>
			</div>

			{/* Config form */}
			<form
				onSubmit={handleSubmit((data) => saveConfig.mutate(data))}
				className="space-y-6"
			>
				<div className="rounded-xl border border-stone-200 bg-white p-6">
					<div className="flex items-center gap-2">
						<Settings className="h-5 w-5 text-stone-400" />
						<h2 className="text-sm font-semibold text-stone-900">
							LLM Provider
						</h2>
					</div>

					{isLoading ? (
						<div className="mt-4 space-y-4">
							{[1, 2, 3].map((i) => (
								<div
									key={i}
									className="h-10 animate-pulse rounded-lg bg-stone-100"
								/>
							))}
						</div>
					) : (
						<div className="mt-4 space-y-5">
							{/* Provider */}
							<div>
								<label className="block text-xs font-medium text-stone-600">
									Provider
								</label>
								<select
									{...register('provider')}
									className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-violet-500 focus:ring-violet-500"
								>
									{PROVIDERS.map((p) => (
										<option key={p.value} value={p.value}>
											{p.label}
										</option>
									))}
								</select>
							</div>

							{/* API Key */}
							<div>
								<label className="block text-xs font-medium text-stone-600">
									API Key
								</label>
								<div className="relative mt-1">
									<input
										{...register('apiKey')}
										type={showKey ? 'text' : 'password'}
										placeholder={providerInfo?.placeholder || 'Enter API key'}
										className="block w-full rounded-lg border border-stone-300 px-3 py-2 pr-10 text-sm focus:border-violet-500 focus:ring-violet-500"
									/>
									<button
										type="button"
										onClick={() => setShowKey(!showKey)}
										className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-stone-400 hover:text-stone-600"
									>
										{showKey ? (
											<EyeOff className="h-4 w-4" />
										) : (
											<Eye className="h-4 w-4" />
										)}
									</button>
								</div>
								{errors.apiKey && (
									<p className="mt-1 text-xs text-red-500">
										{errors.apiKey.message}
									</p>
								)}
							</div>

							{/* Model */}
							<div>
								<label className="block text-xs font-medium text-stone-600">
									Model{' '}
									<span className="text-stone-400">(optional)</span>
								</label>
								{providerInfo &&
								providerInfo.models.length > 0 ? (
									<select
										{...register('model')}
										className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-violet-500 focus:ring-violet-500"
									>
										<option value="">Default</option>
										{providerInfo.models.map((m) => (
											<option key={m} value={m}>
												{m}
											</option>
										))}
									</select>
								) : (
									<input
										{...register('model')}
										type="text"
										placeholder="Model name (e.g., gpt-4o)"
										className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-violet-500 focus:ring-violet-500"
									/>
								)}
							</div>
						</div>
					)}
				</div>

				{/* Current config status */}
				{config && (
					<div className="flex items-start gap-3 rounded-xl border border-stone-200 bg-white p-5">
						<CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
						<div>
							<p className="text-sm font-medium text-stone-700">
								Currently configured
							</p>
							<p className="mt-0.5 text-xs text-stone-500">
								Provider: {config.provider}
								{config.model && ` · Model: ${config.model}`}
								{config.apiKey && ` · Key: ${config.apiKey}`}
							</p>
						</div>
					</div>
				)}

				{/* Save button */}
				<div className="flex justify-end">
					<button
						type="submit"
						disabled={saveConfig.isPending || !isDirty}
						className="rounded-lg bg-stone-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
					>
						{saveConfig.isPending ? 'Saving...' : 'Save settings'}
					</button>
				</div>
			</form>
		</div>
	);
}
