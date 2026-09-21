import { describe, expect, it } from 'vitest';
import { getThroughputPresentation } from './throughputPresentation';

describe('getThroughputPresentation', () => {
  it('leaves buckets with no outcomes visually empty', () => {
    expect(getThroughputPresentation(0, 0)).toEqual({
      hasOutcomes: false,
      successPct: 0,
      failurePct: 0,
    });
  });

  it('shows measured failures as a fully failed bucket', () => {
    expect(getThroughputPresentation(0, 4)).toEqual({
      hasOutcomes: true,
      successPct: 0,
      failurePct: 100,
    });
  });
});
