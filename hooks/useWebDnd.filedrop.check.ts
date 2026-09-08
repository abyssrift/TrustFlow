import assert from 'node:assert';
import { collectDroppedFiles, walkEntry } from '../lib/fileDropEntries';

const file = (name: string, delay = 0) => ({
  isFile: true, isDirectory: false, name,
  file: (cb: (f: any) => void) => setTimeout(() => cb({ name }), delay),
});
const dir = (name: string, children: any[], batches = 1) => ({
  isFile: false, isDirectory: true, name,
  createReader: () => {
    let offset = 0;
    return { readEntries: (cb: (batch: any[]) => void) => { const batch = offset < children.length ? children.slice(offset, offset += Math.ceil(children.length / batches)) : []; cb(batch); } };
  },
});
const modernFile = (name: string, delay = 0) => ({ kind: 'file', name, getFile: async () => { await new Promise(r => setTimeout(r, delay)); return { name, size: 1 }; } });
const modernDir = (name: string, children: any[]) => ({ kind: 'directory', name, async *values() { for (const child of children) yield child; } });

(async () => {
  const tree = dir('Photos', [file('a.png'), dir('2026', [file('b.png')])]);
  const files = await walkEntry(tree, '///');
  assert.deepStrictEqual(files.map(f => (f as any).webkitRelativePath).sort(), ['Photos/2026/b.png', 'Photos/a.png']);
  const loose = await walkEntry(file('report.pdf'));
  assert.strictEqual((loose[0] as any)?.webkitRelativePath ?? '', '');

  const many = dir('Many', Array.from({ length: 125 }, (_, i) => file(`f${i}.txt`)), 126);
  assert.strictEqual((await collectDroppedFiles([many])).files.length, 125, 'all repeated batches must drain');
  const mixed = await collectDroppedFiles([modernDir('Modern', [modernFile('m.txt')]), file('loose.txt'), modernFile('root.txt')]);
  assert.deepStrictEqual(mixed.files.map(f => (f as any).webkitRelativePath || '').sort(), ['', '', 'Modern/m.txt']);
  const empty = await collectDroppedFiles([dir('Empty', [])]);
  assert.ok(empty.diagnostics.some(d => d.kind === 'empty-directory'));
  const unreadable = await collectDroppedFiles([{ isDirectory: true, name: 'Bad', createReader: () => { throw new Error('no access'); } }]);
  assert.ok(unreadable.diagnostics.some(d => d.kind === 'unreadable'));

  let active = 0, peak = 0;
  const wide = modernDir('Wide', Array.from({ length: 12 }, (_, i) => ({ kind: 'file', name: `w${i}`, getFile: async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 2)); active--; return { name: `w${i}`, size: 1 }; } })));
  assert.strictEqual((await collectDroppedFiles([wide], { concurrency: 4 })).files.length, 12);
  assert.ok(peak > 1 && peak <= 4, `concurrency peak ${peak}`);

  let deep: any = file('deep.txt');
  for (let i = 0; i < 1500; i++) deep = dir(`d${i}`, [deep]);
  assert.strictEqual((await collectDroppedFiles([deep])).files.length, 1, 'deep trees must not recurse the JS stack');
  assert.strictEqual((await collectDroppedFiles([dir('Limit', [file('a'), file('b'), file('c')])], { maxFiles: 2 })).files.length, 2);
  assert.ok((await collectDroppedFiles([dir('Limit', [file('a'), file('b'), file('c')])], { maxEntries: 2 })).diagnostics.some(d => d.kind === 'truncated'));
  const controller = new AbortController(); controller.abort();
  assert.ok((await collectDroppedFiles([many], { signal: controller.signal })).diagnostics.some(d => d.kind === 'aborted'));
  console.log('file-drop collector self-check passed');
})();
