// Shared FileHub upload helpers. Extracted from _filehub_desktop so the global
// UploadManager and the upload modal compute hashes / format sizes identically.

import NetInfo from '@react-native-community/netinfo';
import { Platform } from 'react-native';

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

// ── Storage upload with real byte progress ────────────────────────────────────
// supabase-js's storage `.upload()` gives no progress events, so a single big
// file's ring sat at 0% for the whole transfer and only snapped to 100% at the
// end (the "never moves past 1%" bug). We POST straight to the Storage REST
// endpoint with XMLHttpRequest instead — same request supabase-js makes under
// the hood — because XHR exposes `upload.onprogress`. Bonus: `xhr.abort()` can
// actually kill an in-flight transfer, which the js client can't.

export type UploadProgressFn = (loaded: number, total: number) => void;

export class StorageUploadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'StorageUploadError';
    this.status = status;
  }
}

export function uploadFileToStorage(opts: {
  baseUrl: string;      // supabaseUrl
  anonKey: string;      // supabaseAnonKey
  accessToken: string;  // the signed-in user's JWT (RLS runs as them)
  bucket: string;
  path: string;
  file: File;
  upsert?: boolean;
  cacheControl?: string; // seconds; storage-js default is '3600'
  onProgress?: UploadProgressFn;
  // Hands the live XHR to the caller so a cancel can abort it (null on finish).
  registerXhr?: (xhr: XMLHttpRequest | null) => void;
}): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    opts.registerXhr?.(xhr);
    // encodeURI (not encodeURIComponent) so the "/" path separators survive.
    xhr.open('POST', `${opts.baseUrl}/storage/v1/object/${opts.bucket}/${encodeURI(opts.path)}`);
    xhr.setRequestHeader('authorization', `Bearer ${opts.accessToken}`);
    xhr.setRequestHeader('apikey', opts.anonKey);
    xhr.setRequestHeader('x-upsert', opts.upsert ? 'true' : 'false');
    // Match supabase-js's browser path EXACTLY: multipart/form-data with the
    // cacheControl field and the file under the empty field name. Do NOT set
    // Content-Type — the browser adds the multipart boundary itself. (The only
    // reason we hand-roll this instead of calling .upload() is that XHR gives
    // upload.onprogress, which the js client doesn't surface.)
    const form = new FormData();
    form.append('cacheControl', opts.cacheControl ?? '3600');
    form.append('', opts.file);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      opts.registerXhr?.(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(opts.file.size, opts.file.size);
        resolve();
        return;
      }
      let msg = `Upload failed (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText);
        msg = body?.message || body?.error || msg;
      } catch { /* non-JSON error body */ }
      reject(new StorageUploadError(msg, xhr.status));
    };
    xhr.onerror = () => { opts.registerXhr?.(null); reject(new StorageUploadError('Network error during upload', 0)); };
    xhr.onabort = () => { opts.registerXhr?.(null); reject(new StorageUploadError('aborted', 0)); };

    xhr.send(form);
  });
}

// ── Reconnect-and-retry ────────────────────────────────────────────────────
// True when a failure looks like a dropped connection rather than an
// application-level error (validation, permission, HTTP error response) —
// used to decide whether to auto-retry once connectivity returns.
export function isNetworkError(e: unknown): boolean {
  if (e instanceof StorageUploadError && e.status === 0) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return false;
}

// Resolves once the device/browser is back online. Resolves immediately if
// already online. Polls isCancelled() every second so a job cancel can
// interrupt an indefinite wait instead of leaving a dangling listener.
export function waitForReconnect(isCancelled: () => boolean): Promise<void> {
  return new Promise<void>((resolve) => {
    const finish = () => resolve();

    if (Platform.OS === 'web') {
      if (typeof navigator === 'undefined' || navigator.onLine !== false) { finish(); return; }
      let cleanup: () => void;
      const onOnline = () => { cleanup(); finish(); };
      const poll = setInterval(() => { if (isCancelled()) { cleanup(); finish(); } }, 1000);
      cleanup = () => {
        clearInterval(poll);
        if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
      };
      if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
      return;
    }

    // Native
    NetInfo.fetch().then((state) => {
      if (state.isConnected && state.isInternetReachable !== false) { finish(); return; }
      let cleanup: () => void;
      const unsubscribe = NetInfo.addEventListener((s) => {
        if (s.isConnected && s.isInternetReachable !== false) { cleanup(); finish(); }
      });
      const poll = setInterval(() => { if (isCancelled()) { cleanup(); finish(); } }, 1000);
      cleanup = () => { clearInterval(poll); unsubscribe(); };
    });
  });
}
