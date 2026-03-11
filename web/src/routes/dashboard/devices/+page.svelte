<script lang="ts">
	import { listDevices } from '$lib/api/devices.remote';
	import { getConfig } from '$lib/api/settings.remote';
	import { createPairingCode, getPairingStatus } from '$lib/api/pairing.remote';
	import { dashboardWs } from '$lib/stores/dashboard-ws.svelte';
	import { onMount } from 'svelte';
	import DeviceCard from '$lib/components/DeviceCard.svelte';
	import { EmptyState } from '$lib/components/shared';
	import Icon from '@iconify/svelte';
	import { toast } from '$lib/toast';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Alert from '$lib/components/ui/alert';
	import { Spinner } from '$lib/components/ui/spinner';

	interface DeviceEntry {
		deviceId: string;
		name: string;
		status: 'online' | 'offline';
		model: string | null;
		manufacturer: string | null;
		androidVersion: string | null;
		screenWidth: number | null;
		screenHeight: number | null;
		batteryLevel: number | null;
		isCharging: boolean;
		lastSeen: string;
		lastGoal: { goal: string; status: string; startedAt: string } | null;
	}

	const [initialDevices, llmConfig] = await Promise.all([listDevices(), getConfig()]);
	const hasLlmConfig = llmConfig !== null;

	let devices = $state<DeviceEntry[]>(
		initialDevices.map((d) => ({
			deviceId: d.deviceId,
			name: d.name,
			status: d.status as 'online' | 'offline',
			model: d.model as string | null,
			manufacturer: d.manufacturer as string | null,
			androidVersion: d.androidVersion as string | null,
			screenWidth: d.screenWidth as number | null,
			screenHeight: d.screenHeight as number | null,
			batteryLevel: d.batteryLevel as number | null,
			isCharging: d.isCharging as boolean,
			lastSeen: d.lastSeen,
			lastGoal: d.lastGoal as DeviceEntry['lastGoal']
		}))
	);

	// ─── Pairing modal state ───────────────────────────────────
	type ModalState = 'closed' | 'loading' | 'code' | 'expired' | 'paired';
	let modalState = $state<ModalState>('closed');
	let pairingCode = $state('');
	let expiresAt = $state('');
	let secondsLeft = $state(0);
	let countdownTimer: ReturnType<typeof setInterval> | null = null;
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	let dialogOpen = $state(false);

	function clearTimers() {
		if (countdownTimer) {
			clearInterval(countdownTimer);
			countdownTimer = null;
		}
		if (pollTimer) {
			clearInterval(pollTimer);
			pollTimer = null;
		}
	}

	function closeModal() {
		clearTimers();
		modalState = 'closed';
		dialogOpen = false;
		pairingCode = '';
		expiresAt = '';
		secondsLeft = 0;
	}

	function startCountdown() {
		const updateCountdown = () => {
			const now = Date.now();
			const expires = new Date(expiresAt).getTime();
			const remaining = Math.max(0, Math.floor((expires - now) / 1000));
			secondsLeft = remaining;
			if (remaining <= 0) {
				clearTimers();
				modalState = 'expired';
			}
		};
		updateCountdown();
		countdownTimer = setInterval(updateCountdown, 1000);
	}

	function startPolling() {
		pollTimer = setInterval(async () => {
			try {
				const status = await getPairingStatus();
				if (status.paired) {
					clearTimers();
					modalState = 'paired';
					// Refresh devices list
					const refreshed = await listDevices();
					devices = refreshed.map((d) => ({
						deviceId: d.deviceId,
						name: d.name,
						status: d.status as 'online' | 'offline',
						model: d.model as string | null,
						manufacturer: d.manufacturer as string | null,
						androidVersion: d.androidVersion as string | null,
						screenWidth: d.screenWidth as number | null,
						screenHeight: d.screenHeight as number | null,
						batteryLevel: d.batteryLevel as number | null,
						isCharging: d.isCharging as boolean,
						lastSeen: d.lastSeen,
						lastGoal: d.lastGoal as DeviceEntry['lastGoal']
					}));
				} else if (status.expired) {
					clearTimers();
					modalState = 'expired';
				}
			} catch {
				// Silently ignore polling errors
			}
		}, 2000);
	}

	async function generateCode() {
		modalState = 'loading';
		dialogOpen = true;
		try {
			const result = await createPairingCode();
			pairingCode = result.code;
			expiresAt = result.expiresAt;
			modalState = 'code';
			startCountdown();
			startPolling();
		} catch (e: any) {
			toast.error(e.message ?? 'Failed to generate pairing code');
			closeModal();
		}
	}

	async function openPairingModal() {
		await generateCode();
	}

	async function regenerateCode() {
		clearTimers();
		await generateCode();
	}

	function formatTime(seconds: number): string {
		const m = Math.floor(seconds / 60);
		const s = seconds % 60;
		return `${m}:${s.toString().padStart(2, '0')}`;
	}

	// ─── WebSocket subscriptions ───────────────────────────────
	onMount(() => {
		// Auto-open pairing modal if ?pair query param is present
		const params = new URLSearchParams(window.location.search);
		if (params.has('pair')) {
			openPairingModal();
			// Clean up the URL
			history.replaceState({}, '', window.location.pathname);
		}

		const unsub = dashboardWs.subscribe((msg) => {
			if (msg.type === 'device_online') {
				const id = msg.deviceId as string;
				const name = msg.name as string;
				const existing = devices.find((d) => d.deviceId === id);
				if (existing) {
					existing.status = 'online';
					existing.lastSeen = new Date().toISOString();
					devices = [...devices];
				} else {
					devices = [
						{
							deviceId: id,
							name,
							status: 'online',
							model: null,
							manufacturer: null,
							androidVersion: null,
							screenWidth: null,
							screenHeight: null,
							batteryLevel: null,
							isCharging: false,
							lastSeen: new Date().toISOString(),
							lastGoal: null
						},
						...devices
					];
				}
				toast.success(`${name} connected`);
			} else if (msg.type === 'device_offline') {
				const id = msg.deviceId as string;
				const existing = devices.find((d) => d.deviceId === id);
				if (existing) {
					existing.status = 'offline';
					devices = [...devices];
					toast.info(`${existing.name} disconnected`);
				}
			} else if (msg.type === 'device_status') {
				const id = msg.deviceId as string;
				const existing = devices.find((d) => d.deviceId === id);
				if (existing) {
					existing.batteryLevel = msg.batteryLevel as number;
					existing.isCharging = msg.isCharging as boolean;
					devices = [...devices];
				}
			}
		});
		return () => {
			unsub();
			clearTimers();
		};
	});
