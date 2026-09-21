import { reconcileMutationSelection } from './multiSelection';

export type FileHubSelection = {
  fileIds: Iterable<string>;
  folderIds: Iterable<string>;
};

export type FileHubMutationOutcome = {
  succeededFileIds: Iterable<string>;
  succeededFolderIds: Iterable<string>;
};

export type FileHubMutation = {
  kind: 'file' | 'folder';
  id: string;
  run: () => Promise<unknown>;
};

export async function settleFileHubMutations(mutations: FileHubMutation[]): Promise<{
  succeededFileIds: string[];
  succeededFolderIds: string[];
  failedFileIds: string[];
  failedFolderIds: string[];
}> {
  const results = await Promise.all(mutations.map(async mutation => {
    try {
      const result = await mutation.run();
      return { ...mutation, ok: result !== false };
    } catch {
      return { ...mutation, ok: false };
    }
  }));
  return {
    succeededFileIds: results.filter(result => result.kind === 'file' && result.ok).map(result => result.id),
    succeededFolderIds: results.filter(result => result.kind === 'folder' && result.ok).map(result => result.id),
    failedFileIds: results.filter(result => result.kind === 'file' && !result.ok).map(result => result.id),
    failedFolderIds: results.filter(result => result.kind === 'folder' && !result.ok).map(result => result.id),
  };
}

/**
 * Keep FileHub's two identity domains separate while applying the shared
 * mutation-selection contract: only confirmed successes are pruned.
 */
export function reconcileFileHubSelection(
  selected: FileHubSelection,
  outcome: FileHubMutationOutcome,
): { fileIds: string[]; folderIds: string[] } {
  return {
    fileIds: reconcileMutationSelection(selected.fileIds, outcome.succeededFileIds),
    folderIds: reconcileMutationSelection(selected.folderIds, outcome.succeededFolderIds),
  };
}
