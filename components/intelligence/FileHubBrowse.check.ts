import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { canonicalIdentityKey, getBrowseOriginLabel, getProjectWorkspaceLink, hasCanonicalAlias } from './filehubShared';

const source = readFileSync(new URL('./FileHubBrowse.tsx', import.meta.url) as any, 'utf8');
const detail = readFileSync(new URL('./FileHubDetailPane.tsx', import.meta.url) as any, 'utf8');

assert.equal(getBrowseOriginLabel('deliverable'), 'Deliverable');
assert.equal(getBrowseOriginLabel('shared'), 'Shared');
assert.equal(getBrowseOriginLabel('brief'), 'Brief');
assert.equal(getBrowseOriginLabel('submission'), 'Submission');
assert.equal(hasCanonicalAlias({ file_id: 'alias', canonical_file_id: 'canonical' }), true);
assert.equal(hasCanonicalAlias({ file_id: 'canonical', canonical_file_id: 'canonical' }), false);
const project = '11111111-1111-4111-8111-111111111111';
const folder = '22222222-2222-4222-8222-222222222222';
const file = '33333333-3333-4333-8333-333333333333';
assert.equal(getProjectWorkspaceLink({ project_id: project, workspace_folder_id: folder, canonical_file_id: file }), `/projects/${project}?tab=files&folder=${folder}&file=${file}`);
assert.equal(getProjectWorkspaceLink({ project_id: 'p', workspace_folder_id: folder, canonical_file_id: file }), null);
assert.equal(getProjectWorkspaceLink({ project_id: project, workspace_folder_id: '../folder', canonical_file_id: file }), null);
assert.equal(getProjectWorkspaceLink({ project_id: project, workspace_folder_id: folder, canonical_file_id: 'null' }), null);
assert.equal(getProjectWorkspaceLink({ project_id: project, workspace_folder_id: folder, canonical_file_id: `${file}%2Fother` }), null);
assert.equal(canonicalIdentityKey({ file_id: 'alias', canonical_file_id: file, canonical_version_id: folder, bucket: 'files', storage_path: 'a/b' }), `${file}:${folder}:files:a/b`);

for (const token of ['FilterPanel', 'FilterDropdown', 'FilterChipGroup', 'ExplorerCollection', 'p_origins', 'canonical_file_id', 'canonicalIdentityKey', 'groupBrowseItems', 'min-w-\\[220px\\]']) {
  assert.match(source, new RegExp(token), `Browse is missing ${token}`);
}
assert.match(detail, /Open in project workspace/);
assert.doesNotMatch(source, /deleteFile|hideFile|showConfirm|Delete/);
assert.doesNotMatch(detail, /deleteFile|showConfirm|Delete/);
assert.doesNotMatch(detail, /onNavigate=\{\(.*\) => \{\}\}/);

console.log('FileHubBrowse: all checks passed');
