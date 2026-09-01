// Global modal dispatcher (#322, command-palette Phase 2a).
//
// One place that answers "which create/compose modal is open, and with what
// seed data?" so any surface — the command palette (#325), the FAB, a screen
// header, a deep link (#324) — can summon one without prop-drilling a `visible`
// bool down from a screen.
//
// This file is INFRA ONLY. It does not render any modal. #323 adds a
// <ModalHost> that reads `active` and mounts the real components (each still
// living in its own file, wrapped in whatever data provider it needs —
// e.g. TaskCreationProvider for CreateTaskModal).
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type ModalType =
  | 'create-task'
  | 'create-project'
  | 'create-portfolio'
  | 'upload'
  | 'generate-report'
  | 'new-role';

// Per-modal seed data. Every field optional — summoning with no payload opens a
// blank modal. #323 widens these as it wires each modal to its real props.
export type ModalPayloads = {
  'create-task': { projectId?: string; pipelineId?: string };
  'create-project': { portfolioId?: string };
  'create-portfolio': {};
  'upload': { folderId?: string; taskId?: string };
  'generate-report': {};
  'new-role': {};
};

// Discriminated union: `active.payload` is narrowed by `active.type`.
export type ActiveModal = { [K in ModalType]: { type: K; payload: ModalPayloads[K] } }[ModalType];

type ModalDispatchValue = {
  active: ActiveModal | null;
  summon: <K extends ModalType>(type: K, payload?: ModalPayloads[K]) => void;
  dismiss: () => void;
};

const ModalDispatchContext = createContext<ModalDispatchValue | null>(null);

export const useModalDispatch = () => {
  const ctx = useContext(ModalDispatchContext);
  if (!ctx) throw new Error('useModalDispatch must be used within ModalDispatchProvider');
  return ctx;
};

export function ModalDispatchProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<ActiveModal | null>(null);

  const summon = useCallback(<K extends ModalType>(type: K, payload?: ModalPayloads[K]) => {
    // Last summon wins — opening a second modal replaces the first rather than
    // stacking. No create/compose flow here needs a stack.
    setActive({ type, payload: (payload ?? {}) as ModalPayloads[K] } as ActiveModal);
  }, []);

  const dismiss = useCallback(() => setActive(null), []);

  const value = useMemo(() => ({ active, summon, dismiss }), [active, summon, dismiss]);

  return <ModalDispatchContext.Provider value={value}>{children}</ModalDispatchContext.Provider>;
}
