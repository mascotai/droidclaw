import { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface ActionBadgeProps {
	action: string;
	className?: string;
}

export function ActionBadge({ action, className }: ActionBadgeProps) {
	const colorClass = useMemo(() => {
		const a = action.toLowerCase();
		if (a === 'tap' || a.startsWith('tap')) return 'bg-blue-100 text-blue-700';
		if (a === 'type' || a.startsWith('type')) return 'bg-violet-100 text-violet-700';
		if (a === 'swipe' || a === 'scroll' || a.startsWith('swipe') || a.startsWith('scroll')) return 'bg-amber-100 text-amber-700';
		if (a === 'back' || a === 'home' || a.startsWith('back') || a.startsWith('home')) return 'bg-stone-200 text-stone-600';
		if (a === 'done' || a.startsWith('done')) return 'bg-emerald-100 text-emerald-700';
		if (a === 'wait' || a.startsWith('wait')) return 'bg-cyan-100 text-cyan-700';
		if (a === 'long_press' || a === 'longpress' || a.startsWith('long_press') || a.startsWith('longpress')) return 'bg-pink-100 text-pink-700';
		if (a === 'launch' || a.startsWith('launch')) return 'bg-indigo-100 text-indigo-700';
		return 'bg-stone-100 text-stone-600';
	}, [action]);

	return (
		<span
			className={cn(
				'shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide',
				colorClass,
				className,
			)}
		>
			{action}
		</span>
	);
}
