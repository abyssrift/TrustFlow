import ImageLightbox from '@/components/common/ImageLightbox';
import { openStorageFile } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import React, { useEffect, useMemo, useState } from 'react';

export type LightboxMedia = {
  id: string;
  name: string;
  storagePath: string;
  mimeType?: string | null;
  /** Optional per-item bucket override; falls back to the hook's defaultBucket. */
  bucket?: string;
};

const isImageMime = (m?: string | null) => !!m && m.toLowerCase().includes('image');

/**
 * Shared image-viewer behaviour for any list of stored media.
 *
 * - Batch-resolves signed URLs for the image items (so private-bucket thumbnails render).
 * - `handlePress(item)` opens images in a navigable full-screen ImageLightbox
 *   (rotate/flip tools + format-convert download) and downloads everything else.
 * - Returns the `lightbox` element to render once anywhere in the tree.
 */
export function useImageLightbox(
  items: LightboxMedia[],
  defaultBucket: string,
  options?: { onInfo?: (item: LightboxMedia) => void }
) {
  // Only images participate in the lightbox; keep a stable, ordered list for navigation.
  const images = useMemo(
    () => items.filter((i) => isImageMime(i.mimeType) && i.storagePath),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items.map((i) => `${i.id}:${i.storagePath}`).join('|')]
  );
  const imageKey = images.map((i) => i.id).join(',');

  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    if (images.length === 0) {
      setSignedUrls({});
      return;
    }
    let cancelled = false;
    setSignedUrls({}); // clear stale URLs so tiles fall back to a loading state

    (async () => {
      const map: Record<string, string> = {};
      const byBucket = new Map<string, LightboxMedia[]>();

      for (const im of images) {
        // Legacy records that stored a full http(s) URL are already usable as-is.
        if (im.storagePath.startsWith('http')) {
          map[im.id] = im.storagePath;
          continue;
        }
        const b = im.bucket || defaultBucket;
        if (!byBucket.has(b)) byBucket.set(b, []);
        byBucket.get(b)!.push(im);
      }

      await Promise.all(
        Array.from(byBucket.entries()).map(async ([bucket, ims]) => {
          const { data, error } = await supabase.storage
            .from(bucket)
            .createSignedUrls(ims.map((i) => i.storagePath), 3600);
          if (error || !data) return;
          data.forEach((s, i) => {
            if (s.signedUrl) map[ims[i].id] = s.signedUrl;
          });
        })
      );

      if (!cancelled) setSignedUrls(map);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey, defaultBucket]);

  const openImage = (id: string) => {
    const i = images.findIndex((im) => im.id === id);
    if (i >= 0) setIndex(i);
  };

  const handlePress = (item: LightboxMedia) => {
    if (isImageMime(item.mimeType) && signedUrls[item.id]) {
      openImage(item.id);
      return;
    }
    openStorageFile(item.bucket || defaultBucket, item.storagePath, item.name);
  };

  const current = index != null ? images[index] : null;

  const lightbox =
    current && index != null ? (
      <ImageLightbox
        visible
        uri={signedUrls[current.id] || ''}
        fileName={current.name}
        index={index}
        total={images.length}
        hasPrev={index > 0}
        hasNext={index < images.length - 1}
        onPrev={() => setIndex((i) => (i != null && i > 0 ? i - 1 : i))}
        onNext={() => setIndex((i) => (i != null && i < images.length - 1 ? i + 1 : i))}
        onClose={() => setIndex(null)}
        onDownloadOriginal={() =>
          openStorageFile(current.bucket || defaultBucket, current.storagePath, current.name)
        }
        onInfo={
          options?.onInfo
            ? () => {
                setIndex(null);
                options.onInfo!(current);
              }
            : undefined
        }
      />
    ) : null;

  return { signedUrls, openImage, handlePress, lightbox };
}
