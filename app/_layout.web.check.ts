// Focused regression check for stable Sidebar/Slot identity across navigation.
// Run with: npx tsx app/_layout.web.check.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';

const layout = fs.readFileSync('app/_layout.web.tsx', 'utf8');
const sidebar = fs.readFileSync('components/Sidebar.web.tsx', 'utf8');

assert.match(layout, /<StageEvidenceDraftProvider scopeKey=\{pathname\}>/);
assert.match(layout, /<TaskFilePasteProvider scopeKey=\{pathname\}>/);
assert.doesNotMatch(layout, /(?:StageEvidenceDraftProvider|TaskFilePasteProvider) key=\{pathname\}/);
assert.match(layout, /<TaskFilePasteProvider scopeKey=\{pathname\}>[\s\S]*?<Sidebar>[\s\S]*?<Slot \/>[\s\S]*?<\/Sidebar>[\s\S]*?<\/TaskFilePasteProvider>/);
assert.doesNotMatch(layout, /<Sidebar[^>]*key=/);
assert.doesNotMatch(layout, /<Slot[^>]*key=/);
assert.doesNotMatch(sidebar, /key=\{pathname\}|key=\{.*pathname/);

console.log('layout/sidebar regression check: all assertions passed');
