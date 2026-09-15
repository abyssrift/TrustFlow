import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const viewerState = { signedUrls: {} as Record<string, string>, previewUrls: {} as Record<string, string>, handlePress: vi.fn(), viewer: null };
const showConfirm = vi.fn();

vi.mock('react-native', () => ({ ActivityIndicator: 'ActivityIndicator', Image: 'Image', Text: 'Text', TouchableOpacity: 'TouchableOpacity', View: 'View' }));
vi.mock('@/hooks/useFileViewer', () => ({ useFileViewer: () => viewerState }));
vi.mock('@/contexts/AlertContext', () => ({ useAlert: () => ({ showConfirm }) }));
vi.mock('@/lib/uploadHelpers', () => ({ formatFileSize: (size: number) => `${size} bytes` }));
vi.mock('@/lib/storage', () => ({ openStorageFile: vi.fn() }));
vi.mock('@/components/common/FilePreview', () => ({
  FilePreviewTeaser: (props: any) => React.createElement('PreviewTeaser', props),
  getPreviewKind: (mime: string | null, name: string) => mime?.includes('pdf') || name.endsWith('.pdf') ? 'pdf' : mime?.includes('image') ? null : null,
}));
vi.mock('@/components/filehub/explorer/ExplorerDetailPane', () => ({ default: (props: any) => React.createElement('InspectorPane', props, props.capabilities?.canView ? props.renderActions?.() : null, props.children) }));

import ProjectFileInspector from './ProjectFileInspector';

const file = (id: string, mime_type = 'application/pdf') => ({ id, name: `${id}.pdf`, folder_id: 'folder', project_id: 'project', mime_type, size_bytes: 12, bucket: 'project-files', storage_path: `${id}.pdf`, current_version_id: 'current', tags: [], created_at: '2026-01-01', updated_at: '2026-01-02', activity_ids: [] });
const capabilities = (overrides: Partial<Record<string, boolean>> = {}) => ({ view: true, create: false, rename: false, move: false, delete: false, restore: true, upload: false, replace: false, version: true, ...overrides });
const renderInspector = (item = file('a'), caps = capabilities(), versions = vi.fn(async () => []), activity = vi.fn(async () => [])) => TestRenderer.create(React.createElement(ProjectFileInspector, { file: item, projectId: 'project', capabilities: caps, onRefresh: vi.fn(), projectFileVersions: versions, restoreProjectFileVersion: vi.fn(async () => {}), fileActivity: activity, logActivity: vi.fn() }));
const texts = (renderer: TestRenderer.ReactTestRenderer) => renderer.root.findAllByType('Text').map(node => String(node.props.children));

describe('ProjectFileInspector', () => {
  it('hides preview, download, versions, and restore when capabilities deny them', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = renderInspector(file('denied'), capabilities({ view: false, version: false, restore: false })); });
    expect(texts(renderer)).not.toEqual(expect.arrayContaining(['Preview', 'Download', 'versions', 'Restore']));
  });

  it('renders signed image/document previews and permitted version actions', async () => {
    viewerState.signedUrls = { image: 'signed-image' };
    viewerState.previewUrls = { doc: 'signed-document' };
    const versions = vi.fn(async () => [{ id: 'v1', version_no: 1, size_bytes: 10, created_at: '2026-01-03', is_current: false, bucket: 'project-files', storage_path: 'old.pdf', original_name: 'old.pdf', mime_type: 'application/pdf' }]);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = renderInspector(file('doc'), capabilities(), versions); });
    expect(renderer.root.findByType('PreviewTeaser').props.uri).toBe('signed-document');
    await act(async () => { renderer.root.findAllByType('TouchableOpacity').find(node => node.props.children?.props?.children === 'versions')?.props.onPress(); });
    expect(texts(renderer)).toEqual(expect.arrayContaining(['Download', 'Restore']));
    await act(async () => { renderer.root.findAllByType('TouchableOpacity').find(node => node.props.children?.props?.children === 'Restore')?.props.onPress(); });
    expect(showConfirm).toHaveBeenCalled();
    await act(async () => { renderer.update(React.createElement(ProjectFileInspector, { file: file('image', 'image/png'), projectId: 'project', capabilities: capabilities(), onRefresh: vi.fn(), projectFileVersions: versions, restoreProjectFileVersion: vi.fn(async () => {}), fileActivity: vi.fn(async () => []), logActivity: vi.fn() })); });
    expect(renderer.root.findByType('Image').props.source.uri).toBe('signed-image');
  });

  it('resets tabs and ignores stale version/activity responses after the file changes', async () => {
    let resolveVersions!: (value: any[]) => void;
    let resolveActivity!: (value: any[]) => void;
    const versions = vi.fn(() => new Promise<any[]>(resolve => { resolveVersions = resolve; }));
    const activity = vi.fn(() => new Promise<any[]>(resolve => { resolveActivity = resolve; }));
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => { renderer = renderInspector(file('a'), capabilities(), versions, activity); });
    const tab = (label: string) => renderer.root.findAllByType('TouchableOpacity').find(node => node.props.children?.props?.children === label);
    await act(async () => { tab('versions')?.props.onPress(); tab('activity')?.props.onPress(); });
    renderer.update(React.createElement(ProjectFileInspector, { file: file('b'), projectId: 'project', capabilities: capabilities(), onRefresh: vi.fn(), projectFileVersions: versions, restoreProjectFileVersion: vi.fn(async () => {}), fileActivity: activity, logActivity: vi.fn() }));
    await act(async () => { resolveVersions([{ id: 'stale-v', version_no: 9, size_bytes: 1, created_at: '2026-01-04', is_current: false }]); resolveActivity([{ id: 'stale-a', action: 'stale', created_at: '2026-01-04' }]); });
    expect(texts(renderer)).not.toEqual(expect.arrayContaining(['Version 9', 'stale']));
    expect(texts(renderer)).toEqual(expect.arrayContaining(['details']));
  });
});
