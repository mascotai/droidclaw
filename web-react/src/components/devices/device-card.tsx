import { Link } from '@tanstack/react-router';
import {
	Smartphone,
	BatteryCharging,
	BatteryFull,
	BatteryMedium,
	BatteryLow,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusBadge, TimeAgo } from '@/components/shared';
import { DEVICE_CARD_CLICK } from '@/lib/analytics/events';
import type { DeviceInfo } from '@/lib/api';

interface DeviceCardProps {
	device: DeviceInfo;
}

function batteryIcon(level: number | null, charging: boolean) {
	if (level === null || level < 0 || charging) return BatteryCharging;
	if (level > 75) return BatteryFull;
	if (level > 50) return BatteryMedium;
	return BatteryLow;
}

function sanitizeGoalText(text: string): string {
	const credentialPatterns = /\b(type\s*'|password|secret|token|credential|api.?key)\b.*/gi;
	let safe = text.replace(credentialPatterns, '***');
	if (safe.length > 60) safe = safe.slice(0, 60) + '\u2026';
	return safe;
}

export function DeviceCard({ device }: DeviceCardProps) {
	const {
		deviceId, name, status, model, manufacturer, androidVersion,
		batteryLevel, isCharging, screenWidth, screenHeight, lastSeen, lastGoal,
	} = device;

	const BatteryIcon = batteryIcon(batteryLevel, isCharging);

	return (
		<Link
			to="/dashboard/devices/$deviceId"
			params={{ deviceId }}
			aria-label={model ?? name}
			data-umami-event={DEVICE_CARD_CLICK}
			data-umami-event-device={model ?? name}
			className="group block transition-all duration-200 hover:scale-[1.01] hover:shadow-md active:scale-[0.98]"
		>
			<Card className="flex flex-col overflow-hidden">
				<CardHeader className="pb-3">
					<div className="flex items-center justify-between">
						<StatusBadge status={status} size="sm" />
						{batteryLevel !== null && batteryLevel >= 0 ? (
							<Badge
								variant="outline"
								className={`gap-1 text-xs ${batteryLevel <= 20 ? 'border-red-200 bg-red-50 text-red-600' : 'text-stone-500'}`}
							>
								<BatteryIcon className="h-3.5 w-3.5" />
								{batteryLevel}%
							</Badge>
						) : null}
					</div>
				</CardHeader>

				<CardContent className="flex-1 space-y-4">
					{/* Device info */}
					<div className="flex items-center gap-3">
						<div
							className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${status === 'online' ? 'bg-emerald-100' : 'bg-stone-100'}`}
						>
							<Smartphone
								className={`h-5 w-5 ${status === 'online' ? 'text-emerald-600' : 'text-stone-400'}`}
							/>
						</div>
						<div className="min-w-0">
							<CardTitle className="truncate text-sm">{model ?? name}</CardTitle>
							{manufacturer ? (
								<CardDescription className="text-xs">{manufacturer}</CardDescription>
							) : null}
						</div>
					</div>

					{/* Specs */}
					<div className="flex flex-wrap items-center gap-1.5">
						{androidVersion ? (
							<Badge variant="secondary" className="text-xs font-normal">
								Android {androidVersion}
							</Badge>
						) : null}
						{screenWidth && screenHeight ? (
							<Badge variant="secondary" className="text-xs font-normal">
								{screenWidth}&times;{screenHeight}
							</Badge>
						) : null}
						{lastSeen ? (
							<span className="ml-auto text-xs text-stone-400">
								<TimeAgo date={lastSeen} />
							</span>
						) : null}
					</div>
				</CardContent>

				{/* Last goal */}
				<CardFooter className="flex-col items-stretch border-t border-stone-100 pt-3">
					{lastGoal ? (
						<>
							<p className="truncate text-xs text-stone-500">
								{sanitizeGoalText(lastGoal.goal)}
							</p>
							<div className="mt-1 flex items-center justify-between">
								<StatusBadge status={lastGoal.status} size="sm" />
								<TimeAgo date={lastGoal.startedAt} />
							</div>
						</>
					) : (
						<p className="text-xs text-stone-400">No goals yet</p>
					)}
				</CardFooter>
			</Card>
		</Link>
	);
}
