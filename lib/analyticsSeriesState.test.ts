import { describe, expect, it } from 'vitest';
import { summarizeAnalyticsSeries, type AnalyticsSeriesSnapshot } from './analyticsSeriesState';

describe('summarizeAnalyticsSeries', () => {
  it('recognizes measured activity in any successful series', () => {
    const series: AnalyticsSeriesSnapshot[] = [
      { key: 'dwell', status: 'ready', data: [] },
      { key: 'throughput', status: 'ready', data: [{ tasks_succeeded: 2, tasks_failed: 0 }] },
      { key: 'points', status: 'ready', data: [] },
    ];
    expect(summarizeAnalyticsSeries(series)).toEqual({ hasFailure: false, allFailed: false, hasActivity: true, isEmpty: false });
  });

  it('keeps failed series distinct from an empty successful series', () => {
    const series: AnalyticsSeriesSnapshot[] = [
      { key: 'dwell', status: 'error', data: [] },
      { key: 'throughput', status: 'ready', data: [] },
    ];
    expect(summarizeAnalyticsSeries(series)).toEqual({ hasFailure: true, allFailed: false, hasActivity: false, isEmpty: false });
  });

  it('only reports whole-screen failure when every requested series fails', () => {
    expect(summarizeAnalyticsSeries([
      { key: 'dwell', status: 'error', data: [] },
      { key: 'throughput', status: 'error', data: [] },
    ])).toEqual({ hasFailure: true, allFailed: true, hasActivity: false, isEmpty: false });
  });

  it('counts an audit snapshot with a measured sample as activity', () => {
    expect(summarizeAnalyticsSeries([
      { key: 'audit', status: 'ready', data: { current: { sample_size: 3 } } },
    ])).toEqual({ hasFailure: false, allFailed: false, hasActivity: true, isEmpty: false });
    expect(summarizeAnalyticsSeries([
      { key: 'audit', status: 'ready', data: { current: { sample_size: 0 } } },
    ]).isEmpty).toBe(true);
  });
});
