import React, { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { RefObject } from 'react';
import { View } from 'react-native';
import { initialTourState, tourReducer } from './tourReducer';
import type { TourStep } from './types';

type TourContextValue = {
  registerTarget: (id: string, ref: RefObject<View>) => void;
  unregisterTarget: (id: string) => void;
  getTarget: (id: string) => RefObject<View> | undefined;
  registerAction: (id: string, fn: () => void) => void;
  unregisterAction: (id: string) => void;
  runAction: (id: string) => void;
  active: boolean;
  current: TourStep | null;
  index: number;
  total: number;
  startTour: (steps: TourStep[]) => void;
  next: () => void;
  back: () => void;
  end: () => void;
};

const TourContext = createContext<TourContextValue | null>(null);

export function TourProvider({ children }: { children: React.ReactNode }) {
  const targets = useRef(new Map<string, RefObject<View>>()).current;
  const actions = useRef(new Map<string, () => void>()).current;
  const [state, dispatch] = useReducer(tourReducer, initialTourState);

  const registerTarget = useCallback((id: string, ref: RefObject<View>) => { targets.set(id, ref); }, [targets]);
  const unregisterTarget = useCallback((id: string) => { targets.delete(id); }, [targets]);
  const getTarget = useCallback((id: string) => targets.get(id), [targets]);
  const registerAction = useCallback((id: string, fn: () => void) => { actions.set(id, fn); }, [actions]);
  const unregisterAction = useCallback((id: string) => { actions.delete(id); }, [actions]);
  const runAction = useCallback((id: string) => { actions.get(id)?.(); }, [actions]);

  const startTour = useCallback((steps: TourStep[]) => dispatch({ type: 'START', steps }), []);
  const next = useCallback(() => dispatch({ type: 'NEXT' }), []);
  const back = useCallback(() => dispatch({ type: 'BACK' }), []);
  const end = useCallback(() => dispatch({ type: 'END' }), []);

  const current = state.steps[state.index] ?? null;

  const value = useMemo<TourContextValue>(() => ({
    registerTarget, unregisterTarget, getTarget,
    registerAction, unregisterAction, runAction,
    active: state.steps.length > 0,
    current,
    index: state.index,
    total: state.steps.length,
    startTour, next, back, end,
  }), [registerTarget, unregisterTarget, getTarget, registerAction, unregisterAction, runAction, state, current, startTour, next, back, end]);

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

function useTourContext(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('Tour hooks must be used within a TourProvider');
  return ctx;
}

/**
 * Register a View so tour steps can target it by `id`. Safe to call with an
 * undefined id (e.g. a shared component only sometimes used in a tour) —
 * the hook always runs, registration just no-ops.
 */
export function useTourTarget(id?: string): RefObject<View> {
  const { registerTarget, unregisterTarget } = useTourContext();
  const ref = useRef<View | null>(null);
  useEffect(() => {
    if (!id) return;
    registerTarget(id, ref as RefObject<View>);
    return () => unregisterTarget(id);
  }, [id, registerTarget, unregisterTarget]);
  return ref as RefObject<View>;
}

/** Register a callback a tour step can trigger by id before it measures its target (e.g. opening a drawer). */
export function useTourAction(id: string, fn: () => void) {
  const { registerAction, unregisterAction } = useTourContext();
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    const stable = () => fnRef.current();
    registerAction(id, stable);
    return () => unregisterAction(id);
  }, [id, registerAction, unregisterAction]);
}

export function useTour() {
  const { active, current, index, total, startTour, next, back, end, getTarget, runAction } = useTourContext();
  return { active, current, index, total, startTour, next, back, end, getTarget, runAction };
}
