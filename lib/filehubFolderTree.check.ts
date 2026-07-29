// Self-check for folder-tree upload helpers — run: npx tsx lib/filehubFolderTree.check.ts
// No framework (ponytail): plain asserts.
import assert from 'node:assert';
import { groupPickedFiles, relDir, resolveExistingFolderLeaf } from './filehubFolderTree';

assert.equal(relDir('Photos/2026/a.jpg'), 'Photos/2026');
assert.equal(relDir('a.jpg'), '');
assert.equal(relDir(undefined), '');

// Display grouping: folder picks collapse to one entry per top-level folder
// (700 nested files = 1 tile); loose files stay individual with their index.
{
  const picked = [
    { name: 'a.jpg', size: 10, relPath: 'Photos/a.jpg' },
    { name: 'loose.pdf', size: 5, relPath: undefined },
    { name: 'b.jpg', size: 20, relPath: 'Photos/2026/b.jpg' },
  ];
  const entries = groupPickedFiles(picked, p => p.relPath, p => p.size);
  assert.equal(entries.length, 2);
  const folder = entries.find(e => e.kind === 'folder') as any;
  assert.equal(folder.name, 'Photos');
  assert.equal(folder.count, 2);
  assert.equal(folder.size, 30);
  assert.deepEqual(folder.indices, [0, 2]);
  const file = entries.find(e => e.kind === 'file') as any;
  assert.equal(file.index, 1);
}

// resolveExistingFolderLeaf: a fully-existing path resolves to its leaf id;
// the first missing segment short-circuits to null (brand-new sub-tree, so the
// server will create it at commit and there's nothing to conflict-check).
{
  const existing = [
    { id: 'photos', name: 'Photos', parent_id: null },
    { id: '2026', name: '2026', parent_id: 'photos' },
  ];
  assert.equal(resolveExistingFolderLeaf(null, 'Photos/2026', existing), '2026');
  assert.equal(resolveExistingFolderLeaf(null, 'Photos', existing), 'photos');
  assert.equal(resolveExistingFolderLeaf(null, 'Photos/2025', existing), null);
  assert.equal(resolveExistingFolderLeaf(null, 'Docs', existing), null);

  // Same-named folder under a different parent must not be treated as a match.
  const elsewhere = [{ id: 'x', name: 'Photos', parent_id: 'other' }];
  assert.equal(resolveExistingFolderLeaf(null, 'Photos', elsewhere), null);

  // Resolution is anchored to the chosen upload root, not the whole company.
  const nested = [
    { id: 'target', name: 'Target', parent_id: null },
    { id: 'sub', name: 'Sub', parent_id: 'target' },
  ];
  assert.equal(resolveExistingFolderLeaf('target', 'Sub', nested), 'sub');
  assert.equal(resolveExistingFolderLeaf(null, 'Sub', nested), null);
}

// ── Parity with the server's get-or-create (p_rel_dir) ───────────────────────
// These pin resolveExistingFolderLeaf to the semantics of the FOREACH loop in
// rpc_filehub_upload_commit (20260720_filehub_upload_commit_folder_tree.sql).
// Each expectation below was verified against a real Postgres 15 running that
// loop verbatim; if the server's semantics change, these must change with it.
{
  const existing = [{ id: 'docs-upper', name: 'Docs', parent_id: null }];

  // Server matches `name = v_seg` (exact-case, no lower()), and the unique
  // index is on raw `name` — so 'Docs' and 'docs' are two distinct sibling
  // folders. The client must therefore NOT case-fold, or it would scope a
  // dup-check against 'Docs' for an upload the server lands in a new 'docs'.
  // Verified: resolve_tree(..,'Docs') then (..,'docs') => 2 rows.
  assert.equal(resolveExistingFolderLeaf(null, 'Docs', existing), 'docs-upper');
  assert.equal(resolveExistingFolderLeaf(null, 'docs', existing), null,
    'case-only difference must not match — server get-or-create is exact-case');
}

{
  // Server does `CONTINUE WHEN length(v_seg) = 0`, so empty segments from
  // '//', a leading '/', or a trailing '/' are skipped rather than creating a
  // blank folder. The client's `.filter(Boolean)` must agree.
  // Verified: resolve_tree(..,'A//B') => A at root, B child of A (2 rows).
  const existing = [
    { id: 'a', name: 'A', parent_id: null },
    { id: 'b', name: 'B', parent_id: 'a' },
  ];
  assert.equal(resolveExistingFolderLeaf(null, 'A//B', existing), 'b');
  assert.equal(resolveExistingFolderLeaf(null, '/A/B', existing), 'b');
  assert.equal(resolveExistingFolderLeaf(null, 'A/B/', existing), 'b');

  // An all-empty path resolves to the root itself: the server's loop skips
  // every segment, leaving v_target_folder = p_folder_id.
  assert.equal(resolveExistingFolderLeaf(null, '///', existing), null);
  assert.equal(resolveExistingFolderLeaf('a', '///', existing), 'a');
}

{
  // Unicode / spaces / dots survive as-is: folder names are plain DB text and
  // never routed through safeName (that only sanitises the storage object key,
  // which lives under a uuid dir). No normalisation on either side.
  const existing = [
    { id: 'u1', name: 'Photos 2026', parent_id: null },
    { id: 'u2', name: 'Ünicode — dir', parent_id: 'u1' },
    { id: 'u3', name: 'v1.2.3', parent_id: 'u2' },
  ];
  assert.equal(resolveExistingFolderLeaf(null, 'Photos 2026/Ünicode — dir/v1.2.3', existing), 'u3');

  // A path is only "existing" if EVERY segment exists; the first miss
  // short-circuits, and the caller then skips the dup/name-conflict checks.
  assert.equal(resolveExistingFolderLeaf(null, 'Photos 2026/Ünicode — dir/v1.2.4', existing), null);
}

{
  // Deep nesting resolves segment-by-segment with no depth ceiling on either
  // side (the server loops the split array; there is no recursion limit).
  const depth = 50;
  const deep = Array.from({ length: depth }, (_, i) => ({
    id: `d${i}`, name: `lvl${i}`, parent_id: i === 0 ? null : `d${i - 1}`,
  }));
  const path = deep.map(d => d.name).join('/');
  assert.equal(resolveExistingFolderLeaf(null, path, deep), `d${depth - 1}`);
  assert.equal(resolveExistingFolderLeaf(null, `${path}/lvl${depth}`, deep), null);
}

{
  // relDir feeds p_rel_dir directly, so it must never emit a leading slash or
  // an absolute-looking path for a real webkitRelativePath.
  assert.equal(relDir('Photos/2026/deep/nested/a.jpg'), 'Photos/2026/deep/nested');
  assert.equal(relDir('Photos/a.jpg'), 'Photos');
  // No directory part => '' => caller passes p_rel_dir: null and the file
  // lands directly in the chosen target folder.
  assert.equal(relDir('a.jpg'), '');
  assert.equal(relDir(''), '');
  assert.equal(relDir(null), '');
}

console.log('filehubFolderTree: all checks passed');
