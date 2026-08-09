import type { TourStep } from './types';

export type TourEngineState = { steps: TourStep[]; index: number };

export type TourEngineAction =
  | { type: 'START'; steps: TourStep[] }
  | { type: 'NEXT' }
  | { type: 'BACK' }
  | { type: 'END' };

export const initialTourState: TourEngineState = { steps: [], index: 0 };

export function tourReducer(state: TourEngineState, action: TourEngineAction): TourEngineState {
  switch (action.type) {
    case 'START':
      return { steps: action.steps, index: 0 };
    case 'NEXT':
      if (state.index >= state.steps.length - 1) return initialTourState;
      return { ...state, index: state.index + 1 };
    case 'BACK':
      return { ...state, index: Math.max(0, state.index - 1) };
    case 'END':
      return initialTourState;
    default:
      return state;
  }
}
