import Block from '@/components/common/Block';
import { FilePreviewModal, FilePreviewTeaser, getPreviewKind, type PreviewKind } from '@/components/common/FilePreview';
import ExplorerCollection from '@/components/filehub/explorer/ExplorerCollection';
import type { MultiViewColumn } from '@/components/common/MultiViewList';
import Popup from '@/components/common/Popup';
import { useAlert } from '@/contexts/AlertContext';
import { useFileHub, type FileActivity, type FileVersion } from '@/contexts/FileHubContext';
import { useModalDispatch } from '@/contexts/ModalDispatchContext';
import { useProjectDetail } from '@/contexts/ProjectDetailContext';
import { useToast } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { formatFileSize } from '@/lib/uploadHelpers';
import { openStorageFile } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { resolveProjectFileHubDeepLink, type ProjectFileHubBin, type ProjectFileHubFile, type ProjectFileHubFolder, type ProjectFileHubReference } from '@/lib/projectFileHubNormalization';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';

type WorkspaceItem = (ProjectFileHubFolder & { itemType: 'folder' }) | (ProjectFileHubFile & { itemType: 'file' });
const iconFor = (item: WorkspaceItem) => item.itemType === 'folder' ? 'folder-o' : 'file-o';

function Action({ icon, label, onPress, disabled, danger }: { icon: any; label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} className={`min-h-[44px] flex-row items-center justify-center gap-2 rounded-xl border px-3 ${danger ? 'border-state-danger/30 bg-state-danger/10' : 'border-surface-border bg-surface-background'}`}><FontAwesome name={icon} size={12} /><Text className={`text-xs font-bold ${danger ? 'text-state-danger' : 'text-typography-main'}`}>{label}</Text></TouchableOpacity>;
}

function ReferenceStrip({ title, hint, files, sealed }: { title: string; hint: string; files: ProjectFileHubReference[]; sealed?: boolean }) {
  const [preview, setPreview] = useState<{ uri: string; name: string; kind: PreviewKind; sizeBytes?: number } | null>(null);
  const open = async (file: ProjectFileHubReference) => {
    if (!file.bucket || !file.storage_path) return;
    const { data } = await supabase.storage.from(file.bucket).createSignedUrl(file.storage_path, 3600);
    if (!data?.signedUrl) return;
    const kind = getPreviewKind(file.mime_type, file.name);
    if (kind) setPreview({ uri: data.signedUrl, name: file.name, kind, sizeBytes: file.size_bytes });
    else openStorageFile(file.bucket, file.storage_path, file.name, file.mime_type);
  };
  return <Block title={title} hint={hint} icon={<FontAwesome name={sealed ? 'lock' : 'users'} size={15} />}><View className="flex-row items-center justify-between gap-3"><Text className="flex-1 text-typography-muted text-xs">{files.length ? `${files.length} file${files.length === 1 ? '' : 's'} available` : 'No files yet'}</Text><View className="flex-row items-center gap-1.5 rounded-full border border-surface-border px-2.5 py-1"><FontAwesome name="lock" size={9} /><Text className="text-typography-muted text-[10px] font-bold">{sealed ? 'Read only' : 'Shared input'}</Text></View></View>{files.length > 0 && <View className="mt-2 gap-1">{files.map(file => <TouchableOpacity key={file.id} accessibilityRole="button" accessibilityLabel={`Open ${file.name}`} disabled={!file.bucket || !file.storage_path} onPress={() => void open(file)} className="min-h-[36px] flex-row items-center gap-2 rounded-lg px-1"><FontAwesome name="file-o" size={10} /><Text className="flex-1 text-typography-muted text-[11px]" numberOfLines={1}>{file.name}</Text><Text className="text-typography-dim text-[10px]">{file.size_bytes == null ? '' : formatFileSize(file.size_bytes)}</Text></TouchableOpacity>)}</View>}{preview && <FilePreviewModal visible uri={preview.uri} fileName={preview.name} kind={preview.kind} sizeBytes={preview.sizeBytes} onClose={() => setPreview(null)} />}</Block>;
}

