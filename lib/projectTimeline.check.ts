// Self-check for lib/projectTimeline.ts (Phase 10, #191).
// Run by `npm run check` (scripts/run-checks.mjs auto-discovers *.check.ts).
//
// What would break without it, in order of how badly it would lie to a user:
//   1. `hasProjection` accepting 'none'. §16.2 — the server refusing to
//      forecast must render as nothing at all, and that is one `!==` away from
//      drawing a bar to a date nobody computed.
//   2. `overrunDays` sign. Inverted, a project three weeks late reads "three
//      weeks early" in the one place the screen exists to show.
//   3. The axis silently excluding `now` or an overrun, which puts the today
//      line or the worst bar off-screen with no symptom but a wrong picture.

import assert from 'node:assert';
import {
  DAY_MS,
  actualSpan,
  axisTicks,
  compareTimelineRows,
  fraction,
  hasProjection,
  isThinProjection,
  msOf,
  overrunDays,
  overrunSpan,
  projectedAt,
  timelineDomain,
  type TimelineRow,
} from './projectTimeline';

const NOW = Date.parse('2026-08-04T00:00:00Z');
const day = (n: number) => new Date(NOW + n * DAY_MS).toISOString();
const ymd = (n: number) => new Date(NOW + n * DAY_MS).toISOString().slice(0, 10);

// ── Parsing ────────────────────────────────────────────────────────────────
assert.strictEqual(msOf(null), null);
assert.strictEqual(msOf(undefined), null);
assert.strictEqual(msOf(''), null);
assert.strictEqual(msOf('not a date'), null, 'garbage must not become epoch 0 and drag the axis to 1970');
assert.strictEqual(msOf('2026-08-04T00:00:00Z'), NOW);

// ── §16.2: 'none' means draw nothing ───────────────────────────────────────
const none: TimelineRow = { due_date: day(10), projected_end: ymd(40), projection_confidence: 'none' };
assert.strictEqual(hasProjection(none), false, "confidence 'none' must never draw a projection");
assert.strictEqual(overrunDays(none), null);
assert.strictEqual(overrunSpan(none, timelineDomain([none], NOW)), null);
assert.strictEqual(projectedAt(none, timelineDomain([none], NOW)), null);
// A missing/absent column (RPC without the projection migration) is also nothing.
assert.strictEqual(hasProjection({ due_date: day(10) }), false);
assert.strictEqual(hasProjection({ due_date: day(10), projection_confidence: 'ok' }), false, 'confidence without a date is not a projection');
assert.strictEqual(hasProjection({ projected_end: ymd(9), projection_confidence: 'ok' }), true);
// Anything unrecognised is treated as no forecast, not as a fact.
assert.strictEqual(hasProjection({ projected_end: ymd(9), projection_confidence: 'high' }), false);

// ── 'low' is a forecast, but a distinguishable one ─────────────────────────
const thin: TimelineRow = { due_date: day(5), projected_end: ymd(12), projection_confidence: 'low' };
assert.strictEqual(hasProjection(thin), true);
assert.strictEqual(isThinProjection(thin), true, "'low' must stay flaggable so it can be drawn dashed");
assert.strictEqual(isThinProjection({ ...thin, projection_confidence: 'ok' }), false);
assert.strictEqual(isThinProjection(none), false);

// ── Overrun: sign, and only when there is something to compare to ──────────
assert.strictEqual(overrunDays({ due_date: day(5), projected_end: ymd(12), projection_confidence: 'ok' }), 7, 'later than due = positive');
assert.strictEqual(overrunDays({ due_date: day(12), projected_end: ymd(5), projection_confidence: 'ok' }), -7, 'earlier than due = negative');
assert.strictEqual(overrunDays({ projected_end: ymd(5), projection_confidence: 'ok' }), null, 'no due date, nothing to overrun');

