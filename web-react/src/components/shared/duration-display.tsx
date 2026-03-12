import { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface DurationDisplayProps {
	ms: number;
	className?: string;
}

export function DurationDisplay({ ms, className }: DurationDisplayProps) {
	const display = useMemo(() => {
		if (ms < 0) return '\u2014'; // em-dash
		const secs = Math.floor(ms / 1000);
		if (secs < 60) return `${secs}s`;
		const mins = Math.floor(secs / 60);
		const remSecs = secs % 60;
		if (mins < 60) return `${mins}m${remSecs > 0 ? `${remSecs}s` : ''}`;
		const hrs = Math.floor(mins / 60);
		const remMins = mins % 60;
		return `${hrs}h${remMins > 0 ? `${remMins}m` : ''}`;
	}, [ms]);

	return <span className={cn(className)}>{display}</span>;
}