</script>

<!-- Page header -->
<div class="mb-6 flex items-center justify-between">
	<h2 class="text-xl font-bold md:text-2xl">Devices</h2>
	<div class="flex items-center gap-2">
		<Button variant="outline" href="https://github.com/unitedbyai/droidclaw/releases/download/v0.5.3/app-debug.apk">
			<Icon icon="solar:download-bold-duotone" class="h-4 w-4" />
			Download APK
		</Button>
		<Button onclick={openPairingModal}>
			<Icon icon="solar:link-round-bold-duotone" class="h-4 w-4" />
			Pair Device
		</Button>
	</div>
</div>

<!-- LLM not configured banner -->
{#if !hasLlmConfig && devices.length > 0}
	<a
		href="/dashboard/settings"
		class="mb-6 block"
	>
		<Alert.Root class="border-amber-200 bg-amber-50 hover:bg-amber-100/80 transition-colors">
			<Icon icon="solar:danger-triangle-bold-duotone" class="h-5 w-5 text-amber-600" />
			<Alert.Title class="text-amber-900">Set up your LLM provider</Alert.Title>
			<Alert.Description class="text-amber-700">
				Your device is paired but needs an AI model configured to run tasks.
			</Alert.Description>
		</Alert.Root>
	</a>
{/if}

{#if devices.length === 0}
	<div class="rounded-2xl bg-white p-6 text-center md:p-10">
		<EmptyState
			icon="solar:smartphone-bold-duotone"
			title="No devices connected"
			description="Install the Android app and pair your device to get started."
		/>
		<Button onclick={openPairingModal} class="mt-5">
			<Icon icon="solar:link-round-bold-duotone" class="h-4 w-4" />
			Pair Device
		</Button>
	</div>
{:else}
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
		{#each devices as d (d.deviceId)}
			<DeviceCard {...d} />
		{/each}
	</div>
{/if}

<!-- Pairing Dialog -->
<Dialog.Root bind:open={dialogOpen} onOpenChange={(open) => { if (!open) closeModal(); }}>
	<Dialog.Content class="max-w-md max-h-[85vh] overflow-y-auto">
		<Dialog.Header>
			<Dialog.Title>Pair Your Device</Dialog.Title>
			<Dialog.Description>
				Connect an Android device to your dashboard.
			</Dialog.Description>
		</Dialog.Header>

		<div class="py-4">
			{#if modalState === 'loading'}
				<!-- Loading state -->
				<div class="flex flex-col items-center gap-3 py-4">
					<Spinner class="h-8 w-8 text-stone-400" />
					<p class="text-sm text-stone-500">Generating pairing code...</p>
				</div>
			{:else if modalState === 'code'}
				<!-- Code display state -->
				<div class="flex flex-col items-center">
					<p class="mb-6 text-center text-sm text-stone-500">
						Open DroidClaw on your Android device and enter this code:
					</p>

					<!-- OTP digits -->
					<div class="mb-5 flex gap-2">
						{#each pairingCode.split('') as digit}
							<div class="flex h-14 w-11 items-center justify-center rounded-xl border-2 border-stone-200 bg-stone-50">
								<span class="font-mono text-2xl font-bold text-stone-900">{digit}</span>
							</div>
						{/each}
					</div>

					<!-- Countdown -->
					<p class="mb-2 text-sm text-stone-400">
						Expires in {formatTime(secondsLeft)}
					</p>

					<!-- Copy code button -->
					<Button
						variant="outline"
						size="sm"
						onclick={() => {
							navigator.clipboard.writeText(pairingCode);
							toast.success('Code copied to clipboard');
						}}
						class="mb-4"
					>
						<Icon icon="solar:copy-bold-duotone" class="h-4 w-4" />
						Copy code
					</Button>

					<!-- Waiting indicator -->
					<div class="flex items-center gap-2 text-sm text-stone-500">
						<Spinner class="h-4 w-4" />
						Waiting for device...
					</div>
				</div>
			{:else if modalState === 'expired'}
				<!-- Expired state -->
				<div class="flex flex-col items-center gap-4 py-4">
					<div class="flex h-12 w-12 items-center justify-center rounded-full bg-stone-100">
						<Icon icon="solar:clock-circle-bold-duotone" class="h-6 w-6 text-stone-400" />
					</div>
					<p class="font-medium text-stone-600">Code expired</p>
					<Button onclick={regenerateCode}>
						<Icon icon="solar:refresh-bold-duotone" class="h-4 w-4" />
						Generate new code
					</Button>
				</div>
			{:else if modalState === 'paired'}
				<!-- Success state -->
				<div class="flex flex-col items-center gap-4 py-4">
					<div class="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
						<Icon icon="solar:check-circle-bold-duotone" class="h-6 w-6 text-emerald-600" />
					</div>
					<p class="text-lg font-semibold text-stone-900">Device Paired!</p>
					<p class="text-sm text-stone-500">Your device is now connected and ready to use.</p>
					<Button onclick={closeModal}>
						Done
					</Button>
				</div>
			{/if}
		</div>

		<!-- Footer (shown only during code/expired states) -->
		{#if modalState === 'code' || modalState === 'expired'}
			<Dialog.Footer>
				<a
					href="/dashboard/api-keys"
					class="flex w-full items-center justify-center gap-1.5 text-sm text-stone-400 hover:text-stone-600"
				>
					<Icon icon="solar:key-bold-duotone" class="h-3.5 w-3.5" />
					Developer? Use API keys for manual setup
				</a>
			</Dialog.Footer>
		{/if}
	</Dialog.Content>
</Dialog.Root>
