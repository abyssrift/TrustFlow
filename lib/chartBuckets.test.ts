import { describe, expect, it } from 'vitest';
import { bucketLabel, bucketsForWidth, MAX_BUCKETS, MIN_BUCKETS } from './chartBuckets';

describe('bucketsForWidth', () => {
  it('clamps small screens to the minimum', () => {
    expect(bucketsForWidth(390)).toBe(MIN_BUCKETS);
  });
  it('grows with screen width', () => {
    expect(bucketsForWidth(1280)).toBe(11);
    expect(bucketsForWidth(1920)).toBe(17);
  });
  it('clamps very wide screens to the maximum', () => {
    expect(bucketsForWidth(5000)).toBe(MAX_BUCKETS);
  });
});

describe('bucketLabel', () => {
  it('collapses single-day buckets to one date', () => {
    expect(bucketLabel('2026-07-05', '2026-07-06')).toMatch(/Jul.*5/);
  });
  it('labels calendar months as month name', () => {
    expect(bucketLabel('2026-07-01', '2026-08-01')).toMatch(/Jul.*2026/);
  });
  it('labels arbitrary spans as a date range with inclusive end', () => {
    const label = bucketLabel('2026-07-05', '2026-07-12');
    expect(label).toMatch(/Jul.*5/);
    expect(label).toMatch(/Jul.*11/); // exclusive end date not shown
  });
});
