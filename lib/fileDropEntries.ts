// Recurse a dropped FileSystemEntry (webkitGetAsEntry) into files, stamping
// each with its path relative to the drop — empty for a loose file, so relDir()
// treats it as root, and "Folder/sub/x.png" for folder drops so the upload
// pipeline nests them exactly like a webkitdirectory pick. Pure (no react-native
// import) so it stays unit-testable in node.
export function walkEntry(entry: any, prefix: string): Promise<File[]> {
  return new Promise(resolve => {
    if (entry.isFile) {
      entry.file((f: File) => {
        const rel = prefix + entry.name;
        // webkitRelativePath is a read-only prototype getter; shadow it with an
        // own value so `(f as any).webkitRelativePath` matches a webkitdir pick.
        if (rel.includes('/')) { try { Object.defineProperty(f, 'webkitRelativePath', { value: rel, configurable: true }); } catch {} }
        resolve([f]);
      }, () => resolve([]));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const all: File[] = [];
      // readEntries returns in batches; call until it yields an empty one.
      const readBatch = () => reader.readEntries(async (batch: any[]) => {
        if (!batch.length) { resolve(all); return; }
        for (const child of batch) all.push(...await walkEntry(child, prefix + entry.name + '/'));
        readBatch();
      }, () => resolve(all));
      readBatch();
    } else resolve([]);
  });
}
