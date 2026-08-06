// Phase 10 (#191, plan §16) — the geometry behind the topbar attention ribbon
// once it carries three levels of work instead of one.
//
// WHY A .ts AND NOT PART OF TimelineStrip.web.tsx: same split as
// lib/projectTimeline.ts, whose Domain/fraction/actualSpan helpers this file
// builds on rather than restating. Everything here is a pure date -> fraction
// branch, and branches are the part that silently drifts, so they live where
// `deadlineStrata.check.ts` can assert them under plain `npx tsx`. The
// component holds no scaling maths of its own.
//
// THE INVARIANT THIS FILE EXISTS TO PROTECT: every stratum is expressed as a
// fraction of ONE axis and ONE track height. A previous attempt at this
// feature positioned project markers in pixels against a flex-laid-out task
// row, so the markers escaped the track vertically and drifted horizontally
// away from the task segments they were supposed to line up with. Fractions
// in, fractions out; the component multiplies by `100%` and clips.
//
// WHAT THIS FILE DOES NOT DO: compute a projected end date, or decide whether
// a forecast is trustworthy. §16.1 — `fn_project_projection` is the one
// server-side definition, and an 8px ambient bar has no room to distinguish a
// forecast from a fact, so the ribbon draws committed dates only.

import { type Domain, type Span, actualSpan, fraction, msOf } from './projectTimeline';

const DAY_MS = 86_400_000;

/**
 * A span narrower than this is invisible, so every span is widened to it. The
 * widened span may run past 1.0 at the right edge — that is deliberate and
 * safe, because the track clips. Do not "fix" it by clamping: clamping would
 * slide the last deadline leftwards and put it at the wrong date.
 */
export const MIN_SPAN_FRACTION = 0.014;

/** How many project bars the ribbon will draw. It is ambient, not a backlog. */
export const PROJECT_CAP = 12;

// ── Inputs ─────────────────────────────────────────────────────────────────

export type StrataTask = {
  id: string;
  title: string;
  dueDate: string;
  stageColor: string;
  overdue: boolean;
};

export type StrataProject = {
  id: string;
  name: string;
  color: string | null;
  portfolioId: string | null;
  portfolioName: string | null;
  startDate: string | null;
  dueDate: string | null;
  /** §16: the project's CURRENT stage is terminal AND terminal_type='success'. */
  done: boolean;
};

// ── Outputs ────────────────────────────────────────────────────────────────

export type StrataBar = {
  key: string;
  /** The underlying entity id, for navigation and tooltips. */
  sourceId: string;
  label: string;
  /** Null means "the caller picks the entity's fixed hue". */
  color: string | null;
  span: Span;
  /**
   * The real dates behind the span, in epoch ms, for the caller's tooltip.
   * Carried rather than re-derived so a tooltip can never name a different date
   * from the one the bar is drawn at. `fromMs` is null for a level whose bar
   * marks a single date (a task lands, it does not run).
   */
  fromMs: number | null;
  toMs: number;
};

export type StrataLevel = 'portfolio' | 'project' | 'task';

/** Vertical placement of one stratum, as fractions of the track height. */
export type LevelBounds = { top: number; height: number };

// ── The axis ───────────────────────────────────────────────────────────────

/**
 * Today-anchored: the left edge IS now, exactly as the ribbon has always read,
 * and the right edge is the furthest thing on it. Deliberately NOT
 * `timelineDomain` from projectTimeline.ts — that one pads and reaches into the
 * past, which is right for the Timeline tab (where an overrun must be visible
 * behind today) and wrong here, where the strip answers "how soon" and past
 * work is already collapsed into the overdue cap.
 */
export function stripDomain(
  tasks: readonly StrataTask[],
  projects: readonly StrataProject[],
  todayMs: number,
): Domain {
  // A one-day floor: with everything due today the span would be 0 and every
  // fraction would divide by zero.
  let endMs = todayMs + DAY_MS;
  for (const t of tasks) {
    const m = msOf(t.dueDate);
    if (m != null && m > endMs) endMs = m;
  }
  for (const p of projects) {
    for (const d of [p.startDate, p.dueDate]) {
      const m = msOf(d);
      if (m != null && m > endMs) endMs = m;
    }
  }
  return { startMs: todayMs, endMs };
}

// ── Selection ──────────────────────────────────────────────────────────────

/** The one date a project is sorted and placed by. Due if it has one, else start. */
function anchorMs(p: StrataProject): number | null {
  return msOf(p.dueDate) ?? msOf(p.startDate);
}

/**
 * Projects the ribbon should draw: outstanding, dated, still ahead, nearest
 * first, capped. A project whose stage is terminal+success is finished and must
 * not sit on the ribbon as an outstanding deadline.
 */
export function ribbonProjects(
  projects: readonly StrataProject[],
  todayMs: number,
  cap: number = PROJECT_CAP,
): StrataProject[] {
  return projects
    .filter((p) => !p.done && anchorMs(p) != null && anchorMs(p)! >= todayMs)
    .sort((a, b) => anchorMs(a)! - anchorMs(b)!)
    .slice(0, cap);
}

/** Outstanding projects already past their due date — they feed the overdue cap, not a bar. */
export function overdueProjects(projects: readonly StrataProject[], todayMs: number): StrataProject[] {
  return projects.filter((p) => {
    const due = msOf(p.dueDate);
    return !p.done && due != null && due < todayMs;
  });
}

// ── Geometry ───────────────────────────────────────────────────────────────

