import { useState, useEffect, useMemo } from 'react';
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface TimeAgoProps {
	date: Date | string;
	/** Update interval in ms (default: 30000 = 30s) */
	interval?: number;
	className?: string;
}

function formatRelative(dateObj: Date, now: number): string {
	const diff = now - dateObj.getTime();
	const secs = Math.floor(diff / 1000);
	if (secs < 5) return 'just now';
	if (secs < 60) return `${secs}s ago`;
	const mins = Math.floor(secs / 60);
	if (mins < 60) return `${mins}m ago`;
	const hrs = Math.floor(mins / 60);
	if (hrs < 24) return `${hrs}h ago`;
	const days = Math.floor(hrs / 24);
	if (days < 30) return `${days}d ago`;
	const months = Math.floor(days / 30);
	return `${months}mo ago`;
}

export function TimeAgo({ date, interval = 30000, className }: TimeAgoProps) {
	const [now, setNow] = useState(Date.now());

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), interval);
		return () => clearInterval(timer);
	}, [interval]);

	const dateObj = useMemo(() => (date instanceof Date ? date : new Date(date)), [date]);
	const relative = formatRelative(dateObj, now);
	const absolute = dateObj.toLocaleString();

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger className={cn('cursor-default', className)}>
					<time dateTime={dateObj.toISOString()}>{relative}</time>
				</TooltipTrigger>
				<TooltipContent>
					<p>{absolute}</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}
