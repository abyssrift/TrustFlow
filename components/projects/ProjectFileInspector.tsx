import ExplorerDetailPane from '@/components/filehub/explorer/ExplorerDetailPane';
import { FilePreviewTeaser, getPreviewKind } from '@/components/common/FilePreview';
import { useFileViewer, type ViewerMedia } from '@/hooks/useFileViewer';
import { formatFileSize } from '@/lib/uploadHelpers';
import { openStorageFile } from '@/lib/storage';
import type { ProjectFileHubFile } from '@/lib/projectFileHubNormalization';
import type { ProjectFileHubCapabilities } from '@/lib/projectFileHubNormalization';
import { useAlert } from '@/contexts/AlertContext';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native';

type ProjectVersion = { id: string; version_no: number; size_bytes: number; created_at: string; is_current: boolean; storage_path?: string; bucket?: string; original_name?: string; mime_type?: string | null };
type ProjectActivity = { id: string; action: string; created_at: string; user?: { full_name?: string | null } | null };

export type ProjectFileInspectorProps = {
  file: ProjectFileHubFile;
  projectId: string;
  capabilities: ProjectFileHubCapabilities;
  onRefresh: () => void;
  onClose?: () => void;
  projectFileVersions: (projectId: string, fileId: string) => Promise<ProjectVersion[]>;
  restoreProjectFileVersion: (projectId: string, versionId: string) => Promise<void>;
  fileActivity: (fileId: string) => Promise<ProjectActivity[]>;
  logActivity: (fileId: string, action: string, metadata?: Record<string, any> | null) => void;
};

