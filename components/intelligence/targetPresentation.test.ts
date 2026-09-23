import { describe, expect, it } from 'vitest';
import { isTargetProgressRingEligible } from './targetPresentation';

describe('target progress ring eligibility', () => {
  it('allows measured volume zero with a positive target', () => {
    expect(isTargetProgressRingEligible({ target_type: 'volume', current_count: 0, target_quantity: 10 })).toBe(true);
  });

  it('rejects performance targets, missing counts, non-finite values, and nonpositive targets', () => {
    expect(isTargetProgressRingEligible({ target_type: 'performance', current_count: 5, target_quantity: 10 })).toBe(false);
    expect(isTargetProgressRingEligible({ target_type: 'volume', current_count: null, target_quantity: 10 })).toBe(false);
    expect(isTargetProgressRingEligible({ target_type: 'volume', current_count: Number.NaN, target_quantity: 10 })).toBe(false);
    expect(isTargetProgressRingEligible({ target_type: 'volume', current_count: 5, target_quantity: 0 })).toBe(false);
  });
});
