import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'expo-router';
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
type RegisteredTarget = { scopeKey: string; configRef: ConfigRef };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof (error as any).message === 'string') return (error as any).message;
  return 'Could not paste files.';
}

export function TaskFilePasteProvider({ children, scopeKey }: { children: React.ReactNode; scopeKey?: string }) {
  const { infoToast, errorToast } = useToast();
  const routePathname = usePathname();
  const activeScopeKey = scopeKey ?? routePathname;
  const targetsRef = useRef(new Map<TaskFilePasteTargetId, RegisteredTarget>());
  const scopeRef = useRef(activeScopeKey);
  const armedIdRef = useRef<TaskFilePasteTargetId | null>(null);
  const [armedId, setArmedId] = useState<TaskFilePasteTargetId | null>(null);
  const [registryVersion, setRegistryVersion] = useState(0);

  if (scopeRef.current !== activeScopeKey) {
    scopeRef.current = activeScopeKey;
    armedIdRef.current = null;
    setArmedId(null);
  }

  const registerTarget = useCallback((id: TaskFilePasteTargetId, configRef: ConfigRef) => {
    targetsRef.current.set(id, { scopeKey: scopeRef.current, configRef });
    setRegistryVersion(version => version + 1);
    return () => {
      const current = targetsRef.current.get(id);
      if (!current || current.configRef !== configRef) return;
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
    const registered = targetsRef.current.get(id);
    if (!registered || registered.scopeKey !== scopeRef.current) return;
    const target = registered.configRef.current;
    if (!target) return;
    armedIdRef.current = id;
    setArmedId(id);
    infoToast(`Files will be pasted into ${target.label}.`, 'Paste destination armed');
  }, [infoToast]);

  const onFiles = useCallback(async (files: File[]) => {
    const pasteScopeKey = scopeRef.current;
    const id = armedIdRef.current;
    const registered = id ? targetsRef.current.get(id) : null;
    const target = registered?.scopeKey === scopeRef.current ? registered.configRef.current : null;
    if (!target || !target.enabled) return;
    const { accepted, skipped } = dedupeTaskFilePaste(files, target.existingFiles as any[]);
    if (!accepted.length) {
      infoToast(`${target.label}: all pasted files were already present.`, 'Nothing new to paste');
      return;
    }
    try {
      const result = await target.onFiles(accepted);
      if (result === false) return;
      if (scopeRef.current !== pasteScopeKey) return;
      const skippedText = skipped ? ` ${skipped} skipped as duplicate${skipped === 1 ? '' : 's'}.` : '';
      infoToast(`${target.label}: added ${accepted.length} file${accepted.length === 1 ? '' : 's'}.${skippedText}`, 'Files pasted');
    } catch (error) {
      if (scopeRef.current !== pasteScopeKey) return;
      errorToast(`${target.label}: ${errorMessage(error)}`, 'Paste failed');
    }
  }, [errorToast, infoToast]);

  const activeEligible = useMemo(() => {
    if (!armedId) return false;
    const registered = targetsRef.current.get(armedId);
    return registered?.scopeKey === activeScopeKey && !!registered.configRef.current.enabled;
  }, [activeScopeKey, armedId, registryVersion]);

  // Exactly one route-scoped smart-paste hook. Target changes update refs and
  // eligibility; target callback changes never create additional listeners.
  useSmartPaste({ onFiles }, activeEligible);

  useEffect(() => () => {
    targetsRef.current.clear();
    scopeRef.current = '';
    armedIdRef.current = null;
  }, []);

  const value = useMemo<TaskFilePasteContextValue>(() => ({
    registerTarget,
    updateTarget,
    armTarget,
    armedId,
    scopeKey: activeScopeKey,
  }), [activeScopeKey, armTarget, armedId, registerTarget, updateTarget]);

  return <TaskFilePasteContext.Provider value={value}>{children}</TaskFilePasteContext.Provider>;
}

export function useTaskFilePasteTarget(config: TaskFilePasteTargetConfig) {
  const context = React.useContext(TaskFilePasteContext);
  const registerTarget = context?.registerTarget;
  const updateTarget = context?.updateTarget;
  const armTarget = context?.armTarget;
  const scopeKey = context?.scopeKey;
  const configRef = useRef(config);
  configRef.current = config;

  useEffect(() => {
    if (!registerTarget) return;
    const unregister = registerTarget(config.id, configRef);
    return unregister;
  }, [registerTarget, config.id, scopeKey]);

  useEffect(() => {
    updateTarget?.(config.id);
  }, [updateTarget, config.id, config.enabled]);

  return {
    isArmed: context?.armedId === config.id,
    arm: useCallback(() => armTarget?.(config.id), [armTarget, config.id]),
  };
}
