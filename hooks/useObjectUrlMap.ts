import { useEffect, useRef, useState } from 'react';

/**
 * Owns object URLs for a changing collection of browser Blobs. URLs are kept
 * stable while an item remains present, revoked when removed, and all revoked
 * on unmount. Pass null from native/non-previewable paths.
 */
export function useObjectUrlMap<T>(
  items: readonly T[],
  keyOf: (item: T, index: number) => string,
  blobOf: (item: T) => Blob | null | undefined,
): Record<string, string> {
  const urls = useRef(new Map<string, { url: string; blob: Blob }>());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const wanted = new Set<string>();
    let changed = false;
    items.forEach((item, index) => {
      const key = keyOf(item, index);
      const blob = blobOf(item);
      if (!blob) return;
      wanted.add(key);
      const existing = urls.current.get(key);
      if (!existing || existing.blob !== blob) {
        if (existing) URL.revokeObjectURL(existing.url);
        urls.current.set(key, { url: URL.createObjectURL(blob), blob });
        changed = true;
      }
    });
    urls.current.forEach((entry, key) => {
      if (!wanted.has(key)) {
        URL.revokeObjectURL(entry.url);
        urls.current.delete(key);
        changed = true;
      }
    });
    if (changed) setVersion(v => v + 1);
  }, [items, keyOf, blobOf]);

  useEffect(() => () => {
    urls.current.forEach(entry => URL.revokeObjectURL(entry.url));
    urls.current.clear();
  }, []);

  void version;
  return Object.fromEntries(Array.from(urls.current, ([key, entry]) => [key, entry.url]));
}
