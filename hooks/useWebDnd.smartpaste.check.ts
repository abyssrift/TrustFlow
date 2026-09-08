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
    : req === 'expo-clipboard'
    ? {}
    : req === 'react-native-reanimated'
    ? { useReducedMotion: () => false }
    : _load(req, ...rest);

import assert from 'node:assert';
const { extractClipboardPayload, routeClipboardPayload, routeScopedMarkdownPayload, shouldInstallSmartPaste, snapshotClipboardFileItems } = require('./useWebDnd') as typeof import('./useWebDnd');
const { taskSeedKey, applyTaskSeed } = require('../lib/pasteImage') as typeof import('../lib/pasteImage');

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

// 5. Text in an editable target passes through without preventing default.
{
  let prevented = 0;
  let textCalls = 0;
  const result = routeClipboardPayload({ files: [], text: 'typed text' }, true, {
    onText: () => { textCalls += 1; },
  }, () => { prevented += 1; });
  assert.strictEqual(result, 'passthrough');
  assert.strictEqual(prevented, 0, 'editable text paste must not preventDefault');
  assert.strictEqual(textCalls, 0, 'editable text paste must not call onText');
}

// 6. Bare text is intercepted exactly once.
{
  let prevented = 0;
  let text = '';
  const result = routeClipboardPayload({ files: [], text: 'bare text' }, false, {
    onText: value => { text = value; },
  }, () => { prevented += 1; });
  assert.strictEqual(result, 'text');
  assert.strictEqual(prevented, 1);
  assert.strictEqual(text, 'bare text');
}

// 7. Files take precedence even while an editable target is focused.
{
  const f = { name: 'focused.png' };
  let prevented = 0;
  let fileCalls = 0;
  let textCalls = 0;
  const result = routeClipboardPayload({ files: [f] as any, text: 'ignored' }, true, {
    onFiles: files => { fileCalls += files.length; },
    onText: () => { textCalls += 1; },
  }, () => { prevented += 1; });
  assert.strictEqual(result, 'files');
  assert.strictEqual(prevented, 1);
  assert.strictEqual(fileCalls, 1);
  assert.strictEqual(textCalls, 0);
}

// 8. No caller handlers means no routing or preventDefault (disabled/no-op path).
{
  let prevented = 0;
  const result = routeClipboardPayload({ files: [{ name: 'ignored' }] as any, text: 'ignored' }, false, {}, () => { prevented += 1; });
  assert.strictEqual(result, 'noop');
  assert.strictEqual(prevented, 0);
}

// 9. Scoped editor intake claims exactly one Markdown file only. Mixed,
// multiple, and non-Markdown payloads pass through without invoking it.
{
  const markdown = { name: 'notes.MARKDOWN' } as any;
  let calls = 0;
  assert.strictEqual(routeScopedMarkdownPayload({ files: [markdown], text: '' }, () => { calls += 1; }), 'claimed');
  assert.strictEqual(calls, 1);
  for (const payload of [
    { files: [markdown, { name: 'other.md' } as any], text: '' },
    { files: [{ name: 'notes.txt' } as any], text: '' },
    { files: [], text: 'plain text' },
  ]) assert.strictEqual(routeScopedMarkdownPayload(payload, () => { calls += 1; }), 'passthrough');
  assert.strictEqual(calls, 1, 'unclaimed scoped payload must not call the editor');
  assert.strictEqual(routeScopedMarkdownPayload({ files: [markdown], text: 'browser file metadata' }, () => { calls += 1; }), 'claimed');
  assert.strictEqual(calls, 2, 'one Markdown file remains authoritative when the browser also supplies text metadata');
}

// 10. Installation gating proves disabled/native/SSR paths do not install a listener.
assert.strictEqual(shouldInstallSmartPaste('web', false, true), false);
assert.strictEqual(shouldInstallSmartPaste('native', true, true), false);
assert.strictEqual(shouldInstallSmartPaste('web', true, false), false);
assert.strictEqual(shouldInstallSmartPaste('web', true, true), true);

// 10. FileHub's opt-in snapshot captures modern handles synchronously, falls
// back to legacy entries, and never adds a directory pseudo-File as bytes.
{
  let handleCalls = 0;
  const handle = { kind: 'directory', name: 'Photos' };
  const modern = { kind: 'file', getAsFile: () => ({ name: 'pseudo' }), getAsFileSystemHandle: () => { handleCalls += 1; return Promise.resolve(handle); } };
  const secondModern = { kind: 'file', getAsFile: () => ({ name: 'b.txt', size: 1, type: 'text/plain' }), getAsFileSystemHandle: () => { handleCalls += 1; return Promise.resolve({ kind: 'file', name: 'b.txt' }); } };
  const legacyEntry = { isDirectory: true, name: 'Docs' };
  const legacy = { kind: 'file', getAsFile: () => ({ name: 'pseudo2' }), webkitGetAsEntry: () => legacyEntry };
  const snap = snapshotClipboardFileItems(dt({ items: [modern, secondModern, legacy] }), true);
  assert.strictEqual(handleCalls, 2, 'every modern handle must be invoked during the synchronous snapshot');
  assert.strictEqual(snap.files.length, 0, 'directory pseudo-Files must not be treated as loose bytes');
  assert.strictEqual(snap.sources.length, 3);
  assert.strictEqual(snap.filesystemClaimed, true);
}

