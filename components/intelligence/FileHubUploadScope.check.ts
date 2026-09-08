// Run with: npx tsx components/intelligence/FileHubUploadScope.check.ts
// Focused source check for #98's caller-side upload scope propagation and the
// mounted FolderTreePicker selection behavior.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const desktop = readFileSync('components/intelligence/_filehub_desktop.tsx', 'utf8');
const adaptive = readFileSync('components/intelligence/_filehub_adaptive.tsx', 'utf8');
const picker = readFileSync('components/intelligence/FolderTreePicker.tsx', 'utf8');

assert.match(desktop, /const uploadVisibilitySeed: 'direct' \| 'broadcast' \| undefined = mode === 'groups'/);
assert.equal((desktop.match(/visibilitySeed: uploadVisibilitySeed/g) ?? []).length, 4, 'desktop button/drop/paste/overview paths must seed visibility');
assert.match(adaptive, /const uploadVisibilitySeed: 'direct' \| 'broadcast' \| undefined = mode === 'groups'/);
assert.match(adaptive, /visibilitySeed: uploadVisibilitySeed/);
assert.match(adaptive, /\[activeGroup, canUpload, selectedFolderId, summon, uploadVisibilitySeed\]/);
assert.match(picker, /useEffect\(\(\) => \{/);
assert.match(picker, /const next = new Set\(prev\)/);
assert.match(picker, /ancestors\.forEach\(id => next\.add\(id\)\)/);

console.log('FileHubUploadScope.check: all assertions passed');
