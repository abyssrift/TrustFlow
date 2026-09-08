import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('components/task-detail/EditTaskModal.web.tsx', 'utf8');

assert.match(source, /import ClipboardControls from ['"]@\/components\/common\/ClipboardControls['"]/);
assert.strictEqual((source.match(/<ClipboardControls\b/g) ?? []).length, 6);
assert.strictEqual((source.match(/onPaste=\{setTitle\}/g) ?? []).length, 2);
assert.strictEqual((source.match(/onPaste=\{setCategory\}/g) ?? []).length, 2);
assert.strictEqual((source.match(/onPaste=\{t => setDescription\(description \?/g) ?? []).length, 2);
assert.match(source, /if \(isNarrow\)/);
assert.match(source, /tab === 'details'/);

console.log('EditTaskModal.web clipboard parity check: ok');
