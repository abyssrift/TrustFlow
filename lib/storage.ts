import { Alert, Linking, Platform } from 'react-native';
import { supabase } from './supabase';

export const SUBMISSION_BUCKET = 'submission-attachments';
export const TASK_BRIEF_BUCKET = 'task-attachments';

// Media that mobile devices can render inline in their native previewer / camera
// roll. For these we DON'T force an attachment download (the `&download=` param),
// which mobile browsers otherwise save as an opaque file instead of opening.
const INLINE_PREVIEW_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'heic', 'heif', 'avif', 'svg',
  'mp4', 'mov', 'm4v', 'webm', 'pdf',
]);

function isMobileDevice(): boolean {
  if (Platform.OS === 'ios' || Platform.OS === 'android') return true;
  if (Platform.OS === 'web' && typeof navigator !== 'undefined') {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '');
  }
  return false;
}

function isInlinePreviewable(filename?: string, mimeType?: string | null): boolean {
  const m = (mimeType || '').toLowerCase();
  if (m.startsWith('image/') || m.startsWith('video/') || m === 'application/pdf') return true;
  const ext = (filename || '').split('.').pop()?.toLowerCase() || '';
  return INLINE_PREVIEW_EXTS.has(ext);
}

/**
 * Opens a storage file. Uses signed URLs for private buckets.
 * Falls back to direct URL open for legacy records that stored full http URLs.
 *
 * On mobile, previewable media (images / video / PDFs) open inline in the device's
 * native viewer rather than being forced to download as an opaque attachment.
 */
export async function openStorageFile(
  bucket: string,
  storagePath: string,
  filename?: string,
  mimeType?: string | null,
): Promise<void> {
  if (!storagePath) return;

  // Legacy records stored full public URLs — open directly (will 404 for private buckets,
  // but there's nothing we can do for those old records)
  if (storagePath.startsWith('http')) {
    await Linking.openURL(storagePath);
    return;
  }

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, 3600);

  if (error || !data?.signedUrl) {
    console.error('[Storage] Failed to generate signed URL:', error);
    return;
  }

  let url = data.signedUrl;
  // Stream previewable media inline on mobile; otherwise request an attachment
  // download with the original filename.
  const openInline = isMobileDevice() && isInlinePreviewable(filename, mimeType);
  if (filename && !openInline) {
    url += `&download=${encodeURIComponent(filename)}`;
  }

  await Linking.openURL(url);
}

export async function downloadFilesAsZip(
  files: Array<{ storage_path: string; bucket?: string | null; original_name: string }>,
  zipName: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  if (files.length === 0) return;

  if (Platform.OS !== 'web') {
    Alert.alert('Not Supported', 'ZIP download is only available on web. Open each file individually instead.');
    return;
  }

  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const usedNames = new Map<string, number>();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i, files.length);

    const { data, error } = await supabase.storage
      .from(file.bucket || 'filehub-files')
      .createSignedUrl(file.storage_path, 3600);

    if (error || !data?.signedUrl) continue;

    try {
      const response = await fetch(data.signedUrl);
      if (!response.ok) continue;
      const blob = await response.blob();

      let name = file.original_name;
      if (usedNames.has(name)) {
        const count = usedNames.get(name)! + 1;
        usedNames.set(name, count);
        const dotIdx = name.lastIndexOf('.');
        name = dotIdx > 0
          ? `${name.slice(0, dotIdx)} (${count})${name.slice(dotIdx)}`
          : `${name} (${count})`;
      } else {
        usedNames.set(name, 0);
      }

      zip.file(name, blob);
    } catch {
      // skip files that fail to fetch
    }
  }

  onProgress?.(files.length, files.length);

  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${zipName}.zip`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
