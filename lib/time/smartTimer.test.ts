// Self-check for computeTimerAction — run: npx tsx lib/time/smartTimer.test.ts
// No framework (ponytail): plain asserts, fixed "now" so elapsed-time math is deterministic.
import assert from 'node:assert';
import { computeTimerAction, IDLE_TIMEOUT, SESSION_MAX_DURATION } from './smartTimer';

const START = Date.parse('2026-07-20T00:00:00Z');

// Backgrounded the whole session: idle-inactivity is not evaluated (grace for
// working in another app), but the 6h absolute cap still fires. This is the bug
// that let a session survive 5h+ backgrounded with no client-side stop.
{
  const now = START + SESSION_MAX_DURATION + 1;
  const r = computeTimerAction({ now, startedAt: START, lastActivityAt: START, isInForeground: false });
  assert.equal(r.isMaxSession, true, 'max-session cap must fire even while backgrounded');
  assert.equal(r.isForceStop, false, 'idle force-stop must not evaluate while backgrounded');
}

// Backgrounded, under the cap: nothing fires.
{
  const now = START + SESSION_MAX_DURATION - 1;
  const r = computeTimerAction({ now, startedAt: START, lastActivityAt: START, isInForeground: false });
  assert.equal(r.isMaxSession, false);
  assert.equal(r.isForceStop, false);
}

// Foregrounded and idle past the grace window: force-stop fires before the 6h cap.
{
  const now = START + IDLE_TIMEOUT + 2 * 60 * 1000 + 1;
  const r = computeTimerAction({ now, startedAt: START, lastActivityAt: START, isInForeground: true });
  assert.equal(r.isIdle, true);
  assert.equal(r.isForceStop, true);
  assert.equal(r.isMaxSession, false);
}

// Foregrounded, idle but still inside the 2-minute grace period after IDLE_TIMEOUT: modal shows, no stop yet.
{
  const now = START + IDLE_TIMEOUT + 1;
  const r = computeTimerAction({ now, startedAt: START, lastActivityAt: START, isInForeground: true });
  assert.equal(r.isIdle, true);
  assert.equal(r.isForceStop, false);
}

console.log('smartTimer: all checks passed');
