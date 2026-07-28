/**
 * Web Share API level 2 handoff — split out of storage.ts so it can be tested
 * without dragging in react-native and the supabase client. The caller resolves
 * the URL; this only decides whether the browser can take the file and maps the
 * outcome.
 */

export type ShareResult = 'shared' | 'cancelled' | 'unsupported';

/** The browser holds the whole file in memory to hand it over — above this, share a link instead. */
export const WEB_SHARE_MAX_BYTES = 50 * 1024 * 1024;

export async function shareFileViaWeb(
  url: string,
  file: { name: string; mimeType?: string | null; sizeBytes?: number | null },
): Promise<ShareResult> {
  const nav: any = typeof navigator !== 'undefined' ? navigator : null;
  if (!nav?.share || !nav?.canShare) return 'unsupported';
  if (file.sizeBytes && file.sizeBytes > WEB_SHARE_MAX_BYTES) return 'unsupported';

  try {
    const res = await fetch(url);
    if (!res.ok) return 'unsupported';
    const blob = await res.blob();
    const payload = new File([blob], file.name, {
      type: file.mimeType || blob.type || 'application/octet-stream',
    });
    if (!nav.canShare({ files: [payload] })) return 'unsupported';
    await nav.share({ files: [payload], title: file.name });
    return 'shared';
  } catch (err: any) {
    // AbortError = the user dismissed the sheet; don't second-guess them with a
    // fallback. NotAllowedError = Safari expired the click's transient activation
    // during the fetch above — that one legitimately falls back to link sharing.
    if (err?.name === 'AbortError') return 'cancelled';
    console.error('[webShare] share failed:', err);
    return 'unsupported';
  }
}

/** True where the clipboard can carry an image — the only real-object handoff Firefox has. */
export function canCopyImage(mimeType?: string | null): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!(navigator as any).clipboard?.write &&
    typeof ClipboardItem !== 'undefined' &&
    !!mimeType?.toLowerCase().startsWith('image/')
  );
}

/**
 * Puts the actual image on the clipboard, so it can be pasted straight into
 * WhatsApp Web / Drive / an email as a real attachment rather than a link.
 *
 * ponytail: browsers only accept image/png for clipboard writes, so anything
 * else round-trips through a canvas. There is no equivalent for non-image files
 * — the web has no API to put an arbitrary file on the OS clipboard.
 */
export async function copyImageToClipboard(url: string): Promise<boolean> {
  try {
    const res = await fetch(url);
    if (!res.ok) return false;
    const blob = await res.blob();
    const png = blob.type === 'image/png' ? blob : await toPng(blob);
    if (!png) return false;
    await (navigator as any).clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch (err) {
    console.error('[webShare] clipboard copy failed:', err);
    return false;
  }
}

function toPng(blob: Blob): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext('2d')?.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(resolve, 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}