// 11. A zero-byte, extensionless pseudo-File with no entry API is the only
// portable signal available for an unexposed copied folder. Claim it so the
// FileHub fallback is shown; keep a real zero-byte file with an extension.
{
  const folderLike = { name: 'Copied Folder', size: 0, type: '' };
  const emptyFile = { name: 'empty.txt', size: 0, type: 'text/plain' };
  const folderSnap = snapshotClipboardFileItems(dt({ items: [{ kind: 'file', getAsFile: () => folderLike }] }), true);
  assert.strictEqual(folderSnap.filesystemClaimed, true);
  assert.deepStrictEqual(folderSnap.files, []);
  const fileSnap = snapshotClipboardFileItems(dt({ items: [{ kind: 'file', getAsFile: () => emptyFile }] }), true);
  assert.strictEqual(fileSnap.filesystemClaimed, false);
  assert.deepStrictEqual(fileSnap.files, [emptyFile]);
}

// 12. Default (Tasks) mode remains the old loose-file parser and does not
// invoke directory APIs or claim filesystem payloads.
{
  let handleCalls = 0;
  const f = { name: 'task.png' };
  const item = { kind: 'file', getAsFile: () => f, getAsFileSystemHandle: () => { handleCalls += 1; return Promise.resolve({}); } };
  const snap = snapshotClipboardFileItems(dt({ items: [item] }), false);
  assert.strictEqual(handleCalls, 0);
  assert.deepStrictEqual(snap.files, [f]);
  assert.strictEqual(snap.filesystemClaimed, false);
}

// 13. Stable seed keys dedupe rerenders; changed text/files produce a new seed.
const seedFiles = [{ id: '1', uri: 'blob:a', name: 'a.png', size: 1, type: 'image/png' }];
assert.strictEqual(taskSeedKey('Title', seedFiles), taskSeedKey('Title', [...seedFiles]));
assert.notStrictEqual(taskSeedKey('Title', seedFiles), taskSeedKey('Changed', seedFiles));
assert.notStrictEqual(taskSeedKey('Title', seedFiles), taskSeedKey('Title', [{ ...seedFiles[0], id: '2' }]));

// 14. Adaptive close -> new screen seed replaces the stale prior seed once;
// model the actual wasVisible/applied-key transition used by both modals.
let modelDraft = { title: '', description: '' };
let modelFiles: any[] = [];
const modelSetDraft = (updates: any) => { modelDraft = { ...modelDraft, ...updates }; };
const modelAddFiles = (files: any[]) => { modelFiles = [...modelFiles, ...files]; };
let modelWasVisible = false;
let modelAppliedKey: string | null = null;
const modelSeedOpen = (text: string) => {
  const opening = !modelWasVisible;
  modelWasVisible = true;
  const key = taskSeedKey(text, []);
  if (modelAppliedKey === key) return { opening, applied: false };
  modelAppliedKey = key;
  applyTaskSeed({ initialText: text }, modelDraft, modelSetDraft, modelAddFiles, opening);
  return { opening, applied: true };
};
assert.deepStrictEqual(modelSeedOpen('A'), { opening: true, applied: true });
assert.strictEqual(modelDraft.title, 'A');
assert.deepStrictEqual(modelSeedOpen('A'), { opening: false, applied: false });
// Closing resets both lifecycle refs; opening with B is a new seed and can
// replace the stale A title exactly once.
modelWasVisible = false;
modelAppliedKey = null;
assert.deepStrictEqual(modelSeedOpen('B'), { opening: true, applied: true });
assert.strictEqual(modelDraft.title, 'B');
assert.deepStrictEqual(modelSeedOpen('B'), { opening: false, applied: false });
modelDraft = { title: 'User edit', description: '' };
applyTaskSeed({ initialText: 'C' }, modelDraft, modelSetDraft, modelAddFiles, false);
assert.strictEqual(modelDraft.title, 'User edit', 'late visible seed must preserve user title');

