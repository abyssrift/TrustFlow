// Focused structural check for the boolean submitWithEvidence contract.
// Run with: npx tsx contexts/SubmissionContext.check.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';

const context = fs.readFileSync('contexts/SubmissionContext.tsx', 'utf8');
const stageActions = fs.readFileSync('components/task-detail/StageActions.tsx', 'utf8');

assert.match(context, /submitWithEvidence:[\s\S]*?\}\) => Promise<boolean>/);
assert.match(context, /\}\): Promise<boolean> => \{[\s\S]*?rpc_submit_work/);
assert.match(context, /setTimeout\(\(\) => clearJob\(taskId\), 4000\);[\s\S]*?return true;/);
assert.match(context, /showAlert\(['"]Submission Failed['"][\s\S]*?return false;/);
assert.match(context, /if \(err\.message\?\.includes\(['"]LOW_TIMER_TIME['"]\) \|\| err\.message\?\.includes\(['"]TIME_APPROVAL_PENDING['"]\)\)[\s\S]*?throw err;/);

assert.equal((stageActions.match(/submitWithEvidence\(\{/g) || []).length, 3);
assert.equal((stageActions.match(/if \(submitted\) clearDraft\(\);/g) || []).length, 2);
assert.doesNotMatch(stageActions, /setStagedFiles\(\[\]\)/);

console.log('SubmissionContext.check: all assertions passed');
