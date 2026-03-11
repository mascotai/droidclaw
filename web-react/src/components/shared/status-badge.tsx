import { useMemo } from 'react';
import {
	CheckCircle2,
	XCircle,
	Loader2,
	Clock,
	Square,
	Zap,
	Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatusBadgeProps {
	status: string;
	/** Show pulsing dot for live statuses (running, online) */
	pulse?: boolean;
	/** Size variant */
	size?: 'sm' | 'default';
	className?: string;
}

const statusConfig: Record<string, { label: string; colorClass: string; dotClass: string; Icon: typeof CheckCircle2 }> = {
	online: { label: 'Online', colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200', dotClass: 'bg-emerald-500', Icon: CheckCircle2 },
	offline: { label: 'Offline', colorClass: 'bg-stone-100 text-stone-500 border-stone-200', dotClass: 'bg-stone-400', Icon: XCircle },
	completed: { label: 'Completed', colorClass: 'bg-emerald-50 text-emerald-700 border-emerald-200', dotClass: 'bg-emerald-500', Icon: CheckCircle2 },
	running: { label: 'Running', colorClass: 'bg-violet-50 text-violet-700 border-violet-200', dotClass: 'bg-violet-500', Icon: Loader2 },
	failed: { label: 'Failed', colorClass: 'bg-red-50 text-red-700 border-red-200', dotClass: 'bg-red-500', Icon: XCircle },
	stopped: { label: 'Stopped', colorClass: 'bg-stone-100 text-stone-500 border-stone-200', dotClass: 'bg-stone-400', Icon: Square },
	pending: { label: 'Pending', colorClass: 'bg-stone-50 text-stone-500 border-stone-200', dotClass: 'bg-stone-300', Icon: Clock },
	queued: { label: 'Queued', colorClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500', Icon: Clock },
	cached: { label: 'Cached', colorClass: 'bg-cyan-50 text-cyan-700 border-cyan-200', dotClass: 'bg-cyan-500', Icon: Zap },
};

const defaultConfig = { label: '', colorClass: 'bg-stone-100 text-stone-600 border-stone-200', dotClass: 'bg-stone-400', Icon: Info };

export function StatusBadge({ status, pulse, size = 'default', className }: StatusBadgeProps) {
	const config = useMemo(() => {
		const s = status.toLowerCase();
		return statusConfig[s] ?? { ...defaultConfig, label: status };
	}, [status]);

	const showPulse = pulse ?? (status === 'running' || status === 'online');
	const sizeClass = size === 'sm' ? 'text-xs px-1.5 py-0' : 'text-xs px-2.5 py-0.5';

	return (
		<span
			className={cn(
				'inline-flex items-center gap-1.5 rounded-full border font-medium transition-colors duration-300',
				config.colorClass,
				sizeClass,
				className,
			)}
		>
			{showPulse ? (
				<span className="relative flex h-1.5 w-1.5">
					<span className={cn('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', config.dotClass)} />
					<span className={cn('relative inline-flex h-1.5 w-1.5 rounded-full', config.dotClass)} />
				</span>
			) : (
				<config.Icon className="h-3 w-3" />
			)}
			{config.label}
		</span>
	);
}
