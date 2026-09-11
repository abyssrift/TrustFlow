import assert from 'node:assert';
import fs from 'node:fs';

const source = fs.readFileSync('contexts/TaskDetailContext.tsx', 'utf8');
assert.match(source, /parseForwardStageUndo\(result\)/);
assert.match(source, /registerForwardUndo\(undoMetadata\)/);
assert.match(source, /rpc_undo_forward_stage/);
assert.match(source, /p_task_id: taskId/);
assert.match(source, /p_undo_token: metadata\.undoToken/);
assert.match(source, /label: 'Task advanced\.'/);
assert.match(source, /await fetchDetails\(\)/);
assert.match(source, /if \(!registerForwardUndo\(undoMetadata\)\) successToast\('Task action completed\.'\)/);
assert.match(source, /if \(!registerForwardUndo\(undoMetadata\)\) successToast\('Task advanced\.'\)/);
assert.doesNotMatch(source, /isEvidenceSubmission|execution_route === 'submit_work'/);
console.log('TaskDetailContext forward undo source check: ok');
