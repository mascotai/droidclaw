import { useState, useEffect, useCallback } from 'react';
import {
	CheckCircle2,
	XCircle,
	Loader2,
	Monitor,
	Package,
} from 'lucide-react';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ActionBadge } from '@/components/shared';
import { api } from '@/lib/api';
import type { StepResult, WorkflowStepConfig } from '@/types/devices';
import { cn } from '@/lib/utils';

interface StepDetailModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	stepIdx: number;
	stepResult: StepResult;
	config: WorkflowStepConfig | null;
	deviceId: string;
	runId: string;
}

interface AgentStep {
	step: number;
	action: Record<string, unknown>;
	reasoning: string | null;
	result: string | null;
	package: string | null;
	durationMs: number;
}

interface ScreenObservation {
	stepNumber?: number;
	elements: Array<Record<string, unknown>>;
	packageName?: string;
	activityName?: string;
}

function parseAction(action: unknown): {
	type: string;
	coords?: number[];
	text?: string;
	direction?: string;
	target?: string;
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
			target: a.target as string | undefined,
			scrollAmount: a.scrollAmount as number | undefined,
		};
	}
	return { type: 'unknown' };
}

function ElementLine({ elem }: { elem: Record<string, unknown> }) {
	return (
		<p className="truncate font-mono text-[10px] text-stone-500">
			{elem.type ? (
				<span className="text-stone-300">[{(elem.type as string).split('.').pop()}]</span>
			) : null}
			{elem.action ? (
				<span className="text-amber-500/70"> {elem.action as string}</span>
			) : null}
			{elem.text ? (
				<span className="text-stone-700"> &quot;{elem.text as string}&quot;</span>
			) : null}
			{elem.hint ? (
				<span className="italic text-stone-400"> {elem.hint as string}</span>
			) : null}
			{elem.id ? (
				<span className="text-blue-400"> #{(elem.id as string).split('/').pop()}</span>
			) : null}
			{elem.center ? (
				<span className="text-emerald-500"> @{JSON.stringify(elem.center)}</span>
			) : null}
			{elem.checked ? <span className="text-orange-400"> checked</span> : null}
			{elem.focused ? <span className="text-cyan-400"> focused</span> : null}
			{elem.selected ? <span className="text-purple-400"> selected</span> : null}
			{elem.enabled === false ? <span className="text-red-400"> disabled</span> : null}
		</p>
	);
}

function ObservationBlock({
	obs,
	elemKey,
	expanded,
	onToggle,
	maxCollapsed = 15,
}: {
	obs: ScreenObservation;
	elemKey: string;
	expanded: boolean;
	onToggle: (key: string) => void;
	maxCollapsed?: number;
}) {
	const elements = obs.elements ?? [];
	const visibleElements = expanded ? elements : elements.slice(0, maxCollapsed);

	return (
		<div className="ml-8 mt-2 rounded-md border border-stone-200 bg-white px-2.5 py-2">
			<div className="flex flex-wrap items-center gap-1.5 text-[10px]">
				<Monitor className="h-3 w-3 text-blue-500" />
				{obs.packageName ? (
					<span className="font-medium text-blue-700">{obs.packageName}</span>
				) : null}
				{obs.activityName ? (
					<>
						<span className="text-stone-300">&rsaquo;</span>
						<span className="font-medium text-violet-600">
							{obs.activityName.split('.').pop()}
						</span>
					</>
				) : null}
				<span className="text-stone-300">&middot;</span>
				<span className="text-stone-400">
					{elements.length} element{elements.length !== 1 ? 's' : ''}
				</span>
			</div>
			{elements.length > 0 ? (
				<div className={cn('mt-1 space-y-0.5', !expanded && 'max-h-24 overflow-y-auto')}>
					{visibleElements.map((el, idx) => (
						<ElementLine key={idx} elem={el} />
					))}
					{elements.length > maxCollapsed ? (
						<button
							className="mt-0.5 cursor-pointer text-[10px] italic text-blue-500 hover:text-blue-700"
							onClick={() => onToggle(elemKey)}
						>
							{expanded
								? '▲ Show fewer elements'
								: `... +${elements.length - maxCollapsed} more elements`}
						</button>
					) : null}
				</div>
			) : null}
		</div>
	);
}

