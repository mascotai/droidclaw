import { useState, useMemo } from 'react';
import {
	Monitor,
	ChevronDown,
	ChevronUp,
} from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge, ActionBadge } from '@/components/shared';
import type { StepResult, WorkflowStepConfig, Step } from '@/types/devices';
import { cn } from '@/lib/utils';

interface ModalData {
	stepIdx: number;
	stepResult: StepResult;
	config: WorkflowStepConfig | null;
}

interface StepDetailModalProps {
	data: ModalData;
	steps: Step[];
	stepsLoading: boolean;
	onClose: () => void;
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
			scrollAmount: a.scrollAmount as number | undefined,
		};
	}
	return { type: 'unknown' };
}

export function StepDetailModal({ data, steps, stepsLoading, onClose }: StepDetailModalProps) {
	const [expandedElementSets, setExpandedElementSets] = useState<Set<string>>(new Set());

	function toggleExpanded(key: string) {
		setExpandedElementSets((prev) => {
			const next = new Set(prev);
			if (next.has(key)) next.delete(key);
			else next.add(key);
			return next;
		});
	}

	const allObs = data.stepResult.observations ?? [];
	const hasStepNumbers = allObs.some((o) => o.stepNumber != null);

	// Unmatched observations (those not already shown inline with steps)
	const unmatchedObs = useMemo(() => {
		if (steps.length === 0) return allObs;
		if (hasStepNumbers) {
			return allObs.filter(
				(o) => !o.stepNumber || !steps.some((s) => s.stepNumber === o.stepNumber),
			);
		}
		return allObs.slice(steps.length);
	}, [allObs, steps, hasStepNumbers]);

	return (
		<Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
			<SheetContent side="right" className="w-full max-w-2xl overflow-y-auto sm:max-w-xl">
				<SheetHeader>
					<div className="flex items-center gap-3">
						<Badge
							variant="outline"
							className={cn(
								data.stepResult.success
									? 'border-emerald-200 bg-emerald-50 text-emerald-700'
									: 'border-red-200 bg-red-50 text-red-700',
							)}
						>
							Goal {data.stepIdx + 1}
						</Badge>
						<StatusBadge status={data.stepResult.success ? 'completed' : 'failed'} pulse={false} />
					</div>
					<SheetTitle className="sr-only">Step Detail</SheetTitle>
				</SheetHeader>

				<div className="mt-4 space-y-4">
					{/* Goal */}
					<div>
						<p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400">Goal</p>
						<p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-800">
							{data.stepResult.goal ?? data.config?.goal ?? data.stepResult.command ?? 'N/A'}
						</p>
					</div>

					{/* Configuration */}
					{data.config ? (
						<div>
							<p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-stone-400">Configuration</p>
							<div className="flex flex-wrap gap-2">
								{data.config.app ? (
									<Badge variant="outline" className="gap-1 border-blue-200 bg-blue-50 text-blue-700">
										{data.config.app}
									</Badge>
								) : null}
								{data.config.maxSteps ? (
									<Badge variant="outline">Max {data.config.maxSteps} steps</Badge>
								) : null}
								{data.config.retries ? (
									<Badge variant="outline">{data.config.retries} retries</Badge>
								) : null}
								{data.stepResult.resolvedBy ? (
									data.stepResult.resolvedBy === 'cached_flow' ? (
										<Badge variant="outline" className="gap-1 border-cyan-200 bg-cyan-50 text-cyan-700">
											Cached flow
										</Badge>
									) : (
										<Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
											Resolved by: {data.stepResult.resolvedBy}
										</Badge>
									)
								) : null}
								{data.stepResult.stepsUsed !== undefined ? (
									<Badge variant="outline">Used {data.stepResult.stepsUsed} steps</Badge>
								) : null}
							</div>
						</div>
					) : null}

					{/* Error */}
					{data.stepResult.error || (data.stepResult.message && !data.stepResult.success) ? (
						<div>
							<p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-red-400">Error</p>
							<div className="rounded-lg bg-red-50 px-3 py-2.5">
								<p className="text-xs text-red-700">{data.stepResult.error ?? data.stepResult.message}</p>
							</div>
						</div>
					) : null}

					<Separator />

					{/* Agent Journey */}
					<div>
						<p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">Agent Journey</p>
						{stepsLoading ? (
							<div className="space-y-2">
								{[1, 2, 3].map((i) => (
									<Skeleton key={i} className="h-16 w-full" />
								))}
							</div>
						) : steps.length > 0 ? (
							<div className="space-y-1.5">
								{steps.map((s, sIdx) => {
									const act = parseAction(s.action);
									const matchingObs = hasStepNumbers
										? allObs.filter((o) => o.stepNumber === s.stepNumber)
										: sIdx < allObs.length
											? [allObs[sIdx]]
											: [];

									return (
										<div key={s.id} className="rounded-lg bg-stone-50 px-3 py-2.5">
											<div className="flex items-center gap-2">
												<Badge variant="outline" className="font-mono text-xs">{s.stepNumber}</Badge>
												<ActionBadge action={act.type} />
												<div className="flex flex-wrap items-center gap-1.5 text-xs text-stone-600">
													{act.coords && act.coords.length >= 2 ? (
														<span className="font-mono text-stone-400">({act.coords[0]}, {act.coords[1]})</span>
													) : null}
													{act.text ? (
														<span className="rounded bg-white px-1.5 py-0.5 text-stone-700">&quot;{act.text}&quot;</span>
													) : null}
													{act.direction ? (
														<span className="text-stone-400">{act.direction}{act.scrollAmount ? ` x${act.scrollAmount}` : ''}</span>
													) : null}
												</div>
											</div>
											{s.reasoning ? (
												<p className="mt-1 pl-8 text-xs leading-relaxed text-stone-500">{s.reasoning}</p>
											) : null}

											{/* Inline screen observations */}
											{matchingObs.map((obs, obsIdx) => {
												const elemKey = `inline-${sIdx}-${obsIdx}`;
												const isExpanded = expandedElementSets.has(elemKey);
												return (
													<ObservationBlock
														key={elemKey}
														obs={obs}
														isExpanded={isExpanded}
														maxDefault={15}
														onToggle={() => toggleExpanded(elemKey)}
														className="ml-8 mt-2"
													/>
												);
											})}
										</div>
									);
								})}
							</div>
						) : !data.stepResult.sessionId ? (
							<p className="text-xs text-stone-400">
								No session linked - resolved by {data.stepResult.resolvedBy ?? 'parser/classifier'} without UI agent.
							</p>
						) : (
							<p className="text-xs text-stone-400">No step data available.</p>
						)}
					</div>

					{/* Unmatched Screen Observations */}
					{unmatchedObs.length > 0 ? (
						<div>
							<p className="mb-2 text-xs font-semibold uppercase tracking-wider text-stone-400">
								{steps.length > 0 ? 'Additional ' : ''}Screen Observations ({unmatchedObs.length})
							</p>
							<div className="space-y-2">
								{unmatchedObs.map((obs, obsIdx) => {
									const elemKey = `unmatched-${obsIdx}`;
									const isExpanded = expandedElementSets.has(elemKey);
									return (
										<ObservationBlock
											key={elemKey}
											obs={obs}
											isExpanded={isExpanded}
											maxDefault={20}
											onToggle={() => toggleExpanded(elemKey)}
										/>
									);
								})}
							</div>
						</div>
					) : null}

					{/* Session ID */}
					{data.stepResult.sessionId ? (
						<>
							<Separator />
							<p className="text-xs text-stone-400">
								Session ID: <span className="font-mono">{data.stepResult.sessionId}</span>
							</p>
						</>
					) : null}
				</div>
			</SheetContent>
		</Sheet>
	);
}

