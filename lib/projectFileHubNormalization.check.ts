import assert from 'node:assert';
import {
  normalizeProjectFileHubEnvelope,
  projectUploadTarget,
  resolveProjectFileHubDeepLink,
} from './projectFileHubNormalization';

const envelope = normalizeProjectFileHubEnvelope({
  client_id: 'client-1',
  client_name: 'Client',
  standing_folder_id: 'standing-1',
  standing_files: [{ id: 'standing-file', name: 'standing.pdf' }],
  deliverable_folder_id: 'deliverable-1',
  deliverable_files: [{ id: 'deliverable-file', name: 'sealed.pdf' }],
  deliverable_versions: [],
  workspace: {
    root: { id: 'workspace-1', name: 'Workspace', project_id: 'project-1', project_root_kind: 'workspace', scope: 'project' },
    folders: [{ id: 'folder-1', parent_id: 'workspace-1', name: 'Source', project_id: 'project-1', scope: 'project' }],
    files: [{ id: 'file-1', name: 'source.pdf', folder_id: 'folder-1', project_id: 'project-1', current_version_id: 'version-1', activity_ids: ['activity-1'] }],
    capabilities: { view: true, create: true, rename: true, move: true, delete: true, restore: true },
  },
});

assert.equal(envelope.workspace?.root?.id, 'workspace-1');
assert.equal(envelope.workspace?.folders[0]?.project_id, 'project-1');
assert.equal(envelope.workspace?.files[0]?.current_version_id, 'version-1');
assert.equal(envelope.workspace?.capabilities.replace, true);
assert.deepEqual(projectUploadTarget('project-1', 'folder-1'), {
  kind: 'project',
  projectId: 'project-1',
  folderId: 'folder-1',
});

const deepLinkEnvelope = envelope;
assert.deepEqual(resolveProjectFileHubDeepLink(deepLinkEnvelope, 'project-1', { folder: 'folder-1', file: 'file-1' }), {
  folderId: 'folder-1',
  fileId: 'file-1',
});
assert.deepEqual(resolveProjectFileHubDeepLink(deepLinkEnvelope, 'project-1', { folder: 'workspace-1' }), {
  folderId: 'workspace-1',
  fileId: null,
});
assert.equal(resolveProjectFileHubDeepLink(deepLinkEnvelope, 'other-project', { folder: 'folder-1', file: 'file-1' }), null);
assert.equal(resolveProjectFileHubDeepLink(deepLinkEnvelope, 'project-1', { folder: 'foreign', file: 'file-1' }), null);
assert.equal(resolveProjectFileHubDeepLink(deepLinkEnvelope, 'project-1', { folder: 'workspace-1', file: 'file-1' }), null);
assert.equal(resolveProjectFileHubDeepLink(deepLinkEnvelope, 'project-1', { file: 'file-1' }), null);
assert.equal(resolveProjectFileHubDeepLink(deepLinkEnvelope, 'project-1', { folder: '../folder-1', file: 'file-1' }), null);
assert.equal(resolveProjectFileHubDeepLink({ ...deepLinkEnvelope, standing_folder_id: 'folder-1' }, 'project-1', { folder: 'folder-1' }), null);

console.log('projectFileHubNormalization: all checks passed');
