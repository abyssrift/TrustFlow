// Focused structural check for single-task archive undo registration.
// Run with: npx tsx components/task-detail/TaskHeader.check.ts
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('components/task-detail/TaskHeader.tsx', 'utf8');
const contextSource = readFileSync('contexts/TaskDetailContext.tsx', 'utf8');

assert.match(source, /import \{ useUndoAction \} from ['"]@\/contexts\/UndoActionContext['"]/);
assert.match(source, /const \{ registerUndo \} = useUndoAction\(\)/);
assert.match(source, /const \{ data: archiveResult, error \} = await supabase\.rpc\(['"]rpc_archive_task['"]/);
assert.match(source, /const archiveId = typeof archiveResult === ['"]string['"]/);
assert.match(
  source,
  /const canUndoArchive = data\.permissions\.is_owner \|\| hasPermission\(['"]archive\.restore['"]\);[\s\S]*?if \(canUndoArchive\) \{[\s\S]*?registerUndo\(\{[\s\S]*?label: ['"]Task archived\.['"]/,
  'archive undo must be limited to owners or archive.restore permission holders',
);
assert.match(source, /p_archive_id: archiveId/);
assert.match(source, /if \(restoreError\) throw restoreError/);
assert.match(source, /router\.replace\(`\/task\/\$\{taskId\}` as any\)/);
assert.match(source, /if \(!canUndoArchive\) successToast\(['"]Task archived\.['"]\)/);
assert.match(source, /const reversalHistoryId = await revertStage\(\{ showSuccessToast: false \}\)/);
assert.match(source, /if \(data && \(data\.permissions\.is_owner \|\| hasPermission\(['"]pipeline\.reverse['"]\)\)\) \{[\s\S]*?label: ['"]Task reverted to previous stage\.['"]/);
assert.match(source, /supabase\.rpc\(['"]rpc_undo_stage_reversal['"], \{[\s\S]*?p_task_id: taskId,[\s\S]*?p_reversal_history_id: reversalHistoryId/);
assert.match(source, /if \(undoError\) throw undoError/);
assert.match(source, /router\.replace\(`\/task\/\$\{taskId\}` as any\)/);
assert.match(contextSource, /revertStage: \(options\?: \{ showSuccessToast\?: boolean \}\) => Promise<string>/);
assert.match(contextSource, /const \{ data: reversalHistoryId, error \} = await supabase\.rpc\(['"]rpc_revert_stage['"]/);
assert.match(contextSource, /if \(typeof reversalHistoryId !== ['"]string['"] \|\| !reversalHistoryId\)/);
assert.match(contextSource, /if \(options\?\.showSuccessToast !== false\) successToast\(['"]Task reverted to previous stage\.['"]\)/);

console.log('TaskHeader.check: all assertions passed');
