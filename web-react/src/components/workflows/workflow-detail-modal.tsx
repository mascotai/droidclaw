import { useState } from 'react';
import type { Workflow } from '@/types/devices';
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogFooter,
} from '@/components/ui/dialog';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { WorkflowGraph } from './workflow-graph';
import { WorkflowStepsList } from './workflow-steps-list';
import { Pencil, Trash2, Variable, LayoutGrid, List } from 'lucide-react';

interface WorkflowDetailModalProps {
	workflow: Workflow | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onEdit: (workflow: Workflow) => void;
	onDelete: (workflowId: string) => void;
}

export function WorkflowDetailModal({
	workflow,
	open,
	onOpenChange,
	onEdit,
	onDelete,
}: WorkflowDetailModalProps) {
	const [view, setView] = useState<'graph' | 'steps'>('graph');
	const [confirmDelete, setConfirmDelete] = useState(false);

	if (!workflow) return null;

	const varCount = workflow.variables ? Object.keys(workflow.variables).length : 0;

	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				if (!o) {
					setConfirmDelete(false);
					setView('graph');
				}
				onOpenChange(o);
			}}
		>
			<DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
				<DialogHeader>
					<DialogTitle>{workflow.name}</DialogTitle>
					<DialogDescription>
						{workflow.steps.length} {workflow.steps.length === 1 ? 'step' : 'steps'}
						{varCount > 0 && (
							<>
								{' \u00b7 '}
								<Variable className="inline h-3 w-3" /> {varCount} var{varCount !== 1 ? 's' : ''}
							</>
						)}
					</DialogDescription>
				</DialogHeader>

				{/* View toggle */}
				<div className="flex justify-center">
					<ToggleGroup
						type="single"
						value={view}
						onValueChange={(val) => {
							if (val) setView(val as 'graph' | 'steps');
						}}
						variant="outline"
						size="sm"
					>
						<ToggleGroupItem value="graph" className="gap-1.5 px-3">
							<LayoutGrid className="h-3.5 w-3.5" />
							Graph
						</ToggleGroupItem>
						<ToggleGroupItem value="steps" className="gap-1.5 px-3">
							<List className="h-3.5 w-3.5" />
							Steps
						</ToggleGroupItem>
					</ToggleGroup>
				</div>

				{/* Content area */}
				<div className="flex-1 overflow-y-auto min-h-0 py-2">
					{view === 'graph' ? (
						<WorkflowGraph steps={workflow.steps} />
					) : (
						<WorkflowStepsList
							steps={workflow.steps}
							variables={workflow.variables}
						/>
					)}
				</div>

				{/* Footer with actions */}
				<DialogFooter>
					{confirmDelete ? (
						<div className="flex items-center gap-2 mr-auto">
							<button
								onClick={() => {
									onDelete(workflow.id);
									onOpenChange(false);
								}}
								className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
							>
								Confirm delete
							</button>
							<button
								onClick={() => setConfirmDelete(false)}
								className="rounded-lg px-3 py-1.5 text-xs text-stone-500 hover:bg-stone-100"
							>
								Cancel
							</button>
						</div>
					) : (
						<button
							onClick={() => setConfirmDelete(true)}
							className="mr-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-stone-400 hover:text-red-500 hover:bg-red-50"
						>
							<Trash2 className="h-3.5 w-3.5" />
							Delete
						</button>
					)}
					<button
						onClick={() => {
							onEdit(workflow);
							onOpenChange(false);
						}}
						className="flex items-center gap-1.5 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800"
					>
						<Pencil className="h-3.5 w-3.5" />
						Edit
					</button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
