import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { AgentStep } from '@/lib/api';
import { useCallback, useState } from 'react';
import { useWsSubscription } from '@/hooks/use-websocket';
import type { WsMessage, StepEvent, GoalCompletedEvent } from '@/stores/websocket';
import {
	Send,
	Square,
	ChevronDown,
	ChevronRight,
	CheckCircle2,
	XCircle,
	Clock,
	Loader2,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { track } from '@/lib/analytics/track';
import { DEVICE_GOAL_SUBMIT, DEVICE_GOAL_STOP } from '@/lib/analytics/events';

interface GoalsTabProps {
	deviceId: string;
	onGoalStarted?: (sessionId: string) => void;
}

export function GoalsTab({ deviceId, onGoalStarted }: GoalsTabProps) {
	const queryClient = useQueryClient();
	const [goal, setGoal] = useState('');
	const [liveSteps, setLiveSteps] = useState<StepEvent[]>([]);
	const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
	const [expandedSession, setExpandedSession] = useState<string | null>(null);
	const [page, setPage] = useState(1);

	const { data: sessions } = useQuery({
		queryKey: ['sessions', deviceId, page],
		queryFn: () => api.listSessions(deviceId, page),
	});

	const submitGoal = useMutation({
		mutationFn: () => api.submitGoal(deviceId, goal),
		onSuccess: (data) => {
			setGoal('');
			setLiveSteps([]);
			setActiveSessionId(data.sessionId);
			onGoalStarted?.(data.sessionId);
			queryClient.invalidateQueries({ queryKey: ['sessions', deviceId] });
		},
	});

	const stopGoal = useMutation({
		mutationFn: () => api.stopGoal(deviceId),
		onSuccess: () => {
			setActiveSessionId(null);
			queryClient.invalidateQueries({ queryKey: ['sessions', deviceId] });
		},
	});

	// Live agent steps
	useWsSubscription(
		['step', 'goal_completed'],
		useCallback(
			(msg: WsMessage) => {
				if (msg.type === 'step') {
					const step = msg as StepEvent;
					if (step.sessionId === activeSessionId) {
						setLiveSteps((prev) => [...prev, step]);
					}
				}
				if (msg.type === 'goal_completed') {
					const evt = msg as GoalCompletedEvent;
					if (evt.sessionId === activeSessionId) {
						setActiveSessionId(null);
						setLiveSteps([]);
						queryClient.invalidateQueries({ queryKey: ['sessions', deviceId] });
					}
				}
			},
			[activeSessionId, deviceId, queryClient],
		),
	);

	return (
		<div className="space-y-6">
			{/* Goal input */}
			<div className="rounded-xl border border-stone-200 bg-white p-6">
				<h3 className="text-sm font-semibold text-stone-900">Send a goal</h3>
				<div className="mt-3 flex gap-3">
					<input
						type="text"
						value={goal}
						onChange={(e) => setGoal(e.target.value)}
						placeholder="e.g., Open Settings and turn on WiFi"
						className="flex-1 rounded-lg border border-stone-300 px-3 py-2 text-sm focus:border-violet-500 focus:ring-violet-500"
						onKeyDown={(e) => {
							if (e.key === 'Enter' && goal.trim()) {
								track(DEVICE_GOAL_SUBMIT);
								submitGoal.mutate();
							}
						}}
					/>
					{activeSessionId ? (
						<button
							onClick={() => {
								track(DEVICE_GOAL_STOP);
								stopGoal.mutate();
							}}
							className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
						>
							<Square className="h-4 w-4" />
							Stop
						</button>
					) : (
						<button
							onClick={() => {
								if (goal.trim()) {
									track(DEVICE_GOAL_SUBMIT);
									submitGoal.mutate();
								}
							}}
							disabled={!goal.trim() || submitGoal.isPending}
							className="flex items-center gap-2 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-800 disabled:opacity-50"
						>
							<Send className="h-4 w-4" />
							Send
						</button>
					)}
				</div>
			</div>

			{/* Live agent steps */}
			{activeSessionId && liveSteps.length > 0 && (
				<div className="rounded-xl border border-violet-200 bg-violet-50 p-6">
					<div className="flex items-center gap-2">
						<Loader2 className="h-4 w-4 animate-spin text-violet-600" />
						<h3 className="text-sm font-semibold text-violet-900">Live progress</h3>
					</div>
					<div className="mt-3 space-y-2">
						{liveSteps.map((step, i) => (
							<div
								key={i}
								className="rounded-lg bg-white px-3 py-2 text-sm shadow-sm"
							>
								<div className="flex items-center justify-between">
									<span className="font-medium text-stone-700">
										Step {step.step}:{' '}
										{(step.action as Record<string, unknown>).action as string || 'action'}
									</span>
								</div>
								{step.reasoning && (
									<p className="mt-1 text-xs text-stone-500">{step.reasoning}</p>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			{/* Session history */}
			<div className="rounded-xl border border-stone-200 bg-white p-6">
				<h3 className="text-sm font-semibold text-stone-900">Goal history</h3>
				{sessions?.items && sessions.items.length > 0 ? (
					<div className="mt-3 space-y-2">
						{sessions.items.map((session) => (
							<SessionRow
								key={session.id}
								session={session}
								deviceId={deviceId}
								expanded={expandedSession === session.id}
								onToggle={() =>
									setExpandedSession(
										expandedSession === session.id ? null : session.id,
									)
								}
							/>
						))}

						{/* Pagination */}
						{sessions.total > 20 && (
							<div className="flex items-center justify-between pt-4">
								<button
									onClick={() => setPage((p) => Math.max(1, p - 1))}
									disabled={page === 1}
									className="text-sm text-stone-500 hover:text-stone-700 disabled:opacity-50"
								>
									Previous
								</button>
								<span className="text-sm text-stone-400">
									Page {page} of {Math.ceil(sessions.total / 20)}
								</span>
								<button
									onClick={() => setPage((p) => p + 1)}
									disabled={page * 20 >= sessions.total}
									className="text-sm text-stone-500 hover:text-stone-700 disabled:opacity-50"
								>
									Next
								</button>
							</div>
						)}
					</div>
				) : (
					<p className="mt-3 text-sm text-stone-400">No goals run yet</p>
				)}
			</div>
		</div>
	);
}

function SessionRow({
	session,
	deviceId,
	expanded,
	onToggle,
}: {
	session: { id: string; goal: string; status: string; stepsUsed: number | null; startedAt: string; completedAt: string | null };
	deviceId: string;
	expanded: boolean;
	onToggle: () => void;
}) {
	const { data: steps } = useQuery({
		queryKey: ['sessionSteps', deviceId, session.id],
		queryFn: () => api.listSessionSteps(deviceId, session.id),
		enabled: expanded,
	});

	const statusIcon =
		session.status === 'completed' ? (
			<CheckCircle2 className="h-4 w-4 text-emerald-500" />
		) : session.status === 'failed' ? (
			<XCircle className="h-4 w-4 text-red-500" />
		) : session.status === 'running' ? (
			<Loader2 className="h-4 w-4 animate-spin text-violet-500" />
		) : (
			<Clock className="h-4 w-4 text-stone-400" />
		);

	return (
		<div className="rounded-lg border border-stone-100">
			<button
				onClick={onToggle}
				className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
			>
				{expanded ? (
					<ChevronDown className="h-4 w-4 text-stone-400" />
				) : (
					<ChevronRight className="h-4 w-4 text-stone-400" />
				)}
				{statusIcon}
				<span className="flex-1 truncate text-sm text-stone-700">
					{session.goal}
				</span>
				<span className="text-xs text-stone-400">
					{session.stepsUsed ?? 0} steps
				</span>
				<span className="text-xs text-stone-400">
					{formatDistanceToNow(new Date(session.startedAt), { addSuffix: true })}
				</span>
			</button>

			{expanded && steps && (
				<div className="border-t border-stone-100 px-3 py-2">
					<div className="space-y-1.5">
						{steps.map((step: AgentStep) => (
							<StepRow key={step.id} step={step} />
						))}
					</div>
				</div>
			)}
		</div>
	);
}

function StepRow({ step }: { step: AgentStep }) {
	const action = step.action as Record<string, unknown> | null;
	const actionName = action?.action as string || 'unknown';

	return (
		<div className="rounded bg-stone-50 px-2.5 py-1.5 text-xs">
			<div className="flex items-center justify-between">
				<span className="font-medium text-stone-700">
					{step.stepNumber}. {actionName}
				</span>
				{step.durationMs && (
					<span className="text-stone-400">{step.durationMs}ms</span>
				)}
			</div>
			{step.reasoning && (
				<p className="mt-0.5 text-stone-500">{step.reasoning}</p>
			)}
			{step.result && step.result !== 'success' && (
				<p className="mt-0.5 text-amber-600">{step.result}</p>
			)}
		</div>
	);
}
