import React, { useContext } from 'react';
import { TaskFilePasteContext } from './TaskFilePasteContext.shared';
export type { TaskFilePasteTargetId, TaskFilePasteTargetConfig, TaskFilePasteTargetValue } from './TaskFilePasteContext.shared';

export function TaskFilePasteProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useTaskFilePasteTarget(_config: Omit<import('./TaskFilePasteContext.shared').TaskFilePasteTargetConfig, 'id'> & { id: import('./TaskFilePasteContext.shared').TaskFilePasteTargetId }): import('./TaskFilePasteContext.shared').TaskFilePasteTargetValue {
  const context = useContext(TaskFilePasteContext);
  return { isArmed: context?.armedId === _config.id, arm: () => context?.armTarget(_config.id) };
}
