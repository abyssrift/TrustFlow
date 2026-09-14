import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { canonicalIdentityKey, getBrowseOriginLabel, getBrowsePageCursor, getProjectWorkspaceLink, groupByCanonicalIdentity, hasCanonicalAlias, isCurrentBrowseRequest } from './filehubShared';

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
assert.equal(canonicalIdentityKey({ file_id: 'alias', canonical_file_id: file, canonical_version_id: folder, bucket: 'files', storage_path: 'a/b' }), `${file}:${folder}`);
assert.equal(canonicalIdentityKey({ file_id: 'fallback', bucket: 'files', storage_path: 'a/b' }), 'fallback:files:a/b');
assert.deepEqual(getBrowsePageCursor([{ created_at: '2026-09-14T03:00:00Z', file_id: 'first' }, { created_at: '2026-09-14T02:00:00Z', file_id: 'last' }], null), { created_at: '2026-09-14T02:00:00Z', file_id: 'last' });
assert.deepEqual(getBrowsePageCursor([], { created_at: '2026-09-14T02:00:00Z', file_id: 'last' }), { created_at: '2026-09-14T02:00:00Z', file_id: 'last' });
assert.equal(isCurrentBrowseRequest(3, 3), true);
assert.equal(isCurrentBrowseRequest(2, 3), false);
const aliasRows = [
  { file_id: 'alias-a', canonical_file_id: file, canonical_version_id: folder, bucket: 'files', storage_path: 'a/b' },
  { file_id: 'alias-b', canonical_file_id: file, canonical_version_id: folder, bucket: 'other-bucket', storage_path: 'different/path' },
  { file_id: 'version-2', canonical_file_id: file, canonical_version_id: '44444444-4444-4444-8444-444444444444', bucket: 'files', storage_path: 'a/b' },
];
assert.equal(groupByCanonicalIdentity(aliasRows).length, 2, 'aliases group while distinct canonical versions remain separate');
assert.equal(groupByCanonicalIdentity(aliasRows)[0].length, 2);

for (const token of ['FilterPanel', 'FilterDropdown', 'FilterChipGroup', 'ExplorerCollection', 'p_origins', 'p_before_file_id', 'canonical_file_id', 'canonicalIdentityKey', 'groupBrowseItems', 'getBrowsePageCursor', 'pageCursor', 'min-w-\\[220px\\]', 'min-h-11', 'h-11 w-11']) {
  assert.match(source, new RegExp(token), `Browse is missing ${token}`);
}
assert.match(source, /getBrowsePageCursor\(rawItems, before\)/);
assert.match(source, /p_before: before\?\.created_at \?\? null/);
assert.match(source, /p_before_file_id: before\?\.file_id \?\? null/);
assert.match(source, /fetchPage\(null, true\)/);
assert.match(source, /fetchPage\(pageCursor, false\)/);
assert.match(source, /rawBrowseItems/);
assert.match(source, /setRawBrowseItems\(previous => \[\.\.\.previous, \.\.\.result\.rawItems\]\)/);
assert.match(source, /useMemo\(\(\) => groupBrowseItems\(rawBrowseItems\)/);
assert.match(source, /const renderCard = \(item: BrowseItem, _density: 'large' \| 'medium'\) => <View pointerEvents="none">/);
assert.match(source, /queryGenerationRef/);
assert.match(source, /isCurrentBrowseRequest\(requestGeneration, queryGenerationRef\.current\)/);
assert.match(source, /setLoadingMore\(false\)/);
assert.match(detail, /Open in project workspace/);
assert.doesNotMatch(source, /deleteFile|hideFile|showConfirm|Delete/);
assert.doesNotMatch(detail, /deleteFile|showConfirm|Delete/);
assert.doesNotMatch(detail, /onNavigate=\{\(.*\) => \{\}\}/);

console.log('FileHubBrowse: all checks passed');
