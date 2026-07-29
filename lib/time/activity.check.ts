// Self-check for the activity timeline — run: npx tsx lib/time/activity.check.ts
// No framework (ponytail): plain asserts, fixed "now".
import assert from 'node:assert';
import { buildSegments, totalsOf, type ActivityMark } from './activity';

const T = Date.parse('2026-07-28T10:00:00Z');
const m = (min: number, state: ActivityMark['state']): ActivityMark => ({ t: T + min * 60_000, state });

// Open last segment runs to `now`, totals add up to the observed window.
{
  const segs = buildSegments([m(0, 'active'), m(10, 'away'), m(25, 'active'), m(40, 'idle')], T + 60 * 60_000);
  assert.equal(segs.length, 4);
  assert.equal(segs[3].end, T + 60 * 60_000, 'last segment must extend to now');
  const t = totalsOf(segs);
  assert.equal(t.active / 60_000, 25, 'active = 0-10 + 25-40');
  assert.equal(t.away / 60_000, 15);
  assert.equal(t.idle / 60_000, 20);
  assert.equal((t.active + t.idle + t.away) / 60_000, 60, 'segments must tile the window with no gaps');
}

// A just-pushed mark (zero length) is dropped rather than rendered as a sliver.
{
  const segs = buildSegments([m(0, 'active'), m(5, 'idle')], T + 5 * 60_000);
  assert.equal(segs.length, 1);
  assert.equal(segs[0].state, 'active');
}

// Empty marks (no session) yields nothing.
assert.deepEqual(buildSegments([], T), []);

console.log('activity.check.ts OK');
