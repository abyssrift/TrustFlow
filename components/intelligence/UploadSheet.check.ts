// Run with: npx tsx components/intelligence/UploadSheet.check.ts
// Focused source checks for the removal of the legacy adaptive uploader.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('components/intelligence/_filehub_adaptive.tsx', 'utf8');
assert.doesNotMatch(source, /function UploadSheet\(/, 'legacy adaptive uploader must be removed');
assert.doesNotMatch(source, /rpc_filehub_upload_commit/, 'adaptive FileHub must not commit uploads directly');
assert.doesNotMatch(source, /storage\.from\(['"]filehub-files['"]\)\.upload/, 'adaptive FileHub must not upload bytes directly');
assert.match(source, /summon\('upload', \{/s, 'adaptive FileHub must summon the decoupled uploader');
assert.doesNotMatch(source, /setShowUpload|showUpload/, 'adaptive FileHub must not own a second upload modal');

console.log('UploadSheet.check: all assertions passed');
