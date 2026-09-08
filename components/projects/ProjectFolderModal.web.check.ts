import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('components/projects/ProjectFolderModal.web.tsx', 'utf8');

assert.match(source, /import ClipboardControls from ['"]@\/components\/common\/ClipboardControls['"]/);
assert.strictEqual((source.match(/<ClipboardControls\b/g) ?? []).length, 2);
assert.match(source, /<ClipboardControls value=\{name\} onPaste=\{setName\} \/>/);
assert.match(source, /value=\{description\}[\s\S]*?onPaste=\{t => setDescription\(description \? `\$\{description\}\\n\$\{t\}` : t\)\}/);
assert.doesNotMatch(source, /addEventListener|Animated|useForm/);

console.log('ProjectFolderModal.web clipboard check: ok');
