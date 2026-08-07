// Shared helper functions and constants extracted from the duplicated header
// blocks of `_filehub_adaptive.tsx` and `_filehub_desktop.tsx`.
//
// Extraction contract: ONLY byte-identical implementations are hoisted here so
// behavior is preserved exactly. Divergent helpers (relativeDate, getMimeIcon,
// computeSHA256Web/computeSHA256) intentionally remain local to each shell.

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

export const ACTIVITY_META: Record<string, { icon: string; color: string; label: string }> = {
  upload:   { icon: 'upload',   color: '#10b981', label: 'Uploaded'   },
  download: { icon: 'download', color: '#3b82f6', label: 'Downloaded' },
  view:     { icon: 'eye',      color: '#8b5cf6', label: 'Viewed'     },
  delete:   { icon: 'trash-o',  color: '#ef4444', label: 'Deleted'    },
  share:    { icon: 'share',    color: '#f59e0b', label: 'Shared'     },
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