// ── Observation block sub-component ──

interface Observation {
	stepNumber?: number | null;
	packageName?: string;
	activityName?: string;
	elements: unknown[];
}

function ObservationBlock({
	obs,
	isExpanded,
	maxDefault,
	onToggle,
	className,
}: {
	obs: Observation;
	isExpanded: boolean;
	maxDefault: number;
	onToggle: () => void;
	className?: string;
}) {
	return (
		<div className={cn('rounded-md border border-stone-200 bg-white px-2.5 py-2', className)}>
			<div className="flex flex-wrap items-center gap-1.5 text-xs">
				<Monitor className="h-3 w-3 text-blue-500" />
				{obs.stepNumber ? (
					<Badge variant="outline" className="font-mono text-xs">Step {obs.stepNumber}</Badge>
				) : null}
				{obs.packageName ? (
					<span className="font-medium text-blue-700">{obs.packageName}</span>
				) : null}
				{obs.activityName ? (
					<>
						<span className="text-stone-300">&rsaquo;</span>
						<span className="font-medium text-violet-600">{obs.activityName.split('.').pop()}</span>
					</>
				) : null}
				<span className="text-stone-300">&middot;</span>
				<span className="text-stone-400">{obs.elements.length} element{obs.elements.length !== 1 ? 's' : ''}</span>
			</div>
			{obs.elements.length > 0 ? (
				<div className={cn('mt-1 space-y-0.5', !isExpanded && 'max-h-24 overflow-y-auto')}>
					{(isExpanded ? obs.elements : obs.elements.slice(0, maxDefault)).map((el, elIdx) => {
						const elem = el as Record<string, unknown>;
						return (
							<p key={elIdx} className="truncate font-mono text-xs text-stone-500">
								{elem.type ? <span className="text-stone-300">[{(elem.type as string).split('.').pop()}]</span> : null}
								{elem.action ? <span className="text-amber-500/70"> {elem.action as string}</span> : null}
								{elem.text ? <span className="text-stone-700"> &quot;{elem.text as string}&quot;</span> : null}
								{elem.hint ? <span className="italic text-stone-400"> {elem.hint as string}</span> : null}
								{elem.id ? <span className="text-blue-400"> #{(elem.id as string).split('/').pop()}</span> : null}
								{elem.center ? <span className="text-emerald-500"> @{JSON.stringify(elem.center)}</span> : null}
								{elem.checked ? <span className="text-orange-400"> checked</span> : null}
								{elem.focused ? <span className="text-cyan-400"> focused</span> : null}
								{elem.selected ? <span className="text-purple-400"> selected</span> : null}
								{elem.enabled === false ? <span className="text-red-400"> disabled</span> : null}
							</p>
						);
					})}
					{obs.elements.length > maxDefault ? (
						<button
							className="mt-0.5 cursor-pointer text-xs italic text-blue-500 hover:text-blue-700"
							onClick={onToggle}
						>
							{isExpanded ? (
								<span className="flex items-center gap-0.5"><ChevronUp className="h-3 w-3" /> Show fewer elements</span>
							) : (
								<span className="flex items-center gap-0.5"><ChevronDown className="h-3 w-3" /> +{obs.elements.length - maxDefault} more elements</span>
							)}
						</button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
