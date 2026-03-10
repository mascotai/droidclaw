<script lang="ts">
	import Icon from '@iconify/svelte';
	import type { WorkflowStepConfig } from './types';

	interface Props {
		disabled?: boolean;
		onsubmit: (steps: WorkflowStepConfig[], variables: Record<string, string>) => void;
		onstop: () => void;
		isRunning?: boolean;
	}

	let { disabled = false, onsubmit, onstop, isRunning = false }: Props = $props();

	interface BuilderStep extends WorkflowStepConfig {
		_id: string; // internal key for svelte each
	}

	function makeStep(): BuilderStep {
		return {
			_id: crypto.randomUUID(),
			goal: '',
			app: '',
			maxSteps: 15,
			retries: 0,
			cache: true,
			forceStop: false,
		};
	}

	let steps = $state<BuilderStep[]>([makeStep()]);
	let variables = $state<Array<{ key: string; value: string }>>([]);
	let showAdvanced = $state<Set<string>>(new Set());

	function addStep() {
		steps = [...steps, makeStep()];
	}

	function removeStep(id: string) {
		if (steps.length <= 1) return;
		steps = steps.filter((s) => s._id !== id);
	}

	function addVariable() {
		variables = [...variables, { key: '', value: '' }];
	}

	function removeVariable(idx: number) {
		variables = variables.filter((_, i) => i !== idx);
	}

	function toggleAdvanced(id: string) {
		const next = new Set(showAdvanced);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		showAdvanced = next;
	}

	function handleSubmit() {
		const validSteps = steps
			.filter((s) => s.goal.trim())
			.map(({ _id, ...rest }) => {
				const step: WorkflowStepConfig = { goal: rest.goal.trim() };
				if (rest.app?.trim()) step.app = rest.app.trim();
				if (rest.maxSteps !== undefined && rest.maxSteps !== 15) step.maxSteps = rest.maxSteps;
				if (rest.retries !== undefined && rest.retries > 0) step.retries = rest.retries;
				if (rest.cache === false) step.cache = false;
				if (rest.forceStop) step.forceStop = true;
				return step;
			});

		if (validSteps.length === 0) return;

		const vars: Record<string, string> = {};
		for (const v of variables) {
			if (v.key.trim() && v.value.trim()) {
				vars[v.key.trim()] = v.value.trim();
			}
		}

		onsubmit(validSteps, vars);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && steps.length === 1) {
			e.preventDefault();
			handleSubmit();
		}
	}

	const exampleGoals = [
		'Open YouTube and search for lofi beats',
		'Open Settings and enable Wi-Fi',
		'Open Google Maps and search for nearby coffee shops',
		'Take a screenshot and save it'
	];

	const canSubmit = $derived(steps.some((s) => s.goal.trim()) && !disabled && !isRunning);
</script>

