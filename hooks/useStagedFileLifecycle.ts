import { useEffect, useRef } from 'react';
import { revokeStagedFiles, type PastedFile } from '@/lib/pasteImage';

/** Revokes staged blob URLs removed from a collection and on unmount. */
export function useStagedFileLifecycle(files: readonly Pick<PastedFile, 'uri'>[]): void {
  const previous = useRef<readonly Pick<PastedFile, 'uri'>[]>(files);
  useEffect(() => {
    const currentUris = new Set(files.map(file => file.uri));
    revokeStagedFiles(previous.current.filter(file => !currentUris.has(file.uri)));
    previous.current = files;
  }, [files]);
  useEffect(() => () => revokeStagedFiles(previous.current), []);
}
