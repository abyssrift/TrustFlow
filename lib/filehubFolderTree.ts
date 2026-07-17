// Rebuilds a picked directory tree (webkitdirectory folder upload) inside
// FileHub, Explorer-style: the picked folder itself is created at the target,
// nesting is preserved, and a folder that already exists at a level is merged
// into instead of duplicated.

export type FolderNode = { id: string; name: string; parent_id: string | null };

// Directory part of a webkitRelativePath — '' for files picked individually.
export function relDir(path: string | undefined | null): string {
  if (!path) return '';
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

// Collapses a picked-file list for display: files picked via a folder input
// (they carry a relative path) roll up into one entry per top-level folder,
// so a 700-file folder shows as a single tile. Individually picked files
// stay as-is. Indices point back into `items` for removal.
export type PickedDisplayItem<T> =
  | { kind: 'file'; item: T; index: number }
  | { kind: 'folder'; name: string; count: number; size: number; indices: number[] };

export function groupPickedFiles<T>(
  items: T[],
  relPathOf: (item: T) => string | undefined,
  sizeOf: (item: T) => number,
): PickedDisplayItem<T>[] {
  const out: PickedDisplayItem<T>[] = [];
  const byRoot = new Map<string, Extract<PickedDisplayItem<T>, { kind: 'folder' }>>();
  items.forEach((item, index) => {
    const rel = relPathOf(item) || '';
    const slash = rel.indexOf('/');
    if (slash === -1) {
      out.push({ kind: 'file', item, index });
      return;
    }
    const root = rel.slice(0, slash);
    let group = byRoot.get(root);
    if (!group) {
      group = { kind: 'folder', name: root, count: 0, size: 0, indices: [] };
      byRoot.set(root, group);
      out.push(group);
    }
    group.count++;
    group.size += sizeOf(item);
    group.indices.push(index);
  });
  return out;
}

// Resolves a picked directory path (e.g. 'Photos/2026') to an EXISTING leaf
// folder id under rootFolderId, walking `existing` segment by segment. Returns
// null the moment a segment doesn't exist yet.
//
// Folder *creation* for uploads now happens server-side, atomically, inside
// rpc_filehub_upload_commit (p_rel_dir) — so the client never pre-creates a
// tree and can't leave empty husks behind if a batch half-fails. This helper
// exists only so the pre-upload duplicate / name-conflict checks can be scoped
// to the right folder when it already exists. A null result means the target
// sub-folder is brand new, so there is nothing there to conflict with and the
// caller can skip those checks entirely.
// ponytail: name match is exact-case, matching the server's get-or-create.
export function resolveExistingFolderLeaf(
  rootId: string | null,
  dirPath: string,
  existing: FolderNode[],
): string | null {
  let parentId = rootId ?? null;
  for (const part of dirPath.split('/').filter(Boolean)) {
    const found = existing.find(f => f.name === part && (f.parent_id ?? null) === parentId);
    if (!found) return null;
    parentId = found.id;
  }
  return parentId;
}
