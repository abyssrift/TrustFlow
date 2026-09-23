export type AnalyticsSeriesKey = 'dwell' | 'throughput' | 'points' | 'audit';

export interface AnalyticsSeriesSnapshot {
  key: AnalyticsSeriesKey;
  status: 'ready' | 'error';
  data: unknown;
}

function hasMeasuredActivity(key: AnalyticsSeriesKey, data: unknown): boolean {
  if (key === 'audit') {
    if (!data || typeof data !== 'object') return false;
    const current = (data as { current?: unknown }).current;
    if (!current || typeof current !== 'object') return false;
    return Number((current as { sample_size?: unknown }).sample_size) > 0;
  }
  if (!Array.isArray(data)) return false;
  return data.some(row => {
    if (!row || typeof row !== 'object') return false;
    const value = row as Record<string, unknown>;
    if (key === 'throughput') {
      return Number(value.tasks_succeeded) > 0 || Number(value.tasks_failed) > 0;
    }
    if (key === 'points') return Number(value.weight_points) > 0;
    if (key === 'dwell') {
      return Number(value.sample_count) > 0 || Number(value.avg_seconds) > 0;
    }
    return false;
  });
}

export function summarizeAnalyticsSeries(series: readonly AnalyticsSeriesSnapshot[]) {
  const failed = series.filter(item => item.status === 'error').length;
  const hasFailure = failed > 0;
  const allFailed = series.length > 0 && failed === series.length;
  const hasActivity = series.some(item => item.status === 'ready' && hasMeasuredActivity(item.key, item.data));
  return {
    hasFailure,
    allFailed,
    hasActivity,
    isEmpty: !hasFailure && !hasActivity,
  };
}
