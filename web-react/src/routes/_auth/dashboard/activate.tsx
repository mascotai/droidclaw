import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useState, useEffect } from 'react';
import { KeyRound, CheckCircle2, AlertCircle } from 'lucide-react';
import { track } from '@/lib/analytics/track';
import {
	LICENSE_ACTIVATE_MANUAL,
	LICENSE_ACTIVATE_CHECKOUT,
	LICENSE_PURCHASE_CLICK,
} from '@/lib/analytics/events';

export const Route = createFileRoute('/_auth/dashboard/activate')({
	component: ActivatePage,
});

function ActivatePage() {
	const navigate = useNavigate();
	const [licenseKey, setLicenseKey] = useState('');
	const search = Route.useSearch() as { checkout_id?: string };

	// Auto-activate from checkout redirect
	const activateCheckout = useMutation({
		mutationFn: (checkoutId: string) => api.activateFromCheckout(checkoutId),
		onSuccess: () => {
			track(LICENSE_ACTIVATE_CHECKOUT);
		},
	});

	useEffect(() => {
		if (search.checkout_id) {
			activateCheckout.mutate(search.checkout_id);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [search.checkout_id]);

	// Manual key activation
	const activateKey = useMutation({
		mutationFn: () => api.activateLicense(licenseKey.trim()),
		onSuccess: () => {
			track(LICENSE_ACTIVATE_MANUAL);
		},
	});

	const isActivated = activateKey.isSuccess || activateCheckout.isSuccess;
	const error = activateKey.error || activateCheckout.error;

	return (
		<div className="flex min-h-[60vh] items-center justify-center">
			<div className="w-full max-w-md space-y-6 rounded-xl border border-stone-200 bg-white p-8">
				{isActivated ? (
					<div className="text-center">
						<CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
						<h1 className="mt-4 text-xl font-bold text-stone-900">
							License activated!
						</h1>
						<p className="mt-2 text-sm text-stone-500">
							Your DroidClaw license has been successfully activated. You can
							now use all features.
						</p>
						<button
							onClick={() => navigate({ to: '/dashboard' })}
							className="mt-6 rounded-lg bg-stone-900 px-6 py-2.5 text-sm font-medium text-white hover:bg-stone-800"
						>
							Go to dashboard
						</button>
					</div>
				) : (
					<>
						<div className="text-center">
							<div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-violet-50">
								<KeyRound className="h-7 w-7 text-violet-600" />
							</div>
							<h1 className="mt-4 text-xl font-bold text-stone-900">
								Activate your license
							</h1>
							<p className="mt-2 text-sm text-stone-500">
								Enter your license key to unlock DroidClaw
							</p>
						</div>

						{error && (
							<div className="flex items-start gap-3 rounded-lg bg-red-50 p-3">
								<AlertCircle className="mt-0.5 h-4 w-4 text-red-500" />
								<p className="text-sm text-red-600">
									{error instanceof Error
										? error.message
										: 'Activation failed. Please check your key and try again.'}
								</p>
							</div>
						)}

						{activateCheckout.isPending && (
							<div className="flex items-center justify-center gap-3 py-4">
								<div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-200 border-t-stone-600" />
								<span className="text-sm text-stone-500">
									Activating from checkout...
								</span>
							</div>
						)}

						{!search.checkout_id && (
							<div className="space-y-4">
								<div>
									<label className="block text-sm font-medium text-stone-700">
										License key
									</label>
									<input
										type="text"
										value={licenseKey}
										onChange={(e) => setLicenseKey(e.target.value)}
										placeholder="XXXX-XXXX-XXXX-XXXX"
										className="mt-1 block w-full rounded-lg border border-stone-300 px-3 py-2.5 text-center font-mono text-sm tracking-wider focus:border-violet-500 focus:ring-violet-500"
										onKeyDown={(e) => {
											if (e.key === 'Enter' && licenseKey.trim()) {
												activateKey.mutate();
											}
										}}
									/>
								</div>

								<button
									onClick={() => {
										if (licenseKey.trim()) activateKey.mutate();
									}}
									disabled={!licenseKey.trim() || activateKey.isPending}
									className="flex w-full justify-center rounded-lg bg-stone-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
								>
									{activateKey.isPending
										? 'Activating...'
										: 'Activate license'}
								</button>
							</div>
						)}

						<div className="border-t border-stone-100 pt-4 text-center">
							<p className="text-xs text-stone-500">
								Don&apos;t have a license?{' '}
								<a
									href="https://droidclaw.com/pricing"
									target="_blank"
									rel="noopener noreferrer"
									onClick={() => track(LICENSE_PURCHASE_CLICK)}
									className="font-medium text-violet-600 hover:text-violet-700"
								>
									Purchase one
								</a>
							</p>
						</div>
					</>
				)}
			</div>
		</div>
	);
}
