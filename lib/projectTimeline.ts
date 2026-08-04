// Phase 10 (#191, plan §16) — the date maths behind the Timeline tab.
//
// WHY A .ts AND NOT PART OF THE COMPONENT: the same split as
// lib/projectPresentation.ts. Everything here is a pure date -> number branch,
// and branches are the part that silently drifts, so they live where
// `projectTimeline.check.ts` can assert them under plain `npx tsx`. The
// component holds no scaling maths of its own.
//
// IMPORTS NOTHING, deliberately, so the check file stays runnable.
//
// WHAT THIS FILE DOES NOT DO: compute a projected end date. §16.1 —
// `fn_project_projection` is the one server-side definition of "when will this
// land", `rpc_projects_table` carries it to the client, and this file only
// decides where on an axis an already-computed date goes. A pace calculation
// appearing here would be the §16.1 failure with extra steps.

export const DAY_MS = 86_400_000;

/** Domain of the shared axis, in epoch ms. */
export type Domain = { startMs: number; endMs: number };

/** A bar, as fractions of the axis (0..1). */
export type Span = { left: number; width: number };

/**
 * Structural subset of an `rpc_projects_table` row. Optional everywhere on
 * purpose: an environment whose `20260805_projects_table_projection_columns`
 * migration has not run returns rows WITHOUT the three projection columns, and
 * the timeline must degrade to "due dates only" rather than throw.
 */
export type TimelineRow = {
  start_date?: string | null;
  due_date?: string | null;
  projected_end?: string | null;
  projection_confidence?: string | null;
};

/**
 * Parse to epoch ms, or null. `due_date` is a timestamptz and `projected_end`
 * is a plain `date` (parsed as UTC midnight) — mixing them is fine because the
 * axis is never finer than a fortnight, so sub-day skew is under a pixel.
 */
export function msOf(d?: string | null): number | null {
  if (!d) return null;
  const t = Date.parse(d);
  return Number.isFinite(t) ? t : null;
}

/**
 * §16.2 — 'none' means the SERVER refused to forecast. Render nothing at all:
 * not a bar, not a zero, not a marker. This is the single gate; no caller
 * re-tests the confidence string inline.
 */
export function hasProjection(row: TimelineRow): boolean {
  const conf = row.projection_confidence;
  if (conf !== 'ok' && conf !== 'low') return false;
  return msOf(row.projected_end) != null;
}

/** True when a projection exists but is thin — drawn dashed, never as a fact. */
export function isThinProjection(row: TimelineRow): boolean {
  return hasProjection(row) && row.projection_confidence === 'low';
}

/**
 * The axis every row shares. Derived from the data rather than a fixed window,
 * because a fixed "next 90 days" hides exactly the projects a timeline exists
 * to surface: the overdue ones behind it and the badly-overrunning ones past
 * it. `now` is always inside the domain so the today line is never off-screen.
 */
export function timelineDomain(rows: readonly TimelineRow[], nowMs: number): Domain {
  const points: number[] = [nowMs];
  for (const r of rows) {
    const s = msOf(r.start_date);
    if (s != null) points.push(s);
    const d = msOf(r.due_date);
    if (d != null) points.push(d);
    if (hasProjection(r)) points.push(msOf(r.projected_end)!);
  }

  let lo = Math.min(...points);
  let hi = Math.max(...points);

  // A single project due tomorrow would otherwise zoom the axis to a few hours,
  // where every bar is a smear and "3 days late" and "3 hours late" look the
  // same. A fortnight is the floor.
  const MIN_SPAN = 14 * DAY_MS;
  if (hi - lo < MIN_SPAN) {
    const mid = (lo + hi) / 2;
    lo = mid - MIN_SPAN / 2;
    hi = mid + MIN_SPAN / 2;
  }

  // Breathing room so the earliest bar and the latest overrun are not welded to
  // the edges (an overrun flush against the right edge reads as "clipped").
  const pad = Math.max(2 * DAY_MS, (hi - lo) * 0.04);
  return { startMs: lo - pad, endMs: hi + pad };
}

/** Epoch ms -> 0..1 across the axis, clamped. */
export function fraction(t: number, d: Domain): number {
  const span = d.endMs - d.startMs;
  if (!(span > 0)) return 0;
  const f = (t - d.startMs) / span;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/**
 * The committed span: start_date -> due_date. Null when either end is missing —
 * the component then draws a due-date marker only. It never invents a start
 * (the RPC returns no created_at, and a made-up left edge would read as a fact).
 */
export function actualSpan(row: TimelineRow, d: Domain): Span | null {
  const s = msOf(row.start_date);
  const e = msOf(row.due_date);
  if (s == null || e == null) return null;
  const a = fraction(Math.min(s, e), d);
  const b = fraction(Math.max(s, e), d);
  return { left: a, width: b - a };
}

/**
 * Days the forecast lands PAST the due date. Positive = late, negative = early,
 * null = no forecast or no due date to compare against. This is the single most
 * useful number on the screen, so it has one definition.
 */
export function overrunDays(row: TimelineRow): number | null {
  if (!hasProjection(row)) return null;
  const due = msOf(row.due_date);
  if (due == null) return null;
  return Math.round((msOf(row.projected_end)! - due) / DAY_MS);
}

/** The overrun segment (due -> projected). Null unless the forecast is late. */
export function overrunSpan(row: TimelineRow, d: Domain): Span | null {
  const late = overrunDays(row);
  if (late == null || late <= 0) return null;
  const a = fraction(msOf(row.due_date)!, d);
  const b = fraction(msOf(row.projected_end)!, d);
  return { left: a, width: b - a };
}

/** Where to draw the forecast marker, or null when there is no forecast. */
export function projectedAt(row: TimelineRow, d: Domain): number | null {
  if (!hasProjection(row)) return null;
  return fraction(msOf(row.projected_end)!, d);
}

/** Short axis label. `fmtDate` is the full form — too wide for five ticks at 390px. */
export function fmtAxis(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Evenly spaced axis ticks, as {fraction, label}. */
export function axisTicks(d: Domain, count = 5): { at: number; label: string }[] {
  const n = Math.max(2, count);
  return Array.from({ length: n }, (_, i) => {
    const at = i / (n - 1);
    return { at, label: fmtAxis(d.startMs + at * (d.endMs - d.startMs)) };
  });
}

/**
 * Reading order: soonest deadline first, undated last. A timeline sorted by
 * name is a list with extra steps.
 */
export function compareTimelineRows(a: TimelineRow, b: TimelineRow): number {
  const da = msOf(a.due_date);
  const db = msOf(b.due_date);
  if (da == null && db == null) return (msOf(a.start_date) ?? 0) - (msOf(b.start_date) ?? 0);
  if (da == null) return 1;
  if (db == null) return -1;
  return da - db;
}
