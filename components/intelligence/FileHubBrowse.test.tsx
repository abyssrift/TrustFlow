import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text, TouchableOpacity, View } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let viewportWidth = 1280;
const browseTestState = vi.hoisted(() => ({ searchDebounced: '', multiSelect: false }));
const rpcMock = vi.hoisted(() => vi.fn());
const isMultiSelectMock = vi.hoisted(() => vi.fn(() => browseTestState.multiSelect));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
  useWindowDimensions: () => ({ width: viewportWidth, height: 800 }),
}));
vi.mock('@expo/vector-icons', () => ({ FontAwesome: 'FontAwesome' }));
vi.mock('@/contexts/FileHubContext', () => ({ useFileHub: () => ({ searchDebounced: browseTestState.searchDebounced }) }));
vi.mock('@/contexts/ModalDispatchContext', () => ({ useModalDispatch: () => ({ summon: vi.fn() }) }));
vi.mock('@/hooks/useDoubleTap', () => ({ useDoubleTap: () => () => false }));
vi.mock('@/hooks/useImageLightbox', () => ({ useImageLightbox: () => ({ signedUrls: {} }) }));
vi.mock('@/hooks/useThemeColors', () => ({ useThemeColors: () => ({ primary: '#2563eb', textMuted: '#64748b' }) }));
vi.mock('@/lib/storage', () => ({ downloadFilesAsZip: vi.fn(), openStorageFile: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: rpcMock } }));
vi.mock('@/lib/webModifierKeys', () => ({
  isMultiSelectModifierActive: isMultiSelectMock,
  webModifierKeys: { shift: false },
}));
vi.mock('../common/FilterPanel', () => ({
  default: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  FilterChipGroup: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  FilterDropdown: ({ label, onToggle }: { label: string; onToggle: (value: string) => void }) => (
    <TouchableOpacity testID={`filter-${label}`} onPress={() => onToggle('project-1')}><Text>{label}</Text></TouchableOpacity>
  ),
  FilterSection: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
}));
vi.mock('../common/FilePreviewCard', () => ({ FilePreviewCard: 'FilePreviewCard' }));
vi.mock('../common/Tooltip', () => ({ default: ({ children }: { children: React.ReactNode }) => <View>{children}</View> }));
vi.mock('../filehub/explorer/ExplorerUploadAction', () => ({ default: 'ExplorerUploadAction' }));
vi.mock('./FileHubDetailPane', () => ({ default: ({ file }: { file: { file_name: string } }) => <Text testID="detail-file">{file.file_name}</Text> }));
vi.mock('./TaskFileResults', () => ({ fileIcon: () => 'file-o', formatSize: () => '1 KB' }));

vi.mock('../filehub/explorer/ExplorerCollection', () => ({
  default: ({ items, onItemPress, renderRow }: { items: BrowseFixture[]; onItemPress?: (item: BrowseFixture) => void; renderRow?: (item: BrowseFixture) => React.ReactNode }) => (
    <View testID="browse-collection">
      {items.map((item) => (
        <TouchableOpacity key={item.file_id} testID={`browse-item-${item.file_id}`} onPress={() => onItemPress?.(item)}>
          {renderRow ? renderRow(item) : <Text>{item.file_name}</Text>}
        </TouchableOpacity>
      ))}
    </View>
  ),
}));

type BrowseFixture = {
  source: 'filehub';
  file_id: string;
  canonical_file_id: string | null;
  canonical_version_id: string | null;
  folder_id: string | null;
  workspace_folder_id: string | null;
  workspace_path: string | null;
  origin: 'workspace';
  bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  task_id: string | null;
  task_title: string | null;
  project_id: string | null;
  project_name: string | null;
  task_category: string | null;
  submission_id: string | null;
};

const fixture = (file_id: string, file_name = `${file_id}.txt`): BrowseFixture => ({
  source: 'filehub', file_id, canonical_file_id: null, canonical_version_id: null,
  folder_id: null, workspace_folder_id: null, workspace_path: null, origin: 'workspace',
  bucket: 'files', storage_path: file_id, file_name, mime_type: 'text/plain', size_bytes: 1,
  created_at: '2026-09-14T03:00:00Z', task_id: null, task_title: null, project_id: null,
  project_name: null, task_category: null, submission_id: null,
});

const textLabels = (renderer: any) => renderer.root.findAllByType('Text').map((node: any) => Array.isArray(node.props.children) ? node.props.children.join('') : node.props.children);

import FileHubBrowse, { groupBrowseItems } from './FileHubBrowse';

