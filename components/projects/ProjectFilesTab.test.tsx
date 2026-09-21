import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectFilesTabProps } from './ProjectFilesTab';

type Renderer = ReturnType<typeof TestRenderer.create>;
type TestNode = { props: Record<string, unknown> };
const reactGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true;

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
  showConfirm: vi.fn(),
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
  vi.mock('@/contexts/AlertContext', () => ({ useAlert: () => ({ showConfirm: state.showConfirm }) }));
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
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement<ProjectFilesTabProps>(ProjectFilesTab, { folderParam: 'root', fileParam: 'working' })); });
    await act(async () => { TestRenderer.create(state.shellProps.collection); });
    expect(state.shellProps.mobilePane).toBe('inspector');
    expect(state.shellProps.inspector.type).toBeTypeOf('function');
    expect(state.collectionProps.renderCard).not.toBe(state.collectionProps.renderRow);
    expect(state.blockTitles).toEqual(expect.arrayContaining(['Client standing files', 'Sealed deliverable']));
    expect(state.blockRecords.find(record => record.title === 'Client standing files').hint).toContain('Shared reference');
    expect(state.blockRecords.find(record => record.title === 'Sealed deliverable').hint).toContain('read-only');
    let card!: Renderer;
    await act(async () => { card = TestRenderer.create(state.collectionProps.renderCard(state.envelope.workspace.files[0], 'large')); });
    expect(card.root.findAllByType('Text').map((node: TestNode) => String(node.props.children))).toEqual(expect.arrayContaining(['working.pdf', 'application/pdf']));
    expect(card.root.findByType('Icon').props.name).toBe('file-o');
    expect(renderer).toBeDefined();
  });

  it('mobile back returns to collection through the shell callback', async () => {
    await act(async () => { TestRenderer.create(React.createElement<ProjectFilesTabProps>(ProjectFilesTab, { folderParam: 'root', fileParam: 'working' })); });
    await act(async () => { state.shellProps.onRequestCollection(); });
    expect(state.shellProps.mobilePane).toBe('collection');
  });

  it('omits workspace mutation controls when project capabilities deny mutations', async () => {
    const previous = state.envelope;
    state.envelope = { ...previous, workspace: { ...previous.workspace, capabilities: { view: true, create: false, rename: false, move: false, delete: false, restore: false, upload: false, replace: false, version: false } } };
    state.blockRecords.length = 0;
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(React.createElement<ProjectFilesTabProps>(ProjectFilesTab, { folderParam: 'root' })); });
    await act(async () => {});
    await act(async () => { TestRenderer.create(state.shellProps.navigation); });
    await act(async () => { TestRenderer.create(state.shellProps.collection); });
    expect(renderer).toBeDefined();
    expect(state.blockRecords.map(record => record.title)).toEqual(expect.arrayContaining(['Project workspace', 'Workspace']));
    expect(state.blockRecords.find(record => record.title === 'Project workspace').right).toBeUndefined();
    expect(state.blockRecords.find(record => record.title === 'Workspace').right).toBeUndefined();
    state.envelope = previous;
  });

  it('exposes controlled collection selection without coupling it to inspector focus', async () => {
    state.fileHub.projectFiles.mockReset().mockResolvedValue(state.envelope);
    state.collectionProps = null;
    state.envelope = {
      ...state.envelope,
      workspace: {
        ...state.envelope.workspace,
        files: [
          state.envelope.workspace.files[0],
          { ...state.envelope.workspace.files[0], id: 'second', name: 'second.pdf' },
          { ...state.envelope.workspace.files[0], id: 'third', name: 'third.pdf' },
        ],
      },
    };
    await act(async () => { TestRenderer.create(React.createElement<ProjectFilesTabProps>(ProjectFilesTab, { folderParam: 'root' })); });
    await act(async () => { TestRenderer.create(state.shellProps.collection); });
    const selection = state.collectionProps.selection;
    expect(selection).toBeDefined();
    expect(selection.selectedIds).toEqual([]);

    await act(async () => { selection.onPress(state.envelope.workspace.files[0], { ctrlKey: true, metaKey: false, shiftKey: false }); });
    await act(async () => { TestRenderer.create(state.shellProps.collection); });
    expect(state.collectionProps.selection.selectedIds).toEqual(['working']);
    expect(state.shellProps.inspector).toBeUndefined();

    await act(async () => { state.collectionProps.selection.onPress(state.envelope.workspace.files[2], { ctrlKey: false, metaKey: false, shiftKey: true }); });
    await act(async () => { TestRenderer.create(state.shellProps.collection); });
    expect(state.collectionProps.selection.selectedIds).toEqual(['working', 'second', 'third']);
    expect(state.shellProps.inspector).toBeUndefined();
  });

  it('reconciles collection and inspector selections only after a refresh envelope is known', async () => {
    const first = state.envelope;
    const next = {
      ...first,
      workspace: { ...first.workspace, files: [{ ...first.workspace.files[0], id: 'working', name: 'working-renamed.pdf' }] },
    };
    state.envelope = first;
    state.fileHub.projectFiles.mockResolvedValueOnce(first).mockResolvedValueOnce(next);
    await act(async () => { TestRenderer.create(React.createElement<ProjectFilesTabProps>(ProjectFilesTab, { folderParam: 'root', fileParam: 'working' })); });
    await act(async () => { TestRenderer.create(state.shellProps.collection); });
    const selection = state.collectionProps.selection;
    await act(async () => { selection.onPress(first.workspace.files[0], { ctrlKey: true, metaKey: false, shiftKey: false }); });
    await act(async () => { TestRenderer.create(state.shellProps.collection); });
    expect(state.collectionProps.selection.selectedIds).toEqual(['working']);
    expect(state.shellProps.inspector).toBeDefined();

    state.envelope = next;
    await act(async () => { await state.shellProps.inspector.props.onRefresh(); });
    await act(async () => { TestRenderer.create(state.shellProps.collection); });
    expect(state.collectionProps.selection.selectedIds).toEqual(['working']);
    expect(state.shellProps.inspector.props.file.name).toBe('working-renamed.pdf');

    const removed = { ...next, workspace: { ...next.workspace, files: [] } };
    state.fileHub.projectFiles.mockResolvedValueOnce(removed);
    await act(async () => { await state.shellProps.inspector.props.onRefresh(); });
    expect(state.collectionProps.selection.selectedIds).toEqual([]);
    expect(state.shellProps.inspector).toBeUndefined();
  });

  it('falls back safely for stale and foreign deep links', async () => {
    state.envelope = {
      ...state.envelope,
      workspace: { ...state.envelope.workspace, folders: [{ id: 'folder', name: 'Folder', parent_id: 'root', project_id: 'project', project_root_kind: null }] },
    };
    await act(async () => { TestRenderer.create(React.createElement<ProjectFilesTabProps>(ProjectFilesTab, { folderParam: 'missing', fileParam: 'working' })); });
    expect(state.shellProps.mobilePane).toBe('collection');
    expect(state.shellProps.inspector).toBeUndefined();

    await act(async () => { TestRenderer.create(React.createElement<ProjectFilesTabProps>(ProjectFilesTab, { folderParam: 'folder', fileParam: 'working' })); });
    expect(state.shellProps.mobilePane).toBe('collection');
    expect(state.shellProps.inspector).toBeUndefined();
  });

  it('confirms workspace-bin restore before invoking the RPC', async () => {
    state.blockRecords.length = 0;
    state.fileHub.projectFiles.mockReset().mockResolvedValue(state.envelope);
    state.showConfirm.mockReset();
    state.envelope = {
      ...state.envelope,
      workspace: { ...state.envelope.workspace, capabilities: { ...state.envelope.workspace.capabilities, restore: true } },
    };
    state.fileHub.projectWorkspaceBin.mockResolvedValue({ folders: [{ id: 'deleted-folder', name: 'Deleted', item_type: 'folder', project_id: 'project', deleted_at: 'now' }], files: [] });
    await act(async () => { TestRenderer.create(React.createElement<ProjectFilesTabProps>(ProjectFilesTab, { folderParam: 'root' })); });
    await act(async () => {});
    await act(async () => { TestRenderer.create(state.shellProps.navigation); });
    const workspaceBlock = [...state.blockRecords].reverse().find(record => record.title === 'Project workspace');
    const binAction = workspaceBlock.right.props.children.find((child: any) => child?.props?.label === 'Bin');
    await act(async () => { binAction.props.onPress(); });
    const binRecord = state.blockRecords.find(record => record.title === 'Workspace bin');
    const binRenderer = TestRenderer.create(React.cloneElement(binRecord.children));
    const restore = binRenderer.root.findAllByType('TouchableOpacity').find(node => node.props.accessibilityLabel === 'Restore');
    await act(async () => { restore.props.onPress(); });
    expect(state.showConfirm).toHaveBeenCalled();
    expect(state.fileHub.restoreProjectFolder).not.toHaveBeenCalled();
  });
});
