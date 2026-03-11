import { create } from 'zustand';

const WS_URL = import.meta.env.VITE_WS_URL || 'ws://localhost:8080';

export interface StepEvent {
	type: 'step';
	sessionId: string;
	step: number;
	action: Record<string, unknown>;
	reasoning: string;
}

export interface GoalStartedEvent {
	type: 'goal_started';
	sessionId: string;
	goal: string;
	deviceId: string;
}

export interface GoalCompletedEvent {
	type: 'goal_completed';
	sessionId: string;
	success: boolean;
	stepsUsed: number;
}

export interface WorkflowStartedEvent {
	type: 'workflow_started';
	runId: string;
	name: string;
	wfType: string;
	totalSteps: number;
}

export interface WorkflowStepDoneEvent {
	type: 'workflow_step_done';
	runId: string;
	stepIndex: number;
	success: boolean;
	stepsUsed?: number;
}

export interface WorkflowCompletedEvent {
	type: 'workflow_completed';
	runId: string;
	success: boolean;
	stepResults: Array<{
		goal?: string;
		command?: string;
		success: boolean;
		stepsUsed?: number;
		message?: string;
		error?: string;
		observations?: Array<{ elements: unknown[]; packageName?: string }>;
	}>;
}

export interface ReconnectedEvent {
	type: 'reconnected';
}

export type WsMessage =
	| StepEvent
	| GoalStartedEvent
	| GoalCompletedEvent
	| WorkflowStartedEvent
	| WorkflowStepDoneEvent
	| WorkflowCompletedEvent
	| ReconnectedEvent
	| Record<string, unknown>;

type MessageHandler = (msg: WsMessage) => void;

interface WebSocketState {
	connected: boolean;
	handlers: Set<MessageHandler>;
	ws: WebSocket | null;
	sessionToken: string | null;
	hasConnectedBefore: boolean;
	reconnectTimer: ReturnType<typeof setTimeout> | null;

	connect: (sessionToken: string) => void;
	disconnect: () => void;
	subscribe: (handler: MessageHandler) => () => void;
}

export const useWebSocketStore = create<WebSocketState>((set, get) => {
	function doConnect() {
		const { sessionToken, ws } = get();
		if (!sessionToken) return;
		if (ws?.readyState === WebSocket.OPEN) return;

		let newWs: WebSocket;
		try {
			newWs = new WebSocket(`${WS_URL}/ws/dashboard`);
		} catch {
			scheduleReconnect();
			return;
		}

		newWs.onopen = () => {
			newWs.send(JSON.stringify({ type: 'auth', token: get().sessionToken }));
		};

		newWs.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data) as Record<string, unknown>;
				if (msg.type === 'auth_ok') {
					const isReconnect = get().hasConnectedBefore;
					set({ connected: true, hasConnectedBefore: true });
					if (isReconnect) {
						const { handlers } = get();
						for (const handler of handlers) {
							handler({ type: 'reconnected' });
						}
					}
					return;
				}
				if (msg.type === 'auth_error') {
					console.error('[DashboardWS] Auth failed:', msg.message);
					return;
				}
				const { handlers } = get();
				for (const handler of handlers) {
					handler(msg as WsMessage);
				}
			} catch {
				// ignore parse errors
			}
		};

		newWs.onclose = () => {
			set({ connected: false });
			scheduleReconnect();
		};

		newWs.onerror = () => {
			set({ connected: false });
		};

		set({ ws: newWs });
	}

	function scheduleReconnect() {
		const { reconnectTimer } = get();
		if (reconnectTimer) return;
		const timer = setTimeout(() => {
			set({ reconnectTimer: null });
			doConnect();
		}, 3000);
		set({ reconnectTimer: timer });
	}

	return {
		connected: false,
		handlers: new Set(),
		ws: null,
		sessionToken: null,
		hasConnectedBefore: false,
		reconnectTimer: null,

		connect(sessionToken: string) {
			set({ sessionToken });
			doConnect();
		},

		disconnect() {
			const { reconnectTimer, ws } = get();
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
			}
			if (ws) {
				ws.onclose = null;
				ws.close();
			}
			set({
				sessionToken: null,
				reconnectTimer: null,
				ws: null,
				connected: false,
			});
		},

		subscribe(handler: MessageHandler) {
			const { handlers } = get();
			handlers.add(handler);
			return () => {
				handlers.delete(handler);
			};
		},
	};
});
