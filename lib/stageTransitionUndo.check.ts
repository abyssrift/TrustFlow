import assert from 'node:assert';
import { parseForwardStageUndo } from './stageTransitionUndo';

const valid = parseForwardStageUndo({
  history_id: 'history-1',
  undo_token: 'token-1',
  undoable: true,
  refusal_reasons: [],
  from_stage_id: 'stage-a',
  to_stage_id: 'stage-b',
});
assert.deepStrictEqual(valid, {
  historyId: 'history-1',
  undoToken: 'token-1',
  fromStageId: 'stage-a',
  toStageId: 'stage-b',
  refusalReasons: [],
});
assert.equal(parseForwardStageUndo({
  history_id: 'history-1', undo_token: 'token-1', undoable: false,
  from_stage_id: 'stage-a', to_stage_id: 'stage-b',
}), null);
assert.equal(parseForwardStageUndo({ undoable: true, history_id: 'h' }), null);
assert.equal(parseForwardStageUndo(null), null);
assert.equal(parseForwardStageUndo([]), null);
assert.deepStrictEqual(
  parseForwardStageUndo({
    history_id: 'h', undo_token: 't', undoable: true,
    refusal_reasons: ['reason', 4, null], from_stage_id: 'a', to_stage_id: 'b',
  })?.refusalReasons,
  ['reason'],
);
console.log('stageTransitionUndo parser check: ok');
