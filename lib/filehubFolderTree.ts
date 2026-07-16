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

// Ensures every directory in dirPaths exists under rootFolderId, creating
// missing ones top-down. `existing` must already be filtered to the target
// scope/channel. Returns dirPath -> folder id for assigning files.
// ponytail: name match is exact-case; "Docs" and "docs" become two folders.
export async function ensureFolderTree(
  dirPaths: string[],
  rootFolderId: string | null,
  existing: FolderNode[],
  createFolder: (name: string, parentId: string | null) => Promise<string>,
): Promise<Map<string, string>> {
  const resolved = new Map<string, string>();
  for (const dir of dirPaths) {
    let parentId = rootFolderId;
    let path = '';
    for (const part of dir.split('/').filter(Boolean)) {
      path = path ? `${path}/${part}` : part;
      let id = resolved.get(path);
      if (!id) {
        id =
          existing.find(f => f.name === part && (f.parent_id ?? null) === parentId)?.id ??
          (await createFolder(part, parentId));
        resolved.set(path, id);
      }
      parentId = id;
    }
  }
  return resolved;
}
