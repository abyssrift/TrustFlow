import { Alert, Linking, Platform } from 'react-native';
import { supabase } from './supabase';
import { shareFileViaWeb, type ShareResult } from './webShare';

export type { ShareResult };

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

/** Signed URL for a private-bucket path. Legacy records that stored a full http URL pass through. */
async function signedUrlFor(bucket: string, storagePath: string): Promise<string | null> {
  if (storagePath.startsWith('http')) return storagePath;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 3600);
  if (error || !data?.signedUrl) {
    console.error('[Storage] Failed to generate signed URL:', error);
    return null;
  }
  return data.signedUrl;
}

// The cache filename ends up as the name the receiving app shows, so keep spaces
// and only strip what would break the path.
const safeFileName = (name: string) => name.replace(/[/\\?%*:|"<>]/g, '_') || 'file';

export type ShareTarget = {
  bucket: string;
  storagePath: string;
  name: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
};

// Downloads a file locally and hands it to whatever app the OS has for it via
// the native share sheet. Returns 'unsupported' on any failure so the caller can
// fall back to Linking.openURL / a link-based sheet.
async function shareViaNativeSheet(url: string, filename: string, mimeType?: string | null): Promise<ShareResult> {
  try {
    const FS = await import('expo-file-system/legacy');
    const Sharing = await import('expo-sharing');
    if (!(await Sharing.isAvailableAsync())) return 'unsupported';

    const cacheUri = `${FS.cacheDirectory}${safeFileName(filename)}`;
    const { status } = await FS.downloadAsync(url, cacheUri);
    if (status !== 200) return 'unsupported';

    // ponytail: expo-sharing can't distinguish "user dismissed" from "sent" on
    // iOS, so a dismiss reads as 'shared'. Either way the file was handled and
    // the caller must NOT also bounce the user to the browser.
    await Sharing.shareAsync(cacheUri, { mimeType: mimeType || undefined, dialogTitle: filename });
    return 'shared';
  } catch (err) {
    console.error('[Storage] Native share failed:', err);
    return 'unsupported';
  }
}

/**
 * Hands the actual file to the OS share sheet, so it lands in WhatsApp / Drive /
 * OneDrive / Mail as a real attachment rather than a link.
 *
 * - native → expo-sharing (every install-time share target)
 * - web    → Web Share API level 2 (Chrome Android, iOS Safari, Chrome/Edge on
 *            Windows, Safari macOS). Firefox and desktop Chrome on Linux have no
 *            `navigator.share` at all.
 *
 * Returns 'unsupported' whenever nothing happened, which is the caller's cue to
 * open a link-based fallback sheet instead.
 */
export async function shareFile(t: ShareTarget): Promise<ShareResult> {
  if (!t.storagePath) return 'unsupported';

  const url = await signedUrlFor(t.bucket, t.storagePath);
  if (!url) return 'unsupported';

  return Platform.OS === 'web'
    ? shareFileViaWeb(url, { name: safeFileName(t.name), mimeType: t.mimeType, sizeBytes: t.sizeBytes })
    : shareViaNativeSheet(url, t.name, t.mimeType);
}

/**
 * Fire-and-forget: log an activity entry on a task file's FileHub pointer,
 * resolved by (bucket, storage_path). No-op for files that aren't unified task
 * files (no matching visibility='task' pointer) or tasks the caller can't see.
 * Lets task-side surfaces (brief panel, submission/evidence viewers) feed the
 * same Activity tab FileHub does. See migration 20260728_filehub_activity_by_path.
 */
export function logTaskFileActivity(
  bucket: string,
  storagePath: string,
  action: 'view' | 'download' | 'share' = 'view',
  metadata?: Record<string, any> | null,
): void {
  if (!bucket || !storagePath) return;
  supabase
    .rpc('rpc_filehub_log_activity_by_path', {
      p_bucket: bucket,
      p_storage_path: storagePath,
      p_action: action,
      p_metadata: metadata ?? null,
    })
    .then(undefined, () => {});
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
    if (Platform.OS === 'web') { window.open(storagePath, '_blank', 'noopener'); return; }
    await Linking.openURL(storagePath);
    return;
  }

  const signed = await signedUrlFor(bucket, storagePath);
  if (!signed) return;

  let url = signed;
  // Stream previewable media inline on mobile; otherwise request an attachment
  // download with the original filename.
  const openInline = isMobileDevice() && isInlinePreviewable(filename, mimeType);
  if (filename && !openInline) {
    url += `&download=${encodeURIComponent(filename)}`;
  }

  // Explicit '_blank' — don't rely on Linking.openURL's implicit single-arg
  // default, which can be defeated by popup-blocker timing after the async
  // signed-URL fetch above.
  if (Platform.OS === 'web') {
    window.open(url, '_blank', 'noopener');
    return;
  }

  // Non-previewable files go straight to the app that handles them instead of
  // stranding the user in a browser download.
  if (!openInline && filename && (await shareViaNativeSheet(url, filename, mimeType)) !== 'unsupported') {
    return;
  }

  await Linking.openURL(url);
}

type DownloadableFile = {
  storage_path: string;
  bucket?: string | null;
  original_name: string;
  mime_type?: string | null;
  /** Folder path to nest this file under inside the zip (e.g. "Reports/Q1"), no leading/trailing slash. Omit to place at the zip root. */
  zip_path?: string;
};

// Resolves "photo.jpg" -> "photo (1).jpg" on repeat, so same-named attachments
// from different submissions don't clobber each other in the destination.
function dedupeName(name: string, usedNames: Map<string, number>): string {
  if (!usedNames.has(name)) {
    usedNames.set(name, 0);
    return name;
  }
  const count = usedNames.get(name)! + 1;
  usedNames.set(name, count);
  const dotIdx = name.lastIndexOf('.');
  return dotIdx > 0 ? `${name.slice(0, dotIdx)} (${count})${name.slice(dotIdx)}` : `${name} (${count})`;
}

export async function downloadFilesAsZip(
  files: DownloadableFile[],
  zipName: string,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  if (files.length === 0) return;

  if (Platform.OS !== 'web') {
    Alert.alert('Not Supported', 'ZIP download is only available on web. Use "Save to Device" instead.');
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
      const entryName = file.zip_path ? `${file.zip_path}/${file.original_name}` : file.original_name;
      zip.file(dedupeName(entryName, usedNames), blob);
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

export type SaveToDeviceResult = { savedCount: number; failedCount: number; cancelled?: boolean };

/**
 * Batch-saves files onto the device without zipping — Android only, via the
 * Storage Access Framework (user picks a destination folder once, every file
 * gets written straight into it, same as a "Download All" in any other app).
 *
 * ponytail: iOS has no SAF equivalent in Expo without extra native modules;
 * callers on iOS should fall back to opening/sharing files one at a time via
 * openStorageFile(). Add an iOS path if that becomes the primary platform.
 */
export async function downloadFilesToDevice(
  files: DownloadableFile[],
  onProgress?: (downloaded: number, total: number) => void
): Promise<SaveToDeviceResult> {
  if (files.length === 0) return { savedCount: 0, failedCount: 0 };
  if (Platform.OS !== 'android') return { savedCount: 0, failedCount: files.length };

  const FS = await import('expo-file-system/legacy');
  const perm = await FS.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!perm.granted) return { savedCount: 0, failedCount: files.length, cancelled: true };

  const usedNames = new Map<string, number>();
  let savedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i, files.length);
    const cacheUri = `${FS.cacheDirectory}filehub-dl-${Date.now()}-${i}`;

    try {
      const { data, error } = await supabase.storage
        .from(file.bucket || 'filehub-files')
        .createSignedUrl(file.storage_path, 3600);
      if (error || !data?.signedUrl) { failedCount++; continue; }

      const { status } = await FS.downloadAsync(data.signedUrl, cacheUri);
      if (status !== 200) { failedCount++; continue; }

      const name = dedupeName(file.original_name, usedNames);
      const dotIdx = name.lastIndexOf('.');
      const baseName = dotIdx > 0 ? name.slice(0, dotIdx) : name;
      const mime = file.mime_type || 'application/octet-stream';

      const destUri = await FS.StorageAccessFramework.createFileAsync(perm.directoryUri, baseName, mime);
      const base64 = await FS.readAsStringAsync(cacheUri, { encoding: 'base64' });
      await FS.writeAsStringAsync(destUri, base64, { encoding: 'base64' });
      savedCount++;
    } catch {
      failedCount++;
    } finally {
      FS.deleteAsync(cacheUri, { idempotent: true }).catch(() => {});
    }
  }

  onProgress?.(files.length, files.length);
  return { savedCount, failedCount };
}