/** Widen to the visible minimum. May exceed 1.0; the track clips. */
function visible(span: Span): Span {
  return span.width >= MIN_SPAN_FRACTION ? span : { left: span.left, width: MIN_SPAN_FRACTION };
}

/**
 * Portfolio bands: a portfolio's extent is the extent of the projects inside
 * it, so the band literally contains the bars beneath it. Derived from the same
 * project rows the middle stratum draws — no portfolio query, and no way for
 * the two levels to disagree about where a portfolio starts and ends.
 */
export function portfolioBands(projects: readonly StrataProject[], d: Domain): StrataBar[] {
  const groups = new Map<string, { name: string; lo: number; hi: number }>();
  for (const p of projects) {
    if (!p.portfolioId) continue;
    const a = msOf(p.startDate);
    const b = msOf(p.dueDate);
    const lo = a != null && b != null ? Math.min(a, b) : (a ?? b);
    const hi = a != null && b != null ? Math.max(a, b) : (b ?? a);
    if (lo == null || hi == null) continue;
    const found = groups.get(p.portfolioId);
    if (found) {
      found.lo = Math.min(found.lo, lo);
      found.hi = Math.max(found.hi, hi);
    } else {
      groups.set(p.portfolioId, { name: p.portfolioName || 'Portfolio', lo, hi });
    }
  }
  return Array.from(groups.entries()).map(([id, g]) => {
    const left = fraction(g.lo, d);
    return {
      key: `portfolio-${id}`,
      sourceId: id,
      label: g.name,
      color: null,
      span: visible({ left, width: fraction(g.hi, d) - left }),
      fromMs: g.lo,
      toMs: g.hi,
    };
  });
}

/**
 * Project bars: the committed start -> due span. A project with only one of the
 * two dates becomes a minimum-width mark at that date rather than inventing the
 * missing end, which would read as a fact nobody entered.
 */
export function projectBars(projects: readonly StrataProject[], d: Domain): StrataBar[] {
  return projects.map((p) => {
    const committed = actualSpan({ start_date: p.startDate, due_date: p.dueDate }, d);
    const span = committed ?? { left: fraction(anchorMs(p)!, d), width: 0 };
    return {
      key: `project-${p.id}`,
      sourceId: p.id,
      label: p.name,
      color: p.color,
      span: visible(span),
      fromMs: committed ? Math.min(msOf(p.startDate)!, msOf(p.dueDate)!) : null,
      toMs: committed ? Math.max(msOf(p.startDate)!, msOf(p.dueDate)!) : anchorMs(p)!,
    };
  });
}

/**
 * Task segments: each task owns the stretch of axis from the previous deadline
 * up to its own, which is the ribbon's original proportional reading — a wide
 * block means a long quiet gap before that task lands. The only change is that
 * the widths are now fractions of the shared axis instead of flex weights, so a
 * task's right edge sits at its real date and lines up with the project bar
 * above it. Under flex they did not, and two strata disagreeing about where a
 * date falls is the whole thing this rewrite exists to prevent.
 */
export function taskSegments(tasks: readonly StrataTask[], d: Domain): StrataBar[] {
  let prevMs = d.startMs;
  return tasks.map((t) => {
    const dueMs = Math.max(msOf(t.dueDate) ?? prevMs, prevMs);
    const left = fraction(prevMs, d);
    const span = visible({ left, width: fraction(dueMs, d) - left });
    prevMs = dueMs;
    // fromMs is null on purpose: the segment's left edge is the PREVIOUS task's
    // deadline, not a date this task has. Only `toMs` is this task's own.
    return { key: `task-${t.id}`, sourceId: t.id, label: t.title, color: t.stageColor, span, fromMs: null, toMs: dueMs };
  });
}

// ── Vertical layout ────────────────────────────────────────────────────────

/**
 * Where each stratum sits inside the track, as fractions of its height, so the
 * whole stack scales with the hover growth without a second set of numbers.
 *
 * Portfolio on top, then projects, then tasks — a portfolio contains projects,
 * a project contains tasks, and the reading order is the nesting order.
 *
 * Absent levels are not left as gaps. A company with no projects still gets the
 * ribbon it has always had: task segments filling the whole track. Degrading to
 * a third-height sliver would look broken to every user who never adopted
 * projects.
 */
export function strataBounds(levels: {
  portfolio: boolean;
  project: boolean;
  task: boolean;
}): Record<StrataLevel, LevelBounds | null> {
  // Relative weights, top to bottom. Projects are the load-bearing level and
  // get the most ink; the portfolio wash is the lightest thing on the strip.
  const WEIGHTS: [StrataLevel, number][] = [
    ['portfolio', 0.26],
    ['project', 0.36],
    ['task', 0.38],
  ];
  const present = WEIGHTS.filter(([k]) => levels[k]);
  const total = present.reduce((sum, [, w]) => sum + w, 0);
  const out: Record<StrataLevel, LevelBounds | null> = { portfolio: null, project: null, task: null };
  if (total <= 0) return out;

  // A hairline between strata so the levels stay legible once the track grows
  // on hover, taken out of each band rather than added around them (so the
  // stack always sums to exactly the track height).
  const GAP = present.length > 1 ? 0.06 / (present.length - 1) : 0;
  const usable = 1 - GAP * (present.length - 1);

  let top = 0;
  for (const [key, weight] of present) {
    const height = (weight / total) * usable;
    out[key] = { top, height };
    top += height + GAP;
  }
  return out;
}
