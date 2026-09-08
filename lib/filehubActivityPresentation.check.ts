import { strict as assert } from 'node:assert';
import { activityDateKey, formatActivityDetails, formatActivitySummary, getActivityPresentation, groupActivities } from './filehubActivityPresentation';

for (const action of ['upload','download','view','delete','share','rename','move','restore','share_revoke','folder_create','folder_delete']) {
  assert.notEqual(getActivityPresentation(action).icon, 'question-circle');
}
assert.equal(getActivityPresentation('future_action').label, 'Future Action');
assert.equal(activityDateKey(new Date(2026, 8, 8, 12).toISOString()), '2026-09-08');
assert.deepEqual(formatActivityDetails({ file_name: 'report.pdf', token: 'bearer abc', link_id: 'x', location: 'Vault', path: 'vault/123e4567-e89b-12d3-a456-426614174000', version_no: 2 }), [
  { label: 'File', value: 'report.pdf' }, { label: 'Location', value: 'Vault' }, { label: 'Version', value: '2' },
]);
assert.equal(formatActivitySummary('rename', { target_name: 'report.pdf', from: 'old.pdf', to: 'new.pdf' }).change, 'old.pdf → new.pdf');
assert.equal(formatActivitySummary('rename', { target_name: 'report.pdf', from: 'old.pdf', to: 'new.pdf' }).location, 'Not recorded');
assert.equal(formatActivitySummary('move', { target_name: 'report.pdf', from_location: 'Inbox', to_location: 'Archive' }).location, 'Inbox → Archive');
assert.equal(formatActivitySummary('restore', { file_name: 'report.pdf', version_no: 3 }).change, 'Restored to version 3');
assert.deepEqual(groupActivities([{ created_at: '2026-09-08T10:00:00Z' }, { created_at: '2026-09-07T10:00:00Z' }]).map(g => g.items.length), [1, 1]);
console.log('filehubActivityPresentation.check: ok');
