import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { readFileSync } from 'node:fs';
import { Text, TouchableOpacity, View } from 'react-native';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let viewportWidth = 1280;
let multiSelect = false;

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
  useWindowDimensions: () => ({ width: viewportWidth, height: 800 }),
}));
vi.mock('@expo/vector-icons', () => ({ FontAwesome: 'FontAwesome' }));
vi.mock('@/contexts/FileHubContext', () => ({ useFileHub: () => ({ searchDebounced: '' }) }));
vi.mock('@/contexts/ModalDispatchContext', () => ({ useModalDispatch: () => ({ summon: vi.fn() }) }));
vi.mock('@/hooks/useDoubleTap', () => ({ useDoubleTap: () => () => false }));
vi.mock('@/hooks/useImageLightbox', () => ({ useImageLightbox: () => ({ signedUrls: {} }) }));
vi.mock('@/hooks/useThemeColors', () => ({ useThemeColors: () => ({ primary: '#2563eb', textMuted: '#64748b' }) }));
vi.mock('@/lib/storage', () => ({ downloadFilesAsZip: vi.fn(), openStorageFile: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn().mockResolvedValue({ data: { items: [], has_more: false, facets: null }, error: null }) } }));
vi.mock('@/lib/webModifierKeys', () => ({
  isMultiSelectModifierActive: () => multiSelect,
  webModifierKeys: { shift: false },
}));
vi.mock('../common/FilterPanel', () => ({
  default: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  FilterChipGroup: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
  FilterDropdown: 'FilterDropdown',
  FilterSection: ({ children }: { children: React.ReactNode }) => <View>{children}</View>,
}));
vi.mock('../common/FilePreviewCard', () => ({ FilePreviewCard: 'FilePreviewCard' }));
vi.mock('../common/Tooltip', () => ({ default: ({ children }: { children: React.ReactNode }) => <View>{children}</View> }));
vi.mock('../filehub/explorer/ExplorerUploadAction', () => ({ default: 'ExplorerUploadAction' }));
vi.mock('./FileHubDetailPane', () => ({ default: ({ file }: { file: { file_name: string } }) => <Text testID="detail-file">{file.file_name}</Text> }));
vi.mock('./TaskFileResults', () => ({ fileIcon: () => 'file-o', formatSize: () => '1 KB' }));

vi.mock('../filehub/explorer/ExplorerCollection', () => ({
  default: ({ items, onItemPress }: { items: BrowseFixture[]; onItemPress?: (item: BrowseFixture) => void }) => (
    <View testID="browse-collection">
      {items.map((item) => (
        <TouchableOpacity key={item.file_id} testID={`browse-item-${item.file_id}`} onPress={() => onItemPress?.(item)}>
          <Text>{item.file_name}</Text>
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

import FileHubBrowse, { groupBrowseItems } from './FileHubBrowse';

describe('FileHubBrowse characterization', () => {
  beforeEach(() => {
    viewportWidth = 1280;
    multiSelect = false;
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
    const { supabase } = await import('@/lib/supabase');
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { items: [fixture('a'), fixture('b')], has_more: false, facets: null }, error: null } as never);
    viewportWidth = 390;
    let renderer!: any;
    act(() => { renderer = TestRenderer.create(<FileHubBrowse />); });
    await act(async () => {});
    multiSelect = true;
    act(() => renderer.root.findByProps({ testID: 'browse-item-a' }).props.onPress());
    multiSelect = false;
    act(() => renderer.root.findByProps({ testID: 'browse-item-b' }).props.onPress());

    expect(renderer.root.findByProps({ testID: 'detail-file' }).props.children).toBe('b.txt');
    const back = renderer.root.findByProps({ testID: 'explorer-mobile-back' });
    act(() => back.props.onPress());
    expect(renderer.root.findAllByProps({ testID: 'detail-file' })).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'browse-collection' })).toBeTruthy();
  });

  it('replaces the inspector detail without changing collection identity', async () => {
    const { supabase } = await import('@/lib/supabase');
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: { items: [fixture('a'), fixture('b')], has_more: false, facets: null }, error: null } as never);
    let renderer!: any;
    act(() => { renderer = TestRenderer.create(<FileHubBrowse />); });
    await act(async () => {});
    act(() => renderer.root.findByProps({ testID: 'browse-item-a' }).props.onPress());
    act(() => renderer.root.findByProps({ testID: 'browse-item-b' }).props.onPress());
    expect(renderer.root.findByProps({ testID: 'detail-file' }).props.children).toBe('b.txt');
    expect(renderer.root.findByProps({ testID: 'browse-collection' })).toBeTruthy();
  });

  it('keeps query filters, cursor paging, stale-response guards, and ZIP selection in Browse', () => {
    const source = readFileSync(new URL('./FileHubBrowse.tsx', import.meta.url), { encoding: 'utf8' });
    expect(source).toMatch(/p_query: searchDebounced \|\| null/);
    expect(source).toMatch(/p_project_id: projectId/);
    expect(source).toMatch(/p_before: before\?\.created_at \?\? null/);
    expect(source).toMatch(/p_before_file_id: before\?\.file_id \?\? null/);
    expect(source).toMatch(/fetchPage\(null, true\)/);
    expect(source).toMatch(/fetchPage\(pageCursor, false\)/);
    expect(source).toMatch(/setRawBrowseItems\(\(previous\) => \[\.\.\.previous, \.\.\.result\.rawItems\]\)/);
    expect(source).toMatch(/isCurrentBrowseRequest\(requestGeneration, queryGenerationRef\.current\)/);
    expect(source).toMatch(/downloadFilesAsZip/);
    expect(source).toMatch(/selectedItems/);
  });
});
