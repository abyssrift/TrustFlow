import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const state = vi.hoisted(() => ({
  width: 390,
  envelope: {
    standing_files: [{ id: 'client', name: 'client.pdf', mime_type: 'application/pdf', size_bytes: 10 }],
    deliverable_files: [{ id: 'sealed', name: 'sealed.pdf', mime_type: 'application/pdf', size_bytes: 20 }],
    deliverable_versions: [{ id: 'sealed-v1', version_no: 1 }],
    workspace: {
      root: { id: 'root', name: 'Workspace', parent_id: null, scope: 'project', project_id: 'project', project_root_kind: 'workspace', deleted_at: null, version_ids: [], activity_ids: [] },
      folders: [],
      files: [{ id: 'working', name: 'working.pdf', folder_id: 'root', project_id: 'project', mime_type: 'application/pdf', size_bytes: 30, bucket: 'project-files', storage_path: 'working.pdf', current_version_id: 'v1', tags: [], created_at: '2026-01-01', updated_at: '2026-01-02', activity_ids: [] }],
      capabilities: { view: true, create: true, rename: true, move: true, delete: true, restore: true, upload: true, replace: true, version: true },
    },
  },
  shellProps: null as any,
  collectionProps: null as any,
  blockTitles: [] as string[],
  blockRecords: [] as any[],
  fileHub: null as any,
}));
state.fileHub = {
  projectFiles: vi.fn(async () => state.envelope), projectWorkspaceBin: vi.fn(async () => ({ folders: [], files: [] })), ensureProjectWorkspace: vi.fn(async () => {}),
  createProjectFolder: vi.fn(async () => {}), renameProjectFolder: vi.fn(async () => {}), moveProjectFolder: vi.fn(async () => {}), deleteProjectFolder: vi.fn(async () => {}), moveProjectFile: vi.fn(async () => {}), deleteProjectFile: vi.fn(async () => {}), restoreProjectFolder: vi.fn(async () => {}), restoreProjectFile: vi.fn(async () => {}), projectFileVersions: vi.fn(async () => []), restoreProjectFileVersion: vi.fn(async () => {}), fileActivity: vi.fn(async () => []), logActivity: vi.fn(),
};

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Image: 'Image', ScrollView: 'ScrollView', Text: 'Text', TextInput: 'TextInput', TouchableOpacity: 'TouchableOpacity', View: 'View',
  useWindowDimensions: () => ({ width: state.width, height: 800 }),
}));
vi.mock('@/contexts/ProjectDetailContext', () => ({ useProjectDetail: () => ({ projectId: 'project' }) }));
vi.mock('@/contexts/FileHubContext', () => ({ useFileHub: () => state.fileHub }));
vi.mock('@/contexts/ModalDispatchContext', () => ({ useModalDispatch: () => ({ summon: vi.fn() }) }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ errorToast: vi.fn(), successToast: vi.fn() }) }));
vi.mock('@/contexts/AlertContext', () => ({ useAlert: () => ({ showConfirm: vi.fn() }) }));
vi.mock('@/contexts/UploadManagerContext', () => ({ useUploadManager: () => ({ lastCompletedAt: 0 }) }));
vi.mock('@/hooks/useThemeColors', () => ({ useThemeColors: () => ({ textMuted: '#888' }) }));
vi.mock('@/lib/uploadHelpers', () => ({ formatFileSize: (size: number) => `${size} bytes` }));
vi.mock('@/lib/storage', () => ({ openStorageFile: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'signed' } }) }) } } }));
vi.mock('@/components/common/FilePreview', () => ({ FilePreviewModal: 'FilePreviewModal', getPreviewKind: () => 'pdf' }));
vi.mock('@/components/filehub/explorer/ExplorerInspectorShell', () => ({ default: function Shell(props: any) { state.shellProps = props; return null; } }));
vi.mock('@/components/filehub/explorer/ExplorerCollection', () => ({ default: function Collection(props: any) { state.collectionProps = props; return null; } }));
vi.mock('@/components/projects/ProjectFileInspector', () => ({ default: function Inspector(props: any) { return React.createElement('ProjectInspector', props); } }));
vi.mock('@/components/common/Block', () => ({ default: function Block(props: any) { state.blockTitles.push(props.title); state.blockRecords.push(props); return props.children || null; } }));
vi.mock('@/components/common/Popup', () => ({ default: () => null }));
vi.mock('@/components/filehub/explorer/ExplorerBreadcrumbs', () => ({ default: () => null }));
vi.mock('@/components/filehub/explorer/ExplorerUploadAction', () => ({ default: () => null }));
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: (props: any) => React.createElement('Icon', props) }));

import ProjectFilesTab from './ProjectFilesTab';

describe('ProjectFilesTab', () => {
  it('renders the portable shell with separate working, client, and sealed domains', async () => {
    state.shellProps = null;
    state.collectionProps = null;
    state.blockTitles.length = 0;
    state.blockRecords.length = 0;
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProjectFilesTab, { folderParam: 'root', fileParam: 'working' })); });
    await act(async () => { TestRenderer.create(state.shellProps.collection); });
    expect(state.shellProps.mobilePane).toBe('inspector');
    expect(state.shellProps.inspector.type).toBeTypeOf('function');
    expect(state.collectionProps.renderCard).not.toBe(state.collectionProps.renderRow);
    expect(state.blockTitles).toEqual(expect.arrayContaining(['Client standing files', 'Sealed deliverable']));
    expect(state.blockRecords.find(record => record.title === 'Client standing files').hint).toContain('Shared reference');
    expect(state.blockRecords.find(record => record.title === 'Sealed deliverable').hint).toContain('read-only');
    let card!: TestRenderer.ReactTestRenderer;
    await act(async () => { card = TestRenderer.create(state.collectionProps.renderCard(state.envelope.workspace.files[0], 'large')); });
    expect(card.root.findAllByType('Text').map(node => String(node.props.children))).toEqual(expect.arrayContaining(['working.pdf', 'application/pdf']));
    expect(card.root.findByType('Icon').props.name).toBe('file-o');
    expect(renderer).toBeDefined();
  });

  it('mobile back returns to collection through the shell callback', async () => {
    await act(async () => { TestRenderer.create(React.createElement(ProjectFilesTab, { folderParam: 'root', fileParam: 'working' })); });
    await act(async () => { state.shellProps.onRequestCollection(); });
    expect(state.shellProps.mobilePane).toBe('collection');
  });

  it('omits workspace mutation controls when project capabilities deny mutations', async () => {
    const previous = state.envelope;
    state.envelope = { ...previous, workspace: { ...previous.workspace, capabilities: { view: true, create: false, rename: false, move: false, delete: false, restore: false, upload: false, replace: false, version: false } } };
    state.blockRecords.length = 0;
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement(ProjectFilesTab, { folderParam: 'root' })); });
    await act(async () => {});
    await act(async () => { TestRenderer.create(state.shellProps.navigation); });
    await act(async () => { TestRenderer.create(state.shellProps.collection); });
    expect(renderer).toBeDefined();
    expect(state.blockRecords.map(record => record.title)).toEqual(expect.arrayContaining(['Project workspace', 'Workspace']));
    expect(state.blockRecords.find(record => record.title === 'Project workspace').right).toBeUndefined();
    expect(state.blockRecords.find(record => record.title === 'Workspace').right).toBeUndefined();
    state.envelope = previous;
  });
});
