import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocketStore } from '@/stores/websocket';
import type { WsMessage } from '@/stores/websocket';

/**
 * Connect WebSocket on mount and bridge events to TanStack Query invalidation.
 * Call this once in the dashboard layout.
 */
export function useWebSocket(sessionToken: string | undefined) {
	const connect = useWebSocketStore((s) => s.connect);
	const disconnect = useWebSocketStore((s) => s.disconnect);
	const subscribe = useWebSocketStore((s) => s.subscribe);
	const queryClient = useQueryClient();

	useEffect(() => {
		if (!sessionToken) return;

		connect(sessionToken);

		const unsub = subscribe((msg: WsMessage) => {
			switch (msg.type) {
				case 'reconnected':
					// Re-fetch everything on reconnect
					queryClient.invalidateQueries();
					break;
				case 'goal_started':
				case 'goal_completed':
					queryClient.invalidateQueries({ queryKey: ['sessions'] });
					queryClient.invalidateQueries({ queryKey: ['devices'] });
					break;
				case 'workflow_started':
				case 'workflow_step_done':
				case 'workflow_completed':
					queryClient.invalidateQueries({ queryKey: ['workflowRuns'] });
					queryClient.invalidateQueries({ queryKey: ['devices'] });
					break;
				case 'step':
					// Individual step events are consumed by LiveAgentSteps directly
					break;
			}
		});

		return () => {
			unsub();
			disconnect();
		};
	}, [sessionToken, connect, disconnect, subscribe, queryClient]);
}

/**
 * Subscribe to specific WebSocket message types.
 * Returns nothing — callback is called on matching messages.
 */
export function useWsSubscription(
	filter: string | string[],
	callback: (msg: WsMessage) => void,
) {
	const subscribe = useWebSocketStore((s) => s.subscribe);

	useEffect(() => {
		const types = Array.isArray(filter) ? filter : [filter];
		const unsub = subscribe((msg) => {
			if (types.includes(msg.type as string)) {
				callback(msg);
			}
		});
		return unsub;
	}, [filter, callback, subscribe]);
}
