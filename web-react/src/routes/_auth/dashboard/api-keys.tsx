import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ApiKeyInfo } from '@/lib/api';
import { useState } from 'react';
import {
	Key,
	Plus,
	Trash2,
	Copy,
	CheckCircle2,
	AlertTriangle,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { track } from '@/lib/analytics/track';
import { APIKEY_CREATE, APIKEY_COPY, APIKEY_DELETE } from '@/lib/analytics/events';

export const Route = createFileRoute('/_auth/dashboard/api-keys')({
	component: ApiKeysPage,
});

function ApiKeysPage() {
	const queryClient = useQueryClient();
	const [showCreate, setShowCreate] = useState(false);
	const [newKeyName, setNewKeyName] = useState('');
	const [newKeyType, setNewKeyType] = useState<'user' | 'device'>('user');
	const [revealedKey, setRevealedKey] = useState<string | null>(null);
	const [copied, setCopied] = useState<string | null>(null);
	const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

	const { data: keys, isLoading } = useQuery({
		queryKey: ['apiKeys'],
		queryFn: () => api.listApiKeys(),
	});

	const createKey = useMutation({
		mutationFn: () => api.createApiKey(newKeyName, newKeyType),
		onSuccess: (data) => {
			track(APIKEY_CREATE, { type: newKeyType });
			setRevealedKey(data.key);
			setShowCreate(false);
			setNewKeyName('');
			queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
			toast.success('API key created');
		},
		onError: (err) => {
			toast.error('Failed to create key', { description: err.message });
		},
	});

	const deleteKey = useMutation({
		mutationFn: (keyId: string) => api.deleteApiKey(keyId),
		onSuccess: () => {
			track(APIKEY_DELETE);
			setDeleteConfirm(null);
			queryClient.invalidateQueries({ queryKey: ['apiKeys'] });
			toast.success('API key deleted');
		},
		onError: (err) => {
			toast.error('Failed to delete key', { description: err.message });
		},
	});

	function handleCopy(text: string, id: string) {
		navigator.clipboard.writeText(text);
		track(APIKEY_COPY);
		setCopied(id);
		setTimeout(() => setCopied(null), 2000);
	}

	return (
		<div className="mx-auto max-w-3xl space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-2xl font-bold text-stone-900">API Keys</h1>
					<p className="mt-1 text-sm text-stone-500">
						Manage API keys for authenticating with DroidClaw
					</p>
				</div>
				<button
					onClick={() => setShowCreate(true)}
					className="flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
				>
					<Plus className="h-4 w-4" />
					Create key
				</button>
			</div>

			{/* Newly created key reveal */}
			{revealedKey && (
				<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
					<div className="flex items-start gap-3">
						<CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" />
						<div className="flex-1">
							<p className="text-sm font-semibold text-emerald-900">
								API key created
							</p>
							<p className="mt-1 text-xs text-emerald-700">
								Copy this key now — you won&apos;t be able to see it again.
							</p>
							<div className="mt-3 flex items-center gap-2">
								<code className="flex-1 rounded bg-white px-3 py-2 font-mono text-xs text-stone-800">
									{revealedKey}
								</code>
								<button
									onClick={() => handleCopy(revealedKey, 'new')}
									className="rounded p-2 text-emerald-600 hover:bg-emerald-100"
								>
									{copied === 'new' ? (
										<CheckCircle2 className="h-4 w-4" />
									) : (
										<Copy className="h-4 w-4" />
									)}
								</button>
							</div>
						</div>
					</div>
					<button
						onClick={() => setRevealedKey(null)}
						className="mt-3 text-xs text-emerald-600 hover:text-emerald-800"
					>
						Dismiss
					</button>
				</div>
			)}

			{/* Create form */}
			{showCreate && (
				<div className="rounded-xl border border-stone-200 bg-white p-6">
					<h3 className="text-sm font-semibold text-stone-900">
						Create new API key
					</h3>
					<div className="mt-4 space-y-4">
						<div>
							<label className="block text-xs font-medium text-stone-600">
								Name
							</label>
							<input
								type="text"
								value={newKeyName}
								onChange={(e) => setNewKeyName(e.target.value)}
								placeholder="e.g., Production, CI/CD"
								className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-violet-500 focus:ring-violet-500"
							/>
						</div>

						<div>
							<label className="block text-xs font-medium text-stone-600">
								Type
							</label>
							<div className="mt-1 flex gap-3">
								<label className="flex items-center gap-2">
									<input
										type="radio"
										name="type"
										value="user"
										checked={newKeyType === 'user'}
										onChange={() => setNewKeyType('user')}
										className="text-violet-600 focus:ring-violet-500"
									/>
									<span className="text-sm text-stone-700">User</span>
								</label>
								<label className="flex items-center gap-2">
									<input
										type="radio"
										name="type"
										value="device"
										checked={newKeyType === 'device'}
										onChange={() => setNewKeyType('device')}
										className="text-violet-600 focus:ring-violet-500"
									/>
									<span className="text-sm text-stone-700">Device</span>
								</label>
							</div>
						</div>

						<div className="flex gap-3">
							<button
								onClick={() => {
									if (newKeyName.trim()) createKey.mutate();
								}}
								disabled={!newKeyName.trim() || createKey.isPending}
								className="rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
							>
								{createKey.isPending ? 'Creating...' : 'Create'}
							</button>
							<button
								onClick={() => {
									setShowCreate(false);
									setNewKeyName('');
								}}
								className="rounded-lg border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:bg-stone-50"
							>
								Cancel
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Keys list */}
			<div className="rounded-xl border border-stone-200 bg-white p-6">
				<h3 className="text-sm font-semibold text-stone-900">Active keys</h3>
				{isLoading ? (
					<div className="mt-4 space-y-3">
						{[1, 2].map((i) => (
							<div
								key={i}
								className="h-12 animate-pulse rounded-lg bg-stone-100"
							/>
						))}
					</div>
				) : keys && keys.length > 0 ? (
					<div className="mt-4 space-y-2">
						{keys.map((k: ApiKeyInfo) => (
							<div
								key={k.id}
								className="flex items-center justify-between rounded-lg border border-stone-100 px-4 py-3"
							>
								<div className="flex items-center gap-3">
									<Key className="h-4 w-4 text-stone-400" />
									<div>
										<p className="text-sm font-medium text-stone-700">
											{k.name || 'Unnamed key'}
										</p>
										<div className="flex items-center gap-2 text-xs text-stone-400">
											{k.start && (
												<span className="font-mono">{k.start}•••</span>
											)}
											{k.type && (
												<span className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium">
													{k.type}
												</span>
											)}
											<span>
												Created{' '}
												{formatDistanceToNow(new Date(k.createdAt), {
													addSuffix: true,
												})}
											</span>
										</div>
									</div>
								</div>

								<div className="flex items-center gap-2">
									{k.start && (
										<button
											onClick={() => handleCopy(k.start!, k.id)}
											className="rounded p-1.5 text-stone-400 hover:text-stone-600"
											title="Copy key prefix"
										>
											{copied === k.id ? (
												<CheckCircle2 className="h-4 w-4 text-emerald-500" />
											) : (
												<Copy className="h-4 w-4" />
											)}
										</button>
									)}

									{deleteConfirm === k.id ? (
										<div className="flex items-center gap-2">
											<button
												onClick={() => deleteKey.mutate(k.id)}
												className="rounded px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
											>
												Confirm
											</button>
											<button
												onClick={() => setDeleteConfirm(null)}
												className="rounded px-2 py-1 text-xs text-stone-500 hover:bg-stone-50"
											>
												Cancel
											</button>
										</div>
									) : (
										<button
											onClick={() => setDeleteConfirm(k.id)}
											className="rounded p-1.5 text-stone-400 hover:text-red-500"
											title="Delete key"
										>
											<Trash2 className="h-4 w-4" />
										</button>
									)}
								</div>
							</div>
						))}
					</div>
				) : (
					<div className="mt-4 flex flex-col items-center py-8">
						<Key className="h-8 w-8 text-stone-300" />
						<p className="mt-2 text-sm text-stone-500">No API keys yet</p>
						<button
							onClick={() => setShowCreate(true)}
							className="mt-3 text-sm font-medium text-violet-600 hover:text-violet-700"
						>
							Create your first key
						</button>
					</div>
				)}
			</div>

			{/* Security note */}
			<div className="flex items-start gap-3 rounded-xl border border-stone-200 bg-white p-5">
				<AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
				<div>
					<p className="text-sm font-medium text-stone-700">Security note</p>
					<p className="mt-0.5 text-xs text-stone-500">
						API keys provide full access to your DroidClaw account. Keep them
						secret and never share them in public repositories or client-side
						code.
					</p>
				</div>
			</div>
		</div>
	);
}
