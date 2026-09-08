export type TaskFilePasteMetadata = {
  name?: string | null;
  file_name?: string | null;
  size?: number | null;
  file_size?: number | null;
  type?: string | null;
  mimeType?: string | null;
  mime_type?: string | null;
  webkitRelativePath?: string | null;
  relativePath?: string | null;
};

export type TaskFilePasteDedupeResult = {
  accepted: File[];
  skipped: number;
};

function metadataOf(value: TaskFilePasteMetadata) {
  const path = String(value.webkitRelativePath || value.relativePath || '').trim().replace(/\\/g, '/');
  const name = String(value.name || value.file_name || '').trim();
  const size = Number(value.size ?? value.file_size ?? 0) || 0;
  const mime = String(value.type || value.mimeType || value.mime_type || '').trim().toLowerCase() || 'application/octet-stream';
  return { path, name, size, mime };
}

/** Stable identity for clipboard files and existing task attachment records. */
export function taskFilePasteIdentity(value: TaskFilePasteMetadata): string {
  const { path, name, size, mime } = metadataOf(value);
  return path ? `path:${path}|${size}|${mime}` : `name:${name}|${size}|${mime}`;
}

export function dedupeTaskFilePaste(
  incoming: readonly File[],
  existing: readonly TaskFilePasteMetadata[],
): TaskFilePasteDedupeResult {
  const seen = new Set(existing.map(taskFilePasteIdentity));
  const accepted: File[] = [];
  let skipped = 0;
  for (const file of incoming) {
    const identity = taskFilePasteIdentity(file);
    if (seen.has(identity)) { skipped += 1; continue; }
    seen.add(identity);
    accepted.push(file);
  }
  return { accepted, skipped };
}
