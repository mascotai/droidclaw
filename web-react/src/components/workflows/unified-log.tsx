import { useState } from 'react';
import { History, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared';
import { WorkflowRunRow } from '@/components/workflows/workflow-run-row';
import type { WorkflowRun, WorkflowLiveProgress } from '@/types/devices';

interface UnifiedLogProps {
	deviceId: string;
	runs: WorkflowRun[];
	liveProgress: Record<string, WorkflowLiveProgress>;
	loaded: boolean;
	page: number;
	totalPages: number;
	onPageChange: (page: number) => void;
}

export function UnifiedLog({
	deviceId,
	runs,
	liveProgress,
	loaded,
	page,
	totalPages,
	onPageChange,
}: UnifiedLogProps) {
	const [expandedRunId, setExpandedRunId] = useState<string | null>(null);

	function toggleExpand(runId: string) {
		setExpandedRunId((prev) => (prev === runId ? null : runId));
	}

	return (
		<div>
			{/* Header */}
			<div className="mb-4 flex items-center gap-2">
				<History className="h-4 w-4 text-stone-400" />
				<p className="text-sm font-medium text-stone-700">Run History</p>
			</div>

			{/* Content */}
			{!loaded ? (
				<div className="space-y-3">
					{[1, 2, 3].map((i) => (
						<Skeleton key={i} className="h-20 w-full rounded-2xl" />
					))}
				</div>
			) : runs.length === 0 ? (
				<EmptyState title="No workflow runs yet." />
			) : (
				<>
					<div className="space-y-2">
						{runs.map((run) => (
							<WorkflowRunRow
								key={run.id}
								run={run}
								deviceId={deviceId}
								liveProgress={liveProgress[run.id]}
								onExpand={toggleExpand}
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
		</div>
	);
}
