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
			<DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] overflow-y-auto">
				<DialogHeader>
					<DialogTitle>New Workflow Run</DialogTitle>
				</DialogHeader>
				<WorkflowBuilder
					onSubmit={onSubmit}
					onStop={() => {}}
					isRunning={isPending}
					disabled={isPending}
				/>
			</DialogContent>
		</Dialog>
	);
}
