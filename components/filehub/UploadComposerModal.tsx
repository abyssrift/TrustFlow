import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Popup from '@/components/common/Popup';
import FolderTreePicker from '@/components/intelligence/FolderTreePicker';
import { useAlert } from '@/contexts/AlertContext';
import { FileHubFolder } from '@/contexts/FileHubContext';
import { useAuth } from '@/contexts/AuthContext';
import { useUploadManager } from '@/contexts/UploadManagerContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import type { UploadDestination } from '@/lib/uploadTargetNormalization';

export type UploadComposerModalProps = {
  visible: boolean;
  onClose: () => void;
  folderId?: string;
  taskId?: string;
  initialFiles?: File[] | null;
  visibilitySeed?: 'direct' | 'broadcast';
  activeGroup?: { id: string; name: string; avatar_color: string } | null;
  destination?: UploadDestination;
};

export default function UploadComposerModal({ visible, onClose, destination }: UploadComposerModalProps) {
  const router = useRouter();
  const { profile } = useAuth();
  const { startUpload, waitForUpload } = useUploadManager();
  const { showAlert } = useAlert();
  const colors = useThemeColors();
  const [folders, setFolders] = useState<FileHubFolder[]>([]);
  const [folderId, setFolderId] = useState<string | null>(destination?.kind === 'project' ? destination.folderId ?? null : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isProject = destination?.kind === 'project';
  const workspaceFolders = useMemo(() => folders.filter(folder => folder.scope === 'project'), [folders]);

  useEffect(() => {
    if (!visible || !isProject || !destination || destination.kind !== 'project') return;
    let cancelled = false;
    setLoading(true);
    supabase.rpc('rpc_project_files', { p_project_id: destination.projectId }).then(({ data, error: rpcError }) => {
      if (cancelled) return;
      const workspace = data && typeof data === 'object' ? (data as any).workspace : null;
      const nextFolders = workspace ? [workspace.root, ...(workspace.folders || [])].filter(Boolean).map((folder: any) => ({ ...folder, scope: 'project', group_id: null })) : [];
      if (rpcError || !workspace || !workspace.root || !workspace.capabilities?.upload) {
        setError('Project workspace is unavailable for uploads.');
        setFolders([]);
      } else {
        setError(null);
        setFolders(nextFolders as FileHubFolder[]);
        const authorizedFolderIds = new Set(nextFolders.map(folder => folder.id));
        setFolderId(destination.folderId && authorizedFolderIds.has(destination.folderId) ? destination.folderId : workspace.root.id);
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [visible, isProject, destination?.kind === 'project' ? destination.projectId : null, destination?.kind === 'project' ? destination.folderId : null]);

  useEffect(() => {
    if (visible && !isProject) { router.push('/filehub' as any); onClose(); }
  }, [visible, isProject]); // eslint-disable-line react-hooks/exhaustive-deps

  const chooseAndUpload = async () => {
    if (!isProject || !destination || destination.kind !== 'project' || !profile?.company_id || !folderId || !workspaceFolders.some(folder => folder.id === folderId)) return;
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    try {
      const files = await Promise.all(result.assets.map(async asset => {
        const blob = await (await fetch(asset.uri)).blob();
        return new File([blob], asset.name, { type: asset.mimeType || blob.type || 'application/octet-stream' });
      }));
      const jobId = startUpload({ files, companyId: profile.company_id, visibility: 'project', folderId, recipientIds: [], groupId: null, tags: [], caption: null, maxFileSizeBytes: null, scopedFolders: workspaceFolders, destination: { ...destination, folderId }, label: 'Project files' });
      await waitForUpload(jobId);
      onClose();
    } catch (e: any) {
      showAlert('Upload failed', e?.message || 'Unable to upload project files.');
    }
  };

  if (!isProject) return null;
  return (
    <Popup visible={visible} onClose={onClose} presentation="auto" maxWidth={520} scrollable={false}>
      <View className="p-6 gap-4">
        <Text className="text-xl font-black text-typography-main">Upload to project workspace</Text>
        {error ? <Text className="text-state-danger">{error}</Text> : loading ? <Text className="text-typography-muted">Loading workspace…</Text> : <>
          <Text className="text-typography-muted">Choose an authorized workspace folder.</Text>
          <FolderTreePicker folders={workspaceFolders} selectedId={folderId} onSelect={setFolderId} colors={colors} />
          <TouchableOpacity accessibilityRole="button" disabled={!folderId} onPress={chooseAndUpload} className="min-h-11 rounded-xl bg-brand-primary items-center justify-center px-4 py-2"><Text className="text-typography-main font-bold">Choose files</Text></TouchableOpacity>
        </>}
      </View>
    </Popup>
  );
}
