import { createContext } from 'react';
import type { PastedFile } from '@/lib/pasteImage';

export type StageEvidenceDraftContextValue = {
  submissionContent: string;
  setSubmissionContent: React.Dispatch<React.SetStateAction<string>>;
  stagedFiles: PastedFile[];
  setStagedFiles: React.Dispatch<React.SetStateAction<PastedFile[]>>;
  clearDraft: () => void;
};

export const StageEvidenceDraftContext = createContext<StageEvidenceDraftContextValue | null>(null);
