import { describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/AnalyticsContext', () => ({ useAnalytics: () => ({}) }));

import { mapOverviewBuckets } from './usePipelineOverviewData';

describe('mapOverviewBuckets', () => {
  it('keeps a no-sample period unavailable instead of showing 0%', () => {
    expect(mapOverviewBuckets([
      { key: '2026-09-01', succeeded: 0, failed: 0, points: 4, hours: 1.25 },
    ], 'week')).toEqual([
      {
        key: '2026-09-01',
        label: 'W36',
        throughput: 0,
        points: 4,
        hours: 1.3,
        success_rate: null,
      },
    ]);
  });

  it('keeps failed-only periods at a measured 0%', () => {
    expect(mapOverviewBuckets([
      { key: '2026-09-08', succeeded: 0, failed: 3, points: 0, hours: 0 },
    ], 'week')[0].success_rate).toBe(0);
  });

  it('preserves real success rates', () => {
    expect(mapOverviewBuckets([
      { key: '2026-09-15', succeeded: 2, failed: 3, points: 7, hours: 2 },
    ], 'week')[0].success_rate).toBe(40);
  });
});
