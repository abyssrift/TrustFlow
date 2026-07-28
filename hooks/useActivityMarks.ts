import { useCallback, useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';
import { IDLE_AFTER_MS, type ActivityMark, type ActivityState } from '@/lib/time/activity';

const POLL_MS = 5 * 1000;

const inForeground = () =>
  Platform.OS === 'web'
    ? typeof document === 'undefined' || document.visibilityState === 'visible'
    : AppState.currentState === 'active';

/**
 * Records active/idle/away transitions for the running session into a ref — no
 * state, so the provider (and every useTimer() consumer) never re-renders.
 * Readers poll getActivityMarks() on whatever tick they already have.
 *
 * ponytail: in-memory only, so the strip restarts on reload and managers can't
 * see it. Persist the marks in rpc_heartbeat_work if it needs to be auditable.
 */
export function useActivityMarks(
  isActive: boolean,
  startedAt: string | null,
  getLastActivityTime: () => number
) {
  const marksRef = useRef<ActivityMark[]>([]);

  useEffect(() => {
    if (!isActive || !startedAt) {
      marksRef.current = [];
      return;
    }

    // The session may predate this provider (page reload, session restored from
    // storage) — start the timeline at the later of the two so it only claims
    // the window it actually watched.
    marksRef.current = [{ t: Math.max(new Date(startedAt).getTime(), Date.now()), state: 'active' }];

    const push = (state: ActivityState, t: number) => {
      const marks = marksRef.current;
      const last = marks[marks.length - 1];
      if (!last || last.state === state) return;
      marks.push({ t: Math.max(t, last.t), state });
    };

    const evaluate = () => {
      const now = Date.now();
      // Backgrounded: visibilitychange/AppState fires on the edge, so `now` is exact.
      if (!inForeground()) return push('away', now);
      // Focused but no input: the gap actually began one threshold after the last
      // input, not when this poll happened to notice.
      // ponytail: on native only taps feed lastActivityTime (no mousemove), so
      // "idle" there means "no touches", same limitation the chip's label has.
      const idleSince = getLastActivityTime() + IDLE_AFTER_MS;
      if (now >= idleSince) push('idle', idleSince);
      else push('active', getLastActivityTime());
    };

    evaluate();
    const timer = setInterval(evaluate, POLL_MS);

    let appStateSub: ReturnType<typeof AppState.addEventListener> | null = null;
    let onVisibility: (() => void) | null = null;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      onVisibility = () => evaluate();
      document.addEventListener('visibilitychange', onVisibility);
    } else if (Platform.OS !== 'web') {
      appStateSub = AppState.addEventListener('change', evaluate);
    }

    return () => {
      clearInterval(timer);
      if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
      appStateSub?.remove();
    };
  }, [isActive, startedAt, getLastActivityTime]);

  return useCallback(() => marksRef.current, []);
}
