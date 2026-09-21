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
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb,
  0xbef9a3f7, 0xc67178f2,
] as const;

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Bytes(bytes: Uint8Array): string {
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const highBits = Math.floor(bitLength / 0x100000000);
  const lowBits = bitLength >>> 0;
  padded[paddedLength - 8] = highBits >>> 24;
  padded[paddedLength - 7] = highBits >>> 16;
  padded[paddedLength - 6] = highBits >>> 8;
  padded[paddedLength - 5] = highBits;
  padded[paddedLength - 4] = lowBits >>> 24;
  padded[paddedLength - 3] = lowBits >>> 16;
  padded[paddedLength - 2] = lowBits >>> 8;
  padded[paddedLength - 1] = lowBits;

  let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a;
  let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19;
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Uint32Array(64);
    for (let i = 0; i < 16; i++) {
      const index = offset + i * 4;
      words[i] = ((padded[index] << 24) | (padded[index + 1] << 16) | (padded[index + 2] << 8) | padded[index + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(words[i - 15], 7) ^ rotr(words[i - 15], 18) ^ (words[i - 15] >>> 3);
      const s1 = rotr(words[i - 2], 17) ^ rotr(words[i - 2], 19) ^ (words[i - 2] >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }
    let a = h0; let b = h1; let c = h2; let d = h3; let e = h4; let f = h5; let g = h6; let h = h7;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choice + SHA256_K[i] + words[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map(value => value.toString(16).padStart(8, '0')).join('');
}

// WebCrypto is preferred; Expo's native Blob/File implementations may provide
// bytes but no crypto.subtle, so the byte fallback keeps the same dedupe hash.
export async function computeSHA256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const subtle = (globalThis.crypto as any)?.subtle;
  if (subtle?.digest) {
    const digest = await subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest)).map((b: number) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Bytes(new Uint8Array(buffer));
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

// Debug-only: forces the next uploadFileToStorage call to fail as if the
// network dropped, so the retry-on-reconnect path (see UploadManagerContext's
// uploadOne) can be exercised without real DevTools throttling. One-shot —
// resets itself after firing once.
let __debugForceNextUploadFailure = false;
export function debugSimulateNetworkDrop(): void {
  __debugForceNextUploadFailure = true;
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

    if (__debugForceNextUploadFailure) {
      __debugForceNextUploadFailure = false;
      reject(new StorageUploadError('Simulated network drop (debug)', 0));
      return;
    }

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
