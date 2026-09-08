import { usePathname } from 'expo-router';
import React, { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useStagedFileLifecycle } from '@/hooks/useStagedFileLifecycle';
import {
  blankStageEvidenceDraft,
  StageEvidenceDraftContext,
  type StageEvidenceDraftContextValue,
  type StageEvidenceDraftState,
  projectStageEvidenceDraft,
  updateStageEvidenceDraft,
} from './StageEvidenceDraftContext.shared';

/**
 * Owns the unsent Stage Evidence composer at the stable web route boundary.
 * The layout passes pathname as scopeKey, so responsive subtree remounts
 * preserve the draft while navigation clears it and revokes staged URLs.
 */
export function StageEvidenceDraftProvider({ children, scopeKey }: { children: React.ReactNode; scopeKey?: string }) {
  const routePathname = usePathname();
  const activeScopeKey = scopeKey ?? routePathname;
  const scopeRef = useRef(activeScopeKey);
  scopeRef.current = activeScopeKey;
  const [draft, setDraft] = useState<StageEvidenceDraftState>(() => blankStageEvidenceDraft(activeScopeKey));
  const activeDraft = projectStageEvidenceDraft(draft, activeScopeKey);

  // Normalize stored state after the synchronous derived blank has rendered;
  // this prevents a stale route's async setter from repopulating the new one.
  React.useEffect(() => {
    setDraft(current => projectStageEvidenceDraft(current, activeScopeKey));
  }, [activeScopeKey]);

  useStagedFileLifecycle(activeDraft.stagedFiles);

  const setSubmissionContent = useCallback<StageEvidenceDraftContextValue['setSubmissionContent']>(value => {
    const expectedScope = activeScopeKey;
    if (scopeRef.current !== expectedScope) return;
    setDraft(current => updateStageEvidenceDraft(current, expectedScope, scopeRef.current, base => ({
      ...base,
      submissionContent: typeof value === 'function' ? value(base.submissionContent) : value,
    })));
  }, [activeScopeKey]);

  const setStagedFiles = useCallback<StageEvidenceDraftContextValue['setStagedFiles']>(value => {
    const expectedScope = activeScopeKey;
    if (scopeRef.current !== expectedScope) return;
    setDraft(current => updateStageEvidenceDraft(current, expectedScope, scopeRef.current, base => ({
      ...base,
      stagedFiles: typeof value === 'function' ? value(base.stagedFiles) : value,
    })));
  }, [activeScopeKey]);

  const clearDraft = useCallback(() => {
    const expectedScope = activeScopeKey;
    if (scopeRef.current !== expectedScope) return;
    setDraft(current => updateStageEvidenceDraft(current, expectedScope, scopeRef.current, () => blankStageEvidenceDraft(expectedScope)));
  }, [activeScopeKey]);

  const value = useMemo<StageEvidenceDraftContextValue>(() => ({
    submissionContent: activeDraft.submissionContent,
    setSubmissionContent,
    stagedFiles: activeDraft.stagedFiles,
    setStagedFiles,
    clearDraft,
  }), [activeDraft, clearDraft, setStagedFiles, setSubmissionContent]);

  return <StageEvidenceDraftContext.Provider value={value}>{children}</StageEvidenceDraftContext.Provider>;
}

export function useStageEvidenceDraft(): StageEvidenceDraftContextValue {
  const context = useContext(StageEvidenceDraftContext);
  if (!context) throw new Error('useStageEvidenceDraft must be used within StageEvidenceDraftProvider');
  return context;
}
