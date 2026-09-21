import * as DocumentPicker from 'expo-document-picker';
import { File as ExpoFile } from 'expo-file-system';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View, ScrollView } from 'react-native';
import Popup from '@/components/common/Popup';
import FolderTreePicker from '@/components/intelligence/FolderTreePicker';
import SearchableMultiSelect, { type SearchableMultiSelectItem } from '@/components/common/SearchableMultiSelect';
import { useAlert } from '@/contexts/AlertContext';
import { type FileHubFolder } from '@/contexts/FileHubContext';
import { useAuth } from '@/contexts/AuthContext';
import { useUploadManager } from '@/contexts/UploadManagerContext';
import { useFileSizeLimit } from '@/hooks/useFileSizeLimit';
import { useThemeColors } from '@/hooks/useThemeColors';
import { isAllowedFile, ALLOWED_TYPES_MESSAGE } from '@/components/intelligence/filehubShared';
import { supabase } from '@/lib/supabase';
import type { UploadDestination } from '@/lib/uploadTargetNormalization';

type NativeUploadFile = File & { name: string; type: string };
type MemberSummary = { id: string; full_name: string | null; avatar_url: string | null };
type NativeDraft = {
  files: NativeUploadFile[];
  visibility: 'direct' | 'broadcast' | 'group';
  folderId: string | null;
  tags: string[];
  caption: string;
};

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

function assetToFile(asset: DocumentPicker.DocumentPickerAsset): NativeUploadFile {
  const file = new ExpoFile(asset.uri) as unknown as NativeUploadFile;
  Object.defineProperty(file, 'name', { configurable: true, value: asset.name });
  Object.defineProperty(file, 'type', { configurable: true, value: asset.mimeType || 'application/octet-stream' });
  return file;
}

