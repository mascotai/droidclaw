import { useState, useMemo, useCallback } from 'react';
import { History, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared';
import { WorkflowRunRow } from '@/components/workflows/workflow-run-row';
import { StepDetailModal } from '@/components/goals/step-detail-modal';
import type {
	WorkflowRun,
	WorkflowLiveProgress,
	StepResult,
	WorkflowStepConfig,
	Step,
} from '@/types/devices';

interface UnifiedLogProps {
	runs: WorkflowRun[];
	liveProgress: Record<string, WorkflowLiveProgress>;
	loaded: boolean;
	page: number;
	totalPages: number;
	onPageChange: (page: number) => void;
	loadSessionSteps: (sessionId: string) => Promise<Step[]>;
}

function getStepConfig(run: WorkflowRun, stepIdx: number): WorkflowStepConfig | null {
	const step = run.steps?.[stepIdx];
	if (!step) return null;
	if (typeof step === 'string') return { goal: step };
	if (typeof step === 'object' && 'goal' in step) return step as WorkflowStepConfig;
	const [cmd, val] = Object.entries(step)[0] ?? [];
	return cmd ? { goal: `${cmd}: ${val}` } : null;
}

export function UnifiedLog({
	runs,
	liveProgress,
	loaded,
	page,
	totalPages,
	onPageChange,
	loadSessionSteps,
}: UnifiedLogProps) {
	const [filter, setFilter] = useState<string>('all');
	const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

	// Step detail modal state
	const [modalData, setModalData] = useState<{
		stepIdx: number;
		stepResult: StepResult;
		config: WorkflowStepConfig | null;
	} | null>(null);
	const [modalSteps, setModalSteps] = useState<Step[]>([]);
	const [modalStepsLoading, setModalStepsLoading] = useState(false);

	const filteredRuns = useMemo(() => {
		if (filter === 'all') return runs;
		if (filter === 'single') return runs.filter((r) => r.totalSteps === 1);
		return runs.filter((r) => r.totalSteps > 1);
	}, [runs, filter]);

	function toggleExpand(runId: string) {
		setExpandedRunId((prev) => (prev === runId ? null : runId));
	}

	const handleStepClick = useCallback(
		async (run: WorkflowRun, stepIdx: number) => {
			const stepResult = (run.stepResults as StepResult[] | null)?.[stepIdx];
			if (!stepResult) return;
			const config = getStepConfig(run, stepIdx);
			setModalData({ stepIdx, stepResult, config });
			setModalSteps([]);
			setModalStepsLoading(false);

			if (stepResult.sessionId) {
				setModalStepsLoading(true);
				try {
					const steps = await loadSessionSteps(stepResult.sessionId);
					setModalSteps(steps);
				} catch {
					// ignore
				}
				setModalStepsLoading(false);
			}
		},
		[loadSessionSteps],
	);

	function closeModal() {
		setModalData(null);
		setModalSteps([]);
	}

	return (
		<div>
			{/* Header with tabs filter */}
			<div className="mb-4 flex items-center justify-between">
				<div className="flex items-center gap-2">
					<History className="h-4 w-4 text-stone-400" />
					<p className="text-sm font-medium text-stone-700">Run History</p>
				</div>
				<Tabs defaultValue="all" onValueChange={(val) => setFilter(val as string)}>
					<TabsList className="h-8">
						<TabsTrigger value="all" className="px-2.5 py-1 text-xs">All</TabsTrigger>
						<TabsTrigger value="single" className="px-2.5 py-1 text-xs">Single</TabsTrigger>
						<TabsTrigger value="multi" className="px-2.5 py-1 text-xs">Multi</TabsTrigger>
					</TabsList>
				</Tabs>
			</div>

			{/* Content */}
			{!loaded ? (
				<div className="space-y-3">
					{[1, 2, 3].map((i) => (
						<Skeleton key={i} className="h-20 w-full rounded-2xl" />
					))}
				</div>
			) : filteredRuns.length === 0 ? (
				<>
					<EmptyState
						title={
							filter === 'all'
								? 'No workflow runs yet.'
								: `No ${filter === 'single' ? 'single-step' : 'multi-step'} runs found.`
						}
					/>
					{filter !== 'all' ? (
						<div className="mt-2 text-center">
							<Button variant="link" size="sm" onClick={() => setFilter('all')}>
								Show all runs
							</Button>
						</div>
					) : null}
				</>
			) : (
				<>
					<div className="space-y-2">
						{filteredRuns.map((run) => (
							<WorkflowRunRow
								key={run.id}
								run={run}
								liveProgress={liveProgress[run.id]}
								onExpand={toggleExpand}
								onStepClick={handleStepClick}
								expanded={expandedRunId === run.id}
							/>
						))}
					</div>

					{/* Pagination */}
					{totalPages > 1 ? (
						<div className="mt-4 flex items-center justify-center gap-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => onPageChange(page - 1)}
								disabled={page <= 1}
								className="gap-1 text-xs"
							>
								<ChevronLeft className="h-3.5 w-3.5" />
								Prev
							</Button>
							<span className="text-xs text-stone-400">
								Page {page} of {totalPages}
							</span>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => onPageChange(page + 1)}
								disabled={page >= totalPages}
								className="gap-1 text-xs"
							>
								Next
								<ChevronRight className="h-3.5 w-3.5" />
							</Button>
						</div>
					) : null}
				</>
			)}

			{/* Step detail sheet */}
			{modalData ? (
				<StepDetailModal
					data={modalData}
					steps={modalSteps}
					stepsLoading={modalStepsLoading}
					onClose={closeModal}
				/>
			) : null}
		</div>
	);
}
