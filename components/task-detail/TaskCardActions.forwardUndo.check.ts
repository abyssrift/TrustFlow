// Focused structural check for board/card forward-stage undo wiring.
// Run with: npx tsx components/task-detail/TaskCardActions.forwardUndo.check.ts
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const source = readFileSync('components/task-detail/TaskCardActions.tsx', 'utf8');

assert.match(source, /import \{ useUndoAction \} from ['"]@\/contexts\/UndoActionContext['"]/);
assert.match(source, /import \{ parseStageTransitionUndo \} from ['"]@\/lib\/stageTransitionUndo['"]/);
assert.match(source, /const \{ registerUndo \} = useUndoAction\(\)/);
assert.match(source, /const registerForwardStageUndo = \(metadata: ReturnType<typeof parseStageTransitionUndo>\)/);

const executeAction = source.slice(
  source.lastIndexOf('const { data: result, error }', source.indexOf("supabase.rpc('rpc_execute_stage_action'")),
  source.indexOf('// Fallback advance handler'),
);
const fallbackAdvance = source.slice(
  source.lastIndexOf('const { data: result, error }', source.indexOf("supabase.rpc('rpc_advance_stage'")),
  source.indexOf('// Start timer'),
);

for (const [name, route] of [['stage action', executeAction], ['fallback advance', fallbackAdvance]] as const) {
  assert.match(route, /data: result/, `${name} route must capture RPC data`);
  assert.match(route, /parseStageTransitionUndo\(result\)/, `${name} route must parse the server contract`);
  assert.match(route, /registerForwardStageUndo\(undoMetadata\)/, `${name} route must register only parsed metadata`);
}

assert.match(source, /if \(!metadata\) return false/);
assert.match(source, /metadata\.undoToken/);
assert.match(source, /p_task_id: task\.id/);
assert.match(source, /p_undo_token: metadata\.undoToken/);
assert.match(source, /if \(error\) throw error/);
assert.match(source, /onMoved\?\.\(task\.id, metadata\.fromStageId\)/);
assert.match(source, /onRefresh\(\)/);

assert.doesNotMatch(source, /action\.action_type\s*===?[\s\S]*registerForwardStageUndo/);
assert.doesNotMatch(source, /action\.action_type\s*\.includes\([\s\S]*registerForwardStageUndo/);

console.log('TaskCardActions.forwardUndo.check: all assertions passed');
