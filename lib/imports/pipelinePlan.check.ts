// Self-check for the per-board pipeline import plan — run: npx tsx lib/imports/pipelinePlan.check.ts
// No framework (ponytail): plain asserts.
import assert from 'node:assert';
import { buildPipelineImportPlan } from './pipelinePlan';
import type { ImportedTask } from './types';

const task = (stageName: string | null): ImportedTask => ({
  title: 't', description: '', priority: 'medium', category: null,
  assigneeEmails: [], dueDate: null, tags: [], externalId: '', externalUrl: null, stageName,
});

// No existing pipeline of that name -> plan to create one, stages in
// first-seen order, deduped.
{
  const plan = buildPipelineImportPlan('Sprint Board', [
    task('To Do'), task('Doing'), task('To Do'), task('Done'),
  ], []);
  assert.equal(plan.existingPipelineId, null);
  assert.deepEqual(plan.stageNames, ['To Do', 'Doing', 'Done']);
}

// Existing pipeline matches case-insensitively -> reuse, not create.
{
  const plan = buildPipelineImportPlan('sprint board', [task('Done')], [
    { id: 'p1', name: 'Sprint Board' },
  ]);
  assert.equal(plan.existingPipelineId, 'p1');
}

// A different pipeline name is not matched.
{
  const plan = buildPipelineImportPlan('Sprint Board', [task('Done')], [
    { id: 'p1', name: 'Other Board' },
  ]);
  assert.equal(plan.existingPipelineId, null);
}

// Null stageName (task has no source status) is dropped, not turned into a
// literal "null" stage.
{
  const plan = buildPipelineImportPlan('Board', [task(null), task('Done')], []);
  assert.deepEqual(plan.stageNames, ['Done']);
}

console.log('pipelinePlan: all assertions passed');
