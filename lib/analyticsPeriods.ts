// The trend-series RPCs (rpc_get_pipeline_throughput, rpc_get_pipeline_points_series,
// rpc_get_user_performance_series) only bucket data into whole 'week' or 'month'
// snapshots — there is no 'day' granularity in analytics_snapshots. This adapts a
// day-range filter (e.g. the 7d/30d/60d/90d picker on Overview) to the closest
// backend-supported period breakdown, so the chart's actual span always matches
// what the filter promises instead of silently overshooting it.
export type SnapshotPeriodType = 'week' | 'month';

export interface PeriodParams {
  periodType: SnapshotPeriodType;
  nPeriods: number;
}

const WEEK_DAYS = 7;
const MONTH_DAYS = 30;
// Beyond this span, monthly buckets stay readable where weekly would mean a wall of bars.
const MAX_WEEK_SPAN_DAYS = 45;

export function daysToPeriodParams(days: number): PeriodParams {
  if (days <= MAX_WEEK_SPAN_DAYS) {
    return { periodType: 'week', nPeriods: Math.max(1, Math.round(days / WEEK_DAYS)) };
  }
  return { periodType: 'month', nPeriods: Math.max(1, Math.round(days / MONTH_DAYS)) };
}
