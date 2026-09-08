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
assert.match(draft, /const activeDraft = draft\.scopeKey === activeScopeKey \? draft : blankDraft\(activeScopeKey\)/);
assert.match(draft, /scopeRef\.current !== expectedScope/);
assert.match(draft, /useStagedFileLifecycle\(activeDraft\.stagedFiles\)/);
assert.match(draft, /current\.scopeKey === activeScopeKey \? current : blankDraft\(activeScopeKey\)/);
assert.doesNotMatch(draft, /AsyncStorage|localStorage/);

console.log('TaskFilePaste/StageEvidenceDraft scope behavior check: ok');
