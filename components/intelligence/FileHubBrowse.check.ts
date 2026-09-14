import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { getBrowseOriginLabel, getProjectWorkspaceLink, hasCanonicalAlias } from './filehubShared';

const source = readFileSync(new URL('./FileHubBrowse.tsx', import.meta.url) as any, 'utf8');
const detail = readFileSync(new URL('./FileHubDetailPane.tsx', import.meta.url) as any, 'utf8');

assert.equal(getBrowseOriginLabel('deliverable'), 'Deliverable');
assert.equal(getBrowseOriginLabel('shared'), 'Shared');
assert.equal(getBrowseOriginLabel('brief'), 'Brief');
assert.equal(getBrowseOriginLabel('submission'), 'Submission');
assert.equal(hasCanonicalAlias({ file_id: 'alias', canonical_file_id: 'canonical' }), true);
assert.equal(hasCanonicalAlias({ file_id: 'canonical', canonical_file_id: 'canonical' }), false);
assert.equal(getProjectWorkspaceLink({ project_id: 'p', workspace_folder_id: 'f', canonical_file_id: 'c' }), '/projects/p?tab=files&folder=f&file=c');
assert.equal(getProjectWorkspaceLink({ project_id: 'p', workspace_folder_id: null, canonical_file_id: 'c' }), null);
assert.equal(getProjectWorkspaceLink({ project_id: 'p', workspace_folder_id: 'f', canonical_file_id: 'null' }), null);

for (const token of ['FilterPanel', 'FilterDropdown', 'FilterChipGroup', 'ExplorerCollection', 'p_origins', 'canonical_file_id']) {
  assert.match(source, new RegExp(token), `Browse is missing ${token}`);
}
assert.match(detail, /Open in project workspace/);
assert.doesNotMatch(source, /deleteFile|showConfirm|Delete/);
assert.doesNotMatch(detail, /deleteFile|showConfirm|Delete/);

console.log('FileHubBrowse: all checks passed');
