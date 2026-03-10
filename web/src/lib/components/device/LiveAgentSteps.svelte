<script lang="ts">
	import ActionBadge from './ActionBadge.svelte';
	import type { LiveAgentStep } from './types';

	interface Props {
		steps: LiveAgentStep[];
		/** Visual variant: 'live' = violet/pulsing (AI discovery), 'frozen' = cyan (cached replay) */
		variant?: 'live' | 'frozen';
	}

	let { steps, variant = 'live' }: Props = $props();

	const borderColor = $derived(variant === 'frozen' ? 'border-cyan-200' : 'border-violet-200');
</script>

{#if steps.length > 0}
	<div class="mt-2 space-y-1 border-l-2 {borderColor} pl-3">
		{#each steps as agentStep (agentStep.step)}
			<div class="flex items-start gap-1.5">
				<span class="mt-0.5 shrink-0 rounded bg-stone-100 px-1 py-0.5 font-mono text-[9px] text-stone-500">{agentStep.step}</span>
				<div class="min-w-0 flex-1">
					<ActionBadge action={agentStep.action} />
					{#if agentStep.reasoning}
						<p class="mt-0.5 text-[11px] leading-relaxed text-stone-500">{agentStep.reasoning}</p>
					{/if}
				</div>
			</div>
		{/each}
	</div>
{/if}
