// Self-check for walkEntry: dropped-folder traversal must reproduce
// webkitRelativePath exactly (folder nesting depends on it). Framework-free —
// run with: npx tsx hooks/useWebDnd.filedrop.check.ts
import assert from 'node:assert';
import { walkEntry } from '../lib/fileDropEntries';

// Minimal fakes of the FileSystemEntry API walkEntry consumes.
const file = (name: string) => ({
  isFile: true, isDirectory: false, name,
  file: (cb: (f: any) => void) => cb({ name }), // File stand-in; walkEntry stamps webkitRelativePath
});
const dir = (name: string, children: any[]) => ({
  isFile: false, isDirectory: true, name,
  createReader: () => {
    let served = false;
    return {
      // readEntries yields all children once, then an empty batch to stop.
      readEntries: (cb: (b: any[]) => void) => { cb(served ? [] : children); served = true; },
    };
  },
});

(async () => {
  // Tree: Photos/{a.png, 2026/b.png}
  const tree = dir('Photos', [file('a.png'), dir('2026', [file('b.png')])]);
  const files = await walkEntry(tree, '');
  const paths = files.map(f => (f as any).webkitRelativePath).sort();
  assert.deepStrictEqual(paths, ['Photos/2026/b.png', 'Photos/a.png'], `nested paths wrong: ${paths}`);

  // A loose file (dropped directly) gets no slash → relDir() reads '' → root.
  const loose = await walkEntry(file('report.pdf'), '');
  assert.strictEqual((loose[0] as any).webkitRelativePath ?? '', '', 'loose file must have no relative path');

  console.log('walkEntry self-check passed');
})();
