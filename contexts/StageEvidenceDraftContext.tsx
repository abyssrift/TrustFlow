import React, { useCallback, useState } from 'react';
import { useStagedFileLifecycle } from '@/hooks/useStagedFileLifecycle';
import type { PastedFile } from '@/lib/pasteImage';
import type { StageEvidenceDraftContextValue } from './StageEvidenceDraftContext.shared';

/** Native task detail does not replace its route subtree at the web breakpoint.
 * Keep the hook local so native callers retain their existing draft ownership. */
export function StageEvidenceDraftProvider({ children, scopeKey: _scopeKey }: { children: React.ReactNode; scopeKey?: string }) {
  return <>{children}</>;
}

export function useStageEvidenceDraft(): StageEvidenceDraftContextValue {
  const [submissionContent, setSubmissionContent] = useState('');
  const [stagedFiles, setStagedFiles] = useState<PastedFile[]>([]);
  useStagedFileLifecycle(stagedFiles);
  const clearDraft = useCallback(() => {
    setSubmissionContent('');
    setStagedFiles([]);
  }, []);
  return { submissionContent, setSubmissionContent, stagedFiles, setStagedFiles, clearDraft };
}
