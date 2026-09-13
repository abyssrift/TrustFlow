import assert from 'node:assert';
import {
  normalizeUploadCommitResult,
  normalizeUploadTarget,
  type UploadTarget,
} from './uploadTargetNormalization';

{
  const target: UploadTarget = { kind: 'task', taskId: 'task-1', folderId: 'folder-1' };
  assert.deepEqual(normalizeUploadTarget(target), {
    visibility: 'task',
    folderId: 'folder-1',
    recipientIds: [],
    groupId: null,
    taskId: 'task-1',
    projectId: null,
    replaceFileId: null,
    replaceAttachmentId: null,
  });
}

{
  const target: UploadTarget = { kind: 'project', projectId: 'project-1' };
  assert.deepEqual(normalizeUploadTarget(target), {
    visibility: 'project',
    folderId: null,
    recipientIds: [],
    groupId: null,
    taskId: null,
    projectId: 'project-1',
    replaceFileId: null,
    replaceAttachmentId: null,
  });
}

assert.deepEqual(normalizeUploadCommitResult({ file_id: 'file-1', version_id: 'version-1' }), {
  fileId: 'file-1',
  fileVersionId: 'version-1',
  versionId: 'version-1',
});
assert.deepEqual(normalizeUploadCommitResult({ fileId: 'file-1b', fileVersionId: 'version-1b' }), {
  fileId: 'file-1b',
  fileVersionId: 'version-1b',
  versionId: 'version-1b',
});
assert.deepEqual(normalizeUploadCommitResult({ id: 'version-2', fileId: 'file-2' }), {
  fileId: 'file-2',
  fileVersionId: 'version-2',
  versionId: 'version-2',
});
assert.deepEqual(normalizeUploadCommitResult('file-legacy'), {
  fileId: 'file-legacy',
  fileVersionId: null,
  versionId: null,
});

console.log('uploadTargetNormalization: all checks passed');
