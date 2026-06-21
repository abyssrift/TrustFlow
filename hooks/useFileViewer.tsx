import { FilePreviewModal, getPreviewKind, type PreviewKind } from '@/components/common/FilePreview';
import { useImageLightbox, type LightboxMedia } from '@/hooks/useImageLightbox';
import { openStorageFile } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import React, { useEffect, useMemo, useState } from 'react';

export type ViewerMedia = LightboxMedia;

const isImageMime = (m?: string | null) => !!m && m.toLowerCase().includes('image');

/**
 * Unified file viewer — the same rich experience used by FileHub.
 *
 * - Images open in a navigable full-screen ImageLightbox (via {@link useImageLightbox}).
 * - Spreadsheets / PDFs / Word docs / text open inline in a full-screen
 *   {@link FilePreviewModal} (parsed tables, PDF iframe, rendered docx, etc.)
 *   instead of bouncing to a new browser tab.
 * - Anything else (zip, video, audio…) falls back to a direct download/open.
 *
 * Drop-in compatible with `useImageLightbox`: returns `signedUrls` (image
 * thumbnails) and `handlePress(item)`, plus a single `viewer` element to render
 * once anywhere in the tree (replaces the old `lightbox`).
 */
export function useFileViewer(
  items: ViewerMedia[],
  defaultBucket: string,
  options?: { onInfo?: (item: ViewerMedia) => void }
) {
  const { signedUrls, openImage, handlePress: basePress, lightbox } = useImageLightbox(
    items,
    defaultBucket,
    options
  );

  // Previewable non-image files → resolve a signed URL so the modal can render
  // inline (spreadsheet/pdf/docx/text). Keyed by item id.
  const previewables = useMemo(
    () => items.filter((i) => i.storagePath && !isImageMime(i.mimeType) && getPreviewKind(i.mimeType, i.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.map((i) => `${i.id}:${i.storagePath}`).join('|')]
  );
  const previewKey = previewables.map((i) => i.id).join(',');

  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (previewables.length === 0) { setPreviewUrls({}); return; }
    let cancelled = false;
    setPreviewUrls({});

    (async () => {
      const map: Record<string, string> = {};
      const byBucket = new Map<string, ViewerMedia[]>();

      for (const it of previewables) {
        // Legacy records that stored a full http(s) URL are usable as-is.
        if (it.storagePath.startsWith('http')) { map[it.id] = it.storagePath; continue; }
        const b = it.bucket || defaultBucket;
        if (!byBucket.has(b)) byBucket.set(b, []);
        byBucket.get(b)!.push(it);
      }

      await Promise.all(
        Array.from(byBucket.entries()).map(async ([bucket, its]) => {
          const { data, error } = await supabase.storage
            .from(bucket)
            .createSignedUrls(its.map((i) => i.storagePath), 3600);
          if (error || !data) return;
          data.forEach((s, i) => { if (s.signedUrl) map[its[i].id] = s.signedUrl; });
        })
      );

      if (!cancelled) setPreviewUrls(map);
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, defaultBucket]);

  const [preview, setPreview] = useState<
    { uri: string; name: string; kind: PreviewKind; bucket: string; storagePath: string } | null
  >(null);

  const handlePress = (item: ViewerMedia) => {
    if (isImageMime(item.mimeType)) { basePress(item); return; }

    const kind = getPreviewKind(item.mimeType, item.name);
    const bucket = item.bucket || defaultBucket;
    if (!kind) { openStorageFile(bucket, item.storagePath, item.name, item.mimeType); return; }

    const url = previewUrls[item.id];
    if (url) {
      setPreview({ uri: url, name: item.name, kind, bucket, storagePath: item.storagePath });
      return;
    }

    // Signed URL not resolved yet (e.g. item not in the eager list) — resolve on demand.
    if (item.storagePath.startsWith('http')) {
      setPreview({ uri: item.storagePath, name: item.name, kind, bucket, storagePath: item.storagePath });
      return;
    }
    supabase.storage
      .from(bucket)
      .createSignedUrl(item.storagePath, 3600)
      .then(({ data }) => {
        if (data?.signedUrl) setPreview({ uri: data.signedUrl, name: item.name, kind, bucket, storagePath: item.storagePath });
        else openStorageFile(bucket, item.storagePath, item.name, item.mimeType);
      });
  };

  const viewer = (
    <>
      {lightbox}
      {preview && (
        <FilePreviewModal
          visible
          uri={preview.uri}
          fileName={preview.name}
          kind={preview.kind}
          onClose={() => setPreview(null)}
          onDownload={() => openStorageFile(preview.bucket, preview.storagePath, preview.name)}
        />
      )}
    </>
  );

  return { signedUrls, previewUrls, openImage, handlePress, viewer };
}

/** True when a file gets an inline preview (image lightbox or {@link FilePreviewModal}). */
export function isPreviewable(mimeType?: string | null, name?: string | null): boolean {
  return isImageMime(mimeType) || getPreviewKind(mimeType, name) !== null;
}
