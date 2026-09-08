import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { useSmartPaste } from '@/hooks/useWebDnd';
import { dedupeTaskFilePaste } from '@/lib/taskFilePaste';
import {
  TaskFilePasteContext,
  type TaskFilePasteContextValue,
  type TaskFilePasteTargetConfig,
  type TaskFilePasteTargetId,
} from './TaskFilePasteContext.shared';

type ConfigRef = { current: TaskFilePasteTargetConfig };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof (error as any).message === 'string') return (error as any).message;
  return 'Could not paste files.';
}

export function TaskFilePasteProvider({ children }: { children: React.ReactNode }) {
  const { infoToast, errorToast } = useToast();
  const targetsRef = useRef(new Map<TaskFilePasteTargetId, ConfigRef>());
  const armedIdRef = useRef<TaskFilePasteTargetId | null>(null);
  const [armedId, setArmedId] = useState<TaskFilePasteTargetId | null>(null);
  const [registryVersion, setRegistryVersion] = useState(0);

  const registerTarget = useCallback((id: TaskFilePasteTargetId, configRef: ConfigRef) => {
    targetsRef.current.set(id, configRef);
    setRegistryVersion(version => version + 1);
    return () => {
      if (targetsRef.current.get(id) !== configRef) return;
      targetsRef.current.delete(id);
      // Keep the route-scoped selection while a conditional target is absent;
      // re-registration restores eligibility without another arm toast.
      setRegistryVersion(version => version + 1);
    };
  }, []);

  const updateTarget = useCallback((_id: TaskFilePasteTargetId) => {
    setRegistryVersion(version => version + 1);
  }, []);

  const armTarget = useCallback((id: TaskFilePasteTargetId) => {
    const target = targetsRef.current.get(id)?.current;
    if (!target) return;
    armedIdRef.current = id;
    setArmedId(id);
    infoToast(`Files will be pasted into ${target.label}.`, 'Paste destination armed');
  }, [infoToast]);

  const onFiles = useCallback(async (files: File[]) => {
    const id = armedIdRef.current;
    const target = id ? targetsRef.current.get(id)?.current : null;
    if (!target || !target.enabled) return;
    const { accepted, skipped } = dedupeTaskFilePaste(files, target.existingFiles as any[]);
    if (!accepted.length) {
      infoToast(`${target.label}: all pasted files were already present.`, 'Nothing new to paste');
      return;
    }
    try {
      const result = await target.onFiles(accepted);
      if (result === false) return;
      const skippedText = skipped ? ` ${skipped} skipped as duplicate${skipped === 1 ? '' : 's'}.` : '';
      infoToast(`${target.label}: added ${accepted.length} file${accepted.length === 1 ? '' : 's'}.${skippedText}`, 'Files pasted');
    } catch (error) {
      errorToast(`${target.label}: ${errorMessage(error)}`, 'Paste failed');
    }
  }, [errorToast, infoToast]);

  const activeEligible = useMemo(() => {
    if (!armedId) return false;
    return !!targetsRef.current.get(armedId)?.current.enabled;
  }, [armedId, registryVersion]);

  // Exactly one route-scoped smart-paste hook. Target changes update refs and
  // eligibility; target callback changes never create additional listeners.
  useSmartPaste({ onFiles }, activeEligible);

  useEffect(() => () => {
    targetsRef.current.clear();
    armedIdRef.current = null;
  }, []);

  const value = useMemo<TaskFilePasteContextValue>(() => ({
    registerTarget,
    updateTarget,
    armTarget,
    armedId,
  }), [armTarget, armedId, registerTarget, updateTarget]);

  return <TaskFilePasteContext.Provider value={value}>{children}</TaskFilePasteContext.Provider>;
}

export function useTaskFilePasteTarget(config: TaskFilePasteTargetConfig) {
  const context = React.useContext(TaskFilePasteContext);
  const registerTarget = context?.registerTarget;
  const updateTarget = context?.updateTarget;
  const armTarget = context?.armTarget;
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (!registerTarget) return;
    const unregister = registerTarget(config.id, configRef);
    return unregister;
  }, [registerTarget, config.id]);

  useEffect(() => {
    updateTarget?.(config.id);
  }, [updateTarget, config.id, config.enabled]);

  return {
    isArmed: context?.armedId === config.id,
    arm: useCallback(() => armTarget?.(config.id), [armTarget, config.id]),
  };
}
