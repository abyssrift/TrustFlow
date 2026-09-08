import { createContext } from 'react';

export const TASK_FILE_PASTE_TARGET_IDS = ['task-brief', 'stage-evidence'] as const;
export type TaskFilePasteTargetId = (typeof TASK_FILE_PASTE_TARGET_IDS)[number];

export type TaskFilePasteTargetConfig = {
  id: TaskFilePasteTargetId;
  label: string;
  enabled: boolean;
  existingFiles: readonly unknown[];
  onFiles: (files: File[]) => boolean | void | Promise<boolean | void>;
};

export type TaskFilePasteTargetValue = {
  isArmed: boolean;
  arm: () => void;
};

export type TaskFilePasteContextValue = {
  registerTarget: (id: TaskFilePasteTargetId, configRef: { current: TaskFilePasteTargetConfig }) => () => void;
  updateTarget: (id: TaskFilePasteTargetId) => void;
  armTarget: (id: TaskFilePasteTargetId) => void;
  armedId: TaskFilePasteTargetId | null;
  scopeKey: string;
};

export type TaskFilePasteProviderProps = {
  children: React.ReactNode;
  /** Stable route identity; width changes must not change this value. */
  scopeKey: string;
};

export const TaskFilePasteContext = createContext<TaskFilePasteContextValue | null>(null);
