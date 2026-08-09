import { describe, expect, it } from 'vitest';
import { initialTourState, tourReducer } from './tourReducer';
import type { TourStep } from './types';

const steps: TourStep[] = [
  { targetId: 'a', body: 'first' },
  { targetId: 'b', body: 'second' },
  { targetId: 'c', body: 'third' },
];

describe('tourReducer', () => {
  it('starts a tour at index 0 with the given steps', () => {
    const state = tourReducer(initialTourState, { type: 'START', steps });
    expect(state).toEqual({ steps, index: 0 });
  });

  it('advances on NEXT', () => {
    const started = tourReducer(initialTourState, { type: 'START', steps });
    const next = tourReducer(started, { type: 'NEXT' });
    expect(next.index).toBe(1);
    expect(next.steps).toBe(steps);
  });

  it('ends the tour when NEXT is called on the last step', () => {
    let state = tourReducer(initialTourState, { type: 'START', steps });
    state = tourReducer(state, { type: 'NEXT' }); // index 1
    state = tourReducer(state, { type: 'NEXT' }); // index 2 (last)
    state = tourReducer(state, { type: 'NEXT' }); // past last -> ends
    expect(state).toEqual({ steps: [], index: 0 });
  });

  it('moves back but never below index 0', () => {
    let state = tourReducer(initialTourState, { type: 'START', steps });
    state = tourReducer(state, { type: 'NEXT' });
    state = tourReducer(state, { type: 'BACK' });
    expect(state.index).toBe(0);
    state = tourReducer(state, { type: 'BACK' });
    expect(state.index).toBe(0);
  });

  it('END clears the tour regardless of position', () => {
    let state = tourReducer(initialTourState, { type: 'START', steps });
    state = tourReducer(state, { type: 'NEXT' });
    state = tourReducer(state, { type: 'END' });
    expect(state).toEqual({ steps: [], index: 0 });
  });
});
