<script lang="ts">
	import Icon from '@iconify/svelte';
	import ActionBadge from './ActionBadge.svelte';
	import { StatusBadge } from '$lib/components/shared';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Accordion from '$lib/components/ui/accordion';
	import { Badge } from '$lib/components/ui/badge';
	import { Separator } from '$lib/components/ui/separator';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as ScrollArea from '$lib/components/ui/scroll-area';
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

	let sheetOpen = $state(true);

	// Track which element sections are expanded
	let expandedElementSets = $state<Set<string>>(new Set());

	function toggleExpanded(key: string) {
		const next = new Set(expandedElementSets);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		expandedElementSets = next;
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

	function handleOpenChange(open: boolean) {
		if (!open) onclose();
	}
</script>

<Sheet.Root bind:open={sheetOpen} onOpenChange={handleOpenChange}>
	<Sheet.Content side="right" class="w-full max-w-2xl overflow-y-auto sm:max-w-xl">
		<Sheet.Header>
			<div class="flex items-center gap-3">
				<Badge variant="outline" class="{data.stepResult.success ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-red-50 text-red-700 border-red-200'}">
					Goal {data.stepIdx + 1}
				</Badge>
				<StatusBadge status={data.stepResult.success ? 'completed' : 'failed'} pulse={false} />
			</div>
			<Sheet.Title class="sr-only">Step Detail</Sheet.Title>
		</Sheet.Header>

		<div class="mt-4 space-y-4">
			<!-- Goal -->
			<div>
				<p class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400">Goal</p>
				<p class="whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
					{data.stepResult.goal ?? data.config?.goal ?? data.stepResult.command ?? 'N/A'}
				</p>
			</div>

			<!-- Configuration -->
			{#if data.config}
				<div>
					<p class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400">Configuration</p>
					<div class="flex flex-wrap gap-2">
						{#if data.config.app}
							<Badge variant="outline" class="bg-blue-50 text-blue-700 border-blue-200 gap-1">
								<Icon icon="solar:box-bold-duotone" class="h-3 w-3" />
								{data.config.app}
							</Badge>
						{/if}
						{#if data.config.maxSteps}
							<Badge variant="outline">Max {data.config.maxSteps} steps</Badge>
						{/if}
						{#if data.config.retries}
							<Badge variant="outline">{data.config.retries} retries</Badge>
						{/if}
						{#if data.stepResult.resolvedBy}
							{#if data.stepResult.resolvedBy === 'cached_flow'}
								<Badge variant="outline" class="bg-cyan-50 text-cyan-700 border-cyan-200 gap-1">
									<Icon icon="solar:bolt-bold-duotone" class="h-3 w-3" />
									Cached flow
								</Badge>
							{:else}
								<Badge variant="outline" class="bg-violet-50 text-violet-700 border-violet-200">
									Resolved by: {data.stepResult.resolvedBy}
								</Badge>
							{/if}
						{/if}
						{#if data.stepResult.stepsUsed !== undefined}
							<Badge variant="outline">Used {data.stepResult.stepsUsed} steps</Badge>
						{/if}
					</div>
				</div>
			{/if}

			<!-- Error -->
			{#if data.stepResult.error || (data.stepResult.message && !data.stepResult.success)}
				<div>
					<p class="mb-1.5 text-xs font-semibold uppercase tracking-wider text-red-400">Error</p>
					<div class="rounded-lg bg-red-50 px-3 py-2.5">
						<p class="text-xs text-red-700">{data.stepResult.error ?? data.stepResult.message}</p>
					</div>
				</div>
			{/if}

			<Separator />

			<!-- Agent Journey (Accordion) -->
			<Accordion.Root type="multiple" value={['journey']}>
				<Accordion.Item value="journey" class="border-none">
					<Accordion.Trigger class="text-xs font-semibold uppercase tracking-wider text-stone-400 hover:no-underline">
						Agent Journey
					</Accordion.Trigger>
					<Accordion.Content>
						{#if stepsLoading}
							<div class="space-y-2">
								{#each [1, 2, 3] as _}
									<Skeleton class="h-16 w-full" />
								{/each}
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
											<Badge variant="outline" class="font-mono text-xs">{s.stepNumber}</Badge>
											<ActionBadge action={act.type} />
											<div class="flex flex-wrap items-center gap-1.5 text-xs text-stone-600">
												{#if act.coords && act.coords.length >= 2}
													<span class="font-mono text-stone-400">({act.coords[0]}, {act.coords[1]})</span>
												{/if}
												{#if act.text}
													<span class="rounded bg-white px-1.5 py-0.5 text-stone-700">"{act.text}"</span>
												{/if}
												{#if act.direction}
													<span class="text-stone-400">{act.direction}{act.scrollAmount ? ` ×${act.scrollAmount}` : ''}</span>
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
													<div class="flex flex-wrap items-center gap-1.5 text-xs">
														<Icon icon="solar:monitor-smartphone-bold-duotone" class="h-3 w-3 text-blue-500" />
														{#if obs.packageName}
															<span class="font-medium text-blue-700">{obs.packageName}</span>
														{/if}
														{#if obs.activityName}
															<span class="text-stone-300">&rsaquo;</span>
															<span class="font-medium text-violet-600">{obs.activityName.split('.').pop()}</span>
														{/if}
														<span class="text-stone-300">·</span>
														<span class="text-stone-400">{obs.elements.length} element{obs.elements.length !== 1 ? 's' : ''}</span>
													</div>
													{#if obs.elements.length > 0}
														<div
															class="mt-1 space-y-0.5"
															class:max-h-24={!isExpanded}
															class:overflow-y-auto={!isExpanded}
														>
															{#each isExpanded ? obs.elements : obs.elements.slice(0, 15) as el}
																{@const elem = el as Record<string, unknown>}
																<p class="truncate font-mono text-xs text-stone-500">
																	{#if elem.type}<span class="text-stone-300">[{(elem.type as string).split('.').pop()}]</span>{/if}
																	{#if elem.action}<span class="text-amber-500/70"> {elem.action}</span>{/if}
																	{#if elem.text}<span class="text-stone-700"> "{elem.text}"</span>{/if}
																	{#if elem.hint}<span class="text-stone-400 italic"> {elem.hint}</span>{/if}
																	{#if elem.id}<span class="text-blue-400"> #{(elem.id as string).split('/').pop()}</span>{/if}
																	{#if elem.center}<span class="text-emerald-500"> @{JSON.stringify(elem.center)}</span>{/if}
																	{#if elem.checked}<span class="text-orange-400"> checked</span>{/if}
																	{#if elem.focused}<span class="text-cyan-400"> focused</span>{/if}
																	{#if elem.selected}<span class="text-purple-400"> selected</span>{/if}
																	{#if elem.enabled === false}<span class="text-red-400"> disabled</span>{/if}
																</p>
															{/each}
															{#if obs.elements.length > 15}
																<button
																	class="mt-0.5 cursor-pointer text-xs italic text-blue-500 hover:text-blue-700"
																	onclick={() => toggleExpanded(elemKey)}
																>
																	{isExpanded ? '▲ Show fewer elements' : `... +${obs.elements.length - 15} more elements`}
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
								No session linked — resolved by {data.stepResult.resolvedBy ?? 'parser/classifier'} without UI agent.
							</p>
						{:else}
							<p class="text-xs text-stone-400">No step data available.</p>
						{/if}
					</Accordion.Content>
				</Accordion.Item>

				<!-- Screen Observations -->
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
						<Accordion.Item value="observations" class="border-none">
							<Accordion.Trigger class="text-xs font-semibold uppercase tracking-wider text-stone-400 hover:no-underline">
								{steps.length > 0 ? 'Additional ' : ''}Screen Observations ({unmatchedObs.length})
							</Accordion.Trigger>
							<Accordion.Content>
								<div class="space-y-2">
									{#each unmatchedObs as obs, obsIdx}
										{@const elemKey = `unmatched-${obsIdx}`}
										{@const isExpanded = expandedElementSets.has(elemKey)}
										<div class="rounded-lg bg-stone-50 px-3 py-2.5">
											<div class="mb-1.5 flex flex-wrap items-center gap-1.5 text-xs">
												<Icon icon="solar:monitor-smartphone-bold-duotone" class="h-3.5 w-3.5 text-blue-500" />
												{#if obs.stepNumber}
													<Badge variant="outline" class="font-mono text-xs">Step {obs.stepNumber}</Badge>
												{/if}
												{#if obs.packageName}
													<span class="font-medium text-blue-700">{obs.packageName}</span>
												{/if}
												{#if obs.activityName}
													<span class="text-stone-300">&rsaquo;</span>
													<span class="font-medium text-violet-600">{obs.activityName.split('.').pop()}</span>
												{/if}
												<span class="text-stone-300">·</span>
												<span class="text-stone-400">{obs.elements.length} element{obs.elements.length !== 1 ? 's' : ''}</span>
											</div>
											{#if obs.elements.length > 0}
												<div
													class="space-y-0.5"
													class:max-h-32={!isExpanded}
													class:overflow-y-auto={!isExpanded}
												>
													{#each isExpanded ? obs.elements : obs.elements.slice(0, 20) as el}
														{@const elem = el as Record<string, unknown>}
														<p class="truncate font-mono text-xs text-stone-500">
															{#if elem.type}<span class="text-stone-300">[{(elem.type as string).split('.').pop()}]</span>{/if}
															{#if elem.action}<span class="text-amber-500/70"> {elem.action}</span>{/if}
															{#if elem.text}<span class="text-stone-700"> "{elem.text}"</span>{/if}
															{#if elem.hint}<span class="text-stone-400 italic"> {elem.hint}</span>{/if}
															{#if elem.id}<span class="text-blue-400"> #{(elem.id as string).split('/').pop()}</span>{/if}
															{#if elem.center}<span class="text-emerald-500"> @{JSON.stringify(elem.center)}</span>{/if}
															{#if elem.checked}<span class="text-orange-400"> checked</span>{/if}
															{#if elem.focused}<span class="text-cyan-400"> focused</span>{/if}
															{#if elem.selected}<span class="text-purple-400"> selected</span>{/if}
															{#if elem.enabled === false}<span class="text-red-400"> disabled</span>{/if}
														</p>
													{/each}
													{#if obs.elements.length > 20}
														<button
															class="mt-0.5 cursor-pointer text-xs italic text-blue-500 hover:text-blue-700"
															onclick={() => toggleExpanded(elemKey)}
														>
															{isExpanded ? '▲ Show fewer elements' : `... +${obs.elements.length - 20} more elements`}
														</button>
													{/if}
												</div>
											{/if}
										</div>
									{/each}
								</div>
							</Accordion.Content>
						</Accordion.Item>
					{/if}
				{/if}
			</Accordion.Root>

			<!-- Session ID -->
			{#if data.stepResult.sessionId}
				<Separator />
				<p class="text-xs text-stone-400">
					Session ID: <span class="font-mono">{data.stepResult.sessionId}</span>
				</p>
			{/if}
		</div>
	</Sheet.Content>
</Sheet.Root>
