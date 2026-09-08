import { usePathname } from 'expo-router';
import React, { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useStagedFileLifecycle } from '@/hooks/useStagedFileLifecycle';
import {
  StageEvidenceDraftContext,
  type StageEvidenceDraftContextValue,
} from './StageEvidenceDraftContext.shared';

/**
 * Owns the unsent Stage Evidence composer at the stable web route boundary.
 * The layout keys this provider by pathname, so responsive subtree remounts
 * preserve the draft while navigation clears it and revokes staged URLs.
 */
type DraftState = {
  scopeKey: string;
  submissionContent: string;
  stagedFiles: StageEvidenceDraftContextValue['stagedFiles'];
};

export function StageEvidenceDraftProvider({ children, scopeKey }: { children: React.ReactNode; scopeKey?: string }) {
  const routePathname = usePathname();
  const activeScopeKey = scopeKey ?? routePathname;
  const previousScopeRef = useRef(activeScopeKey);
  const [draft, setDraft] = useState<DraftState>({ scopeKey: activeScopeKey, submissionContent: '', stagedFiles: [] });

  // Reset during render so a new route never paints the prior task's draft;
  // the existing lifecycle hook revokes the prior scope's blob URLs once.
  if (previousScopeRef.current !== activeScopeKey) {
    previousScopeRef.current = activeScopeKey;
    setDraft({ scopeKey: activeScopeKey, submissionContent: '', stagedFiles: [] });
  }

  useStagedFileLifecycle(draft.stagedFiles);

  const setSubmissionContent = useCallback<StageEvidenceDraftContextValue['setSubmissionContent']>(value => {
    setDraft(current => ({ ...current, submissionContent: typeof value === 'function' ? value(current.submissionContent) : value }));
  }, []);

  const setStagedFiles = useCallback<StageEvidenceDraftContextValue['setStagedFiles']>(value => {
    setDraft(current => ({ ...current, stagedFiles: typeof value === 'function' ? value(current.stagedFiles) : value }));
  }, []);

  const clearDraft = useCallback(() => {
    setDraft(current => ({ ...current, submissionContent: '', stagedFiles: [] }));
  }, []);

  const value = useMemo<StageEvidenceDraftContextValue>(() => ({
    submissionContent: draft.submissionContent,
    setSubmissionContent,
    stagedFiles: draft.stagedFiles,
    setStagedFiles,
    clearDraft,
  }), [clearDraft, draft, setStagedFiles, setSubmissionContent]);

  return <StageEvidenceDraftContext.Provider value={value}>{children}</StageEvidenceDraftContext.Provider>;
}

export function useStageEvidenceDraft(): StageEvidenceDraftContextValue {
  const context = useContext(StageEvidenceDraftContext);
  if (!context) throw new Error('useStageEvidenceDraft must be used within StageEvidenceDraftProvider');
  return context;
}
