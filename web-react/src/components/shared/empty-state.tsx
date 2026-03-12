import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
	icon?: LucideIcon;
	title: string;
	description?: string;
	animate?: boolean;
	className?: string;
}

export function EmptyState({
	icon: Icon = Inbox,
	title,
	description,
	animate = false,
	className,
}: EmptyStateProps) {
	return (
		<div
			className={cn(
				'flex flex-col items-center justify-center rounded-xl border border-dashed border-stone-200 bg-white/50 px-6 py-12',
				className,
			)}
		>
			<div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-stone-100/80">
				<Icon
					className={cn('h-8 w-8 text-stone-300', animate && 'animate-bounce')}
				/>
			</div>
			<p className="text-sm font-medium text-stone-400">{title}</p>
			{description ? (
				<p className="mt-1 max-w-xs text-center text-sm text-stone-300">
					{description}
				</p>
			) : null}
		</div>
	);
}
