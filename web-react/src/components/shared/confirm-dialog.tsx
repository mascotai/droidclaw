import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface ConfirmDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title?: string;
	description: string;
	confirmLabel?: string;
	cancelLabel?: string;
	variant?: 'destructive' | 'default';
	onConfirm: () => void;
	onCancel?: () => void;
}

export function ConfirmDialog({
	open,
	onOpenChange,
	title = 'Are you sure?',
	description,
	confirmLabel = 'Confirm',
	cancelLabel = 'Cancel',
	variant = 'destructive',
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter className="flex gap-2 pt-4">
					<Button
						variant="outline"
						onClick={() => {
							onOpenChange(false);
							onCancel?.();
						}}
					>
						{cancelLabel}
					</Button>
					<Button
						variant={variant === 'destructive' ? 'destructive' : 'default'}
						onClick={() => {
							onOpenChange(false);
							onConfirm();
						}}
					>
						{confirmLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
