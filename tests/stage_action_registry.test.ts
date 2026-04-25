import { describe, it, expect } from 'vitest';
import { getActionDescriptor, isComplexActionType, splitStageActions } from '@/components/task-detail/actionRegistry';

describe('actionRegistry', () => {
  it('classifies submit_work into submission slot and submit route', () => {
    const descriptor = getActionDescriptor('submit_work');

    expect(descriptor.uiSlot).toBe('submission');
    expect(descriptor.executionRoute).toBe('submit_work');
    expect(descriptor.isComplex).toBe(true);
  });

  it('classifies review actions into review slot', () => {
    const descriptor = getActionDescriptor('review_approve');

    expect(descriptor.uiSlot).toBe('review');
    expect(descriptor.executionRoute).toBe('review_submission');
    expect(descriptor.isComplex).toBe(true);
  });

  it('falls back unknown actions to generic button behavior', () => {
    const descriptor = getActionDescriptor('custom_escalation');

    expect(descriptor.uiSlot).toBe('button');
    expect(descriptor.executionRoute).toBe('generic');
    expect(descriptor.isComplex).toBe(false);
    expect(isComplexActionType('custom_escalation')).toBe(false);
  });

  it('splits stage actions by registry slot', () => {
    const split = splitStageActions([
      { id: 'a1', action_type: 'submit_work' },
      { id: 'a2', action_type: 'review_reject' },
      { id: 'a3', action_type: 'advance' },
    ]);

    expect(split.submission.map((a) => a.id)).toEqual(['a1']);
    expect(split.review.map((a) => a.id)).toEqual(['a2']);
    expect(split.buttons.map((a) => a.id)).toEqual(['a3']);
  });
});