// ── Axis ───────────────────────────────────────────────────────────────────
const rows: TimelineRow[] = [
  { start_date: day(-30), due_date: day(-2) },                                             // overdue, behind today
  { start_date: day(0), due_date: day(20), projected_end: ymd(55), projection_confidence: 'ok' }, // overruns far ahead
  { due_date: day(6) },
];
const d = timelineDomain(rows, NOW);
assert.ok(d.startMs < NOW && NOW < d.endMs, 'today must always be inside the axis');
assert.ok(d.startMs < msOf(day(-30))!, 'the earliest start must be inside the axis, with padding');
assert.ok(d.endMs > msOf(ymd(55))!, 'the furthest overrun must be inside the axis, with padding');

// A 'none' projection must not stretch the axis to a date nobody will see.
const stretched = timelineDomain([{ due_date: day(1), projected_end: ymd(400), projection_confidence: 'none' }], NOW);
assert.ok(stretched.endMs < NOW + 100 * DAY_MS, "a suppressed projection must not widen the axis");

// Degenerate input still yields a usable, forward-looking window.
const empty = timelineDomain([], NOW);
assert.ok(empty.endMs - empty.startMs >= 14 * DAY_MS, 'no rows must still give a fortnight of axis');
assert.ok(empty.startMs < NOW && NOW < empty.endMs);
const single = timelineDomain([{ due_date: day(0), start_date: day(0) }], NOW);
assert.ok(single.endMs - single.startMs >= 14 * DAY_MS, 'one same-day project must not zoom the axis to zero');

// ── fraction: monotonic, clamped, safe on a collapsed domain ───────────────
assert.strictEqual(fraction(d.startMs, d), 0);
assert.strictEqual(fraction(d.endMs, d), 1);
assert.strictEqual(fraction(d.startMs - 999 * DAY_MS, d), 0, 'must clamp, not go negative');
assert.strictEqual(fraction(d.endMs + 999 * DAY_MS, d), 1);
assert.ok(fraction(NOW, d) > 0 && fraction(NOW, d) < 1);
assert.ok(fraction(NOW, d) < fraction(NOW + DAY_MS, d), 'later dates must sit further right');
assert.strictEqual(fraction(NOW, { startMs: NOW, endMs: NOW }), 0, 'a zero-width domain must not produce NaN/Infinity');

// ── Spans stay inside the track ────────────────────────────────────────────
for (const r of rows) {
  const s = actualSpan(r, d);
  if (s) {
    assert.ok(s.left >= 0 && s.left <= 1, 'bar left inside track');
    assert.ok(s.width >= 0 && s.left + s.width <= 1 + 1e-9, 'bar must not run past the track');
  }
}
assert.strictEqual(actualSpan({ due_date: day(6) }, d), null, 'no start_date must give no bar, never an invented left edge');
assert.strictEqual(actualSpan({ start_date: day(6) }, d), null);
// Reversed dates (bad data) render as a real span, not a negative-width bar.
const reversed = actualSpan({ start_date: day(10), due_date: day(2) }, d)!;
assert.ok(reversed.width > 0, 'start after due must not produce a negative width');

const over = overrunSpan(rows[1], d)!;
assert.ok(over.width > 0 && over.left + over.width <= 1 + 1e-9);
assert.strictEqual(overrunSpan({ due_date: day(20), projected_end: ymd(10), projection_confidence: 'ok' }, d), null, 'finishing early is not an overrun');

// ── Ticks ──────────────────────────────────────────────────────────────────
const ticks = axisTicks(d, 5);
assert.strictEqual(ticks.length, 5);
assert.strictEqual(ticks[0].at, 0);
assert.strictEqual(ticks[4].at, 1);
assert.ok(ticks.every((t, i) => i === 0 || t.at > ticks[i - 1].at), 'ticks must be strictly increasing');
assert.ok(ticks.every(t => t.label.length > 0));
assert.strictEqual(axisTicks(d, 1).length, 2, 'an axis needs at least two labelled ends');

// ── Order: soonest deadline first, undated last ────────────────────────────
const ordered = [{ due_date: day(9) }, { due_date: null }, { due_date: day(1) }].sort(compareTimelineRows);
assert.strictEqual(ordered[0].due_date, day(1));
assert.strictEqual(ordered[1].due_date, day(9));
assert.strictEqual(ordered[2].due_date, null, 'undated projects sink to the bottom');

console.log('projectTimeline.check.ts OK');
