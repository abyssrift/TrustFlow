// Self-check for folder-tree upload — run: npx tsx lib/filehubFolderTree.test.ts
// No framework (ponytail): plain asserts, fake createFolder counts calls.
import assert from 'node:assert';
import { ensureFolderTree, groupPickedFiles, relDir } from './filehubFolderTree';

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

async function run() {
  // Fresh tree: shared prefixes are created once, ids map back per path.
  let calls: string[] = [];
  let n = 0;
  const create = async (name: string, parentId: string | null) => {
    calls.push(`${parentId ?? 'root'}/${name}`);
    return `id${++n}`;
  };
  const map = await ensureFolderTree(
    ['Photos/2026', 'Photos/2025', 'Docs'],
    null,
    [],
    create,
  );
  assert.deepEqual(calls, ['root/Photos', 'id1/2026', 'id1/2025', 'root/Docs']);
  assert.equal(map.get('Photos/2026'), 'id2');
  assert.equal(map.get('Docs'), 'id4');

  // Merge: an existing "Photos" under the chosen root is reused, not duplicated.
  calls = [];
  const map2 = await ensureFolderTree(
    ['Photos/2026'],
    'target',
    [{ id: 'existing', name: 'Photos', parent_id: 'target' }],
    create,
  );
  assert.deepEqual(calls, ['existing/2026']);
  assert.equal(map2.get('Photos'), 'existing');

  // A same-named folder under a DIFFERENT parent must not be mistaken for a match.
  calls = [];
  await ensureFolderTree(
    ['Photos'],
    null,
    [{ id: 'elsewhere', name: 'Photos', parent_id: 'other-folder' }],
    create,
  );
  assert.deepEqual(calls, ['root/Photos']);

  console.log('filehubFolderTree: all checks passed');
}

run();
