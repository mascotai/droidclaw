import type { WorkflowStepConfig } from '@/types/devices';
import { Badge } from '@/components/ui/badge';
import { FormattedGoalText } from './formatted-goal-text';
import {
	Package,
	Zap,
	RotateCcw,
	OctagonX,
	ClipboardCheck,
	GitBranch,
} from 'lucide-react';

interface WorkflowStepsListProps {
	steps: WorkflowStepConfig[];
	variables?: Record<string, string>;
}

export function WorkflowStepsList({ steps, variables }: WorkflowStepsListProps) {
	return (
		<div className="space-y-2">
			{steps.map((step, idx) => (
				<div
					key={idx}
					className="flex items-start gap-3 rounded-lg bg-stone-50 px-3 py-2.5"
				>
					<span className="mt-0.5 shrink-0 flex items-center justify-center h-5 w-5 rounded-full bg-stone-200 text-[10px] font-bold text-stone-600">
						{idx + 1}
					</span>
					<div className="min-w-0 flex-1">
						<p className="text-sm text-stone-700">
							<FormattedGoalText text={step.goal} />
						</p>

						{/* Badges row */}
						<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
							{step.app && (
								<Badge variant="outline" className="gap-1">
									<Package className="h-3 w-3" />
									{step.app}
								</Badge>
							)}
							<Badge variant="secondary" className="gap-1">
								<Zap className="h-3 w-3" />
								{step.maxSteps ?? 15} steps
							</Badge>
							{(step.retries ?? 0) > 0 && (
								<Badge variant="secondary" className="gap-1">
									<RotateCcw className="h-3 w-3" />
									{step.retries} {step.retries === 1 ? 'retry' : 'retries'}
								</Badge>
							)}
							{step.forceStop && (
								<Badge variant="destructive" className="gap-1">
									<OctagonX className="h-3 w-3" />
									Force stop
								</Badge>
							)}
							{step.cache && (
								<Badge variant="secondary">Cached</Badge>
							)}
							{step.eval && (
								<Badge variant="secondary" className="gap-1 bg-emerald-100 text-emerald-700">
									<ClipboardCheck className="h-3 w-3" />
									Eval
								</Badge>
							)}
						</div>

						{/* When condition display */}
						{step.when && Object.keys(step.when).length > 0 && (
							<div className="mt-1.5 flex items-center gap-1.5 text-xs text-blue-600">
								<GitBranch className="h-3 w-3 shrink-0" />
								<span className="font-medium">When:</span>
								{Object.entries(step.when).map(([key, value]) => (
									<code
										key={key}
										className="rounded bg-blue-50 px-1 py-0.5 font-mono text-[11px] text-blue-700"
									>
										{key} = {String(value)}
									</code>
								))}
							</div>
						)}
					</div>
				</div>
			))}

			{/* Variables section */}
			{variables && Object.keys(variables).length > 0 && (
				<div className="rounded-lg bg-violet-50 border border-violet-100 px-3 py-2 mt-3">
					<p className="text-[10px] font-semibold uppercase tracking-wider text-violet-500 mb-1">
						Variables
					</p>
					<div className="flex flex-wrap gap-1.5">
						{Object.entries(variables).map(([key, val]) => (
							<span
								key={key}
								className="inline-flex items-center gap-1 rounded bg-white border border-violet-200 px-2 py-0.5 text-xs font-mono"
							>
								<span className="text-violet-600">{key}</span>
								<span className="text-stone-300">=</span>
								<span className="text-stone-500">{val}</span>
							</span>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