function SealedVersionHistory({ versions }: { versions: unknown[] }) {
  const colors = useThemeColors();
  const [expanded, setExpanded] = useState(false);
  if (versions.length === 0) return null;
  return <View className="rounded-xl border border-surface-border bg-surface-card p-3"><TouchableOpacity onPress={() => setExpanded(value => !value)} className="min-h-[36px] flex-row items-center gap-2"><FontAwesome name={expanded ? 'chevron-down' : 'chevron-right'} size={9} color={colors.textMuted} /><Text className="text-typography-muted text-xs font-bold">{versions.length} sealed version{versions.length === 1 ? '' : 's'}</Text></TouchableOpacity>{expanded && <View className="mt-2 gap-2 border-l border-surface-border pl-3">{versions.map((raw, index) => { const version = (raw || {}) as Record<string, any>; const sequence = version.seq ?? version.version_no ?? index + 1; const actor = version.actor?.full_name || version.created_by_name || 'Someone'; const date = version.created_at ? new Date(version.created_at).toLocaleDateString() : ''; return <View key={version.batch_id || version.id || index} className="flex-row items-center gap-2"><Text className="text-typography-main text-[10px] font-black">v{sequence}</Text><Text className="flex-1 text-typography-muted text-[10px]" numberOfLines={1}>{actor}{date ? ` · ${date}` : ''}{version.files_added != null ? ` · ${version.files_added} added` : ''}{version.files_replaced ? `, ${version.files_replaced} replaced` : ''}</Text></View>; })}</View>}</View>;
}

function ProjectFileDetail({ file, projectId, canRestore, onRefresh, onClose }: { file: ProjectFileHubFile; projectId: string; canRestore: boolean; onRefresh: () => void; onClose?: () => void }) {
  const colors = useThemeColors();
  const { projectFileVersions, restoreProjectFileVersion, fileActivity, logActivity } = useFileHub();
  const { showConfirm } = useAlert();
  const [preview, setPreview] = useState<{ uri: string; kind: PreviewKind } | null>(null);
  const [versions, setVersions] = useState<FileVersion[] | null>(null);
  const [activity, setActivity] = useState<FileActivity[] | null>(null);
  const kind = getPreviewKind(file.mime_type, file.name);
  const open = useCallback(async () => { const { supabase } = await import('@/lib/supabase'); const { data } = await supabase.storage.from(file.bucket).createSignedUrl(file.storage_path, 3600); if (data?.signedUrl && kind) setPreview({ uri: data.signedUrl, kind }); else openStorageFile(file.bucket, file.storage_path, file.name, file.mime_type); logActivity(file.id, 'view'); }, [file, kind, logActivity]);
  const restore = (version: FileVersion) => showConfirm('Restore version?', `Restore ${file.name} to version ${version.version_no}?`, async () => { await restoreProjectFileVersion(projectId, version.id); setVersions(null); onRefresh(); });
  return <View className="flex-1 bg-surface-card"><View className="flex-row items-start gap-3 border-b border-surface-border p-4">{onClose && <TouchableOpacity accessibilityLabel="Back to files" onPress={onClose} className="h-11 w-11 items-center justify-center rounded-xl border border-surface-border"><FontAwesome name="chevron-left" size={12} color={colors.textMuted} /></TouchableOpacity>}<View className="flex-1 min-w-0"><Text className="text-typography-main text-base font-black" numberOfLines={2}>{file.name}</Text><Text className="mt-1 text-typography-muted text-xs">{formatFileSize(file.size_bytes)} · {file.mime_type || 'File'}</Text></View></View><View className="flex-row flex-wrap gap-2 border-b border-surface-border p-4"><Action icon="external-link" label="Preview" onPress={open} /><Action icon="download" label="Download" onPress={() => { logActivity(file.id, 'download'); openStorageFile(file.bucket, file.storage_path, file.name, file.mime_type); }} /></View><ScrollView className="flex-1" contentContainerClassName="gap-4 p-4">{kind && <FilePreviewTeaser uri={file.storage_path} kind={kind} height={180} onPress={open} sizeBytes={file.size_bytes} />}<View className="flex-row gap-2"><TouchableOpacity accessibilityRole="tab" onPress={() => void projectFileVersions(projectId, file.id).then(setVersions)} className="min-h-[44px] flex-1 justify-center rounded-xl border border-surface-border"><Text className="text-center text-typography-main text-xs font-bold">Versions</Text></TouchableOpacity><TouchableOpacity accessibilityRole="tab" onPress={() => void fileActivity(file.id).then(setActivity)} className="min-h-[44px] flex-1 justify-center rounded-xl border border-surface-border"><Text className="text-center text-typography-main text-xs font-bold">Activity</Text></TouchableOpacity></View>{versions && <View className="gap-2">{versions.map(version => <View key={version.id} className="flex-row items-center gap-3 rounded-xl border border-surface-border p-3"><View className="flex-1"><Text className="text-typography-main text-xs font-bold">Version {version.version_no}{version.is_current ? ' · Current' : ''}</Text><Text className="mt-1 text-typography-muted text-[11px]">{new Date(version.created_at).toLocaleDateString()} · {formatFileSize(version.size_bytes)}</Text></View>{canRestore && !version.is_current && <Action icon="undo" label="Restore" onPress={() => restore(version)} />}</View>)}</View>}{activity && <View className="gap-2">{activity.length ? activity.map(row => <View key={row.id} className="rounded-xl border border-surface-border p-3"><Text className="text-typography-main text-xs font-bold">{row.action}</Text><Text className="mt-1 text-typography-muted text-[11px]">{row.user?.full_name || 'Someone'} · {new Date(row.created_at).toLocaleString()}</Text></View>) : <Text className="text-typography-muted text-xs">No activity recorded yet.</Text>}</View>}</ScrollView>{preview && <FilePreviewModal visible uri={preview.uri} fileName={file.name} kind={preview.kind} sizeBytes={file.size_bytes} onClose={() => setPreview(null)} />}</View>;
}