describe('FileHubBrowse characterization', () => {
  beforeEach(() => {
    viewportWidth = 1280;
    browseTestState.multiSelect = false;
    browseTestState.searchDebounced = '';
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: { items: [], has_more: false, facets: null }, error: null });
    isMultiSelectMock.mockReset();
    isMultiSelectMock.mockImplementation(() => browseTestState.multiSelect);
  });

  it('groups aliases while keeping canonical versions distinct and renders mixed collection items', () => {
    const first = fixture('first');
    const alias = { ...first, file_id: 'alias', canonical_file_id: 'canonical', canonical_version_id: 'v1' };
    const version = { ...first, file_id: 'version', canonical_file_id: 'canonical', canonical_version_id: 'v2' };
    expect(groupBrowseItems([
      { ...alias, canonical_file_id: 'canonical' },
      { ...first, file_id: 'canonical', canonical_file_id: 'canonical', canonical_version_id: 'v1' },
      version,
    ])).toHaveLength(2);
  });

  it('keeps bulk selection independent when mobile inspector focus changes', async () => {
    rpcMock.mockResolvedValueOnce({ data: { items: [fixture('a'), fixture('b'), { ...fixture('folder'), file_name: 'Folder', folder_id: 'folder-1', mime_type: null }], has_more: false, facets: null }, error: null });
    viewportWidth = 390;
    isMultiSelectMock.mockReturnValue(true);
    let renderer!: any;
    act(() => { renderer = TestRenderer.create(<FileHubBrowse />); });
    await act(async () => {});
    await act(async () => { renderer.root.findByProps({ testID: 'browse-item-a' }).props.onPress(); });
    expect(textLabels(renderer)).toContain('1 selected');
    expect(renderer.root.findByProps({ children: 'Download ZIP' })).toBeTruthy();
    isMultiSelectMock.mockReturnValue(false);
    await act(async () => { renderer.root.findByProps({ testID: 'browse-item-b' }).props.onPress(); });

    expect(renderer.root.findByProps({ testID: 'detail-file' }).props.children).toBe('b.txt');
    const back = renderer.root.findByProps({ testID: 'explorer-mobile-back' });
    act(() => back.props.onPress());
    expect(renderer.root.findAllByProps({ testID: 'detail-file' })).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'browse-collection' })).toBeTruthy();
    expect(textLabels(renderer)).toContain('1 selected');
    expect(renderer.root.findByProps({ children: 'Download ZIP' })).toBeTruthy();
    expect(textLabels(renderer)).toContain('Folder');
  });

  it('replaces the inspector detail without changing collection identity', async () => {
    rpcMock.mockResolvedValueOnce({ data: { items: [fixture('a'), fixture('b')], has_more: false, facets: null }, error: null });
    let renderer!: any;
    act(() => { renderer = TestRenderer.create(<FileHubBrowse />); });
    await act(async () => {});
    act(() => renderer.root.findByProps({ testID: 'browse-item-a' }).props.onPress());
    act(() => renderer.root.findByProps({ testID: 'browse-item-b' }).props.onPress());
    expect(renderer.root.findByProps({ testID: 'detail-file' }).props.children).toBe('b.txt');
    expect(renderer.root.findByProps({ testID: 'browse-collection' })).toBeTruthy();
  });

  it('renders the mixed collection through the ExplorerCollection adapter', async () => {
    rpcMock.mockResolvedValueOnce({ data: { items: [fixture('file'), { ...fixture('folder'), file_name: 'Folder', folder_id: 'folder-1', mime_type: null }], has_more: false, facets: null }, error: null });
    let renderer!: any;
    act(() => { renderer = TestRenderer.create(<FileHubBrowse />); });
    await act(async () => {});
    const labels = textLabels(renderer);
    expect(labels).toContain('file.txt');
    expect(labels).toContain('Folder');
  });

  it('sends filter and cursor state to RPC and appends the next page', async () => {
    let resolvePage!: (value: unknown) => void;
    rpcMock.mockImplementation((_name: string, args: { p_before: string | null; p_project_id: string | null }) => {
      if (args.p_before) return new Promise((resolve) => { resolvePage = resolve; });
      const items = args.p_project_id ? [fixture('filtered')] : [fixture('first')];
      return Promise.resolve({ data: { items, has_more: true, facets: null }, error: null });
    });
    let renderer!: any;
    act(() => { renderer = TestRenderer.create(<FileHubBrowse />); });
    await act(async () => {});
    expect(rpcMock).toHaveBeenCalledWith('rpc_filehub_browse', expect.objectContaining({ p_query: null, p_before: null, p_before_file_id: null, p_project_id: null }));
    act(() => renderer.root.findByProps({ testID: 'filter-Project' }).props.onPress());
    await act(async () => {});
    expect(rpcMock).toHaveBeenLastCalledWith('rpc_filehub_browse', expect.objectContaining({ p_project_id: 'project-1' }));
    const loadMore = renderer.root.findByProps({ children: 'Load more' }).parent;
    const loadPromise = loadMore.props.onPress() as Promise<void>;
    expect(rpcMock).toHaveBeenLastCalledWith('rpc_filehub_browse', expect.objectContaining({ p_before: fixture('filtered').created_at, p_before_file_id: 'filtered' }));
    resolvePage({ data: { items: [fixture('second')], has_more: false, facets: null }, error: null });
    await act(async () => { await loadPromise; });
    const labels = textLabels(renderer);
    expect(labels).toContain('filtered.txt');
    expect(labels).toContain('second.txt');
  });

  it('ignores a stale search response after a newer request starts', async () => {
    const pending = new Map<string, Array<(value: unknown) => void>>();
    rpcMock.mockImplementation((_name: string, args: { p_query: string | null }) => new Promise((resolve) => {
      const key = args.p_query || 'old';
      pending.set(key, [...(pending.get(key) || []), resolve]);
    }));
    let renderer!: any;
    act(() => { renderer = TestRenderer.create(<FileHubBrowse />); });
    await act(async () => {});
    browseTestState.searchDebounced = 'new search';
    await act(async () => { renderer.update(<FileHubBrowse key="search-change" />); });
    expect(pending.get('new search')).toHaveLength(1);
    expect(rpcMock).toHaveBeenLastCalledWith('rpc_filehub_browse', expect.objectContaining({ p_query: 'new search', p_before: null }));
    for (const resolve of pending.get('old') || []) resolve({ data: { items: [fixture('stale')], has_more: false, facets: null }, error: null });
    await act(async () => {});
    for (const resolve of pending.get('new search') || []) resolve({ data: { items: [fixture('current')], has_more: false, facets: null }, error: null });
    await act(async () => {});
    const labels = textLabels(renderer);
    expect(labels).toContain('current.txt');
    expect(labels).not.toContain('stale.txt');
  });
});
