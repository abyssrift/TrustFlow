import { describe, expect, it } from 'vitest';

import { reconcileFileHubSelection, settleFileHubMutations } from './filehubSelection';

describe('reconcileFileHubSelection', () => {
  it('prunes successful files and folders while retaining failed identities', () => {
    expect(reconcileFileHubSelection(
      { fileIds: ['file-a', 'file-b'], folderIds: ['folder-a', 'folder-b'] },
      { succeededFileIds: ['file-a'], succeededFolderIds: ['folder-b'] },
    )).toEqual({ fileIds: ['file-b'], folderIds: ['folder-a'] });
  });
});

describe('settleFileHubMutations', () => {
  it('treats explicit false as failure and void as success', async () => {
    await expect(settleFileHubMutations([
      { kind: 'file', id: 'file-ok', run: async () => undefined },
      { kind: 'file', id: 'file-failed', run: async () => false },
      { kind: 'folder', id: 'folder-ok', run: async () => true },
    ])).resolves.toEqual({
      succeededFileIds: ['file-ok'],
      succeededFolderIds: ['folder-ok'],
      failedFileIds: ['file-failed'],
      failedFolderIds: [],
    });
  });
});