export type ProjectFilesTabProps = { folderParam?: unknown; fileParam?: unknown };

export default function ProjectFilesTab({ folderParam, fileParam }: ProjectFilesTabProps = {}) {
  const { projectId } = useProjectDetail();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  const colors = useThemeColors();
  const {
    projectFiles, projectWorkspaceBin, ensureProjectWorkspace, createProjectFolder,
    renameProjectFolder, moveProjectFolder, deleteProjectFolder, moveProjectFile,
    deleteProjectFile, restoreProjectFolder, restoreProjectFile,
  } = useFileHub();
  const { summon } = useModalDispatch();
  const { errorToast, successToast } = useToast();
  const { showConfirm } = useAlert();
  const [envelope, setEnvelope] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<ProjectFileHubFile | null>(null);
  const [mobilePage, setMobilePage] = useState<'folders' | 'files' | 'detail'>('folders');
  const [dialog, setDialog] = useState<'create' | 'rename' | null>(null);
  const [dialogValue, setDialogValue] = useState('');
  const [moveItem, setMoveItem] = useState<{ id: string; itemType: 'folder' | 'file'; name: string } | null>(null);
  const [workspaceBin, setWorkspaceBin] = useState<ProjectFileHubBin | null>(null);
  const [showBin, setShowBin] = useState(false);
  const ensured = useRef(false);
  useEffect(() => {
    ensured.current = false;
    setEnvelope(null);
    setSelectedFolderId(null);
    setSelectedFile(null);
    setWorkspaceBin(null);
    setShowBin(false);
    setMobilePage('folders');
  }, [projectId]);
  const refresh = useCallback(async () => { setLoading(true); try { const next = await projectFiles(projectId); setEnvelope(next); if (next.workspace?.root && !selectedFolderId) setSelectedFolderId(next.workspace.root.id); } catch { setEnvelope(null); } finally { setLoading(false); } }, [projectId, projectFiles, selectedFolderId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (loading || !envelope) return;
    const hasDeepLink = folderParam !== undefined || fileParam !== undefined;
    if (!hasDeepLink) return;
    const selection = resolveProjectFileHubDeepLink(envelope, projectId, { folder: folderParam, file: fileParam });
    if (!selection) {
      if (envelope.workspace?.root) setSelectedFolderId(envelope.workspace.root.id);
      setSelectedFile(null);
      if (isMobile) setMobilePage('folders');
      return;
    }
    setSelectedFolderId(selection.folderId);
    const file = selection.fileId ? envelope.workspace?.files.find((candidate: ProjectFileHubFile) => candidate.id === selection.fileId) : null;
    setSelectedFile(file || null);
    if (isMobile) setMobilePage(file ? 'detail' : 'files');
  }, [envelope, fileParam, folderParam, isMobile, loading, projectId]);
  useEffect(() => { if (!loading && envelope && !envelope.workspace?.root && !ensured.current) { ensured.current = true; void ensureProjectWorkspace(projectId).then(refresh).catch(() => { ensured.current = false; }); } }, [loading, envelope, ensureProjectWorkspace, projectId, refresh]);
  const workspace = envelope?.workspace; const root = workspace?.root as ProjectFileHubFolder | null; const folders = (workspace?.folders || []) as ProjectFileHubFolder[]; const files = (workspace?.files || []) as ProjectFileHubFile[]; const currentFolder = folders.find(f => f.id === selectedFolderId) || root; const canMutate = Boolean(workspace?.capabilities?.create);
  const children = useMemo(() => [...folders.filter(f => f.parent_id === currentFolder?.id).map(f => ({ ...f, itemType: 'folder' as const })), ...files.filter(f => f.folder_id === currentFolder?.id).map(f => ({ ...f, itemType: 'file' as const }))], [folders, files, currentFolder?.id]);
  const chooseFolder = (folder: ProjectFileHubFolder) => { setSelectedFolderId(folder.id); setSelectedFile(null); if (isMobile) setMobilePage('files'); };
  const runDialog = async () => { const value = dialogValue.trim(); if (!value || !currentFolder) return; try { if (dialog === 'create') await createProjectFolder(projectId, value, currentFolder.id); else if (selectedFolderId) await renameProjectFolder(projectId, selectedFolderId, value); setDialog(null); setDialogValue(''); successToast(dialog === 'create' ? 'Folder created.' : 'Folder renamed.'); await refresh(); } catch (error: any) { errorToast(error?.message || 'Folder action failed.'); } };
  const isDescendant = useCallback((candidateId: string, ancestorId: string) => {
    let current = folders.find(folder => folder.id === candidateId);
    let guard = 0;
    while (current?.parent_id && guard++ < 100) {
      if (current.parent_id === ancestorId) return true;
      current = folders.find(folder => folder.id === current?.parent_id);
    }
    return false;
  }, [folders]);
  const moveCandidates = useMemo(() => folders.filter(folder => (
    folder.id !== moveItem?.id
      && !(moveItem?.itemType === 'folder' && isDescendant(folder.id, moveItem.id))
  )), [folders, isDescendant, moveItem]);
  const runMove = async (destination: ProjectFileHubFolder) => {
    if (!moveItem) return;
    try {
      if (moveItem.itemType === 'folder') await moveProjectFolder(projectId, moveItem.id, destination.id);
      else await moveProjectFile(projectId, moveItem.id, destination.id);
      setMoveItem(null);
      successToast(`${moveItem.itemType === 'folder' ? 'Folder' : 'File'} moved.`);
      await refresh();
    } catch (error: any) { errorToast(error?.message || 'Move failed.'); }
  };
  const deleteItem = (item: WorkspaceItem) => showConfirm(
    item.itemType === 'folder' ? 'Delete folder?' : 'Delete file?',
    `"${item.name}" will move to the workspace bin.`,
    async () => {
      if (item.itemType === 'folder') await deleteProjectFolder(projectId, item.id);
      else await deleteProjectFile(projectId, item.id);
      await refresh();
    },
  );
  const toggleBin = async () => {
    const next = !showBin;
    setShowBin(next);
    if (next) {
      try { setWorkspaceBin(await projectWorkspaceBin(projectId)); }
      catch (error: any) { errorToast(error?.message || 'Workspace bin could not load.'); }
    }
  };
  const restoreBinEntry = async (entry: ProjectFileHubBin['folders'][number]) => {
    try {
      if (entry.item_type === 'folder') await restoreProjectFolder(projectId, entry.id);
      else await restoreProjectFile(projectId, entry.id);
      successToast(`${entry.item_type === 'folder' ? 'Folder' : 'File'} restored.`);
      setWorkspaceBin(await projectWorkspaceBin(projectId));
      await refresh();
    } catch (error: any) { errorToast(error?.message || 'Restore failed.'); }
  };
  const upload = () => { if (!currentFolder || !workspace?.capabilities?.upload) return; summon('upload', { destination: { kind: 'project', projectId, folderId: currentFolder.id } }); };
  if (loading && !envelope) return <View className="flex-1 items-center justify-center py-24"><ActivityIndicator color={colors.textMuted} /></View>;
  if (!envelope) return <View className="flex-1 items-center justify-center p-8"><Text className="text-typography-main text-sm font-bold">Files couldn’t load</Text><Text className="mt-2 text-center text-typography-muted text-xs">Refresh the project and try again.</Text></View>;
  const renderItem = (item: WorkspaceItem) => <View className="min-h-[60px] flex-row items-center gap-3 rounded-xl border border-surface-border bg-surface-background px-3 py-2"><FontAwesome name={iconFor(item)} size={16} color={colors.textMuted} /><View className="flex-1 min-w-0"><Text className="text-typography-main text-xs font-bold" numberOfLines={1}>{item.name}</Text><Text className="mt-0.5 text-typography-muted text-[10px]">{item.itemType === 'folder' ? 'Folder' : formatFileSize(item.size_bytes)}</Text></View>{canMutate && (item.itemType !== 'folder' || item.id !== root?.id) ? <View className="flex-row items-center"><TouchableOpacity accessibilityLabel={`Move ${item.name}`} onPress={() => setMoveItem({ id: item.id, itemType: item.itemType, name: item.name })} className="h-11 w-11 items-center justify-center"><FontAwesome name="arrows" size={11} color={colors.textMuted} /></TouchableOpacity><TouchableOpacity accessibilityLabel={`Delete ${item.name}`} onPress={() => deleteItem(item)} className="h-11 w-11 items-center justify-center"><FontAwesome name="trash-o" size={11} color={colors.textMuted} /></TouchableOpacity></View> : null}</View>;
  const columns: MultiViewColumn<WorkspaceItem>[] = [{ key: 'name', label: 'Name', flex: 2, render: renderItem }, { key: 'type', label: 'Type', render: item => <Text className="text-typography-muted text-xs">{item.itemType}</Text> }];
  const list = <ExplorerCollection items={children} keyExtractor={item => item.id} storageKey={`project-files-${projectId}-${currentFolder?.id || 'root'}`} defaultMode="list" modes={['list', 'details']} renderCard={renderItem} renderRow={renderItem} columns={columns} onItemPress={item => item.itemType === 'folder' ? chooseFolder(item) : (setSelectedFile(item), isMobile && setMobilePage('detail'))} emptyState={{ icon: 'folder-open-o', title: 'This folder is empty', body: canMutate ? 'Upload a file or create a folder to get started.' : 'No files are available here.' }} />;
  const tree = <Block title="Project workspace" hint="Working files for this project" icon={<FontAwesome name="folder-open-o" size={15} />} right={canMutate ? <View className="flex-row gap-2"><Action icon="plus" label="Folder" onPress={() => setDialog('create')} /><Action icon="trash-o" label="Bin" onPress={toggleBin} /></View> : undefined}><ScrollView className="max-h-[420px]" contentContainerClassName="gap-1.5">{root && <TouchableOpacity onPress={() => chooseFolder(root)} className={`min-h-[44px] justify-center rounded-xl px-3 ${currentFolder?.id === root.id ? 'bg-brand-primary/10' : ''}`}><Text className="text-typography-main text-xs font-bold">{root.name}</Text></TouchableOpacity>}{folders.filter(f => f.id !== root?.id).map(folder => <TouchableOpacity key={folder.id} onPress={() => chooseFolder(folder)} className={`min-h-[44px] flex-row items-center gap-2 rounded-xl px-3 ${currentFolder?.id === folder.id ? 'bg-brand-primary/10' : ''}`}><FontAwesome name="folder-o" size={12} color={colors.textMuted} /><Text className="flex-1 text-typography-main text-xs" numberOfLines={1}>{folder.name}</Text><TouchableOpacity accessibilityLabel={`Rename ${folder.name}`} onPress={() => { setSelectedFolderId(folder.id); setDialogValue(folder.name); setDialog('rename'); }} className="h-11 w-11 items-center justify-center"><FontAwesome name="pencil" size={11} color={colors.textMuted} /></TouchableOpacity></TouchableOpacity>)}</ScrollView></Block>;
  const filesBlock = <Block title={currentFolder?.name || 'Files'} hint="Select a file to preview, download, or inspect" right={canMutate ? <Action icon="upload" label="Upload" onPress={upload} disabled={!workspace?.capabilities?.upload} /> : undefined} bodyClassName="flex-1">{list}</Block>;
  const binBlock = showBin && <Block title="Workspace bin" hint="Deleted workspace items remain restorable for 15 days." icon={<FontAwesome name="trash-o" size={15} />}>
    {workspaceBin ? <View className="gap-2">{[...workspaceBin.folders, ...workspaceBin.files].map(entry => <View key={`${entry.item_type}-${entry.id}`} className="min-h-[52px] flex-row items-center gap-3 rounded-xl border border-surface-border px-3"><FontAwesome name={entry.item_type === 'folder' ? 'folder-o' : 'file-o'} size={13} color={colors.textMuted} /><Text className="flex-1 text-typography-main text-xs" numberOfLines={1}>{entry.name}</Text><Action icon="undo" label="Restore" onPress={() => void restoreBinEntry(entry)} /></View>)}{workspaceBin.folders.length + workspaceBin.files.length === 0 && <Text className="text-typography-muted text-xs">The workspace bin is empty.</Text>}</View> : <ActivityIndicator color={colors.textMuted} />}
  </Block>;
  return <View className="flex-1 gap-4 p-4 md:p-8"><View><Text className="text-typography-main text-lg font-black">Project files</Text><Text className="mt-1 text-typography-muted text-xs">Working files stay editable here. Client inputs and sealed outputs remain separate and protected.</Text></View>{binBlock}<View className="gap-4 md:flex-row"><View className="gap-4 md:w-[28%]">{tree}<ReferenceStrip title="Client standing files" hint="Shared reference material that persists across projects." files={envelope.standing_files} /><ReferenceStrip title="Sealed deliverable" hint="Project output, versioned and read-only." files={envelope.deliverable_files} sealed /><SealedVersionHistory versions={envelope.deliverable_versions || []} /></View>{(!isMobile || mobilePage === 'files') && <View className="min-h-[420px] flex-1">{filesBlock}</View>}{(!isMobile || mobilePage === 'detail') && selectedFile && <View className="min-h-[420px] md:w-[34%]"><Block bodyClassName="flex-1"><ProjectFileDetail file={selectedFile} projectId={projectId} canRestore={Boolean(workspace?.capabilities?.version)} onRefresh={refresh} onClose={isMobile ? () => setMobilePage('files') : undefined} /></Block></View>}</View><Popup visible={!!moveItem} onClose={() => setMoveItem(null)} presentation="auto" maxWidth={420} title={`Move ${moveItem?.name || 'item'}`}><View className="max-h-[420px] gap-1.5 p-5">{moveCandidates.map(folder => <TouchableOpacity key={folder.id} onPress={() => void runMove(folder)} className="min-h-[44px] flex-row items-center gap-2 rounded-xl border border-surface-border px-3"><FontAwesome name="folder-o" size={12} color={colors.textMuted} /><Text className="flex-1 text-typography-main text-xs">{folder.name}</Text></TouchableOpacity>)}{moveCandidates.length === 0 && <Text className="text-typography-muted text-xs">No valid workspace destination.</Text>}</View></Popup><Popup visible={!!dialog} onClose={() => setDialog(null)} presentation="auto" maxWidth={420} title={dialog === 'create' ? 'Create folder' : 'Rename folder'}><View className="gap-4 p-5"><TextInput autoFocus value={dialogValue} onChangeText={setDialogValue} placeholder="Folder name" placeholderTextColor={colors.textMuted} className="rounded-lg border border-surface-border bg-surface-background px-3 py-3 text-typography-main" /><View className="flex-row justify-end gap-2"><Action icon="times" label="Cancel" onPress={() => setDialog(null)} /><Action icon="check" label="Save" onPress={runDialog} disabled={!dialogValue.trim()} /></View></View></Popup></View>;
}
