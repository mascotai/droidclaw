import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ErrorAlertProps {
	title?: string;
	message: string;
	onRetry?: (() => void) | null;
	className?: string;
}

export function ErrorAlert({
	title = 'Something went wrong',
	message,
	onRetry = null,
	className,
}: ErrorAlertProps) {
	return (
		<Alert className={cn('border-red-200 bg-red-50', className)}>
			<AlertTriangle className="h-5 w-5 text-red-600" />
			<AlertTitle className="text-red-800">{title}</AlertTitle>
			<AlertDescription className="text-red-700">{message}</AlertDescription>
			{onRetry ? (
				<Button
					variant="outline"
					size="sm"
					onClick={onRetry}
					className="mt-2 gap-1.5 border-red-200 text-red-700 hover:bg-red-100"
				>
					<RefreshCw className="h-3.5 w-3.5" />
					Retry
				</Button>
			) : null}
		</Alert>
	);
}
