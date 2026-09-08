import { createContext } from 'react';

export type UndoRegistration = {
  label: string;
  undo: () => void | Promise<void>;
  ttlMs?: number;
};

export type UndoActionContextValue = {
  registerUndo: (registration: UndoRegistration) => void;
};

export const noopUndo: UndoActionContextValue = { registerUndo: () => {} };
export const UndoActionContext = createContext<UndoActionContextValue | null>(null);
