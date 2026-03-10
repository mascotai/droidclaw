<script lang="ts">
	import Icon from '@iconify/svelte';
	import ActionBadge from './ActionBadge.svelte';
	import type { StepResult, WorkflowStepConfig, Step } from './types';

	interface ModalData {
		stepIdx: number;
		stepResult: StepResult;
		config: WorkflowStepConfig | null;
	}

	interface Props {
		data: ModalData;
		steps: Step[];
		stepsLoading: boolean;
		screenWidth: number;
		screenHeight: number;
		onclose: () => void;
	}

	let { data, steps, stepsLoading, screenWidth, screenHeight, onclose }: Props = $props();

	// Track which element sections are expanded and which are in ASCII mode
	let expandedElementSets = $state<Set<string>>(new Set());
	let asciiViewKeys = $state<Set<string>>(new Set());

	function toggleExpanded(key: string) {
		const next = new Set(expandedElementSets);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		expandedElementSets = next;
	}

	function toggleAscii(key: string) {
		const next = new Set(asciiViewKeys);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		asciiViewKeys = next;
	}

	function parseAction(action: unknown): {
		type: string;
		coords?: number[];
		text?: string;
		direction?: string;
		scrollAmount?: number;
	} {
		if (typeof action === 'string') return { type: action };
		if (typeof action === 'object' && action !== null) {
			const a = action as Record<string, unknown>;
			return {
				type: (a.action as string) ?? 'unknown',
				coords: a.coordinates as number[] | undefined,
				text: a.text as string | undefined,
				direction: a.direction as string | undefined,
				scrollAmount: a.scrollAmount as number | undefined
			};
		}
		return { type: 'unknown' };
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onclick={onclose}>
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div
		class="relative max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-xl"
		onclick={(e) => e.stopPropagation()}
	>
		<!-- Modal header -->
		<div
			class="sticky top-0 z-10 flex items-center justify-between rounded-t-2xl border-b border-stone-100 bg-white px-6 py-4"
		>
			<div class="flex items-center gap-3">
				<span
					class="rounded-full px-2.5 py-0.5 font-mono text-xs
						{data.stepResult.success
						? 'bg-emerald-100 text-emerald-700'
						: 'bg-red-100 text-red-700'}"
				>
					Goal {data.stepIdx + 1}
				</span>
				<span
					class="flex items-center gap-1 text-sm font-medium {data.stepResult.success
						? 'text-emerald-700'
						: 'text-red-700'}"
				>
					<Icon
						icon={data.stepResult.success
							? 'solar:check-circle-bold-duotone'
							: 'solar:close-circle-bold-duotone'}
						class="h-4 w-4"
					/>
					{data.stepResult.success ? 'Succeeded' : 'Failed'}
				</span>
			</div>
			<button
				onclick={onclose}
				class="rounded-full p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-600"
			>
				<Icon icon="solar:close-circle-bold-duotone" class="h-5 w-5" />
			</button>
		</div>

		<div class="space-y-5 px-6 py-5">
			<!-- Goal -->
			<div>
				<p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">Goal</p>
				<p class="whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
					{data.stepResult.goal ?? data.config?.goal ?? data.stepResult.command ?? 'N/A'}
				</p>
			</div>

			<!-- Step Config -->
			{#if data.config}
				<div>
					<p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
						Configuration
					</p>
					<div class="flex flex-wrap gap-2">
						{#if data.config.app}
							<span
								class="flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-xs text-blue-700"
							>
								<Icon icon="solar:box-bold-duotone" class="h-3.5 w-3.5" />
								{data.config.app}
							</span>
						{/if}
						{#if data.config.maxSteps}
							<span class="rounded-lg bg-stone-100 px-2.5 py-1 text-xs text-stone-600"
								>Max {data.config.maxSteps} steps</span
							>
						{/if}
						{#if data.config.retries}
							<span class="rounded-lg bg-stone-100 px-2.5 py-1 text-xs text-stone-600"
								>{data.config.retries} retries</span
							>
						{/if}
						{#if data.stepResult.resolvedBy}
							{#if data.stepResult.resolvedBy === 'cached_flow'}
								<span
									class="flex items-center gap-1 rounded-lg bg-cyan-50 px-2.5 py-1 text-xs text-cyan-700"
								>
									<Icon icon="solar:bolt-bold-duotone" class="h-3.5 w-3.5" />
									Cached flow
								</span>
							{:else}
								<span class="rounded-lg bg-violet-50 px-2.5 py-1 text-xs text-violet-700"
									>Resolved by: {data.stepResult.resolvedBy}</span
								>
							{/if}
						{/if}
						{#if data.stepResult.stepsUsed !== undefined}
							<span class="rounded-lg bg-stone-100 px-2.5 py-1 text-xs text-stone-600"
								>Used {data.stepResult.stepsUsed} steps</span
							>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Error -->
			{#if data.stepResult.error || (data.stepResult.message && !data.stepResult.success)}
				<div>
					<p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-400">Error</p>
					<div class="rounded-lg bg-red-50 px-3 py-2.5">
						<p class="text-xs text-red-700">{data.stepResult.error ?? data.stepResult.message}</p>
					</div>
				</div>
			{/if}

			<!-- Agent Journey -->
			<div>
				<p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
					Agent Journey
				</p>
				{#if stepsLoading}
					<div class="flex items-center gap-2 py-3 text-xs text-stone-400">
						<Icon icon="solar:refresh-circle-bold-duotone" class="h-4 w-4 animate-spin" />
						Loading steps...
					</div>
				{:else if steps.length > 0}
					<div class="space-y-1.5">
						{#each steps as s, sIdx (s.id)}
							{@const act = parseAction(s.action)}
							{@const allObs = data.stepResult.observations ?? []}
							{@const hasStepNumbers = allObs.some((o) => o.stepNumber != null)}
							{@const matchingObs = hasStepNumbers
								? allObs.filter((o) => o.stepNumber === s.stepNumber)
								: sIdx < allObs.length
									? [allObs[sIdx]]
									: []}
							<div class="rounded-lg bg-stone-50 px-3 py-2.5">
								<div class="flex items-center gap-2">
									<span
										class="shrink-0 rounded-full bg-stone-200 px-2 py-0.5 font-mono text-[10px] text-stone-500"
									>
										{s.stepNumber}
									</span>
									<ActionBadge action={act.type} />
									<div class="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-600">
										{#if act.coords && act.coords.length >= 2}
											<span class="font-mono text-stone-400"
												>({act.coords[0]}, {act.coords[1]})</span
											>
										{/if}
										{#if act.text}
											<span class="rounded bg-white px-1.5 py-0.5 text-stone-700"
												>"{act.text}"</span
											>
										{/if}
										{#if act.direction}
											<span class="text-stone-400"
												>{act.direction}{act.scrollAmount
													? ` ×${act.scrollAmount}`
													: ''}</span
											>
										{/if}
									</div>
								</div>
								{#if s.reasoning}
									<p class="mt-1 pl-8 text-xs leading-relaxed text-stone-500">{s.reasoning}</p>
								{/if}

								<!-- Inline screen observation -->
								{#if matchingObs.length > 0}
									{#each matchingObs as obs, obsIdx}
										{@const elemKey = `inline-${sIdx}-${obsIdx}`}
										{@const isExpanded = expandedElementSets.has(elemKey)}
										<div class="ml-8 mt-2 rounded-md border border-stone-200 bg-white px-2.5 py-2">
											<div class="flex flex-wrap items-center gap-1.5 text-[10px]">
												<Icon
													icon="solar:monitor-smartphone-bold-duotone"
													class="h-3 w-3 text-blue-500"
												/>
												{#if obs.packageName}
													<span class="font-medium text-blue-700">{obs.packageName}</span>
												{/if}
												{#if obs.activityName}
													<span class="text-stone-300">&rsaquo;</span>
													<span class="font-medium text-violet-600"
														>{obs.activityName.split('.').pop()}</span
													>
												{/if}
												<span class="text-stone-300">·</span>
												<span class="text-stone-400"
													>{obs.elements.length} element{obs.elements.length !== 1
														? 's'
														: ''}</span
												>
											</div>
											{#if obs.elements.length > 0}
												<div
													class="mt-1 space-y-0.5"
													class:max-h-24={!isExpanded}
													class:overflow-y-auto={!isExpanded}
												>
													{#each isExpanded ? obs.elements : obs.elements.slice(0, 15) as el}
														{@const elem = el as Record<string, unknown>}
														<p class="truncate font-mono text-[10px] text-stone-500">
															{#if elem.type}<span class="text-stone-300"
																	>[{(elem.type as string).split('.').pop()}]</span
																>{/if}
															{#if elem.action}<span class="text-amber-500/70">
																	{elem.action}</span
																>{/if}
															{#if elem.text}<span class="text-stone-700">
																	"{elem.text}"</span
																>{/if}
															{#if elem.hint}<span class="text-stone-400 italic">
																	{elem.hint}</span
																>{/if}
															{#if elem.id}<span class="text-blue-400">
																	#{(elem.id as string).split('/').pop()}</span
																>{/if}
															{#if elem.center}<span class="text-emerald-500">
																	@{JSON.stringify(elem.center)}</span
																>{/if}
															{#if elem.checked}<span class="text-orange-400">
																	checked</span
																>{/if}
															{#if elem.focused}<span class="text-cyan-400">
																	focused</span
																>{/if}
															{#if elem.selected}<span class="text-purple-400">
																	selected</span
																>{/if}
															{#if elem.enabled === false}<span class="text-red-400">
																	disabled</span
																>{/if}
														</p>
													{/each}
													{#if obs.elements.length > 15}
														<button
															class="mt-0.5 cursor-pointer text-[10px] italic text-blue-500 hover:text-blue-700"
															onclick={() => toggleExpanded(elemKey)}
														>
															{isExpanded
																? '▲ Show fewer elements'
																: `... +${obs.elements.length - 15} more elements`}
														</button>
													{/if}
												</div>
											{/if}
										</div>
									{/each}
								{/if}
							</div>
						{/each}
					</div>
				{:else if !data.stepResult.sessionId}
					<p class="text-xs text-stone-400">
						No session linked — resolved by {data.stepResult.resolvedBy ?? 'parser/classifier'} without
						UI agent.
					</p>
				{:else}
					<p class="text-xs text-stone-400">No step data available.</p>
				{/if}
			</div>

			<!-- Unmatched Screen Observations -->
			{#if data.stepResult.observations && data.stepResult.observations.length > 0}
				{@const allObs = data.stepResult.observations}
				{@const hasStepNumbers = allObs.some((o) => o.stepNumber != null)}
				{@const unmatchedObs =
					steps.length > 0
						? hasStepNumbers
							? allObs.filter(
									(o) => !o.stepNumber || !steps.some((s) => s.stepNumber === o.stepNumber)
								)
							: allObs.slice(steps.length)
						: allObs}
				{#if unmatchedObs.length > 0}
					<div>
						<p class="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
							{steps.length > 0 ? 'Additional ' : ''}Screen Observations ({unmatchedObs.length})
						</p>
						<div class="space-y-2">
							{#each unmatchedObs as obs, obsIdx}
								{@const elemKey = `unmatched-${obsIdx}`}
								{@const isExpanded = expandedElementSets.has(elemKey)}
								<div class="rounded-lg bg-stone-50 px-3 py-2.5">
									<div class="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
										<Icon
											icon="solar:monitor-smartphone-bold-duotone"
											class="h-3.5 w-3.5 text-blue-500"
										/>
										{#if obs.stepNumber}
											<span
												class="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-stone-500"
												>Step {obs.stepNumber}</span
											>
										{/if}
										{#if obs.packageName}
											<span class="font-medium text-blue-700">{obs.packageName}</span>
										{/if}
										{#if obs.activityName}
											<span class="text-stone-300">&rsaquo;</span>
											<span class="font-medium text-violet-600"
												>{obs.activityName.split('.').pop()}</span
											>
										{/if}
										<span class="text-stone-300">·</span>
										<span class="text-stone-400"
											>{obs.elements.length} element{obs.elements.length !== 1
												? 's'
												: ''}</span
										>
									</div>
									{#if obs.elements.length > 0}
										<div
											class="space-y-0.5"
											class:max-h-32={!isExpanded}
											class:overflow-y-auto={!isExpanded}
										>
											{#each isExpanded ? obs.elements : obs.elements.slice(0, 20) as el}
												{@const elem = el as Record<string, unknown>}
												<p class="truncate font-mono text-[10px] text-stone-500">
													{#if elem.type}<span class="text-stone-300"
															>[{(elem.type as string).split('.').pop()}]</span
														>{/if}
													{#if elem.action}<span class="text-amber-500/70">
															{elem.action}</span
														>{/if}
													{#if elem.text}<span class="text-stone-700">
															"{elem.text}"</span
														>{/if}
													{#if elem.hint}<span class="text-stone-400 italic">
															{elem.hint}</span
														>{/if}
													{#if elem.id}<span class="text-blue-400">
															#{(elem.id as string).split('/').pop()}</span
														>{/if}
													{#if elem.center}<span class="text-emerald-500">
															@{JSON.stringify(elem.center)}</span
														>{/if}
													{#if elem.checked}<span class="text-orange-400">
															checked</span
														>{/if}
													{#if elem.focused}<span class="text-cyan-400">
															focused</span
														>{/if}
													{#if elem.selected}<span class="text-purple-400">
															selected</span
														>{/if}
													{#if elem.enabled === false}<span class="text-red-400">
															disabled</span
														>{/if}
												</p>
											{/each}
											{#if obs.elements.length > 20}
												<button
													class="mt-0.5 cursor-pointer text-[10px] italic text-blue-500 hover:text-blue-700"
													onclick={() => toggleExpanded(elemKey)}
												>
													{isExpanded
														? '▲ Show fewer elements'
														: `... +${obs.elements.length - 20} more elements`}
												</button>
											{/if}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</div>
				{/if}
			{/if}

			<!-- Session ID -->
			{#if data.stepResult.sessionId}
				<div class="border-t border-stone-100 pt-3">
					<p class="text-[10px] text-stone-400">
						Session ID: <span class="font-mono">{data.stepResult.sessionId}</span>
					</p>
				</div>
			{/if}
		</div>
	</div>
</div>