export default function ProjectFileInspector({ file, projectId, capabilities, onRefresh, onClose, projectFileVersions, restoreProjectFileVersion, fileActivity, logActivity }: ProjectFileInspectorProps) {
  const { showConfirm } = useAlert();
  const [tab, setTab] = useState<'details' | 'versions' | 'activity'>('details');
  const [versions, setVersions] = useState<ProjectVersion[] | null>(null);
  const [activity, setActivity] = useState<ProjectActivity[] | null>(null);
  const requestIdRef = useRef(0);
  const kind = getPreviewKind(file.mime_type, file.name);
  const media = useMemo<ViewerMedia[]>(() => [{ id: file.id, name: file.name, storagePath: file.storage_path, mimeType: file.mime_type, bucket: file.bucket, sizeBytes: file.size_bytes }], [file]);
  const { handlePress, viewer, previewUrls, signedUrls } = useFileViewer(media, file.bucket, { onOpen: () => logActivity(file.id, 'view') });
  const previewUrl = previewUrls[file.id] || (file.storage_path.startsWith('http') ? file.storage_path : null);
  const imageUrl = signedUrls[file.id] || null;
  useEffect(() => {
    requestIdRef.current += 1;
    setTab('details');
    setVersions(null);
    setActivity(null);
  }, [file.id]);
  const open = () => handlePress(media[0]);
  const loadVersions = () => {
    setTab('versions');
    if (!capabilities.version || versions !== null) return;
    const requestId = requestIdRef.current;
    const fileId = file.id;
    void projectFileVersions(projectId, fileId).then(value => { if (requestId === requestIdRef.current && fileId === file.id) setVersions(value); }).catch(() => { if (requestId === requestIdRef.current && fileId === file.id) setVersions([]); });
  };
  const loadActivity = () => {
    setTab('activity');
    if (!capabilities.view || activity !== null) return;
    const requestId = requestIdRef.current;
    const fileId = file.id;
    void fileActivity(fileId).then(value => { if (requestId === requestIdRef.current && fileId === file.id) setActivity(value); }).catch(() => { if (requestId === requestIdRef.current && fileId === file.id) setActivity([]); });
  };
  const restore = (version: ProjectVersion) => showConfirm('Restore version?', `Restore ${file.name} to version ${version.version_no}?`, async () => { if (!capabilities.restore) return; await restoreProjectFileVersion(projectId, version.id); setVersions(null); onRefresh(); });
  return <>
    <ExplorerDetailPane
      item={{ id: file.id, name: file.name, mimeType: file.mime_type, sizeBytes: file.size_bytes, path: file.storage_path, createdAt: file.created_at, updatedAt: file.updated_at }}
      capabilities={{ canView: capabilities.view, canCreate: capabilities.create, canRename: capabilities.rename, canMove: capabilities.move, canDelete: capabilities.delete, canRestore: capabilities.restore, canUpload: capabilities.upload, canReplace: capabilities.replace, canVersion: capabilities.version }}
      onClose={onClose}
      renderHeader={() => <View className="flex-1 min-w-0"><Text className="text-typography-main text-base font-black" numberOfLines={2}>{file.name}</Text><Text className="mt-1 text-typography-muted text-xs">{formatFileSize(file.size_bytes)} · {file.mime_type || 'File'}</Text></View>}
      renderActions={() => capabilities.view ? <><TouchableOpacity onPress={open} className="min-h-11 min-w-11 flex-row items-center gap-2 rounded-xl border border-surface-border px-3"><Text className="text-typography-main text-xs font-bold">Preview</Text></TouchableOpacity><TouchableOpacity onPress={() => { logActivity(file.id, 'download'); openStorageFile(file.bucket, file.storage_path, file.name, file.mime_type); }} className="min-h-11 min-w-11 flex-row items-center gap-2 rounded-xl border border-surface-border px-3"><Text className="text-typography-main text-xs font-bold">Download</Text></TouchableOpacity></> : null}
    >
      {capabilities.view && imageUrl ? <TouchableOpacity onPress={open} className="h-48 items-center justify-center overflow-hidden rounded-xl bg-surface-background"><Image source={{ uri: imageUrl }} resizeMode="contain" className="h-full w-full" /></TouchableOpacity> : capabilities.view && kind && previewUrl ? <FilePreviewTeaser uri={previewUrl} kind={kind} height={180} onPress={open} sizeBytes={file.size_bytes} /> : capabilities.view && kind ? <View className="min-h-[96px] items-center justify-center rounded-xl border border-surface-border"><ActivityIndicator /><Text className="mt-2 text-typography-muted text-xs">Preparing preview…</Text></View> : null}
      <View className="gap-3">
        <View className="flex-row gap-2">{(['details', 'versions', 'activity'] as const).map(value => (value === 'versions' && !capabilities.version) || (value === 'activity' && !capabilities.view) ? null : <TouchableOpacity key={value} accessibilityRole="tab" onPress={value === 'versions' ? loadVersions : value === 'activity' ? loadActivity : () => setTab('details')} className={`min-h-11 min-w-11 flex-1 justify-center rounded-xl border ${tab === value ? 'bg-brand-primary/10 border-brand-primary/30' : 'border-surface-border'}`}><Text className="text-center text-typography-main text-xs font-bold">{value}</Text></TouchableOpacity>)}</View>
        {tab === 'details' && <View className="gap-3"><Detail label="MIME type" value={file.mime_type || 'Unknown'} /><Detail label="Size" value={formatFileSize(file.size_bytes)} /><Detail label="Added" value={file.created_at} /><Detail label="Updated" value={file.updated_at || file.created_at} /><Detail label="Project" value={projectId} /><Detail label="Path" value={file.storage_path} /><Detail label="Origin" value="Working project file" /><Detail label="Current version" value={file.current_version_id || 'Unavailable'} /></View>}
        {tab === 'versions' && (versions === null ? <ActivityIndicator /> : versions.length === 0 ? <Text className="text-typography-muted text-sm">No version history.</Text> : <View className="gap-2">{versions.map(version => <View key={version.id} className="flex-row items-center gap-3 rounded-xl border border-surface-border p-3"><View className="flex-1"><Text className="text-typography-main text-xs font-bold">Version {version.version_no}{version.is_current ? ' · Current' : ''}</Text><Text className="mt-1 text-typography-muted text-[11px]">{new Date(version.created_at).toLocaleDateString()} · {formatFileSize(version.size_bytes)}</Text></View>{capabilities.view && version.bucket && version.storage_path && <TouchableOpacity onPress={() => { logActivity(file.id, 'download', { version_no: version.version_no }); openStorageFile(version.bucket!, version.storage_path!, version.original_name || file.name, version.mime_type || file.mime_type); }} className="min-h-11 min-w-11 items-center justify-center rounded-xl border border-surface-border"><Text className="text-typography-main text-xs font-bold">Download</Text></TouchableOpacity>}{capabilities.restore && !version.is_current && <TouchableOpacity onPress={() => restore(version)} className="min-h-11 min-w-11 items-center justify-center rounded-xl border border-surface-border"><Text className="text-typography-main text-xs font-bold">Restore</Text></TouchableOpacity>}</View>)}</View>)}
        {tab === 'activity' && (activity === null ? <ActivityIndicator /> : activity.length === 0 ? <Text className="text-typography-muted text-xs">No activity recorded yet.</Text> : <View className="gap-2">{activity.map(row => <View key={row.id} className="rounded-xl border border-surface-border p-3"><Text className="text-typography-main text-xs font-bold">{row.action}</Text><Text className="mt-1 text-typography-muted text-[11px]">{row.user?.full_name || 'Someone'} · {new Date(row.created_at).toLocaleString()}</Text></View>)}</View>)}
      </View>
    </ExplorerDetailPane>
    {viewer}
  </>;
}

function Detail({ label, value }: { label: string; value: string }) { return <View><Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">{label}</Text><Text className="mt-1 text-typography-main text-sm" numberOfLines={3}>{value}</Text></View>; }
