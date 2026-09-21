// Self-check for the catalog-backed starter adapter.
import assert from 'node:assert';
import { starterTemplatesFromCatalogPayload } from './starterTemplates';

const payload = {
  schema_version: 1,
  id: 'check-starter',
  sector: 'Checks',
  name: 'Catalog starter',
  description: 'A catalog-owned starter used to verify normalization.',
  color: '#6366F1',
  tasks: [
    { title: 'Plan', description: 'Plan the work.', category: 'Planning', priority: 'high', weight: 3, estimated_hours: 2, due_offset_days: 0 },
    { title: 'Deliver', description: 'Deliver the work.', category: 'Delivery', priority: 'medium', weight: 5, estimated_hours: 4, due_offset_days: 3 },
    { title: 'Review', description: 'Review the work.', category: 'Review', priority: 'medium', weight: 4, estimated_hours: 2, due_offset_days: 4 },
    { title: 'Close', description: 'Close the work.', category: 'Close', priority: 'low', weight: 2, estimated_hours: 1, due_offset_days: 5 },
  ],
};

const [template] = starterTemplatesFromCatalogPayload(payload, 'project_template.check-starter', 1);
assert.ok(template, 'catalog payload should produce a starter');
assert.equal(template.catalogKey, 'project_template.check-starter');
assert.equal(template.catalogVersion, 1);
assert.equal(template.tasks.length, 4);
assert.ok(template.tasks.every(task => !('pipeline_id' in task) && !('assignee_team_id' in task)));
assert.ok(template.tasks.every(task => Number.isInteger(task.weight) && task.weight >= 1 && task.weight <= 10));
assert.ok(template.tasks.every(task => ['urgent', 'high', 'medium', 'low'].includes(task.priority)));
assert.deepEqual(template.tasks.map(task => task.due_offset_days), [0, 3, 4, 5]);

console.log('starterTemplates: catalog adapter checks passed');