export default function UploadComposerModal({
  visible,
  onClose,
  folderId,
  initialFiles = null,
  visibilitySeed,
  activeGroup = null,
  destination,
}: UploadComposerModalProps) {
  const { profile, hasPermission } = useAuth();
  const { startUpload } = useUploadManager();
  const { showAlert } = useAlert();
  const colors = useThemeColors();
  const maxFileSizeBytes = useFileSizeLimit();
  const isProject = destination?.kind === 'project';
  const canBroadcast = hasPermission('filehub:broadcast');
  const initialVisibility: NativeDraft['visibility'] = isProject
    ? 'direct'
    : activeGroup
      ? 'group'
      : visibilitySeed === 'broadcast' && canBroadcast
        ? 'broadcast'
        : 'direct';

  const [folders, setFolders] = useState<FileHubFolder[]>([]);
  const [foldersLoaded, setFoldersLoaded] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [draft, setDraft] = useState<NativeDraft>({
    files: [],
    visibility: initialVisibility,
    folderId: destination?.kind === 'project' ? destination.folderId ?? null : folderId ?? null,
    tags: [],
    caption: '',
  });
  const [tagInput, setTagInput] = useState('');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [memberResults, setMemberResults] = useState<MemberSummary[]>([]);
  const [recipientRecords, setRecipientRecords] = useState<Map<string, MemberSummary>>(new Map());
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const recipientRequest = useRef(0);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setFoldersLoaded(false);
    if (isProject && destination?.kind === 'project') {
      supabase.rpc('rpc_project_files', { p_project_id: destination.projectId }).then(({ data, error }) => {
        if (cancelled) return;
        const workspace = data && typeof data === 'object' ? (data as any).workspace : null;
        const rows = workspace?.folders || [];
        const next = workspace
          ? [
              ...(workspace.root && !rows.some((folder: any) => folder?.id === workspace.root.id) ? [workspace.root] : []),
              ...rows,
            ].filter(Boolean).map((folder: any) => ({ ...folder, scope: 'project', group_id: null }))
          : [];
        if (error || !workspace?.root || !workspace.capabilities?.upload) {
          setProjectError('Project workspace is unavailable for uploads.');
          setFolders([]);
        } else {
          setProjectError(null);
          setFolders(next as FileHubFolder[]);
          const authorizedFolderIds = new Set(next.map((folder: any) => folder.id));
          setDraft(prev => ({
            ...prev,
            visibility: 'direct',
            folderId: destination.folderId && authorizedFolderIds.has(destination.folderId)
              ? destination.folderId
              : workspace.root.id,
          }));
        }
        setFoldersLoaded(true);
      });
    } else {
      supabase.from('filehub_folders').select('id, name, parent_id, scope, group_id').order('name').then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setFolders([]);
        } else {
          setFolders((data as FileHubFolder[]) || []);
        }
        setFoldersLoaded(true);
      });
    }
    return () => { cancelled = true; };
  }, [visible, isProject, destination?.kind === 'project' ? destination.projectId : null]);

  const uploadScope = isProject
    ? 'project'
    : activeGroup
      ? 'group'
      : draft.visibility === 'broadcast'
        ? 'broadcast'
        : 'direct';
  const scopedFolders = useMemo(
    () => folders.filter(folder => folder.scope === uploadScope && (isProject || (folder.group_id ?? null) === (activeGroup?.id ?? null))),
    [folders, uploadScope, activeGroup?.id, isProject],
  );

  useEffect(() => {
    if (!visible || !foldersLoaded) return;
    setDraft(prev => {
      if (isProject) {
        const next = prev.folderId && scopedFolders.some(folder => folder.id === prev.folderId)
          ? prev.folderId
          : scopedFolders[0]?.id ?? null;
        return next === prev.folderId ? prev : { ...prev, folderId: next };
      }
      if (!prev.folderId || scopedFolders.some(folder => folder.id === prev.folderId)) return prev;
      return { ...prev, folderId: null };
    });
  }, [visible, foldersLoaded, scopedFolders, isProject]);

  useEffect(() => {
    if (!visible || isProject || activeGroup || draft.visibility !== 'direct') {
      recipientRequest.current += 1;
      setSearchingMembers(false);
      return;
    }
    const requestId = ++recipientRequest.current;
    const query = recipientSearch.trim();
    const timer = setTimeout(async () => {
      setSearchingMembers(true);
      setRecipientError(null);
      try {
        let request = supabase.from('users').select('id, full_name, avatar_url').order('full_name').limit(12);
        if (query) request = request.ilike('full_name', '%' + query + '%');
        const { data, error } = await request;
        if (requestId !== recipientRequest.current) return;
        if (error) {
          setMemberResults([]);
          setRecipientError('Unable to search members.');
        } else {
          setMemberResults(Array.from(new Map((data || []).map((member: MemberSummary) => [member.id, member])).values()));
        }
      } catch {
        if (requestId === recipientRequest.current) {
          setMemberResults([]);
          setRecipientError('Unable to search members.');
        }
      } finally {
        if (requestId === recipientRequest.current) setSearchingMembers(false);
      }
    }, query ? 220 : 0);
    return () => clearTimeout(timer);
  }, [visible, isProject, activeGroup, draft.visibility, recipientSearch]);

  useEffect(() => {
    if (!visible || !initialFiles?.length) return;
    setDraft(prev => ({ ...prev, files: initialFiles as NativeUploadFile[] }));
  }, [visible, initialFiles]);

  const chooseFiles = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (result.canceled) return;
    const accepted: NativeUploadFile[] = [];
    const rejected: string[] = [];
    for (const asset of result.assets) {
      if (!isAllowedFile(asset.name)) rejected.push(asset.name);
      else accepted.push(assetToFile(asset));
    }
    if (rejected.length) {
      showAlert(
        'Unsupported File Type',
        (rejected.length === 1 ? '"' + rejected[0] + '" is' : rejected.length + ' files are') +
          ' not supported.\n\nSupported types:\n' + ALLOWED_TYPES_MESSAGE,
      );
    }
    if (accepted.length) setDraft(prev => ({ ...prev, files: [...prev.files, ...accepted] }));
  };

  const toggleRecipient = (id: string) => {
    setRecipientRecords(previous => {
      const next = new Map(previous);
      if (next.has(id)) next.delete(id);
      else {
        const member = memberResults.find(row => row.id === id);
        if (member) next.set(id, member);
      }
      return next;
    });
  };

  const addTags = () => {
    const next = tagInput
      .split(',')
      .map(tag => tag.trim().toLowerCase().replace(/\s+/g, '-'))
      .filter(tag => tag && !draft.tags.includes(tag));
    if (next.length) setDraft(prev => ({ ...prev, tags: [...prev.tags, ...next] }));
    setTagInput('');
  };

  const handleUpload = () => {
    if (!draft.files.length || projectError) return;
    const companyId = profile?.company_id;
    if (!companyId) {
      showAlert('Error', 'Company not found.');
      return;
    }
    if (!isProject && !activeGroup && draft.visibility === 'direct' && recipientRecords.size === 0) {
      showAlert('Error', 'Choose at least one recipient.');
      return;
    }
    if (isProject && (!destination || destination.kind !== 'project' || !draft.folderId || !scopedFolders.some(folder => folder.id === draft.folderId))) {
      showAlert('Error', 'Choose an authorized project workspace folder.');
      return;
    }
    const uploadVisibility = isProject ? 'project' : draft.visibility;
    const uploadDestination: UploadDestination = isProject && destination?.kind === 'project'
      ? { ...destination, folderId: draft.folderId }
      : { kind: 'filehub', visibility: uploadVisibility as 'direct' | 'broadcast' | 'group', folderId: draft.folderId, groupId: activeGroup?.id ?? null };
    startUpload({
      files: draft.files,
      companyId,
      visibility: uploadVisibility,
      folderId: draft.folderId,
      recipientIds: Array.from(recipientRecords.keys()),
      groupId: activeGroup?.id ?? null,
      tags: draft.tags,
      caption: draft.caption.trim() || null,
      maxFileSizeBytes: maxFileSizeBytes ?? null,
      scopedFolders,
      destination: uploadDestination,
      label: isProject ? 'Project files' : activeGroup?.name ?? (draft.visibility === 'broadcast' ? 'Broadcast' : 'Direct'),
    });
    onClose();
  };

  const recipientItems: SearchableMultiSelectItem[] = memberResults.map(member => ({
    id: member.id,
    label: member.full_name || 'Unnamed member',
    avatarUrl: member.avatar_url,
  }));
  const selectedRecipientItems: SearchableMultiSelectItem[] = Array.from(recipientRecords.values()).map(member => ({
    id: member.id,
    label: member.full_name || 'Unnamed member',
    avatarUrl: member.avatar_url,
  }));
  const disabled = !draft.files.length || !!projectError || (isProject
    ? !draft.folderId || !scopedFolders.some(folder => folder.id === draft.folderId)
    : !activeGroup && draft.visibility === 'direct' && recipientRecords.size === 0);

  return (
    <Popup visible={visible} onClose={onClose} presentation="auto" maxWidth={560} scrollable={false}>
      <View className="p-5 gap-4">
        <Text className="text-xl font-black text-typography-main">
          {isProject ? 'Upload to project workspace' : activeGroup ? 'Upload to ' + activeGroup.name : 'Upload files'}
        </Text>
        {projectError && <Text className="text-state-danger text-sm">{projectError}</Text>}
        {!isProject && !activeGroup && (
          <View className="flex-row gap-2">
            {(['direct', 'broadcast'] as const).filter(mode => mode !== 'broadcast' || canBroadcast).map(mode => (
              <TouchableOpacity
                key={mode}
                accessibilityRole="button"
                accessibilityLabel={mode === 'broadcast' ? 'Broadcast audience' : 'Direct recipients'}
                accessibilityState={{ selected: draft.visibility === mode }}
                onPress={() => setDraft(prev => ({ ...prev, visibility: mode }))}
                className="min-h-11 flex-1 items-center justify-center rounded-xl border border-surface-border"
              >
                <Text className="text-typography-main text-xs font-bold">{mode === 'broadcast' ? 'Broadcast' : 'Direct'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {!isProject && !activeGroup && draft.visibility === 'direct' && (
          <SearchableMultiSelect
            title="Recipients"
            items={recipientItems}
            selectedIds={Array.from(recipientRecords.keys())}
            onToggle={toggleRecipient}
            query={recipientSearch}
            onQueryChange={setRecipientSearch}
            loading={searchingMembers}
            errorText={recipientError}
            selectedItems={selectedRecipientItems}
            searchPlaceholder="Search team members..."
            accent={colors.primary}
            onClearSelection={() => setRecipientRecords(new Map())}
          />
        )}
        {foldersLoaded && (isProject || scopedFolders.length > 0) && (
          <View className="gap-2">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Destination</Text>
            <FolderTreePicker folders={scopedFolders} selectedId={draft.folderId} onSelect={id => setDraft(prev => ({ ...prev, folderId: id }))} colors={colors} />
          </View>
        )}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose files" onPress={chooseFiles} className="min-h-11 items-center justify-center rounded-xl bg-brand-primary px-4 py-3">
          <Text className="text-white font-black">Choose files</Text>
        </TouchableOpacity>
        {draft.files.map((file, index) => (
          <View key={file.name + ':' + index} className="min-h-11 flex-row items-center gap-2 rounded-xl border border-surface-border px-3">
            <Text className="flex-1 text-typography-main text-xs" numberOfLines={1}>{file.name}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={'Remove ' + file.name} onPress={() => setDraft(prev => ({ ...prev, files: prev.files.filter((_, fileIndex) => fileIndex !== index) }))} className="min-h-11 min-w-11 items-center justify-center">
              <Text className="text-state-danger text-xs font-bold">Remove</Text>
            </TouchableOpacity>
          </View>
        ))}
        <View className="gap-2">
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Tags</Text>
          <TextInput
            value={tagInput}
            onChangeText={setTagInput}
            onSubmitEditing={addTags}
            placeholder="Comma-separated tags"
            placeholderTextColor={colors.textMuted}
            className="min-h-11 rounded-xl border border-surface-border px-3 text-typography-main"
          />
          {draft.tags.length > 0 && <Text className="text-typography-muted text-xs">{draft.tags.join(', ')}</Text>}
          <TextInput
            value={draft.caption}
            onChangeText={caption => setDraft(prev => ({ ...prev, caption }))}
            placeholder="Caption (optional)"
            placeholderTextColor={colors.textMuted}
            multiline
            className="min-h-20 rounded-xl border border-surface-border px-3 py-3 text-typography-main"
          />
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Start upload" disabled={disabled} onPress={handleUpload} className="min-h-11 items-center justify-center rounded-xl bg-brand-primary px-4 py-3">
          <Text className="text-white font-black">Start upload</Text>
        </TouchableOpacity>
      </View>
    </Popup>
  );
}
