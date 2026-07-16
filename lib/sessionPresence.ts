// Presence rules for an active work session, derived from its heartbeat.
// Pure + injectable clock so the UI (ActiveSessionAvatars) stays dumb and this
// stays testable without pulling react-native into node.

// useSmartTimer pulses every 30s but early-returns while the tab/app isn't
// visible, so a stale heartbeat means the worker has stepped away rather than
// that the timer died. 3 missed pulses before we call it.
export const IDLE_MS = 90 * 1000;

/** ms since the last heartbeat. Unknown heartbeat → 0, i.e. treated as active. */
export const idleMsOf = (lastHeartbeatAt?: string | null, now = Date.now()) =>
  lastHeartbeatAt ? Math.max(0, now - new Date(lastHeartbeatAt).getTime()) : 0;

export const isIdle = (lastHeartbeatAt?: string | null, now = Date.now()) =>
  idleMsOf(lastHeartbeatAt, now) > IDLE_MS;

export const idleLabel = (ms: number) => {
  const m = Math.floor(ms / 60000);
  return m < 60 ? `Idle ${m}m` : `Idle ${Math.floor(m / 60)}h ${m % 60}m`;
};
