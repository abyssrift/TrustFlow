export const IDLE_TIMEOUT = 60 * 60 * 1000;        // 60 minutes of no activity
export const SESSION_MAX_DURATION = 6 * 60 * 60 * 1000; // 6 hours

// isInForeground only gates the inactivity grace period (user may be working in
// another app); the absolute session cap always applies, backgrounded or not —
// the 8h server-side sweep (fn_sweep_stale_work_sessions) assumes this fires at 6h.
export function computeTimerAction(params: {
  now: number;
  startedAt: number;
  lastActivityAt: number;
  isInForeground: boolean;
}): { isIdle: boolean; isForceStop: boolean; isMaxSession: boolean } {
  const { now, startedAt, lastActivityAt, isInForeground } = params;
  const isMaxSession = now - startedAt > SESSION_MAX_DURATION;

  if (!isInForeground) {
    return { isIdle: false, isForceStop: false, isMaxSession };
  }

  const elapsedSinceActivity = now - lastActivityAt;
  const isIdle = elapsedSinceActivity > IDLE_TIMEOUT;
  const isForceStop = isIdle && elapsedSinceActivity > IDLE_TIMEOUT + 2 * 60 * 1000;
  return { isIdle, isForceStop, isMaxSession };
}
