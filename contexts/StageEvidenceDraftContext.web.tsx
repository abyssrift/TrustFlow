import React, { useCallback, useContext, useMemo, useState } from 'react';
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
export function StageEvidenceDraftProvider({ children }: { children: React.ReactNode }) {
  const [submissionContent, setSubmissionContent] = useState('');
  const [stagedFiles, setStagedFiles] = useState<StageEvidenceDraftContextValue['stagedFiles']>([]);
  useStagedFileLifecycle(stagedFiles);

  const clearDraft = useCallback(() => {
    setSubmissionContent('');
    setStagedFiles([]);
  }, []);

  const value = useMemo<StageEvidenceDraftContextValue>(() => ({
    submissionContent,
    setSubmissionContent,
    stagedFiles,
    setStagedFiles,
    clearDraft,
  }), [clearDraft, stagedFiles, submissionContent]);

  return <StageEvidenceDraftContext.Provider value={value}>{children}</StageEvidenceDraftContext.Provider>;
}

export function useStageEvidenceDraft(): StageEvidenceDraftContextValue {
  const context = useContext(StageEvidenceDraftContext);
  if (!context) throw new Error('useStageEvidenceDraft must be used within StageEvidenceDraftProvider');
  return context;
}
