<script lang="ts">
	import Icon from '@iconify/svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import * as Accordion from '$lib/components/ui/accordion';
	import type { WorkflowStepConfig } from './types';

	interface Props {
		disabled?: boolean;
		onsubmit: (steps: WorkflowStepConfig[], variables: Record<string, string>) => void;
		onstop: () => void;
		isRunning?: boolean;
	}

	let { disabled = false, onsubmit, onstop, isRunning = false }: Props = $props();

	interface BuilderStep extends WorkflowStepConfig {
		_id: string;
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
						<Input
							type="text"
							bind:value={step.goal}
							placeholder={idx === 0 ? 'e.g., Open YouTube and search for lofi beats' : 'Goal for this step'}
							disabled={isRunning}
							onkeydown={handleKeydown}
						/>

						<!-- App input + advanced toggle -->
						<div class="flex gap-2">
							<Input
								type="text"
								bind:value={step.app}
								placeholder="App package (optional)"
								disabled={isRunning}
								class="text-xs"
							/>
						</div>

						<!-- Advanced params (accordion) -->
						<Accordion.Root type="single">
							<Accordion.Item value="advanced-{step._id}" class="border-none">
								<Accordion.Trigger class="py-1 text-[10px] text-stone-400 hover:text-stone-600 hover:no-underline">
									<div class="flex items-center gap-1">
										<Icon icon="solar:tuning-2-bold-duotone" class="h-3 w-3" />
										Advanced
									</div>
								</Accordion.Trigger>
								<Accordion.Content>
									<div class="flex flex-wrap items-center gap-4 rounded-lg bg-stone-100 px-3 py-2.5">
										<div class="flex items-center gap-1.5">
											<Label class="text-[10px] text-stone-500">Max steps</Label>
											<Input
												type="number"
												bind:value={step.maxSteps}
												min={1}
												max={50}
												disabled={isRunning}
												class="h-6 w-14 text-center text-[10px]"
											/>
										</div>
										<div class="flex items-center gap-1.5">
											<Label class="text-[10px] text-stone-500">Retries</Label>
											<Input
												type="number"
												bind:value={step.retries}
												min={0}
												max={5}
												disabled={isRunning}
												class="h-6 w-12 text-center text-[10px]"
											/>
										</div>
										<div class="flex items-center gap-1.5">
											<Switch bind:checked={step.cache} disabled={isRunning} class="scale-75" />
											<Label class="text-[10px] text-stone-500">Cache</Label>
										</div>
										<div class="flex items-center gap-1.5">
											<Switch bind:checked={step.forceStop} disabled={isRunning} class="scale-75" />
											<Label class="text-[10px] text-stone-500">Force stop</Label>
										</div>
									</div>
								</Accordion.Content>
							</Accordion.Item>
						</Accordion.Root>
					</div>

					<!-- Remove step button -->
					{#if steps.length > 1}
						<Button
							variant="ghost"
							size="icon"
							onclick={() => removeStep(step._id)}
							disabled={isRunning}
							class="mt-1.5 h-7 w-7 text-stone-300 hover:text-red-500"
						>
							<Icon icon="solar:trash-bin-minimalistic-bold-duotone" class="h-3.5 w-3.5" />
						</Button>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	<!-- Add step button -->
	<Button
		variant="outline"
		onclick={addStep}
		disabled={isRunning}
		class="mt-3 w-full gap-1.5 border-dashed text-stone-400 hover:text-stone-600"
	>
		<Icon icon="solar:add-circle-bold-duotone" class="h-4 w-4" />
		Add step
	</Button>

	<!-- Variables section -->
	{#if variables.length > 0}
		<div class="mt-4 border-t border-stone-100 pt-3">
			<p class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400">Variables</p>
			<div class="space-y-1.5">
				{#each variables as v, i}
					<div class="flex gap-2">
						<Input
							type="text"
							bind:value={v.key}
							placeholder="key"
							disabled={isRunning}
							class="w-28 font-mono text-[11px]"
						/>
						<Input
							type="text"
							bind:value={v.value}
							placeholder="value"
							disabled={isRunning}
							class="flex-1 text-[11px]"
						/>
						<Button variant="ghost" size="icon" onclick={() => removeVariable(i)} disabled={isRunning} class="h-8 w-8 text-stone-300 hover:text-red-500">
							<Icon icon="solar:close-circle-bold-duotone" class="h-3.5 w-3.5" />
						</Button>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Bottom actions -->
	<div class="mt-4 flex items-center gap-2">
		{#if isRunning}
			<Button variant="destructive" onclick={onstop} class="flex-1 gap-2">
				<Icon icon="solar:stop-bold" class="h-4 w-4" />
				Stop
			</Button>
		{:else}
			<Button onclick={handleSubmit} disabled={!canSubmit} class="flex-1 gap-2">
				<Icon icon="solar:play-bold" class="h-4 w-4" />
				Run{steps.length > 1 ? ` ${steps.length} steps` : ''}
			</Button>
		{/if}
		<Button
			variant="outline"
			size="icon"
			onclick={addVariable}
			disabled={isRunning}
			title="Add variable"
		>
			<Icon icon="solar:code-bold-duotone" class="h-4 w-4" />
		</Button>
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
