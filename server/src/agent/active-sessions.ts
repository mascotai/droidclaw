/**
 * Shared active-session tracker for the agent pipeline.
 *
 * Both the device WebSocket handler (device.ts) and the HTTP goals
 * handler (goals.ts) register/look-up running sessions here so that
 * a stop request from *either* path can find and abort the session.
 */

export interface ActiveSession {
  sessionId?: string;
  goal: string;
  abort: AbortController;
  /**
   * When set, indicates the device disconnected (not a user-initiated stop).
   * Workflows can wait for reconnection instead of terminating immediately.
   */
  deviceDisconnected?: boolean;
}

const activeSessions = new Map<string, ActiveSession>();

export { activeSessions };