export function StepDetailModal({
	open,
	onOpenChange,
	stepIdx,
	stepResult,
	config,
	deviceId,
	runId,
}: StepDetailModalProps) {
	const [steps, setSteps] = useState<AgentStep[]>([]);
	const [stepsLoading, setStepsLoading] = useState(false);
	const [expandedSets, setExpandedSets] = useState<Set<string>>(new Set());

	const toggleExpanded = useCallback((key: string) => {
		setExpandedSets((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}, []);

	// Fetch agent steps when modal opens
	useEffect(() => {
		if (!open) return;
		setStepsLoading(true);
		setSteps([]);
		setExpandedSets(new Set());

		api.getGoalSteps(deviceId, runId, stepIdx)
			.then((data) => {
				setSteps((data.steps ?? []) as unknown as AgentStep[]);
				setStepsLoading(false);
			})
			.catch(() => {
				setSteps([]);
				setStepsLoading(false);
			});
	}, [open, deviceId, runId, stepIdx]);

	const observations = (stepResult.observations ?? []) as ScreenObservation[];
	const hasStepNumbers = observations.some((o) => o.stepNumber != null);

	function getMatchingObs(stepNumber: number, stepIndex: number): ScreenObservation[] {
		if (hasStepNumbers) {
			return observations.filter((o) => o.stepNumber === stepNumber);
		}
		return stepIndex < observations.length ? [observations[stepIndex]] : [];
	}

	// Unmatched observations (not linked to any step)
	const unmatchedObs =
		steps.length > 0
			? hasStepNumbers
				? observations.filter(
						(o) => !o.stepNumber || !steps.some((s) => s.step === o.stepNumber),
					)
				: observations.slice(steps.length)
			: observations;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-2xl p-0">
				{/* Header */}
				<DialogHeader className="sticky top-0 z-10 rounded-t-2xl border-b border-stone-100 bg-white px-6 py-4">
					<div className="flex items-center gap-3">
						<span
							className={cn(
								'rounded-full px-2.5 py-0.5 font-mono text-xs',
								stepResult.success
									? 'bg-emerald-100 text-emerald-700'
									: 'bg-red-100 text-red-700',
							)}
						>
							Goal {stepIdx + 1}
						</span>
						<DialogTitle className="flex items-center gap-1 text-sm font-medium">
							<span className={stepResult.success ? 'text-emerald-700' : 'text-red-700'}>
								{stepResult.success ? (
									<CheckCircle2 className="mr-1 inline h-4 w-4" />
								) : (
									<XCircle className="mr-1 inline h-4 w-4" />
								)}
								{stepResult.success ? 'Succeeded' : 'Failed'}
							</span>
						</DialogTitle>
					</div>
				</DialogHeader>

				<ScrollArea className="max-h-[75vh]">
					<div className="space-y-5 px-6 py-5">
						{/* Goal text */}
						<div>
							<p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
								Goal
							</p>
							<p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
								{stepResult.goal ?? config?.goal ?? stepResult.command ?? 'N/A'}
							</p>
						</div>

						{/* Configuration */}
						{config ? (
							<div>
								<p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
									Configuration
								</p>
								<div className="flex flex-wrap gap-2">
									{config.app ? (
										<span className="flex items-center gap-1 rounded-lg bg-blue-50 px-2.5 py-1 text-xs text-blue-700">
											<Package className="h-3.5 w-3.5" />
											{config.app}
										</span>
									) : null}
									{config.maxSteps ? (
										<span className="rounded-lg bg-stone-100 px-2.5 py-1 text-xs text-stone-600">
											Max {config.maxSteps} steps
										</span>
									) : null}
									{config.retries ? (
										<span className="rounded-lg bg-stone-100 px-2.5 py-1 text-xs text-stone-600">
											{config.retries} retries
										</span>
									) : null}
									{stepResult.resolvedBy ? (
										<span className="rounded-lg bg-stone-100 px-2.5 py-1 text-xs text-stone-600">
											{stepResult.resolvedBy === 'cached_flow' ? 'Cached flow' : `Resolved by: ${stepResult.resolvedBy}`}
										</span>
									) : null}
									{stepResult.stepsUsed !== undefined ? (
										<span className="rounded-lg bg-stone-100 px-2.5 py-1 text-xs text-stone-600">
											Used {stepResult.stepsUsed} steps
										</span>
									) : null}
								</div>
							</div>
						) : null}

						{/* Error */}
						{stepResult.error || (stepResult.message && !stepResult.success) ? (
							<div>
								<p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-red-400">
									Error
								</p>
								<div className="rounded-lg bg-red-50 px-3 py-2.5">
									<p className="text-xs text-red-700">
										{stepResult.error ?? stepResult.message}
									</p>
								</div>
							</div>
						) : null}

						{/* Agent Journey */}
						<div>
							<p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
								Agent Journey
							</p>
							{stepsLoading ? (
								<div className="flex items-center gap-2 py-3 text-xs text-stone-400">
									<Loader2 className="h-4 w-4 animate-spin" />
									Loading steps...
								</div>
							) : steps.length > 0 ? (
								<div className="space-y-1.5">
									{steps.map((s, sIdx) => {
										const act = parseAction(s.action);
										const matchingObs = getMatchingObs(s.step, sIdx);

										return (
											<div key={s.step} className="rounded-lg bg-stone-50 px-3 py-2.5">
												<div className="flex items-center gap-2">
													<span className="shrink-0 rounded-full bg-stone-200 px-2 py-0.5 font-mono text-[10px] text-stone-500">
														{s.step}
													</span>
													<ActionBadge action={act.type} />
													<div className="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-600">
														{act.target ? (
															<span className="text-stone-600">{act.target}</span>
														) : null}
														{act.coords && act.coords.length >= 2 ? (
															<span className="font-mono text-stone-400">
																({act.coords[0]}, {act.coords[1]})
															</span>
														) : null}
														{act.text ? (
															<span className="rounded bg-white px-1.5 py-0.5 text-stone-700">
																&quot;{act.text}&quot;
															</span>
														) : null}
														{act.direction ? (
															<span className="text-stone-400">
																{act.direction}
																{act.scrollAmount ? ` ×${act.scrollAmount}` : ''}
															</span>
														) : null}
													</div>
													{s.durationMs ? (
														<span className="ml-auto shrink-0 text-[9px] text-stone-300">
															{Math.round(s.durationMs / 1000)}s
														</span>
													) : null}
												</div>
												{s.reasoning ? (
													<p className="mt-1 pl-8 text-xs leading-relaxed text-stone-500">
														{s.reasoning}
													</p>
												) : null}
												{s.result ? (
													<p className="mt-0.5 pl-8 text-xs text-stone-400">
														→ {s.result}
													</p>
												) : null}

												{/* Inline screen observations */}
												{matchingObs.map((obs, obsIdx) => (
													<ObservationBlock
														key={`inline-${sIdx}-${obsIdx}`}
														obs={obs}
														elemKey={`inline-${sIdx}-${obsIdx}`}
														expanded={expandedSets.has(`inline-${sIdx}-${obsIdx}`)}
														onToggle={toggleExpanded}
													/>
												))}
											</div>
										);
									})}
								</div>
							) : !stepResult.sessionId ? (
								<p className="text-xs text-stone-400">
									No session linked — resolved by{' '}
									{stepResult.resolvedBy ?? 'parser/classifier'} without UI agent.
								</p>
							) : (
								<p className="text-xs text-stone-400">No step data available.</p>
							)}
						</div>

						{/* Unmatched Screen Observations */}
						{unmatchedObs.length > 0 ? (
							<div>
								<p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
									{steps.length > 0 ? 'Additional ' : ''}Screen Observations ({unmatchedObs.length})
								</p>
								<div className="space-y-2">
									{unmatchedObs.map((obs, obsIdx) => (
										<div key={obsIdx} className="rounded-lg bg-stone-50 px-3 py-2.5">
											<div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
												<Monitor className="h-3.5 w-3.5 text-blue-500" />
												{obs.stepNumber ? (
													<span className="rounded bg-stone-200 px-1.5 py-0.5 font-mono text-stone-500">
														Step {obs.stepNumber}
													</span>
												) : null}
												{obs.packageName ? (
													<span className="font-medium text-blue-700">{obs.packageName}</span>
												) : null}
												{obs.activityName ? (
													<>
														<span className="text-stone-300">&rsaquo;</span>
														<span className="font-medium text-violet-600">
															{obs.activityName.split('.').pop()}
														</span>
													</>
												) : null}
												<span className="text-stone-300">&middot;</span>
												<span className="text-stone-400">
													{obs.elements.length} element{obs.elements.length !== 1 ? 's' : ''}
												</span>
											</div>
											{obs.elements.length > 0 ? (
												<div
													className={cn(
														'space-y-0.5',
														!expandedSets.has(`unmatched-${obsIdx}`) && 'max-h-32 overflow-y-auto',
													)}
												>
													{(expandedSets.has(`unmatched-${obsIdx}`)
														? obs.elements
														: obs.elements.slice(0, 20)
													).map((el, elIdx) => (
														<ElementLine key={elIdx} elem={el} />
													))}
													{obs.elements.length > 20 ? (
														<button
															className="mt-0.5 cursor-pointer text-[10px] italic text-blue-500 hover:text-blue-700"
															onClick={() => toggleExpanded(`unmatched-${obsIdx}`)}
														>
															{expandedSets.has(`unmatched-${obsIdx}`)
																? '▲ Show fewer elements'
																: `... +${obs.elements.length - 20} more elements`}
														</button>
													) : null}
												</div>
											) : null}
										</div>
									))}
								</div>
							</div>
						) : null}

						{/* Session ID */}
						{stepResult.sessionId ? (
							<div className="border-t border-stone-100 pt-3">
								<p className="text-[10px] text-stone-400">
									Session ID: <span className="font-mono">{stepResult.sessionId}</span>
								</p>
							</div>
						) : null}
					</div>
				</ScrollArea>
			</DialogContent>
		</Dialog>
	);
}
