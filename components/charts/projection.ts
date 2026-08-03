/**
 * The projection contract (issue #198, plan §16.1 / §16.2).
 *
 * WHY THIS FILE EXISTS AT ALL. Plan §16.1 names the failure mode outright:
 * five surfaces each inventing their own "projected end date", disagreeing on
 * screen, and the product reading as untrustworthy rather than buggy. The
 * Timeline tab (#191) will carry several projections, Intelligence will carry
 * more, and the project Assignments screen carries one today. They all render
 * through `ProjectionChart`, and `ProjectionChart` renders through this shape.
 *
 * THE ONE RULE THAT MAKES IT WORK: **this component never computes a
 * projection.** It has no pace maths in it, deliberately, and it must never
 * grow any. It draws exactly what it is handed. The forecast is computed
 * server-side once — `rpc_portfolio_throughput` / `rpc_portfolio_capacity`
 * already derive completion rate from real `project_stage_history` timestamps
 * (plan §13.18), and Phase 10's `rpc_project_health` applies that throughput to
 * remaining scope. A caller that computes `projectedEnd` in TypeScript has
 * re-created the §16.1 failure with extra steps, whatever it looks like.
 *
 * HONESTY IS PART OF THE CONTRACT, not a nicety. §16.2: "a projection from
 * three stage transitions is noise wearing a date's clothing." So `sampleSize`
 * and `confidence` are REQUIRED fields, not optional garnish, and the chart
 * refuses to draw a projected arm below `MIN_PROJECTION_SAMPLE`. Shipping a
 * confident wrong date is worse than shipping no date.
 */

export type ProjectionPoint = {
  /** ISO date (YYYY-MM-DD). Also used as the x-axis key. */
  date: string;
  /**
   * Observed cumulative value at this date — a real, already-happened number.
   * `null` for dates after the last observation, so the solid line stops.
   */
  actual: number | null;
  /**
   * Projected cumulative value at this date. `null` for dates at or before the
   * handoff. Set BOTH `actual` and `projected` on the handoff point itself, or
   * the two lines render with a visible gap between them.
   */
  projected: number | null;
};

/**
 * How confident the SERVER is. The chart reads this; it never derives it.
 *
 *   'none' — not enough history to forecast at all. No projected arm is drawn.
 *   'low'  — enough to forecast, but thin. Drawn dashed and labelled as a
 *            rough estimate, never as a date to plan around.
 *   'ok'   — enough history that the date is worth acting on.
 */
export type ProjectionConfidence = 'none' | 'low' | 'ok';

export type ProjectionSeries = {
  /** Chronological. Mixed actual/projected as described above. */
  points: ProjectionPoint[];
  /** The value that counts as finished — drawn as a horizontal target rule. */
  target: number;
  /** What one unit is, for the axis and tooltip copy. e.g. "tasks done". */
  unitLabel: string;
  /**
   * Number of real observations the projection rests on. This is a COUNT of
   * facts (completed tasks, stage transitions), never a derived rate.
   * Below MIN_PROJECTION_SAMPLE the projected arm is suppressed regardless of
   * what `confidence` says — the threshold is enforced here, not per caller,
   * so five surfaces cannot pick five different thresholds.
   */
  sampleSize: number;
  /** ISO date the projection lands on. `null` when there is no projection. */
  projectedEnd: string | null;
  /** The committed date, drawn as a reference rule so the gap is visible. */
  dueDate?: string | null;
  /** The server's verdict. See ProjectionConfidence. */
  confidence: ProjectionConfidence;
};

/**
 * Below this many real observations, no projected arm is drawn — by any
 * caller, on any surface. §16.2's "three data points" line made concrete.
 *
 * Five, not three: three points can be produced by a single busy afternoon and
 * would extrapolate that afternoon across a whole engagement.
 */
export const MIN_PROJECTION_SAMPLE = 5;

/** The single gate. Both platform variants call this — never re-test inline. */
export function canProject(series: ProjectionSeries): boolean {
  return (
    series.confidence !== 'none' &&
    series.sampleSize >= MIN_PROJECTION_SAMPLE &&
    series.projectedEnd != null
  );
}

/**
 * The one sentence shown when there is no projection. Plain language, and it
 * always says what WOULD produce one — an empty state that offers the next
 * action (plan §14.2), not a shrug.
 */
export function noProjectionReason(series: ProjectionSeries): string {
  const need = MIN_PROJECTION_SAMPLE - series.sampleSize;
  if (series.sampleSize === 0) {
    return 'Nothing has been completed yet, so there is no pace to project from. Finish a few tasks and a forecast appears here.';
  }
  if (need > 0) {
    return `Only ${series.sampleSize} completed so far. ${need} more and this will project a finish date — forecasting from ${series.sampleSize} would be guessing.`;
  }
  return 'Not enough consistent history to forecast a finish date yet.';
}

/** Shared by both variants so the two platforms cannot word this differently. */
export function confidenceCaption(series: ProjectionSeries): string {
  return series.confidence === 'low'
    ? `Rough estimate from ${series.sampleSize} completed — treat it as a direction, not a date.`
    : `Projected from ${series.sampleSize} completed.`;
}
