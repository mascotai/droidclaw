import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { WorkflowBuilder } from '@/components/workflows/workflow-builder';
import type { WorkflowStepConfig } from '@/types/devices';

interface WorkflowBuilderModalProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (steps: WorkflowStepConfig[], variables: Record<string, string>) => void;
	isPending?: boolean;
}

export function WorkflowBuilderModal({
	open,
	onOpenChange,
	onSubmit,
	isPending = false,
}: WorkflowBuilderModalProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] max-h-[90vh] flex flex-col overflow-hidden">
				<DialogHeader>
					<DialogTitle>New Workflow Run</DialogTitle>
				</DialogHeader>
				<div className="flex-1 overflow-y-auto">
					<WorkflowBuilder
						onSubmit={onSubmit}
						onStop={() => {}}
						isRunning={isPending}
						disabled={isPending}
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}
