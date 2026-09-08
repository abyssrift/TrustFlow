import { createContext } from 'react';
import type { PastedFile } from '@/lib/pasteImage';

export type StageEvidenceDraftContextValue = {
  submissionContent: string;
  setSubmissionContent: React.Dispatch<React.SetStateAction<string>>;
  stagedFiles: PastedFile[];
  setStagedFiles: React.Dispatch<React.SetStateAction<PastedFile[]>>;
  clearDraft: () => void;
};

export type StageEvidenceDraftProviderProps = {
  children: React.ReactNode;
  /** Stable route identity; responsive layout changes must not alter it. */
  scopeKey: string;
};

export type StageEvidenceDraftState = {
  scopeKey: string;
  submissionContent: string;
  stagedFiles: PastedFile[];
};

export const blankStageEvidenceDraft = (scopeKey: string): StageEvidenceDraftState => ({
  scopeKey,
  submissionContent: '',
  stagedFiles: [],
});

export function projectStageEvidenceDraft(
  draft: StageEvidenceDraftState,
  scopeKey: string,
): StageEvidenceDraftState {
  return draft.scopeKey === scopeKey ? draft : blankStageEvidenceDraft(scopeKey);
}

export function updateStageEvidenceDraft(
  draft: StageEvidenceDraftState,
  expectedScope: string,
  liveScope: string,
  update: (draft: StageEvidenceDraftState) => StageEvidenceDraftState,
): StageEvidenceDraftState {
  if (liveScope !== expectedScope) return draft;
  return update(projectStageEvidenceDraft(draft, expectedScope));
}

export const StageEvidenceDraftContext = createContext<StageEvidenceDraftContextValue | null>(null);
