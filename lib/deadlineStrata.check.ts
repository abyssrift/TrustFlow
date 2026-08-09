// Self-check for lib/deadlineStrata.ts (Phase 10, #191).
// Run by `npm run check` (scripts/run-checks.mjs auto-discovers *.check.ts).
//
// What would break without it, in order of how badly it would lie to a user:
//   1. A stratum escaping the track. The previous attempt at this component
//      shipped project markers positioned above the bar in pixels; they
//      rendered as floating squares and the work was reverted. Every bound
//      this file produces must stay inside [0,1] vertically.
//   2. A finished project sitting on the ribbon as an outstanding deadline.
//      "Done" is terminal AND terminal_type='success', and it is one dropped
//      filter away from the ribbon nagging about work that shipped.
//   3. Strata disagreeing about where a date falls. The task segments and the
//      project bars are drawn from one domain; if a task's right edge stopped
//      landing on its own due date, the levels would visibly drift apart.
//   4. The task-only ribbon shrinking to a sliver for every company that has
//      no projects — a regression for users who never adopted the feature.

import assert from 'node:assert';
import {
  MIN_SPAN_FRACTION,
  PROJECT_CAP,
  overdueProjects,
  projectBars,
  ribbonProjects,
  ribbonTasks,
  stripDomain,
  taskSegments,
  type StrataProject,
  type StrataTask,
} from './deadlineStrata';
import { fraction } from './projectTimeline';

const DAY = 86_400_000;
const TODAY = Date.parse('2026-08-06T00:00:00Z');
const at = (n: number) => new Date(TODAY + n * DAY).toISOString();

const task = (id: string, days: number, overdue = false): StrataTask => ({
  id,
  title: `Task ${id}`,
  dueDate: at(days),
  stageColor: '#3b82f6',
  overdue,
});

const project = (id: string, p: Partial<StrataProject> = {}): StrataProject => ({
  id,
  name: `Project ${id}`,
  color: null,
  portfolioId: null,
  portfolioName: null,
  startDate: null,
  dueDate: null,
  done: false,
  ...p,
});

// ── The axis ───────────────────────────────────────────────────────────────

{
  const d = stripDomain([task('a', 10)], [project('p', { dueDate: at(30) })], TODAY);
  assert.strictEqual(d.startMs, TODAY, 'the left edge is now — the ribbon has always read that way');
  // This assertion used to demand the opposite, and that is exactly what broke
  // the strip: a project 30 days out stretched the axis, so a week of real task
  // deadlines collapsed into a few pixels and every segment looked identical.
  // A segment's LENGTH is how long you have; only tasks may set that scale.
  assert.strictEqual(d.endMs, TODAY + 10 * DAY, 'a distant project must NOT stretch the axis past the furthest task');
}
{
  const d = stripDomain([task('a', 40)], [project('p', { dueDate: at(5) })], TODAY);
  assert.strictEqual(d.endMs, TODAY + 40 * DAY, 'the furthest task sets the end');
}
{
  // The scale is task-driven even when there are no tasks to drive it: an
  // all-project ribbon falls back to the one-day floor rather than sizing
  // itself to projects, so adding a task later cannot make the strip jump.
  const d = stripDomain([], [project('p', { dueDate: at(30) })], TODAY);
  assert.strictEqual(d.endMs, TODAY + DAY, 'no tasks means no scale to stretch');
}
{
  // Everything due today: a zero span would divide by zero in every fraction.
  const d = stripDomain([task('a', 0)], [], TODAY);
  assert.ok(d.endMs > d.startMs, 'the domain always has positive width');
  assert.strictEqual(d.endMs - d.startMs, DAY, 'one-day floor');
}
{
  const d = stripDomain([], [], TODAY);
  assert.ok(d.endMs > d.startMs, 'an empty ribbon still yields a usable axis');
}

// ── Selection: done, overdue, cap, order ───────────────────────────────────

{
  const rows = [
    project('done', { dueDate: at(5), done: true }),
    project('live', { dueDate: at(5) }),
  ];
  const picked = ribbonProjects(rows, TODAY);
  assert.deepStrictEqual(picked.map((p) => p.id), ['live'], 'a finished project must not sit on the ribbon');
  assert.deepStrictEqual(overdueProjects(rows, TODAY).map((p) => p.id), [], 'nothing here is overdue');
}
{
  const rows = [
    project('late', { dueDate: at(-3) }),
    project('lateDone', { dueDate: at(-3), done: true }),
    project('soon', { dueDate: at(2) }),
  ];
  assert.deepStrictEqual(
    overdueProjects(rows, TODAY).map((p) => p.id),
    ['late'],
    'overdue means outstanding and past due — a project finished late is not still overdue',
  );
  assert.deepStrictEqual(
    ribbonProjects(rows, TODAY).map((p) => p.id),
    ['soon'],
    'overdue projects feed the cap, never a bar (a bar would sit at fraction 0, on top of the today cursor)',
  );
}
{
  const rows = [
    project('c', { dueDate: at(30) }),
    project('a', { dueDate: at(1) }),
    project('b', { dueDate: at(10) }),
  ];
  assert.deepStrictEqual(ribbonProjects(rows, TODAY).map((p) => p.id), ['a', 'b', 'c'], 'nearest first');
}
{
  const rows = Array.from({ length: PROJECT_CAP + 8 }, (_, i) => project(`p${i}`, { dueDate: at(i + 1) }));
  assert.strictEqual(ribbonProjects(rows, TODAY).length, PROJECT_CAP, 'the ribbon is ambient, not a backlog');
}
{
  // Dateless projects cannot be placed on a time axis at all.
  assert.deepStrictEqual(ribbonProjects([project('nodate')], TODAY), []);
  // Start-only is placeable: it is sorted and drawn at its start.
  assert.deepStrictEqual(
    ribbonProjects([project('startonly', { startDate: at(4) })], TODAY).map((p) => p.id),
    ['startonly'],
  );
}

