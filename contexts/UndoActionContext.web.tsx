import React, { useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { UndoActionContext } from './UndoActionContext.shared';
import type { UndoActionContextValue, UndoRegistration } from './UndoActionContext.shared';

export const DEFAULT_UNDO_TTL_MS = 10_000;

type ActiveUndo = UndoRegistration & {
  id: number;
  toastId: string;
  expiryTimer: ReturnType<typeof setTimeout>;
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
}

export function UndoActionProvider({ children }: { children: React.ReactNode }) {
  const { showToast, dismissToast, successToast, errorToast } = useToast();
  const activeRef = useRef<ActiveUndo | null>(null);
  const sequenceRef = useRef(0);

  const clearActive = useCallback(() => {
    const active = activeRef.current;
    if (!active) return null;
    clearTimeout(active.expiryTimer);
    activeRef.current = null;
    dismissToast(active.toastId);
    return active;
  }, [dismissToast]);

  const executeUndo = useCallback(async () => {
    const active = clearActive();
    if (!active) return;

    try {
      await active.undo();
      successToast('The change was undone.', 'Undone');
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : (typeof error === 'object' && error !== null && 'message' in error && typeof (error as { message?: unknown }).message === 'string'
          ? (error as { message: string }).message
          : 'The change could not be undone.');
      errorToast(message || 'The change could not be undone.', 'Undo failed');
    }
  }, [clearActive, errorToast, successToast]);

  const registerUndo = useCallback((registration: UndoRegistration) => {
    if (!registration.label.trim() || typeof registration.undo !== 'function') return;

    clearActive();
    const ttlMs = Math.max(0, registration.ttlMs ?? DEFAULT_UNDO_TTL_MS);
    const id = ++sequenceRef.current;
    const expiryTimer = setTimeout(() => {
      if (activeRef.current?.id === id) clearActive();
    }, ttlMs);
    const toastId = showToast({
      type: 'info',
      title: 'Undo available',
      message: registration.label,
      duration: ttlMs,
      actionLabel: 'Undo',
      onPress: () => { void executeUndo(); },
    });
    activeRef.current = { ...registration, id, toastId, expiryTimer };
  }, [clearActive, executeUndo, showToast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return;
      if (!activeRef.current) return;
      event.preventDefault();
      void executeUndo();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearActive();
    };
  }, [clearActive, executeUndo]);

  const value = useMemo(() => ({ registerUndo }), [registerUndo]);
  return <UndoActionContext.Provider value={value}>{children}</UndoActionContext.Provider>;
}

export function useUndoAction() {
  const context = useContext(UndoActionContext);
  if (!context) throw new Error('useUndoAction must be used within UndoActionProvider');
  return context;
}

export { isEditableTarget };
