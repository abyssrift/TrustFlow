// Shared helper functions and constants extracted from the duplicated header
// blocks of `_filehub_adaptive.tsx` and `_filehub_desktop.tsx`.
//
// Extraction contract: ONLY byte-identical implementations are hoisted here so
// behavior is preserved exactly. Divergent helpers (relativeDate, getMimeIcon,
// computeSHA256Web/computeSHA256) intentionally remain local to each shell.

import { ActivityPresentation, getActivityPresentation } from '@/lib/filehubActivityPresentation';
import type { ExplorerOrigin } from '@/lib/fileExplorerMode';

export type BrowseIdentity = {
  file_id?: string | null;
  project_id?: string | null;
  folder_id?: string | null;
  workspace_folder_id?: string | null;
  origin?: ExplorerOrigin | string | null;
  canonical_file_id?: string | null;
  canonical_version_id?: string | null;
  bucket?: string | null;
  storage_path?: string | null;
};

/** Stable identity for one canonical byte/version, regardless of pointer alias. */
export function canonicalIdentityKey(identity: BrowseIdentity): string {
  if (identity.canonical_file_id && identity.canonical_version_id) {
    return [identity.canonical_file_id, identity.canonical_version_id].join(':');
  }
  return [identity.file_id || '', identity.bucket || '', identity.storage_path || ''].join(':');
}

export type BrowsePageCursor = { created_at: string; file_id: string };

/** Keep keyset pagination anchored to the final raw RPC row, not a grouped alias. */
export function getBrowsePageCursor(rows: Array<{ created_at: string; file_id: string }>, fallback: BrowsePageCursor | null): BrowsePageCursor | null {
  return rows.length ? { created_at: rows[rows.length - 1].created_at, file_id: rows[rows.length - 1].file_id } : fallback;
}

/** Commit browse responses only while they belong to the active query generation. */
export function isCurrentBrowseRequest(requestGeneration: number, currentGeneration: number): boolean {
  return requestGeneration === currentGeneration;
}

export function groupByCanonicalIdentity<T extends BrowseIdentity>(rows: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = canonicalIdentityKey(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.values()];
}

export function getBrowseOriginLabel(origin: ExplorerOrigin | string | null | undefined): string {
  switch (origin) {
    case 'workspace': return 'Workspace';
    case 'deliverable': return 'Deliverable';
    case 'brief': return 'Brief';
    case 'submission': return 'Submission';
    case 'shared': return 'Shared';
    default: return 'Unknown origin';
  }
}

export function hasCanonicalAlias(row: { file_id?: string | null; canonical_file_id?: string | null }): boolean {
  return Boolean(row.file_id && row.canonical_file_id && row.file_id !== row.canonical_file_id);
}

function validIdentityPart(value: string | null | undefined): value is string {
  const normalized = value?.trim();
  return Boolean(normalized && normalized !== 'null' && normalized !== 'undefined' && UUID_RE.test(normalized));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Browse is intentionally fail-closed: incomplete RPC identity never becomes a workspace link. */
export function getProjectWorkspaceLink(identity: BrowseIdentity): string | null {
  if (identity.origin !== 'workspace') return null;
  const folderId = identity.folder_id;
  if (!validIdentityPart(identity.project_id) || !validIdentityPart(folderId) || !validIdentityPart(identity.canonical_file_id)) return null;
  return `/projects/${encodeURIComponent(identity.project_id)}?tab=${encodeURIComponent('files')}&folder=${encodeURIComponent(folderId)}&file=${encodeURIComponent(identity.canonical_file_id)}`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// Whole days from now until `expires_at`. Returns null when missing/already past.
export function expiresInDays(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

export function getInitials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').slice(0, 2).join('');
}

// ─── Group colors palette ─────────────────────────────────────────────────────

export const GROUP_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#06b6d4', '#f97316',
];

export const TAG_PALETTE = [
  { bg: '#fef3c7', text: '#92400e', border: '#fde68a' },
  { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' },
  { bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe' },
  { bg: '#f3e8ff', text: '#6b21a8', border: '#e9d5ff' },
  { bg: '#ffe4e6', text: '#9f1239', border: '#fecdd3' },
  { bg: '#ccfbf1', text: '#134e4a', border: '#99f6e4' },
  { bg: '#ffedd5', text: '#7c2d12', border: '#fed7aa' },
  { bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe' },
];

export function getTagColor(tag: string): { bg: string; text: string; border: string } {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

export const ACTIVITY_META: Record<string, ActivityPresentation> = {
  upload: getActivityPresentation('upload'), download: getActivityPresentation('download'), view: getActivityPresentation('view'),
  delete: getActivityPresentation('delete'), share: getActivityPresentation('share'), rename: getActivityPresentation('rename'),
  move: getActivityPresentation('move'), restore: getActivityPresentation('restore'), share_revoke: getActivityPresentation('share_revoke'),
  folder_create: getActivityPresentation('folder_create'), folder_delete: getActivityPresentation('folder_delete'),
};

// ─── Upload helpers ───────────────────────────────────────────────────────────

export const ALLOWED_EXTENSIONS = new Set([
  'pdf','doc','docx','xls','xlsx','ppt','pptx','csv','txt','rtf','odt','ods','odp',
  'jpg','jpeg','png','gif','webp','svg','bmp','tiff','tif','heic','heif','avif',
  'mp4','mov','avi','mkv','webm','m4v','wmv','flv','ogv',
  'mp3','wav','aac','ogg','flac','m4a','wma','opus',
  'zip','rar','7z','tar','gz','tgz','bz2','xz',
  'json','xml','yaml','yml','toml','sql','md','html','css','js','ts','jsx','tsx',
]);

export const ALLOWED_TYPES_MESSAGE =
  '• Documents: PDF, Word, Excel, PowerPoint, CSV, TXT, RTF\n' +
  '• Images: JPG, PNG, GIF, WEBP, SVG, HEIC\n' +
  '• Video: MP4, MOV, AVI, MKV, WEBM\n' +
  '• Audio: MP3, WAV, AAC, OGG, FLAC\n' +
  '• Archives: ZIP, RAR, 7Z, TAR, GZ\n' +
  '• Data: JSON, XML, YAML, SQL, HTML, JS, TS';

export function isAllowedFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ALLOWED_EXTENSIONS.has(ext);
}
