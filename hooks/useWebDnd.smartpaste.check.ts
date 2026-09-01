// Self-check for extractClipboardPayload: a clipboard paste must split files vs
// plain text, and files must win when both are present. Framework-free —
// run with: npx tsx hooks/useWebDnd.smartpaste.check.ts
//
// useWebDnd.ts imports react-native (flow syntax esbuild/tsx can't parse), so
// stub that bare module before requiring the hook file. Kept as plain
// statements + require() so esbuild doesn't hoist the import above the stub.
// ponytail: minimal shim; the pure helper under test never touches react-native.
const _mod = require('node:module');
const _load = _mod._load;
_mod._load = (req: string, ...rest: any[]) =>
  req === 'react-native'
    ? { Platform: { OS: 'test' }, Animated: {}, Easing: {} }
    : req === 'react-native-reanimated'
    ? { useReducedMotion: () => false }
    : _load(req, ...rest);

import assert from 'node:assert';
const { extractClipboardPayload } = require('./useWebDnd') as typeof import('./useWebDnd');

// Minimal DataTransfer-shaped fakes — only the bits the parser reads.
const fileItem = (f: any) => ({ kind: 'file', getAsFile: () => f });
const textItem = () => ({ kind: 'string', getAsFile: () => null });
const dt = (o: { items?: any[]; files?: any[]; text?: string }) =>
  ({
    items: o.items ?? [],
    files: o.files ?? [],
    getData: (type: string) => (type === 'text/plain' ? o.text ?? '' : ''),
  }) as any;

// 1. items containing a file → payload.files has it (this is the onFiles branch).
{
  const f = { name: 'shot.png' };
  const { files, text } = extractClipboardPayload(dt({ items: [fileItem(f)] }));
  assert.deepStrictEqual(files, [f], 'file item not collected');
  assert.strictEqual(text, '', 'no text expected');
}

// 2. items with only text/plain → payload.text set, payload.files empty.
{
  const { files, text } = extractClipboardPayload(dt({ items: [textItem()], text: 'hello world' }));
  assert.strictEqual(files.length, 0, 'no files expected');
  assert.strictEqual(text, 'hello world', 'text/plain not read');
}

// 3. both present → files win. The hook checks files.length before onText, so a
// non-empty files array here means onFiles fires and onText is never consulted.
{
  const f = { name: 'a.png' };
  const { files, text } = extractClipboardPayload(dt({ items: [fileItem(f)], text: 'ignored' }));
  assert.ok(files.length > 0, 'files must be present so onFiles wins over onText');
  assert.strictEqual(text, 'ignored', 'text still parsed, just unused when files present');
}

// 4. .files fallback when items[] is empty.
{
  const f = { name: 'b.pdf' };
  const { files } = extractClipboardPayload(dt({ files: [f] }));
  assert.deepStrictEqual(files, [f], '.files fallback not used');
}

console.log('useSmartPaste self-check passed');
