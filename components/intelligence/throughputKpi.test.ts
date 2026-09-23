import { describe, expect, it } from 'vitest';
import { mapThroughputKpi } from './throughputKpi';

describe('mapThroughputKpi', () => {
  it('preserves a measured zero and calculates its zero delta', () => {
    expect(mapThroughputKpi(0, 0)).toEqual({ value: 0, delta: 0 });
  });

  it('shows current throughput as unavailable when it is missing', () => {
    expect(mapThroughputKpi(null, 4)).toEqual({ value: null, delta: null });
  });

  it('omits the delta when either period is unavailable', () => {
    expect(mapThroughputKpi(4, undefined)).toEqual({ value: 4, delta: null });
  });

  it('rejects non-finite values as unavailable', () => {
    expect(mapThroughputKpi(Number.NaN, 4)).toEqual({ value: null, delta: null });
  });
});