// ── Geometry: nothing escapes, everything lands on its date ────────────────

const DOMAIN = stripDomain([task('t1', 10), task('t2', 20)], [project('p', { startDate: at(5), dueDate: at(25) })], TODAY);

{
  const bars = projectBars([project('p', { startDate: at(5), dueDate: at(25) })], DOMAIN);
  assert.strictEqual(bars.length, 1);
  const { left, width } = bars[0].span;
  assert.ok(Math.abs(left - fraction(TODAY + 5 * DAY, DOMAIN)) < 1e-9, 'a bar starts on its start date');
  assert.ok(Math.abs(left + width - fraction(TODAY + 25 * DAY, DOMAIN)) < 1e-9, 'and ends on its due date');
}
{
  // Reversed dates must not produce a negative width, which renders as nothing.
  const bars = projectBars([project('p', { startDate: at(25), dueDate: at(5) })], DOMAIN);
  assert.ok(bars[0].span.width > 0, 'a project entered back-to-front still draws');
}
{
  const bars = projectBars([project('p', { dueDate: at(12) })], DOMAIN);
  assert.strictEqual(bars[0].span.width, MIN_SPAN_FRACTION, 'a due-only project is a mark, not an invented span');
  assert.ok(Math.abs(bars[0].span.left - fraction(TODAY + 12 * DAY, DOMAIN)) < 1e-9, 'placed at its real date');
}
{
  // The last thing on the axis sits at fraction 1.0, so widening it to the
  // visible minimum runs past the right edge. That is intended — the track
  // clips. Clamping instead would slide the final deadline backwards in time.
  const bars = projectBars([project('p', { dueDate: at(25) })], DOMAIN);
  assert.ok(bars[0].span.left + bars[0].span.width > 1, 'the widened final mark overruns, and the track clips it');
  assert.ok(bars[0].span.left <= 1, 'but its start is never off the axis');
}

{
  const segs = taskSegments([task('t1', 10), task('t2', 20)], DOMAIN);
  assert.strictEqual(segs.length, 2);
  assert.strictEqual(segs[0].span.left, 0, 'the first segment starts at now');
  assert.ok(
    Math.abs(segs[0].span.left + segs[0].span.width - fraction(TODAY + 10 * DAY, DOMAIN)) < 1e-9,
    "a task segment ends on the task's own due date — this is what keeps it aligned with the project bar above it",
  );
  assert.ok(
    Math.abs(segs[1].span.left - segs[0].span.left - segs[0].span.width) < 1e-9,
    'segments are contiguous: each one owns the gap since the previous deadline',
  );
}
{
  // Two tasks due the same day used to collapse to zero width and vanish.
  const segs = taskSegments([task('t1', 10), task('t2', 10)], DOMAIN);
  assert.ok(segs.every((s) => s.span.width >= MIN_SPAN_FRACTION), 'same-day tasks stay visible');
  assert.ok(segs[1].span.left >= segs[0].span.left, 'and never run backwards');
}
{
  // An out-of-order list must not produce a negative-width segment.
  const segs = taskSegments([task('t1', 20), task('t2', 5)], DOMAIN);
  assert.ok(segs.every((s) => s.span.width > 0), 'unsorted input still draws');
}

// ── Task selection: the bug that emptied the ribbon in production ──────────

{
  // The exact shape that shipped broken: a backlog longer than the cap, sorted
  // due-date ascending, with the only upcoming work at the far end. A plain
  // slice(0, 10) returns ten overdue rows and NO upcoming ones.
  const backlog = Array.from({ length: 15 }, (_, i) => task(`old${i}`, -30 + i, true));
  const soon = task('soon', 5);
  const picked = ribbonTasks([...backlog, soon]);

  assert.ok(
    picked.some((t) => t.id === 'soon'),
    'an upcoming task must survive a backlog longer than the cap — this is the whole bug: the strip draws ONLY upcoming tasks, so losing them renders an empty grey track',
  );
  assert.strictEqual(
    picked.filter((t) => t.overdue).length, 15,
    'every overdue task is kept — the cap counts them and truncating would understate how far behind you are',
  );
}
{
  // And the consequence the axis cares about: with the upcoming task retained,
  // the domain reaches it instead of collapsing to the one-day floor.
  const picked = ribbonTasks([task('old', -10, true), task('soon', 6)]);
  const d = stripDomain(picked.filter((t) => !t.overdue), [], TODAY);
  assert.strictEqual(d.endMs, TODAY + 6 * DAY, 'the surviving upcoming task sets the scale');
}
{
  assert.strictEqual(ribbonTasks([]).length, 0, 'no tasks, no selection');
  const many = Array.from({ length: 40 }, (_, i) => task(`t${i}`, i + 1));
  assert.strictEqual(ribbonTasks(many).length, 10, 'upcoming is still capped');
}

console.log('deadlineStrata: all assertions passed (axis, selection, spans)');