// 15. Source-level caller checks prove competing screen/modal gates are
// mutually scoped (this does not claim one listener per mounted hook).
const _fs = require('node:fs');
const _path = require('node:path');
const _read = (relative: string) => _fs.readFileSync(_path.join(process.cwd(), relative), 'utf8');
const _adaptiveTasks = _read('components/tabs/_tasks_adaptive.tsx');
const _desktopTasks = _read('components/tabs/_tasks_desktop.tsx');
const _createTaskWeb = _read('components/tasks/CreateTaskModal.web.tsx');
const _createTaskNative = _read('components/tasks/CreateTaskModal.tsx');
const _fileHub = _read('components/intelligence/_filehub_desktop.tsx');
const _adaptiveFileHub = _read('components/intelligence/_filehub_adaptive.tsx');
const _uploadComposer = _read('components/filehub/UploadComposerModal.web.tsx');
const _modalHost = _read('components/common/ModalHost.tsx');
const _modalDispatch = _read('contexts/ModalDispatchContext.tsx');
assert.match(_adaptiveTasks, /useSmartPaste\([\s\S]*?!showCreateSheet/);
assert.match(_desktopTasks, /useSmartPaste\([\s\S]*?!showCreateModal/);
assert.match(_createTaskWeb, /useSmartPaste\([\s\S]*?visible && !bulkMode && !loading/);
assert.match(_fileHub, /useSmartPaste\([\s\S]*?canUpload && active\?\.type !== 'upload'/);
assert.match(_fileHub, /resolveDirectories:\s*true[\s\S]*?onDiagnostics:/);
assert.match(_fileHub, /summon\('upload', \{[\s\S]*?folderId:[\s\S]*?initialFiles:[\s\S]*?activeGroup:/);
assert.match(_adaptiveFileHub, /useSmartPaste\([\s\S]*?canUpload && !uploadModalActive/);
assert.match(_adaptiveFileHub, /resolveDirectories:\s*true[\s\S]*?onDiagnostics:/);
assert.match(_adaptiveFileHub, /useFileDrop\([\s\S]*?canUpload && !uploadModalActive/);
assert.match(_adaptiveFileHub, /summon\('upload', \{[\s\S]*?folderId:[\s\S]*?initialFiles:[\s\S]*?activeGroup:/);
assert.match(_adaptiveFileHub, /Platform\.OS !== 'web'[\s\S]*?<UploadSheet/);
assert.doesNotMatch(_fileHub, /(?:function|const)\s+UploadModal\b|goo|morphToIsland|<UploadModal\b/);
assert.match(_uploadComposer, /initialFiles\?: File\[\] \| null/);
assert.match(_uploadComposer, /activeGroup\?: \{ id: string; name: string; avatar_color: string \} \| null/);
assert.match(_uploadComposer, /useSmartPaste\([\s\S]*?visible/);
assert.match(_uploadComposer, /resolveDirectories:\s*true[\s\S]*?onDiagnostics:/);
assert.match(_uploadComposer, /groupId:\s*activeGroup\?\.id \?\? null/);
assert.match(_uploadComposer, /presentation="auto"/);
assert.match(_uploadComposer, /flex-row flex-wrap w-full bg-surface-card/);
assert.match(_uploadComposer, /flexBasis:\s*100/);
assert.match(_uploadComposer, /flexGrow:\s*1/);
assert.match(_uploadComposer, /maxWidth:\s*140/);
assert.doesNotMatch(_uploadComposer, /display:\s*['"]grid['"]|gridTemplateColumns|containerWidth|gridWidthLockRef|onLayout=/);
assert.match(_modalDispatch, /initialFiles\?: File\[\] \| null/);
assert.match(_modalDispatch, /activeGroup\?: \{ id: string; name: string; avatar_color: string \} \| null/);
assert.match(_modalHost, /initialFiles=\{active\.payload\.initialFiles\}/);
assert.match(_modalHost, /activeGroup=\{active\.payload\.activeGroup\}/);
for (const modalSource of [_createTaskNative, _createTaskWeb]) {
  assert.match(modalSource, /wasVisibleRef\.current = false/);
  assert.match(modalSource, /appliedSeedKeyRef\.current = null/);
  assert.match(modalSource, /applyTaskSeed\([\s\S]*?opening,/);
}

// Latest-callback ref assertion is separate: it proves rerenders do not add a
// stale callback path, but intentionally does not claim runtime listener count.
const _hookSource = _fs.readFileSync(require.resolve('./useWebDnd'), 'utf8');
assert.match(_hookSource, /handlersRef\.current = handlers/);
assert.match(_hookSource, /diagnosticsRef\.current = options\.onDiagnostics/);
assert.match(_hookSource, /traversalRef\.current\?\.abort\(\)/);
assert.doesNotMatch(_hookSource, /onDiagnostic\?:/);

console.log('useSmartPaste self-check passed');
