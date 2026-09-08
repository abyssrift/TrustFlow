import assert from 'node:assert/strict';
import fs from 'node:fs';

const paste = fs.readFileSync('contexts/TaskFilePasteContext.web.tsx', 'utf8');
const draft = fs.readFileSync('contexts/StageEvidenceDraftContext.web.tsx', 'utf8');

assert.match(paste, /scopeKey: string/);
assert.match(paste, /scopeRef\.current !== activeScopeKey/);
assert.match(paste, /armedIdRef\.current = null/);
assert.match(paste, /registered\.scopeKey !== scopeRef\.current/);
assert.match(paste, /current\.configRef !== configRef/);
assert.match(draft, /scopeKey: string/);
assert.match(draft, /previousScopeRef\.current !== activeScopeKey/);
assert.match(draft, /setDraft\(\{ scopeKey: activeScopeKey, submissionContent: '', stagedFiles: \[\] \}\)/);
assert.match(draft, /useStagedFileLifecycle\(draft\.stagedFiles\)/);
assert.doesNotMatch(draft, /AsyncStorage|localStorage/);

console.log('TaskFilePaste/StageEvidenceDraft scope behavior check: ok');
