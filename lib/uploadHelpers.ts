// Shared FileHub upload helpers. Extracted from _filehub_desktop so the global
// UploadManager and the upload modal compute hashes / format sizes identically.

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// SHA-256 of a file's bytes, used for content-dedupe. NOTE: crypto.subtle is
// only defined in a secure context (https / localhost); over plain http it's
// undefined and this throws — same constraint the caller already lived with.
export async function computeSHA256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await (crypto as any).subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b: number) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Human-readable ETA from seconds remaining. "~2m" / "~45s" / "" when unknown.
export function formatEta(secondsRemaining: number | null): string {
  if (secondsRemaining == null || !isFinite(secondsRemaining) || secondsRemaining < 0) return '';
  if (secondsRemaining < 60) return `~${Math.max(1, Math.round(secondsRemaining))}s`;
  if (secondsRemaining < 3600) return `~${Math.round(secondsRemaining / 60)}m`;
  return `~${(secondsRemaining / 3600).toFixed(1)}h`;
}
