import { useState, useEffect, useCallback } from 'react';
import {
	CheckCircle2,
	XCircle,
	Loader2,
	Monitor,
	Package,
	ChevronDown,
	ChevronUp,
	X,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
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

interface ScreenData {
	elements: Array<Record<string, unknown>>;
	packageName?: string;
	activityName?: string;
	elementCount?: number;
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

/** Format a long goal text into readable paragraphs */
function GoalText({ text }: { text: string }) {
	// Split on sentence boundaries that look like instructions
	const sentences = text
		.split(/(?<=[.!])\s+(?=[A-Z])/)
		.filter(Boolean);

	if (sentences.length <= 1) {
		return <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-800">{text}</p>;
	}

	return (
		<div className="space-y-1.5">
			{sentences.map((sentence, i) => (
				<p key={i} className="text-sm leading-relaxed text-stone-800">
					{sentence.startsWith('IMPORTANT') || sentence.startsWith('WARNING') || sentence.startsWith('NOTE') ? (
						<span className="font-medium text-amber-700">{sentence}</span>
					) : (
						sentence
					)}
				</p>
			))}
		</div>
	);
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

function ScreenPanel({
	screen,
	expanded,
	onToggle,
	maxCollapsed = 15,
}: {
	screen: ScreenData;
	expanded: boolean;
	onToggle: () => void;
	maxCollapsed?: number;
}) {
	const elements = screen.elements ?? [];
	const visibleElements = expanded ? elements : elements.slice(0, maxCollapsed);

	return (
		<div className="mt-2 rounded-md border border-stone-200 bg-white px-2.5 py-2">
			<div className="flex flex-wrap items-center gap-1.5 text-[10px]">
				<Monitor className="h-3 w-3 text-blue-500" />
				{screen.packageName ? (
					<span className="font-medium text-blue-700">{screen.packageName}</span>
				) : null}
				{screen.activityName ? (
					<>
						<span className="text-stone-300">&rsaquo;</span>
						<span className="font-medium text-violet-600">
							{screen.activityName.split('.').pop()}
						</span>
					</>
				) : null}
				<span className="text-stone-300">&middot;</span>
				<span className="text-stone-400">
					{screen.elementCount ?? elements.length} element{(screen.elementCount ?? elements.length) !== 1 ? 's' : ''}
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
							onClick={onToggle}
						>
							{expanded
								? 'Show fewer elements'
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
	const [expandedScreens, setExpandedScreens] = useState<Set<number>>(new Set());
	const [screenData, setScreenData] = useState<Record<number, ScreenData | null>>({});
	const [screenLoading, setScreenLoading] = useState<Set<number>>(new Set());
	const [expandedElements, setExpandedElements] = useState<Set<string>>(new Set());

	const toggleElements = useCallback((key: string) => {
		setExpandedElements((prev) => {
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
		setExpandedScreens(new Set());
		setScreenData({});
		setScreenLoading(new Set());
		setExpandedElements(new Set());

		// Lock body scroll
		document.body.style.overflow = 'hidden';

		api.getGoalSteps(deviceId, runId, stepIdx)
			.then((data) => {
				setSteps((data.steps ?? []) as unknown as AgentStep[]);
				setStepsLoading(false);
			})
			.catch(() => {
				setSteps([]);
				setStepsLoading(false);
			});

		return () => { document.body.style.overflow = ''; };
	}, [open, deviceId, runId, stepIdx]);

	// Escape key handler
	useEffect(() => {
		if (!open) return;
		const handler = (e: KeyboardEvent) => {
			if (e.key === 'Escape') onOpenChange(false);
		};
		window.addEventListener('keydown', handler);
		return () => window.removeEventListener('keydown', handler);
	}, [open, onOpenChange]);

	// Fetch screen data for a specific step
	const fetchScreen = useCallback(async (stepNumber: number) => {
		if (screenData[stepNumber] !== undefined || screenLoading.has(stepNumber)) return;

		setScreenLoading((prev) => new Set(prev).add(stepNumber));
		try {
			const data = await api.getStepScreen(deviceId, runId, stepIdx, stepNumber);
			setScreenData((prev) => ({ ...prev, [stepNumber]: data as unknown as ScreenData }));
		} catch {
			setScreenData((prev) => ({ ...prev, [stepNumber]: null }));
		}
		setScreenLoading((prev) => {
			const next = new Set(prev);
			next.delete(stepNumber);
			return next;
		});
	}, [deviceId, runId, stepIdx, screenData, screenLoading]);

	const toggleScreen = useCallback((stepNumber: number) => {
		setExpandedScreens((prev) => {
			const next = new Set(prev);
			if (next.has(stepNumber)) {
				next.delete(stepNumber);
			} else {
				next.add(stepNumber);
				fetchScreen(stepNumber);
			}
			return next;
		});
	}, [fetchScreen]);

	if (!open) return null;

	return (
		<div className="fixed inset-0 z-50 flex flex-col bg-white">
			{/* Header */}
			<div className="flex shrink-0 items-center justify-between border-b border-stone-200 px-6 py-4">
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
					<div className="flex items-center gap-1.5 text-sm font-medium">
						<span className={stepResult.success ? 'text-emerald-700' : 'text-red-700'}>
							{stepResult.success ? (
								<CheckCircle2 className="mr-1 inline h-4 w-4" />
							) : (
								<XCircle className="mr-1 inline h-4 w-4" />
							)}
							{stepResult.success ? 'Succeeded' : 'Failed'}
						</span>
						{stepResult.stepsUsed !== undefined ? (
							<span className="ml-2 text-xs font-normal text-stone-400">
								{stepResult.stepsUsed} step{stepResult.stepsUsed !== 1 ? 's' : ''}
							</span>
						) : null}
						{stepResult.resolvedBy ? (
							<span className="ml-1 rounded bg-stone-100 px-1.5 py-0.5 text-[10px] font-medium text-stone-500">
								{stepResult.resolvedBy === 'cached_flow' ? 'cached' : stepResult.resolvedBy}
							</span>
						) : null}
					</div>
				</div>
				<Button variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)}>
					<X className="h-4 w-4" />
					<span className="sr-only">Close</span>
				</Button>
			</div>

			{/* Body */}
			<ScrollArea className="flex-1">
				<div className="mx-auto max-w-3xl space-y-6 px-6 py-6">
					{/* Goal text */}
					<div>
						<p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
							Goal
						</p>
						<GoalText text={stepResult.goal ?? config?.goal ?? stepResult.command ?? 'N/A'} />
					</div>

					{/* Configuration */}
					{config ? (
						<div>
							<p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
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
							</div>
						</div>
					) : null}

					{/* Error */}
					{stepResult.error || (stepResult.message && !stepResult.success) ? (
						<div>
							<p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-red-400">
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
						<p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-stone-400">
							Agent Journey
						</p>
						{stepsLoading ? (
							<div className="flex items-center gap-2 py-3 text-xs text-stone-400">
								<Loader2 className="h-4 w-4 animate-spin" />
								Loading steps...
							</div>
						) : steps.length > 0 ? (
							<div className="space-y-2">
								{steps.map((s) => {
									const act = parseAction(s.action);
									const isScreenExpanded = expandedScreens.has(s.step);
									const screen = screenData[s.step];
									const isScreenLoading = screenLoading.has(s.step);

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
															{act.scrollAmount ? ` x${act.scrollAmount}` : ''}
														</span>
													) : null}
												</div>
												<div className="ml-auto flex shrink-0 items-center gap-2">
													{s.durationMs ? (
														<span className="text-[9px] text-stone-300">
															{Math.round(s.durationMs / 1000)}s
														</span>
													) : null}
													{/* Screen toggle button */}
													<button
														className={cn(
															'flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[9px] transition-colors',
															isScreenExpanded
																? 'bg-blue-100 text-blue-600'
																: 'text-stone-400 hover:bg-stone-100 hover:text-stone-600',
														)}
														onClick={() => toggleScreen(s.step)}
													>
														<Monitor className="h-2.5 w-2.5" />
														{isScreenExpanded ? (
															<ChevronUp className="h-2 w-2" />
														) : (
															<ChevronDown className="h-2 w-2" />
														)}
													</button>
												</div>
											</div>
											{s.reasoning ? (
												<p className="mt-1 pl-8 text-xs leading-relaxed text-stone-500">
													{s.reasoning}
												</p>
											) : null}
											{s.result ? (
												<p className="mt-0.5 pl-8 text-xs text-stone-400">
													&rarr; {s.result}
												</p>
											) : null}
											{s.package ? (
												<span className="mt-0.5 ml-8 inline-flex items-center gap-0.5 text-[10px] text-stone-400">
													<Package className="h-2.5 w-2.5" />
													{s.package}
												</span>
											) : null}

											{/* Inline screen observation */}
											{isScreenExpanded ? (
												<div className="mt-2 ml-8">
													{isScreenLoading ? (
														<div className="flex items-center gap-1.5 py-2 text-[10px] text-stone-400">
															<Loader2 className="h-3 w-3 animate-spin" />
															Loading screen...
														</div>
													) : screen ? (
														<ScreenPanel
															screen={screen}
															expanded={expandedElements.has(`screen-${s.step}`)}
															onToggle={() => toggleElements(`screen-${s.step}`)}
														/>
													) : (
														<p className="py-1 text-[10px] text-stone-400">No screen data available for this step.</p>
													)}
												</div>
											) : null}
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
		</div>
	);
}
