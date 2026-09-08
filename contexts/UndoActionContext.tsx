import React, { useContext } from 'react';
import { UndoActionContext, noopUndo } from './UndoActionContext.shared';
export type { UndoRegistration } from './UndoActionContext.shared';

/** Native-safe stub. Undo is a web-only affordance and has no native shortcut. */
export function UndoActionProvider({ children }: { children: React.ReactNode }) {
  return <UndoActionContext.Provider value={noopUndo}>{children}</UndoActionContext.Provider>;
}

export function useUndoAction() {
  return useContext(UndoActionContext) ?? noopUndo;
}
