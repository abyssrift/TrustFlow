// Phase 10 (#191, plan §16) — the geometry behind the topbar attention ribbon
// once it marks projects alongside tasks.
//
// A THREE-LEVEL VERSION OF THIS EXISTED AND WAS REJECTED: portfolio wash over
// project bars over task segments, each a horizontal band of the track. It read
// as clutter at 8px. The ribbon now draws task segments on the track and one
// circular bead per project on the same axis; portfolios are not on it at all.
// `portfolioBands` and `strataBounds` were deleted with that design — check the
// history before re-deriving them.
//
// WHY A .ts AND NOT PART OF TimelineStrip.web.tsx: same split as
// lib/projectTimeline.ts, whose Domain/fraction/actualSpan helpers this file
// builds on rather than restating. Everything here is a pure date -> fraction
// branch, and branches are the part that silently drifts, so they live where
// `deadlineStrata.check.ts` can assert them under plain `npx tsx`. The
// component holds no scaling maths of its own.
//
// THE INVARIANT THIS FILE EXISTS TO PROTECT: every span is a fraction of ONE
// axis. A previous attempt at this feature positioned project markers in pixels
// against a flex-laid-out task row, so the markers drifted horizontally away
// from the task segments they were supposed to line up with. Fractions in,
// fractions out; the component multiplies by `100%` and clips.
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
  // TASKS ALONE SET THE SCALE. Projects are marked on this axis, they do not
  // stretch it.
  //
  // The whole point of the strip is that a segment's LENGTH is how long you
  // have: the run from the previous deadline to this one. Letting a project
  // due in December push endMs out squeezed a week of real task deadlines into
  // a few pixels at the far left, and every segment became the same
  // indistinguishable sliver. The encoding survived; the scale destroyed it.
  //
  // A project past the last task therefore falls outside the domain and is
  // dropped from the strip by `visible`/`fraction` clamping. That is the right
  // trade: the ribbon answers "what is landing soon", and the dropdown lists
  // everything regardless. Restoring urgency-by-length matters more than
  // guaranteeing every project gets a bead.
  void projects;
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
