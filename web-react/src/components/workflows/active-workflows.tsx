import { useState, useEffect, useRef } from 'react';
import { Zap, Play, Trash2, ArrowUp, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog, TimeAgo } from '@/components/shared';
import type { CachedFlowEntry } from '@/types/devices';
import { cn } from '@/lib/utils';

interface ActiveWorkflowsProps {
	flows: CachedFlowEntry[];
	loading: boolean;
	runningFlowId: string | null;
	onRun: (flow: CachedFlowEntry) => void;
	onDelete: (flowId: string) => void;
}

export function ActiveWorkflows({ flows, loading, runningFlowId = null, onRun, onDelete }: ActiveWorkflowsProps) {
	const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
	const [deleteFlowId, setDeleteFlowId] = useState<string | null>(null);
	const [newFlowIds, setNewFlowIds] = useState<Set<string>>(new Set());
	const knownFlowIdsRef = useRef<Set<string>>(new Set());

	// Detect newly added flows for glow animation
	useEffect(() => {
		const currentIds = new Set(flows.map((f) => f.id));
		const freshIds = new Set<string>();
		for (const id of currentIds) {
			if (!knownFlowIdsRef.current.has(id)) {
				freshIds.add(id);
			}
		}
		if (freshIds.size > 0) {
			setNewFlowIds(freshIds);
			const timer = setTimeout(() => setNewFlowIds(new Set()), 1500);
			return () => clearTimeout(timer);
		}
		knownFlowIdsRef.current = currentIds;
	}, [flows]);

	function confirmDelete(flowId: string) {
		setDeleteFlowId(flowId);
		setDeleteConfirmOpen(true);
	}

	function handleDeleteConfirm() {
		if (deleteFlowId) {
			onDelete(deleteFlowId);
			setDeleteFlowId(null);
		}
	}

	return (
		<>
			<Card>
				<CardHeader className="pb-2">
					<div className="flex items-center gap-2">
						<Zap className="h-4 w-4 text-cyan-500" />
						<CardTitle className="text-sm font-medium text-stone-700">Active Workflows</CardTitle>
						{flows.length > 0 ? (
							<Badge variant="outline" className="text-xs">{flows.length}</Badge>
						) : null}
					</div>
				</CardHeader>
				<CardContent>
					{loading ? (
						<div className="grid grid-cols-1 gap-3">
							{[1, 2].map((i) => (
								<div key={i} className="space-y-2 rounded-xl border border-stone-200 p-4">
									<Skeleton className="h-3.5 w-32" />
									<Skeleton className="h-2.5 w-20" />
								</div>
							))}
						</div>
					) : flows.length === 0 ? (
						<div className="rounded-xl border border-dashed border-stone-300 bg-white px-6 py-8 text-center">
							<Zap className="mx-auto mb-2 h-8 w-8 text-stone-300" />
							<p className="text-xs text-stone-400">
								Run workflows to discover new automations.<br />
								Successful tasks get saved here for instant replay.
							</p>
						</div>
					) : (
						<div className="grid grid-cols-1 gap-3">
							{flows.map((flow) =>
								runningFlowId === flow.id ? (
									<div
										key={flow.id}
										className="flex items-center justify-center rounded-xl border-2 border-dashed border-cyan-200 bg-cyan-50/30 px-4 py-6"
									>
										<div className="flex items-center gap-1.5 text-xs text-cyan-400">
											<ArrowUp className="h-3.5 w-3.5" />
											Running above
										</div>
									</div>
								) : (
									<Card
										key={flow.id}
										className={cn(
											'group border-cyan-200 bg-gradient-to-br from-cyan-50/50 to-white transition-all hover:shadow-md',
											newFlowIds.has(flow.id) && 'ring-2 ring-cyan-300 ring-offset-1',
										)}
									>
										<CardContent className="p-4">
											<div className="mb-2 flex items-start justify-between gap-2">
												<div className="min-w-0 flex-1">
													<p className="truncate text-xs font-medium text-stone-800">{flow.goalKey}</p>
													{flow.appPackage ? (
														<Badge variant="outline" className="mt-1 gap-0.5 border-blue-200 bg-blue-50 text-xs text-blue-600">
															<Package className="h-2.5 w-2.5" />
															{flow.appPackage}
														</Badge>
													) : null}
												</div>
												<Zap className="h-4 w-4 shrink-0 text-cyan-400" />
											</div>

											{/* Stats row */}
											<div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-stone-400">
												<span>{flow.stepCount} step{flow.stepCount !== 1 ? 's' : ''}</span>
												<span className="text-stone-200">&middot;</span>
												<span className="text-emerald-600">{flow.successCount ?? 0} hits</span>
												{(flow.failCount ?? 0) > 0 ? (
													<>
														<span className="text-stone-200">&middot;</span>
														<span className="text-red-500">{flow.failCount} fails</span>
													</>
												) : null}
												{flow.lastUsedAt ? (
													<>
														<span className="text-stone-200">&middot;</span>
														<TimeAgo date={flow.lastUsedAt} />
													</>
												) : null}
											</div>

											{/* Actions */}
											<div className="flex items-center gap-2">
												<Button
													size="sm"
													onClick={() => onRun(flow)}
													className="h-7 flex-1 gap-1.5 bg-cyan-600 text-xs hover:bg-cyan-500"
												>
													<Play className="h-3 w-3" />
													Run
												</Button>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => confirmDelete(flow.id)}
													title="Delete cached flow"
													className="h-7 w-7 text-stone-300 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
												>
													<Trash2 className="h-3.5 w-3.5" />
												</Button>
											</div>
										</CardContent>
									</Card>
								),
							)}
						</div>
					)}
				</CardContent>
			</Card>

			<ConfirmDialog
				open={deleteConfirmOpen}
				onOpenChange={setDeleteConfirmOpen}
				title="Delete cached flow?"
				description="This will remove the cached flow. The next run of this goal will use AI discovery instead of instant replay."
				confirmLabel="Delete"
				onConfirm={handleDeleteConfirm}
				onCancel={() => setDeleteFlowId(null)}
			/>
		</>
	);
}
