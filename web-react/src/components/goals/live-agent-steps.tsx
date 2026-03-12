import { ActionBadge } from '@/components/shared';
import type { LiveAgentStep } from '@/types/devices';
import { cn } from '@/lib/utils';

interface LiveAgentStepsProps {
	steps: LiveAgentStep[];
	/** Visual variant: 'live' = violet/pulsing (AI discovery), 'frozen' = cyan (cached replay) */
	variant?: 'live' | 'frozen';
}

export function LiveAgentSteps({ steps, variant = 'live' }: LiveAgentStepsProps) {
	if (steps.length === 0) return null;

	const borderColor = variant === 'frozen' ? 'border-cyan-200' : 'border-violet-200';

	return (
		<div className={cn('mt-2 space-y-1 border-l-2 pl-3', borderColor)}>
			{steps.map((agentStep) => (
				<div key={agentStep.step} className="flex items-start gap-1.5">
					<span className="mt-0.5 shrink-0 rounded bg-stone-100 px-1 py-0.5 font-mono text-[9px] text-stone-500">
						{agentStep.step}
					</span>
					<div className="min-w-0 flex-1">
						<ActionBadge action={agentStep.action} />
						{agentStep.reasoning ? (
							<p className="mt-0.5 text-xs leading-relaxed text-stone-500">{agentStep.reasoning}</p>
						) : null}
					</div>
				</div>
			))}
		</div>
	);
}
