export type UploadVisibility = 'direct' | 'broadcast' | 'group' | 'task' | 'project';

export type UploadDestination =
  | { kind: 'filehub'; visibility: 'direct' | 'broadcast' | 'group'; folderId?: string | null; groupId?: string | null }
  | { kind: 'project'; projectId: string; folderId?: string | null };

export type UploadTarget =
  | { kind: 'task'; taskId: string; folderId?: string | null; replaceFileId?: string | null; replaceAttachmentId?: string | null }
  | { kind: 'project'; projectId: string; folderId?: string | null; replaceFileId?: string | null };

export type NormalizedUploadTarget = {
  visibility: UploadVisibility;
  folderId: string | null;
  recipientIds: string[];
  groupId: string | null;
  taskId: string | null;
  projectId: string | null;
  replaceFileId: string | null;
  replaceAttachmentId: string | null;
};

export type UploadCommitIdentity = { fileId: string; fileVersionId: string | null; versionId: string | null };

export function normalizeUploadDestination(
  destination: UploadDestination,
  authorizedProjectFolderIds?: ReadonlySet<string>,
): NormalizedUploadTarget {
  if (destination.kind === 'filehub') {
    return {
      visibility: destination.visibility,
      folderId: destination.folderId ?? null,
      recipientIds: [],
      groupId: destination.groupId ?? null,
      taskId: null,
      projectId: null,
      replaceFileId: null,
      replaceAttachmentId: null,
    };
  }
  if (!destination.projectId.trim()) throw new Error('Project upload destination is incomplete.');
  if (destination.folderId && authorizedProjectFolderIds && !authorizedProjectFolderIds.has(destination.folderId)) {
    throw new Error('Project upload folder is outside the authorized project workspace.');
  }
  return {
    visibility: 'project',
    folderId: destination.folderId ?? null,
    recipientIds: [],
    groupId: null,
    taskId: null,
    projectId: destination.projectId,
    replaceFileId: null,
    replaceAttachmentId: null,
  };
}

export function normalizeUploadTarget(target: UploadTarget): NormalizedUploadTarget {
  if (target.kind === 'task') {
    return {
      visibility: 'task',
      folderId: target.folderId ?? null,
      recipientIds: [],
      groupId: null,
      taskId: target.taskId,
      projectId: null,
      replaceFileId: target.replaceFileId ?? null,
      replaceAttachmentId: target.replaceAttachmentId ?? null,
    };
  }
  return {
    visibility: 'project',
    folderId: target.folderId ?? null,
    recipientIds: [],
    groupId: null,
    taskId: null,
    projectId: target.projectId,
    replaceFileId: target.replaceFileId ?? null,
    replaceAttachmentId: null,
  };
}

/** Accepts the new RPC object shape and the UUID-only rollout shape. */
export function normalizeUploadCommitResult(raw: unknown): UploadCommitIdentity {
  if (typeof raw === 'string') return { fileId: raw, fileVersionId: null, versionId: null };
  if (!raw || typeof raw !== 'object') throw new Error('Upload commit returned no FileHub identity.');
  const value = raw as Record<string, unknown>;
  const fileId = value.fileId ?? value.file_id;
  const versionId = value.versionId ?? value.version_id ?? value.fileVersionId ?? value.file_version_id
    ?? value.current_version_id ?? (value.id && fileId ? value.id : null);
  if (typeof fileId !== 'string' || !fileId) throw new Error('Upload commit returned no FileHub file identity.');
  const normalizedVersionId = typeof versionId === 'string' && versionId ? versionId : null;
  return { fileId, fileVersionId: normalizedVersionId, versionId: normalizedVersionId };
}
