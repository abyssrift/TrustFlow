export type ProjectFileHubUploadTarget = {
  kind: 'project';
  projectId: string;
  folderId: string | null;
};

export type ProjectFileHubCapabilities = {
  view: boolean;
  create: boolean;
  rename: boolean;
  move: boolean;
  delete: boolean;
  restore: boolean;
  upload: boolean;
  replace: boolean;
  version: boolean;
};

export type ProjectFileHubFolder = {
  id: string;
  name: string;
  parent_id: string | null;
  scope: 'project';
  project_id: string;
  project_root_kind: 'workspace' | 'deliverable' | null;
  company_id?: string;
  created_by?: string;
  created_at?: string;
  deleted_at: string | null;
  version_ids: string[];
  activity_ids: string[];
};

export type ProjectFileHubFile = {
  id: string;
  name: string;
  folder_id: string;
  project_id: string;
  mime_type: string | null;
  size_bytes: number;
  bucket: string;
  storage_path: string;
  current_version_id: string | null;
  tags: string[];
  created_at: string;
  updated_at?: string;
  activity_ids: string[];
};

export type ProjectFileHubReference = {
  id: string;
  name: string;
  mime_type: string | null;
  size_bytes?: number;
  bucket?: string;
  storage_path?: string;
  created_at?: string;
};

export type ProjectFileHubWorkspace = {
  root: ProjectFileHubFolder | null;
  folders: ProjectFileHubFolder[];
  files: ProjectFileHubFile[];
  capabilities: ProjectFileHubCapabilities;
};

export type ProjectFileHubEnvelope = {
  client_id: string | null;
  client_name: string | null;
  standing_folder_id: string | null;
  standing_files: ProjectFileHubReference[];
  deliverable_folder_id: string | null;
  deliverable_files: ProjectFileHubReference[];
  deliverable_versions: unknown[];
  workspace: ProjectFileHubWorkspace | null;
};

export type ProjectFileHubDeepLinkParams = {
  folder?: unknown;
  file?: unknown;
};

export type ProjectFileHubDeepLinkSelection = {
  folderId: string;
  fileId: string | null;
};

export type ProjectFileHubBinEntry = {
  id: string;
  name: string;
  item_type: 'folder' | 'file';
  parent_id?: string | null;
  folder_id?: string | null;
  project_id: string;
  deleted_at: string;
  mime_type?: string | null;
  size_bytes?: number;
  bucket?: string | null;
  storage_path?: string | null;
};

export type ProjectFileHubBin = {
  folders: ProjectFileHubBinEntry[];
  files: ProjectFileHubBinEntry[];
};

const asRecord = (value: unknown): Record<string, any> => (
  value && typeof value === 'object' ? value as Record<string, any> : {}
);

const asString = (value: unknown, fallback = ''): string => (
  typeof value === 'string' ? value : fallback
);

const asNullableString = (value: unknown): string | null => (
  typeof value === 'string' && value.length > 0 ? value : null
);

const asArray = (value: unknown): any[] => Array.isArray(value) ? value : [];

function deepLinkId(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(value).trim(); } catch { return null; }
  if (!decoded || /[\\/?#\s]/.test(decoded)) return null;
  return decoded;
}

function normalizeReference(value: unknown): ProjectFileHubReference {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    name: asString(row.name ?? row.original_name),
    mime_type: typeof row.mime_type === 'string' ? row.mime_type : null,
    ...(typeof row.size_bytes === 'number' ? { size_bytes: row.size_bytes } : {}),
    ...(typeof row.bucket === 'string' ? { bucket: row.bucket } : {}),
    ...(typeof row.storage_path === 'string' ? { storage_path: row.storage_path } : {}),
    ...(typeof row.created_at === 'string' ? { created_at: row.created_at } : {}),
  };
}

function normalizeFolder(value: unknown): ProjectFileHubFolder {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    name: asString(row.name),
    parent_id: asNullableString(row.parent_id),
    scope: 'project',
    project_id: asString(row.project_id),
    project_root_kind: row.project_root_kind === 'workspace' || row.project_root_kind === 'deliverable'
      ? row.project_root_kind : null,
    ...(typeof row.company_id === 'string' ? { company_id: row.company_id } : {}),
    ...(typeof row.created_by === 'string' ? { created_by: row.created_by } : {}),
    ...(typeof row.created_at === 'string' ? { created_at: row.created_at } : {}),
    deleted_at: asNullableString(row.deleted_at),
    version_ids: asArray(row.version_ids).filter((id): id is string => typeof id === 'string'),
    activity_ids: asArray(row.activity_ids).filter((id): id is string => typeof id === 'string'),
  };
}

