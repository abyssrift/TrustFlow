import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  blankStageEvidenceDraft,
  projectStageEvidenceDraft,
  updateStageEvidenceDraft,
} from './StageEvidenceDraftContext.shared';

const paste = fs.readFileSync('contexts/TaskFilePasteContext.web.tsx', 'utf8');
const draft = fs.readFileSync('contexts/StageEvidenceDraftContext.web.tsx', 'utf8');
const taskDraft = blankStageEvidenceDraft('task-a');
const sameScope = updateStageEvidenceDraft(taskDraft, 'task-a', 'task-a', current => ({
  ...current,
  submissionContent: 'kept',
}));
assert.equal(sameScope.submissionContent, 'kept');
const taskB = projectStageEvidenceDraft(sameScope, 'task-b');
assert.equal(taskB.submissionContent, '');
assert.deepEqual(taskB.stagedFiles, []);
const staleAUpdate = updateStageEvidenceDraft(taskB, 'task-a', 'task-b', current => ({
  ...current,
  submissionContent: 'stale',
}));
assert.strictEqual(staleAUpdate, taskB);

assert.match(paste, /scopeKey: string/);
assert.match(paste, /scopeRef\.current !== activeScopeKey/);
assert.match(paste, /armedIdRef\.current = null/);
assert.match(paste, /registered\.scopeKey !== scopeRef\.current/);
assert.match(paste, /current\.configRef !== configRef/);
assert.match(draft, /activeScopeKey/);
assert.match(draft, /const activeDraft = projectStageEvidenceDraft\(draft, activeScopeKey\)/);
assert.match(draft, /scopeRef\.current !== expectedScope/);
assert.match(draft, /useStagedFileLifecycle\(activeDraft\.stagedFiles\)/);
assert.match(draft, /updateStageEvidenceDraft\(/);
assert.match(draft, /projectStageEvidenceDraft\(draft, activeScopeKey\)/);
assert.match(paste, /catch \(error\) \{[\s\S]*?scopeRef\.current !== pasteScopeKey[\s\S]*?errorToast/);
assert.doesNotMatch(draft, /AsyncStorage|localStorage/);

console.log('TaskFilePaste/StageEvidenceDraft scope behavior check: ok');
