// Self-check for stage-name guessing — run: npx tsx lib/imports/statusMapper.check.ts
// No framework (ponytail): plain asserts.
import assert from 'node:assert';
import { guessStageMapping } from './statusMapper';

const canonical = [
  { id: 's-todo', name: 'To Do' },
  { id: 's-prog', name: 'In Progress' },
  { id: 's-rev', name: 'In Review' },
  { id: 's-done', name: 'Done' },
];

// Exact + case-insensitive alias hits
{
  const m = guessStageMapping(['todo', 'DOING', 'Resolved', 'peer review'], canonical);
  assert.equal(m[0].targetStageId, 's-todo');   // 'todo' alias of To Do
  assert.equal(m[1].targetStageId, 's-prog');   // 'doing' alias of In Progress
  assert.equal(m[2].targetStageId, 's-done');   // 'resolved' alias of Done
  assert.equal(m[3].targetStageId, 's-rev');    // 'peer review' alias of In Review
}

// Unknown source falls through to null (no false match)
{
  const m = guessStageMapping(['Sprint Backlog Icebox'], canonical);
  assert.equal(m[0].targetStageId, null);
}

// KNOWN LIMITATION (documents current behavior, not desired):
// aliases are keyed by the canonical TARGET name, so if a company renamed its
// board's stages, the alias table is never consulted. Here the board's stage is
// literally named "Backlog" — which is itself an alias of "To Do" — yet a Jira
// "To Do" column does NOT map to it, because STAGE_ALIASES['Backlog'] is undefined
// and the fuzzy fallback ('to do' vs 'backlog') shares no substring.
{
  const renamed = [{ id: 'x', name: 'Backlog' }];
  const m = guessStageMapping(['To Do'], renamed);
  assert.equal(m[0].targetStageId, null); // <- ideally 'x'; alias map can't help
}

console.log('statusMapper: all assertions passed');