function normalizeFile(value: unknown): ProjectFileHubFile {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    name: asString(row.name ?? row.original_name),
    folder_id: asString(row.folder_id),
    project_id: asString(row.project_id),
    mime_type: typeof row.mime_type === 'string' ? row.mime_type : null,
    size_bytes: typeof row.size_bytes === 'number' ? row.size_bytes : 0,
    bucket: asString(row.bucket),
    storage_path: asString(row.storage_path),
    current_version_id: asNullableString(row.current_version_id),
    tags: asArray(row.tags).filter((tag): tag is string => typeof tag === 'string'),
    created_at: asString(row.created_at),
    ...(typeof row.updated_at === 'string' ? { updated_at: row.updated_at } : {}),
    activity_ids: asArray(row.activity_ids).filter((id): id is string => typeof id === 'string'),
  };
}

function normalizeCapabilities(value: unknown): ProjectFileHubCapabilities {
  const row = asRecord(value);
  const mutation = Boolean(row.create || row.rename || row.move || row.delete || row.restore);
  return {
    view: Boolean(row.view),
    create: Boolean(row.create),
    rename: Boolean(row.rename),
    move: Boolean(row.move),
    delete: Boolean(row.delete),
    restore: Boolean(row.restore),
    upload: row.upload == null ? Boolean(row.create) : Boolean(row.upload),
    replace: row.replace == null ? mutation : Boolean(row.replace),
    version: row.version == null ? mutation : Boolean(row.version),
  };
}

function normalizeBinEntry(value: unknown, itemType: 'folder' | 'file'): ProjectFileHubBinEntry {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    name: asString(row.name ?? row.original_name),
    item_type: itemType,
    ...(typeof row.parent_id === 'string' ? { parent_id: row.parent_id } : {}),
    ...(typeof row.folder_id === 'string' ? { folder_id: row.folder_id } : {}),
    project_id: asString(row.project_id),
    deleted_at: asString(row.deleted_at),
    ...(typeof row.mime_type === 'string' ? { mime_type: row.mime_type } : {}),
    ...(typeof row.size_bytes === 'number' ? { size_bytes: row.size_bytes } : {}),
    ...(typeof row.bucket === 'string' ? { bucket: row.bucket } : {}),
    ...(typeof row.storage_path === 'string' ? { storage_path: row.storage_path } : {}),
  };
}

export function normalizeProjectFileHubBin(raw: unknown): ProjectFileHubBin {
  const value = asRecord(raw);
  return {
    folders: asArray(value.folders).map((row) => normalizeBinEntry(row, 'folder')),
    files: asArray(value.files).map((row) => normalizeBinEntry(row, 'file')),
  };
}

export function projectUploadTarget(projectId: string, folderId: string | null = null): ProjectFileHubUploadTarget {
  return { kind: 'project', projectId, folderId };
}

export function normalizeProjectFileHubEnvelope(raw: unknown): ProjectFileHubEnvelope {
  const value = asRecord(raw);
  const workspaceValue = value.workspace;
  const workspace = workspaceValue && typeof workspaceValue === 'object'
    ? (() => {
        const row = asRecord(workspaceValue);
        return {
          root: row.root ? normalizeFolder(row.root) : null,
          folders: asArray(row.folders).map(normalizeFolder),
          files: asArray(row.files).map(normalizeFile),
          capabilities: normalizeCapabilities(row.capabilities),
        };
      })()
    : null;
  return {
    client_id: asNullableString(value.client_id),
    client_name: asNullableString(value.client_name),
    standing_folder_id: asNullableString(value.standing_folder_id),
    standing_files: asArray(value.standing_files).map(normalizeReference),
    deliverable_folder_id: asNullableString(value.deliverable_folder_id),
    deliverable_files: asArray(value.deliverable_files).map(normalizeReference),
    deliverable_versions: asArray(value.deliverable_versions),
    workspace,
  };
}

/** Resolve URL identities only inside the authorized workspace envelope. */
export function resolveProjectFileHubDeepLink(
  envelope: ProjectFileHubEnvelope,
  projectId: string,
  params: ProjectFileHubDeepLinkParams,
): ProjectFileHubDeepLinkSelection | null {
  const hasFolder = params.folder !== undefined && params.folder !== null;
  const hasFile = params.file !== undefined && params.file !== null;
  if (!hasFolder && !hasFile) return null;
  const folderId = deepLinkId(params.folder);
  const fileId = deepLinkId(params.file);
  if (!folderId || !hasFolder || (hasFile && !fileId)) return null;
  const workspace = envelope.workspace;
  if (!workspace) return null;
  const folders = [workspace.root, ...workspace.folders].filter((folder): folder is ProjectFileHubFolder => Boolean(folder));
  const folder = folders.find(candidate => candidate.id === folderId);
  if (!folder || folder.project_id !== projectId || folder.project_root_kind === 'deliverable') return null;
  if (folder.id === envelope.standing_folder_id || folder.id === envelope.deliverable_folder_id) return null;
  if (!fileId) return { folderId: folder.id, fileId: null };
  const file = workspace.files.find(candidate => candidate.id === fileId);
  if (!file || file.project_id !== projectId || file.folder_id !== folder.id) return null;
  if ([...envelope.standing_files, ...envelope.deliverable_files].some(reference => reference.id === file.id)) return null;
  return { folderId: folder.id, fileId: file.id };
}