<div class="rounded-2xl bg-white p-5">
	<div class="mb-3 flex items-center justify-between">
		<p class="text-sm font-medium text-stone-700">
			{steps.length === 1 ? 'Run a task' : `Workflow · ${steps.length} steps`}
		</p>
		{#if steps.length > 1}
			<span class="text-[10px] text-stone-400">Steps run sequentially</span>
		{/if}
	</div>

	<!-- Step cards -->
	<div class="space-y-3">
		{#each steps as step, idx (step._id)}
			<div class="rounded-xl border border-stone-200 bg-stone-50 p-3 transition-colors hover:border-stone-300">
				<div class="flex gap-2">
					{#if steps.length > 1}
						<span class="mt-2 shrink-0 rounded-full bg-stone-200 px-2 py-0.5 font-mono text-[10px] text-stone-500">
							{idx + 1}
						</span>
					{/if}
					<div class="min-w-0 flex-1 space-y-2">
						<!-- Goal input -->
						<input
							type="text"
							bind:value={step.goal}
							placeholder={idx === 0 ? 'e.g., Open YouTube and search for lofi beats' : 'Goal for this step'}
							class="w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm focus:border-stone-400 focus:outline-none"
							disabled={isRunning}
							onkeydown={handleKeydown}
						/>

						<!-- App input (always visible) -->
						<div class="flex gap-2">
							<input
								type="text"
								bind:value={step.app}
								placeholder="App package (optional)"
								class="flex-1 rounded-md border border-stone-200 bg-white px-2.5 py-1.5 text-xs text-stone-600 focus:border-stone-400 focus:outline-none"
								disabled={isRunning}
							/>
							<button
								onclick={() => toggleAdvanced(step._id)}
								class="shrink-0 rounded-md px-2 py-1.5 text-[10px] text-stone-400 transition-colors hover:bg-stone-200 hover:text-stone-600"
							>
								<Icon icon="solar:tuning-2-bold-duotone" class="h-3.5 w-3.5" />
							</button>
						</div>

						<!-- Advanced params -->
						{#if showAdvanced.has(step._id)}
							<div class="flex flex-wrap gap-3 rounded-lg bg-stone-100 px-3 py-2.5">
								<label class="flex items-center gap-1.5 text-[10px] text-stone-500">
									Max steps
									<input
										type="number"
										bind:value={step.maxSteps}
										min="1"
										max="50"
										class="w-12 rounded border border-stone-200 bg-white px-1.5 py-0.5 text-center text-[10px] focus:outline-none"
										disabled={isRunning}
									/>
								</label>
								<label class="flex items-center gap-1.5 text-[10px] text-stone-500">
									Retries
									<input
										type="number"
										bind:value={step.retries}
										min="0"
										max="5"
										class="w-10 rounded border border-stone-200 bg-white px-1.5 py-0.5 text-center text-[10px] focus:outline-none"
										disabled={isRunning}
									/>
								</label>
								<label class="flex items-center gap-1.5 text-[10px] text-stone-500">
									<input type="checkbox" bind:checked={step.cache} disabled={isRunning} class="rounded" />
									Cache
								</label>
								<label class="flex items-center gap-1.5 text-[10px] text-stone-500">
									<input type="checkbox" bind:checked={step.forceStop} disabled={isRunning} class="rounded" />
									Force stop
								</label>
							</div>
						{/if}
					</div>

					<!-- Remove step button -->
					{#if steps.length > 1}
						<button
							onclick={() => removeStep(step._id)}
							class="mt-1.5 shrink-0 rounded-md p-1 text-stone-300 transition-colors hover:bg-red-50 hover:text-red-500"
							disabled={isRunning}
						>
							<Icon icon="solar:trash-bin-minimalistic-bold-duotone" class="h-3.5 w-3.5" />
						</button>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	<!-- Add step button -->
	<button
		onclick={addStep}
		disabled={isRunning}
		class="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-stone-300 py-2 text-xs text-stone-400 transition-colors hover:border-stone-400 hover:bg-stone-50 hover:text-stone-600 disabled:opacity-40"
	>
		<Icon icon="solar:add-circle-bold-duotone" class="h-4 w-4" />
		Add step
	</button>

	<!-- Variables section -->
	{#if variables.length > 0}
		<div class="mt-4 border-t border-stone-100 pt-3">
			<p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400">Variables</p>
			<div class="space-y-1.5">
				{#each variables as v, i}
					<div class="flex gap-2">
						<input
							type="text"
							bind:value={v.key}
							placeholder="key"
							class="w-28 rounded-md border border-stone-200 bg-white px-2 py-1 font-mono text-[11px] focus:border-stone-400 focus:outline-none"
							disabled={isRunning}
						/>
						<input
							type="text"
							bind:value={v.value}
							placeholder="value"
							class="flex-1 rounded-md border border-stone-200 bg-white px-2 py-1 text-[11px] focus:border-stone-400 focus:outline-none"
							disabled={isRunning}
						/>
						<button onclick={() => removeVariable(i)} class="shrink-0 text-stone-300 hover:text-red-500" disabled={isRunning}>
							<Icon icon="solar:close-circle-bold-duotone" class="h-3.5 w-3.5" />
						</button>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Bottom actions -->
	<div class="mt-4 flex items-center gap-2">
		{#if isRunning}
			<button
				onclick={onstop}
				class="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500"
			>
				<Icon icon="solar:stop-bold" class="h-4 w-4" />
				Stop
			</button>
		{:else}
			<button
				onclick={handleSubmit}
				disabled={!canSubmit}
				class="flex flex-1 items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:opacity-40"
			>
				<Icon icon="solar:play-bold" class="h-4 w-4" />
				Run{steps.length > 1 ? ` ${steps.length} steps` : ''}
			</button>
		{/if}
		<button
			onclick={addVariable}
			disabled={isRunning}
			class="shrink-0 rounded-xl border border-stone-200 px-3 py-2.5 text-xs text-stone-500 transition-colors hover:bg-stone-50 disabled:opacity-40"
			title="Add variable"
		>
			<Icon icon="solar:code-bold-duotone" class="h-4 w-4" />
		</button>
	</div>

	<!-- Example goals (only when single step is empty and idle) -->
	{#if steps.length === 1 && !steps[0].goal.trim() && !isRunning}
		<div class="mt-4 border-t border-stone-100 pt-3">
			<p class="mb-2 text-[10px] font-medium text-stone-400">Try an example</p>
			<div class="flex flex-wrap gap-1.5">
				{#each exampleGoals as example}
					<button
						onclick={() => (steps[0].goal = example)}
						class="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-[11px] text-stone-600 transition-colors hover:border-stone-300 hover:bg-white"
					>
						{example}
					</button>
				{/each}
			</div>
		</div>
	{/if}
</div>
