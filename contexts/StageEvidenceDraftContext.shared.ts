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

export const StageEvidenceDraftContext = createContext<StageEvidenceDraftContextValue | null>(null);
