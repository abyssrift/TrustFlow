// Standalone FileHub upload composer (#340).
//
// Lifted out of the non-exported `UploadModal` local fn in
// components/intelligence/_filehub_desktop.tsx so <ModalHost> (command palette /
// deep link / QuickCreateButton) can summon it without the FileHub screen.
//
// What it keeps from the original: the staging UI (file/folder picker, visibility,
// recipients, destination folder tree, tags, caption) and the single
// `useUploadManager().startUpload(...)` hand-off. What it drops: the in-modal
// progress ring + the goo-morph-to-island transition — progress and any
// dup/name-conflict prompts already surface through the topbar upload island
// (UploadManagerContext publishes to it unconditionally), so once the job is
// launched this modal just closes.
//
// Deps that used to come from FileHubContext / screen props are taken directly:
//   folders   -> its own `filehub_folders` select (context's fetchFolders, inlined)
//   profile / hasPermission -> useAuth()
// No FileHubProvider needed. `taskId` is accepted but unused — see note on Props.
import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { FileHubFolder, FileHubFolderScope, folderAncestors, folderPath } from '@/contexts/FileHubContext';
import { useUploadManager } from '@/contexts/UploadManagerContext';
import { useFileSizeLimit } from '@/hooks/useFileSizeLimit';
import { useThemeColors } from '@/hooks/useThemeColors';
import { SMART_FOLDER_PASTE_WARNING_MESSAGE, SMART_FOLDER_PASTE_WARNING_TITLE, useDropPulse, useFileDrop, useSmartPaste } from '@/hooks/useWebDnd';
import { useObjectUrlMap } from '@/hooks/useObjectUrlMap';
import { groupPickedFiles } from '@/lib/filehubFolderTree';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import Popup from '../common/Popup';
import SearchableMultiSelect, { SearchableMultiSelectItem } from '../common/SearchableMultiSelect';
import Tooltip from '../common/Tooltip';
import FolderTreePicker from '../intelligence/FolderTreePicker';
import { ALLOWED_TYPES_MESSAGE, formatFileSize, isAllowedFile } from '../intelligence/filehubShared';

export type UploadComposerModalProps = {
  visible: boolean;
  onClose: () => void;
  folderId?: string;
  initialFiles?: File[] | null;
  visibilitySeed?: 'direct' | 'broadcast';
  activeGroup?: { id: string; name: string; avatar_color: string } | null;
  // ponytail: #340 follow-up — UploadManagerContext's UploadJobInput has no
  // task field (FileHub uploads are direct/broadcast/group, never task-attached),
  // so there is nowhere to route this yet. Accepted so the payload type and deep
  // link keep carrying it; wire once a task-file upload path exists.
  taskId?: string;
};

type UploadDraft = {
  files: File[];
  visibility: 'direct' | 'broadcast' | 'group';
  folderId: string | null;
  tags: string[];
  tagInput: string;
  caption: string;
};
type MemberSummary = { id: string; full_name: string | null; avatar_url: string | null };

const EMPTY_DRAFT = (
  folderId: string | null,
  activeGroup?: UploadComposerModalProps['activeGroup'],
  visibilitySeed?: UploadComposerModalProps['visibilitySeed'],
): UploadDraft => ({
  files: [],
  visibility: activeGroup ? 'group' : visibilitySeed ?? 'direct',
  folderId,
  tags: [],
  tagInput: '',
  caption: '',
});

function getMimeIcon(mimeType: string | null): { icon: string; color: string } {
  if (!mimeType) return { icon: 'file-o', color: '#94a3b8' };
  const t = mimeType.toLowerCase();
  if (t.includes('pdf')) return { icon: 'file-pdf-o', color: '#e53e3e' };
  if (t.includes('image')) return { icon: 'file-image-o', color: '#38a169' };
  if (t.includes('spreadsheet') || t.includes('excel') || t.includes('csv')) return { icon: 'file-excel-o', color: '#2f855a' };
  if (t.includes('word') || t.includes('wordprocessing')) return { icon: 'file-word-o', color: '#2b6cb0' };
  if (t.includes('zip') || t.includes('compressed') || t.includes('archive')) return { icon: 'file-zip-o', color: '#d69e2e' };
  if (t.includes('video')) return { icon: 'file-video-o', color: '#805ad5' };
  if (t.includes('audio')) return { icon: 'file-audio-o', color: '#dd6b20' };
  if (t.includes('text')) return { icon: 'file-text-o', color: '#4a5568' };
  return { icon: 'file-o', color: '#94a3b8' };
}

// Picked-file preview grid. A picked folder collapses to one tile, and fixed
// flex bounds avoid measurement-driven width/height feedback while pasting.
function AdaptiveFileGrid({
  files,
  onRemove,
  onAddMore,
}: {
  files: File[];
  onRemove: (indices: number[]) => void;
  onAddMore: () => void;
}) {
  const previewUrls = useObjectUrlMap(
    files,
    (file, index) => `${index}:${file.name}:${file.size}:${file.lastModified}`,
    file => file.type?.toLowerCase().startsWith('image/') ? file : null,
  );
  if (files.length === 0) return null;

  const entries = groupPickedFiles(files, f => (f as any).webkitRelativePath, f => f.size);

  return (
    <View
      className="flex-row flex-wrap w-full bg-surface-card border border-surface-border rounded-2xl p-4"
      style={{ gap: 12 }}
    >
      {entries.map(entry => {
        if (entry.kind === 'folder') {
          return (
            <View
              key={`dir-${entry.name}`}
              style={{ aspectRatio: 1, flexBasis: 100, flexGrow: 1, minWidth: 100, maxWidth: 140 }}
              className="rounded-xl overflow-hidden border border-surface-border bg-surface-background relative"
            >
              <View className="flex-1 items-center justify-center p-2" style={{ backgroundColor: '#f59e0b12' }}>
                <FontAwesome name="folder-o" size={36} color="#f59e0b" />
                <View className="mt-3 bg-surface-background px-2 py-1 rounded-md border border-surface-border shadow-sm" style={{ maxWidth: '90%' }}>
                  <Text className="text-[10px] font-black text-typography-muted" numberOfLines={1}>
                    {entry.name}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                accessibilityRole="button" accessibilityLabel={`Remove folder ${entry.name}`} onPress={() => onRemove(entry.indices)}
                className="absolute top-1.5 right-1.5 w-11 h-11 bg-black/50 rounded-full items-center justify-center hover:bg-black/70 transition-colors"
                style={{ cursor: 'pointer' } as any}
              >
                <FontAwesome name="times" size={10} color="#fff" />
              </TouchableOpacity>
              <View className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 backdrop-blur-md">
                <Text className="text-white text-[9px] font-bold text-center" numberOfLines={1}>
                  {entry.count} files · {formatFileSize(entry.size)}
                </Text>
              </View>
            </View>
          );
        }
        const pf = entry.item;
        const idx = entry.index;
        const isImage = pf.type?.toLowerCase().startsWith('image/');
        const { icon, color } = getMimeIcon(pf.type || null);
        const imageSource = isImage ? (previewUrls[`${idx}:${pf.name}:${pf.size}:${pf.lastModified}`] || '') : '';

        return (
          <View
            key={`${pf.name}-${idx}`}
            style={{ aspectRatio: 1, flexBasis: 100, flexGrow: 1, minWidth: 100, maxWidth: 140 }}
            className="rounded-xl overflow-hidden border border-surface-border bg-surface-background relative"
          >
            {isImage ? (
              <Image
                source={{ uri: imageSource }}
                style={{ flex: 1, width: '100%', height: '100%', position: 'absolute' }}
                resizeMode="cover"
              />
            ) : (
              <View className="flex-1 items-center justify-center p-2" style={{ backgroundColor: color + '12' }}>
                <FontAwesome name={icon as any} size={36} color={color} />
                <View className="mt-3 bg-surface-background px-2 py-1 rounded-md border border-surface-border shadow-sm">
                  <Text className="text-[10px] font-black uppercase text-typography-muted" numberOfLines={1}>
                    {pf.name.split('.').pop() || 'FILE'}
                  </Text>
                </View>
              </View>
            )}
            <TouchableOpacity
              accessibilityRole="button" accessibilityLabel={`Remove ${pf.name}`} onPress={() => onRemove([idx])}
              className="absolute top-1.5 right-1.5 w-11 h-11 bg-black/50 rounded-full items-center justify-center hover:bg-black/70 transition-colors"
              style={{ cursor: 'pointer' } as any}
            >
              <FontAwesome name="times" size={10} color="#fff" />
            </TouchableOpacity>
            <View className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 backdrop-blur-md">
              <Text className="text-white text-[9px] font-bold text-center" numberOfLines={1}>
                {formatFileSize(pf.size)}
              </Text>
            </View>
          </View>
        );
      })}

      <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add more files"
        onPress={onAddMore}
        style={{ aspectRatio: 1, flexBasis: 100, flexGrow: 1, minWidth: 100, maxWidth: 140 }}
        className="rounded-xl border-2 border-dashed border-surface-border bg-surface-background items-center justify-center hover:bg-surface-overlay transition-colors"
      >
        <FontAwesome name="plus" size={20} color="#94a3b8" />
        <Text className="text-typography-muted text-[10px] font-black mt-2 tracking-wide uppercase">Add More</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function UploadComposerModal({ visible, onClose, folderId, initialFiles = null, visibilitySeed, activeGroup = null }: UploadComposerModalProps) {
  const { profile, hasPermission } = useAuth();
  const { startUpload } = useUploadManager();
  const { showAlert } = useAlert();
  const colors = useThemeColors();
  const maxFileSizeBytes = useFileSizeLimit();
  const { height: winHeight, width: winWidth } = useWindowDimensions();
  const isDesktop = winWidth >= 768;
  const canBroadcast = hasPermission('filehub:broadcast');
  const allowedVisibilitySeed = visibilitySeed === 'broadcast' && !canBroadcast ? 'direct' : visibilitySeed;

  const fileInputRef = useRef<any>(null);
  const folderInputRef = useRef<any>(null);
  const [draft, setDraft] = useState<UploadDraft>(() => EMPTY_DRAFT(folderId ?? null, activeGroup, allowedVisibilitySeed));
  const [recipientSearch, setRecipientSearch] = useState('');
  const [memberResults, setMemberResults] = useState<MemberSummary[]>([]);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [recipientRecords, setRecipientRecords] = useState<Map<string, MemberSummary>>(new Map());
  const [recipientError, setRecipientError] = useState<string | null>(null);
  const recipientRequestRef = useRef(0);
  const [mobilePage, setMobilePage] = useState<'form' | 'recipients' | 'destination'>('form');
  const [desktopDestinationOpen, setDesktopDestinationOpen] = useState(false);
  const [desktopDestinationSearch, setDesktopDestinationSearch] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [tagSuggestResults, setTagSuggestResults] = useState<string[]>([]);
  const appliedSeedRef = useRef<string | null>(null);
  const [foldersLoaded, setFoldersLoaded] = useState(false);

  // Own copy of the folder tree — the context's fetchFolders, inlined. Cheap
  // one-shot select; the real destination sub-tree is get-or-created server-side
  // at commit regardless.
  const [folders, setFolders] = useState<FileHubFolder[]>([]);
  useEffect(() => {
    if (!visible) {
      setFoldersLoaded(false);
      return;
    }
    setFoldersLoaded(false);
    let cancelled = false;
    supabase
      .from('filehub_folders')
      .select('id, name, parent_id, scope, group_id')
      .order('name')
      .then(({ data, error }) => {
        if (!cancelled && !error) {
          setFolders((data as FileHubFolder[]) || []);
          setFoldersLoaded(true);
        }
      });
    return () => { cancelled = true; };
  }, [visible]);

  const patch = (updates: Partial<UploadDraft>) => setDraft(prev => ({ ...prev, ...updates }));

  const uploadScope: FileHubFolderScope = activeGroup
    ? 'group'
    : draft.visibility === 'broadcast' ? 'broadcast' : 'direct';
  const scopedFolders = useMemo(
    () => folders.filter(f => f.scope === uploadScope && (f.group_id ?? null) === (activeGroup?.id ?? null)),
    [folders, uploadScope, activeGroup?.id],
  );

  // Keep matching folders and their ancestor chains so search never strands a
  // result outside the hierarchy needed to navigate to it.
  const desktopDestinationFolders = useMemo(() => {
    const query = desktopDestinationSearch.trim().toLowerCase();
    if (!query) return scopedFolders;
    const keep = new Set<string>();
    scopedFolders.forEach(folder => {
      if (folder.name.toLowerCase().includes(query)) {
        folderAncestors(scopedFolders, folder.id).forEach(ancestor => keep.add(ancestor.id));
      }
    });
    return scopedFolders.filter(folder => keep.has(folder.id));
  }, [desktopDestinationSearch, scopedFolders]);
  const desktopDestinationChain = draft.folderId ? folderAncestors(scopedFolders, draft.folderId) : [];

  useEffect(() => {
    if (!visible) {
      setDraft(EMPTY_DRAFT(folderId ?? null, activeGroup, allowedVisibilitySeed));
      setRecipientSearch('');
      setMemberResults([]);
      setSearchingMembers(false);
      setRecipientRecords(new Map());
      setRecipientError(null);
      setMobilePage('form');
      setDesktopDestinationOpen(false);
      setDesktopDestinationSearch('');
      setDetailsOpen(false);
      appliedSeedRef.current = null;
    } else {
      setDraft(prev => ({
        ...prev,
        visibility: activeGroup ? 'group' : allowedVisibilitySeed ?? (prev.visibility === 'group' ? 'direct' : prev.visibility),
        folderId: folderId !== undefined ? folderId : prev.folderId,
      }));
    }
  }, [visible, folderId, allowedVisibilitySeed, activeGroup]);

  // Group is derived from the active group; direct/broadcast determine the
  // folder scope. Once the folder list is loaded, clear a stale selection when
  // a newly selected scope cannot contain it, while retaining valid folders.
  useEffect(() => {
    if (!visible || !foldersLoaded) return;
    setDraft(prev => {
      if (!prev.folderId) return prev;
      const valid = scopedFolders.some(folder => folder.id === prev.folderId);
      return valid ? prev : { ...prev, folderId: null };
    });
  }, [visible, foldersLoaded, scopedFolders]);

  useEffect(() => {
    const requestId = ++recipientRequestRef.current;
    if (!visible) return;
    const query = recipientSearch.trim();
    const timer = setTimeout(async () => {
      setSearchingMembers(true);
      setRecipientError(null);
      try {
        let request = supabase.from('users').select('id, full_name, avatar_url').order('full_name').limit(12);
        if (query) request = request.ilike('full_name', `%${query}%`);
        const { data, error } = await request;
        if (requestId !== recipientRequestRef.current) return;
        if (error) { setRecipientError('Unable to search members.'); setMemberResults([]); return; }
        const rows = Array.from(new Map((data || []).map((row: MemberSummary) => [row.id, row])).values());
        setMemberResults(rows);
      } catch {
        if (requestId === recipientRequestRef.current) { setRecipientError('Unable to search members.'); setMemberResults([]); }
      } finally {
        if (requestId === recipientRequestRef.current) setSearchingMembers(false);
      }
    }, query ? 260 : 0);
    return () => clearTimeout(timer);
  }, [recipientSearch, visible]);

  const fetchTagSuggestions = useCallback(async (prefix: string) => {
    if (!prefix.trim()) { setTagSuggestResults([]); return; }
    const { data } = await supabase.rpc('rpc_filehub_tag_suggestions', { p_prefix: prefix, p_limit: 8 });
    setTagSuggestResults((data || []).filter((t: string) => !draft.tags.includes(t)));
  }, [draft.tags]);

  const selectedRecipientIds = useMemo(() => Array.from(recipientRecords.keys()), [recipientRecords]);
  const toggleRecipient = (id: string) => {
    setRecipientRecords(prev => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else {
        const record = memberResults.find(m => m.id === id);
        if (record) next.set(id, record);
      }
      return next;
    });
  };
  const finishPicker = () => {
    recipientRequestRef.current += 1;
    if (mobilePage === 'recipients') {
      setRecipientSearch('');
      setMemberResults([]);
    }
    setRecipientError(null);
    setMobilePage('form');
  };

  const addTag = (tag: string) => {
    const clean = tag.trim().toLowerCase().replace(/\s+/g, '-');
    if (!clean || draft.tags.includes(clean)) return;
    patch({ tags: [...draft.tags, clean], tagInput: '' });
    setTagSuggestResults([]);
  };

  const handleTagKeyPress = (e: any) => {
    if (e.nativeEvent?.key === 'Enter' || e.nativeEvent?.key === ',') {
      e.preventDefault?.();
      addTag(draft.tagInput);
    }
  };

  const processWebFiles = useCallback((fileList: FileList | File[] | null): File[] => {
    if (!fileList || fileList.length === 0) return [];
    const valid: File[] = [];
    const rejected: string[] = [];
    Array.from(fileList)
      .filter(f => !f.name.startsWith('.'))
      .forEach(file => {
        if (isAllowedFile(file.name)) valid.push(file);
        else rejected.push(file.name);
      });
    if (rejected.length > 0) {
      showAlert(
        'Unsupported File Type',
        `${rejected.length === 1 ? `"${rejected[0]}" is` : `${rejected.length} files are`} not supported.\n\nSupported types:\n${ALLOWED_TYPES_MESSAGE}`,
      );
    }
    return valid;
  }, [showAlert]);

  // Apply a seed once per visible seed identity. The marker resets on close so
  // intentionally reopening with the same files works without duplicate adds.
  useEffect(() => {
    if (!visible || !initialFiles?.length) return;
    const seedKey = initialFiles.map(file => `${file.name}:${file.size}:${file.lastModified}:${(file as any).webkitRelativePath || ''}`).join('|');
    if (appliedSeedRef.current === seedKey) return;
    appliedSeedRef.current = seedKey;
    const valid = processWebFiles(initialFiles);
    if (valid.length) setDraft(prev => ({ ...prev, files: [...prev.files, ...valid] }));
  }, [visible, initialFiles, processWebFiles]);

  const handleFileChange = (e: any) => {
    const valid = processWebFiles(e.target?.files);
    if (valid.length > 0) patch({ files: [...draft.files, ...valid] });
    e.target.value = '';
  };

  const handleFolderChange = (e: any) => {
    const valid = processWebFiles(e.target?.files);
    if (valid.length > 0) patch({ files: [...draft.files, ...valid] });
    e.target.value = '';
  };

  const { ref: modalDropRef, isOver: modalDropOver } = useFileDrop(
    (files) => {
      const valid = processWebFiles(files as any);
      if (valid.length) setDraft(prev => ({ ...prev, files: [...prev.files, ...valid] }));
    },
    visible,
  );
  const { iconScale: dropIconScale, glowOpacity: dropGlowOpacity } = useDropPulse(modalDropOver);

  // File payloads are intercepted even while a text input is focused; the
  // shared hook preserves normal text paste semantics otherwise.
  useSmartPaste(
    { onFiles: files => {
      const valid = processWebFiles(files);
      if (valid.length) setDraft(prev => ({ ...prev, files: [...prev.files, ...valid] }));
    } },
    visible,
    {
      resolveDirectories: true,
      onDiagnostics: () => showAlert(SMART_FOLDER_PASTE_WARNING_TITLE, SMART_FOLDER_PASTE_WARNING_MESSAGE),
    },
  );

  // Hand the draft to the background upload manager and close — progress, ETA,
  // cancel and any dup/name-conflict prompts all live in the topbar upload
  // island from here (UploadManagerContext.startUpload publishes to it).
  const handleUpload = () => {
    if (draft.files.length === 0) return;
    const companyId = profile?.company_id;
    if (!companyId) { showAlert('Error', 'Company not found.'); return; }

    startUpload({
      files: draft.files,
      companyId,
      visibility: draft.visibility,
      folderId: draft.folderId,
      recipientIds: selectedRecipientIds,
      groupId: activeGroup?.id ?? null,
      tags: draft.tags,
      caption: draft.caption || null,
      maxFileSizeBytes: maxFileSizeBytes ?? null,
      scopedFolders,
      label: activeGroup?.name ?? (draft.visibility === 'broadcast' ? 'Broadcast' : 'Direct'),
    });
    onClose();
  };

  const disabled = draft.files.length === 0 || (draft.visibility === 'direct' && selectedRecipientIds.length === 0);
  const recipientItems: SearchableMultiSelectItem[] = useMemo(() => memberResults.map(m => ({ id: m.id, label: m.full_name || 'Unnamed member', avatarUrl: m.avatar_url })), [memberResults]);
  const selectedRecipientItems: SearchableMultiSelectItem[] = useMemo(() => Array.from(recipientRecords.values()).map(m => ({ id: m.id, label: m.full_name || 'Unnamed member', avatarUrl: m.avatar_url })), [recipientRecords]);
  const audienceModes: Array<'direct' | 'broadcast'> = canBroadcast ? ['direct', 'broadcast'] : ['direct'];
  const audienceControls = activeGroup ? (
    <Tooltip label={`Group: ${activeGroup.name}`}><View className="flex-row items-center gap-2 px-2.5 py-1.5 rounded-full" style={{ backgroundColor: colors.primary + '14' }}><FontAwesome name="users" size={11} color={colors.primary} /><Text className="text-[10px] font-black" style={{ color: colors.primary }}>{activeGroup.name}</Text></View></Tooltip>
  ) : (
    <View className="flex-row items-center gap-1">
      {audienceModes.map(mode => {
        const active = draft.visibility === mode;
        return <Tooltip key={mode} label={mode === 'broadcast' ? 'Broadcast' : 'Direct recipients'}><TouchableOpacity accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={mode === 'broadcast' ? 'Broadcast audience' : 'Direct recipients'} onPress={() => { if (active) return; patch({ visibility: mode }); if (mode !== 'direct' && mobilePage === 'recipients') finishPicker(); }} className="w-11 h-11 items-center justify-center rounded-xl border" style={{ backgroundColor: active ? colors.primary + '1a' : colors.background, borderColor: active ? colors.primary + '66' : colors.border }}><FontAwesome name={mode === 'broadcast' ? 'bullhorn' : 'user'} size={14} color={active ? colors.primary : colors.textMuted} /></TouchableOpacity></Tooltip>;
      })}
      <Text className="text-[10px] font-black ml-1" style={{ color: colors.primary }}>{draft.visibility === 'broadcast' ? 'Broadcast' : `${selectedRecipientIds.length} recipient${selectedRecipientIds.length === 1 ? '' : 's'}`}</Text>
    </View>
  );

  return (
    <Popup
      visible={visible}
      onClose={onClose}
      presentation="auto"
      maxWidth={900}
      maxHeight="90%"
      containerClassName="rounded-[2rem] premium-shadow"
      containerStyle={{
        backgroundColor: colors.card,
        borderWidth: modalDropOver ? 2 : 1,
        borderColor: modalDropOver ? colors.primary : colors.border,
      }}
      scrollable={false}
    >
      <View ref={modalDropRef} style={{ maxHeight: '100%' }}>
        {modalDropOver && (
          <Animated.View
            pointerEvents="none"
            className="absolute inset-0 rounded-[2rem] border-2"
            style={{ borderColor: colors.primary, opacity: dropGlowOpacity }}
          />
        )}
        <View className="px-5 md:px-8 pt-5 md:pt-7 pb-4 md:pb-5 border-b" style={{ borderColor: colors.border }}>
          <View className="flex-row items-center justify-between">
            <Text className="text-xl font-black tracking-tight" style={{ color: colors.textMain }}>Upload Files</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close upload" onPress={onClose} className="w-11 h-11 items-center justify-center rounded-xl border" style={{ backgroundColor: colors.background, borderColor: colors.border }}><FontAwesome name="times" size={12} color={colors.textMuted} /></TouchableOpacity>
          </View>
          <View className="mt-3 md:absolute md:right-20 md:top-7 md:mt-0">{audienceControls}</View>
        </View>

        {isDesktop && desktopDestinationOpen ? (
          <View style={{ minHeight: Math.max(420, winHeight * 0.62), flex: 1 }}>
            <View className="flex-row items-center gap-3 px-7 py-4 border-b" style={{ borderColor: colors.border }}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to upload form" onPress={() => { setDesktopDestinationOpen(false); setDesktopDestinationSearch(''); }} className="w-11 h-11 items-center justify-center rounded-xl border" style={{ borderColor: colors.border, backgroundColor: colors.background }}>
                <FontAwesome name="chevron-left" size={11} color={colors.textMuted} />
              </TouchableOpacity>
              <View className="flex-1">
                <Text className="font-black text-base" style={{ color: colors.textMain }}>Choose destination</Text>
                <Text className="text-xs mt-1" style={{ color: colors.textMuted }}>Select where these files should be uploaded</Text>
              </View>
            </View>
            <View className="px-7 pt-5 gap-3">
              <TextInput
                value={desktopDestinationSearch}
                onChangeText={setDesktopDestinationSearch}
                placeholder="Search folders..."
                placeholderTextColor={colors.textDim}
                accessibilityLabel="Search destination folders"
                className="border rounded-xl px-4 py-3 text-sm"
                style={{ backgroundColor: colors.background, borderColor: colors.border, color: colors.textMain }}
              />
              <View className="flex-row items-center flex-wrap gap-1.5" accessibilityRole="text">
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Select top level" onPress={() => patch({ folderId: null })} className="min-h-11 justify-center px-2">
                  <Text className="text-xs font-black" style={{ color: colors.primary }}>Top level</Text>
                </TouchableOpacity>
                {desktopDestinationChain.map(folder => (
                  <React.Fragment key={folder.id}>
                    <FontAwesome name="chevron-right" size={9} color={colors.textMuted} />
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Select ${folder.name}`} onPress={() => patch({ folderId: folder.id })} className="min-h-11 justify-center px-2">
                      <Text className="text-xs font-black" style={{ color: folder.id === draft.folderId ? colors.primary : colors.textMuted }}>{folder.name}</Text>
                    </TouchableOpacity>
                  </React.Fragment>
                ))}
              </View>
              <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Selected destination</Text>
              <Text className="text-sm font-bold" accessibilityRole="text" style={{ color: colors.textMain }}>{draft.folderId ? folderPath(scopedFolders, draft.folderId) : 'Top level (no folder)'}</Text>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flex: 1, margin: 20, marginTop: 12 }} contentContainerStyle={{ padding: 6 }}>
              <FolderTreePicker folders={desktopDestinationFolders} selectedId={draft.folderId} onSelect={(id) => patch({ folderId: id })} colors={colors} scrollable={false} />
            </ScrollView>
          </View>
        ) : !isDesktop && mobilePage !== 'form' ? (
          <View style={{ minHeight: Math.max(320, winHeight * 0.62), flex: 1 }}>
            <View className="flex-row items-center gap-3 px-5 py-4 border-b" style={{ borderColor: colors.border }}>
              <TouchableOpacity accessibilityRole="button" accessibilityLabel="Back to upload form" onPress={finishPicker} className="w-11 h-11 items-center justify-center rounded-lg border" style={{ borderColor: colors.border, backgroundColor: colors.background }}>
                <FontAwesome name="chevron-left" size={11} color={colors.textMuted} />
              </TouchableOpacity>
              <Text className="font-black text-base" style={{ color: colors.textMain }}>{mobilePage === 'recipients' ? 'Recipients' : 'Destination'}</Text>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20 }}>
              {mobilePage === 'recipients' ? (
                <SearchableMultiSelect title="Recipients" items={recipientItems} selectedIds={selectedRecipientIds} onToggle={toggleRecipient} query={recipientSearch} onQueryChange={setRecipientSearch} loading={searchingMembers} errorText={recipientError ?? undefined} selectedItems={selectedRecipientItems} autoFocus onClearSelection={() => setRecipientRecords(new Map())} searchPlaceholder="Search team members..." accent={colors.primary} />
              ) : (
                <FolderTreePicker folders={scopedFolders} selectedId={draft.folderId} onSelect={(id) => patch({ folderId: id })} colors={colors} />
              )}
            </ScrollView>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={mobilePage === 'recipients' ? 'Done choosing recipients' : 'Done choosing destination'} onPress={finishPicker} className="mx-5 mb-4 items-center justify-center rounded-xl py-3.5" style={{ backgroundColor: colors.primary }}><Text className="text-white font-black">Done</Text></TouchableOpacity>
          </View>
        ) : (
        <View style={{ flexDirection: isDesktop ? 'row' : 'column', minHeight: 0 }}>
          {/* Left column: file staging */}
          <ScrollView showsVerticalScrollIndicator={false} style={isDesktop ? { flexGrow: 2, flexBasis: 0, minWidth: 0, maxHeight: winHeight * 0.62 } : { flexGrow: 0, flexShrink: 1, maxHeight: winHeight * 0.46 }} contentContainerStyle={{ padding: isDesktop ? 28 : 20, gap: 20 }}>
            {Platform.OS === 'web' && (
              <>
                <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleFileChange} />
                <input ref={folderInputRef} type="file" {...({ webkitdirectory: '', multiple: '' } as any)} style={{ display: 'none' }} onChange={handleFolderChange} />
              </>
            )}

            {draft.files.length === 0 ? (
              <View
                className="border-2 border-dashed rounded-2xl items-center justify-center py-10 px-6 gap-4"
                style={{ borderColor: modalDropOver ? colors.primary : colors.border, backgroundColor: modalDropOver ? colors.primary + '0d' : 'transparent' }}
              >
                <Animated.View
                  className="w-14 h-14 rounded-2xl border items-center justify-center"
                  style={{ backgroundColor: colors.background, borderColor: modalDropOver ? colors.primary : colors.border, transform: [{ scale: dropIconScale }] }}
                >
                  <FontAwesome name="cloud-upload" size={24} color={modalDropOver ? colors.primary : colors.textMuted} />
                </Animated.View>
                <View className="items-center gap-1">
                  <Text className="font-bold text-sm" style={{ color: modalDropOver ? colors.primary : colors.textMain }}>
                    {modalDropOver ? 'Release to add files' : 'Drag and drop files here'}
                  </Text>
                  <Text className="text-xs" style={{ color: colors.textMuted }}>or choose below · up to 500 MB per file</Text>
                </View>
                <View className="flex-row gap-3">
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose files" onPress={() => fileInputRef.current?.click()} className="min-h-11 flex-row items-center gap-2 px-5 py-2.5 rounded-xl" style={{ backgroundColor: colors.primary }}>
                    <FontAwesome name="files-o" size={12} color="#fff" />
                    <Text className="text-white font-black text-sm">Files</Text>
                  </TouchableOpacity>
                  <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose folder" onPress={() => folderInputRef.current?.click()} className="min-h-11 flex-row items-center gap-2 border px-5 py-2.5 rounded-xl" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                    <FontAwesome name="folder-open-o" size={12} color={colors.textMuted} />
                    <Text className="font-black text-sm" style={{ color: colors.textMuted }}>Folder</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <>
                <View className="flex-row items-center justify-between">
                  <Text accessibilityRole="text" className="text-xs font-black" style={{ color: colors.textMuted }}>{draft.files.length} file{draft.files.length === 1 ? '' : 's'} · {formatFileSize(draft.files.reduce((sum, file) => sum + file.size, 0))}</Text>
                  <View className="flex-row gap-2">
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Add more files" onPress={() => fileInputRef.current?.click()} className="h-11 px-3 items-center justify-center rounded-xl border" style={{ borderColor: colors.border, backgroundColor: colors.background }}><Text className="text-xs font-black" style={{ color: colors.primary }}>Add more</Text></TouchableOpacity>
                    <TouchableOpacity accessibilityRole="button" accessibilityLabel="Clear all staged files" onPress={() => patch({ files: [] })} className="h-11 px-3 items-center justify-center rounded-xl border" style={{ borderColor: colors.border, backgroundColor: colors.background }}><Text className="text-xs font-black" style={{ color: colors.textMuted }}>Clear all</Text></TouchableOpacity>
                  </View>
                </View>
                <AdaptiveFileGrid files={draft.files} onRemove={(indices) => { const drop = new Set(indices); patch({ files: draft.files.filter((_, i) => !drop.has(i)) }); }} onAddMore={() => fileInputRef.current?.click()} />
              </>
            )}
          </ScrollView>

          {isDesktop && <View style={{ width: 1, backgroundColor: colors.border }} />}

          {/* Right column: destination + metadata */}
          <ScrollView showsVerticalScrollIndicator={false} style={isDesktop ? { flexGrow: 3, flexBasis: 0, minWidth: 0, maxHeight: winHeight * 0.62 } : { flexGrow: 0, flexShrink: 1, maxHeight: winHeight * 0.46 }} contentContainerStyle={{ padding: isDesktop ? 28 : 20, gap: 20 }}>
            {!isDesktop && (
              <View className="gap-2">
                {draft.visibility === 'direct' && <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose recipients" onPress={() => setMobilePage('recipients')} className="flex-row items-center justify-between border rounded-xl px-4 py-3" style={{ borderColor: colors.border, backgroundColor: colors.background }}>
                  <View><Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Recipients</Text><Text className="text-sm font-bold mt-1" style={{ color: colors.textMain }}>{selectedRecipientIds.length ? `${selectedRecipientIds.length} selected` : 'Choose recipients'}</Text></View>
                  <FontAwesome name="chevron-right" size={11} color={colors.textMuted} />
                </TouchableOpacity>}
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Choose destination folder" onPress={() => setMobilePage('destination')} className="flex-row items-center justify-between border rounded-xl px-4 py-3" style={{ borderColor: colors.border, backgroundColor: colors.background }}>
                  <View><Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Destination</Text><Text className="text-sm font-bold mt-1" style={{ color: colors.textMain }}>{draft.folderId ? folderPath(scopedFolders, draft.folderId) : 'Top level (no folder)'}</Text></View>
                  <FontAwesome name="chevron-right" size={11} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            )}
            {isDesktop && draft.visibility === 'direct' && (
              <View className="gap-2">
                <SearchableMultiSelect title="Recipients" items={recipientItems} selectedIds={selectedRecipientIds} onToggle={toggleRecipient} query={recipientSearch} onQueryChange={setRecipientSearch} loading={searchingMembers} errorText={recipientError ?? undefined} selectedItems={selectedRecipientItems} searchPlaceholder="Search team members..." accent={colors.primary} />
              </View>
            )}

            {isDesktop && <View className="gap-2">
              <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Destination</Text>
              <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: desktopDestinationOpen }} accessibilityLabel="Choose destination folder" onPress={() => setDesktopDestinationOpen(true)} className="min-h-11 flex-row items-center justify-between border rounded-xl px-4 py-3" style={{ borderColor: colors.border, backgroundColor: colors.background }}>
                <View className="flex-1">
                  <Text className="text-sm font-bold" style={{ color: colors.textMain }}>{draft.folderId ? folderPath(scopedFolders, draft.folderId) : 'Top level (no folder)'}</Text>
                </View>
                <FontAwesome name="chevron-right" size={11} color={colors.textMuted} />
              </TouchableOpacity>
            </View>}
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} accessibilityLabel="Toggle upload details" onPress={() => setDetailsOpen(v => !v)} className="flex-row items-center justify-between border rounded-xl px-4 py-3" style={{ borderColor: colors.border, backgroundColor: colors.background }}>
              <View><Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Details</Text><Text className="text-xs font-bold mt-1" style={{ color: colors.textMain }}>{draft.tags.length === 0 && !draft.caption.trim() ? 'No details' : `${draft.tags.length} tag${draft.tags.length === 1 ? '' : 's'}${draft.caption.trim() ? ' · Caption added' : ''}`}</Text></View>
              <FontAwesome name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={11} color={colors.textMuted} />
            </TouchableOpacity>
            {detailsOpen && <>
            <View className="gap-2">
              <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Tags</Text>
              {draft.tags.length > 0 && (
                <View className="flex-row flex-wrap gap-2">
                  {draft.tags.map(tag => (
                    <View key={tag} className="flex-row items-center gap-1.5 border rounded-full px-3 py-1" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                      <Text className="text-xs font-bold" style={{ color: colors.textMuted }}>{tag}</Text>
                      <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Remove tag ${tag}`} className="w-11 h-11 items-center justify-center" onPress={() => patch({ tags: draft.tags.filter(t => t !== tag) })}>
                        <FontAwesome name="times" size={9} color={colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
              <View className="flex-row items-center border rounded-xl px-4 py-2.5 gap-2" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                <FontAwesome name="tag" size={11} color={colors.textMuted} />
                <TextInput
                  value={draft.tagInput}
                  onChangeText={v => { patch({ tagInput: v }); fetchTagSuggestions(v); }}
                  onKeyPress={handleTagKeyPress}
                  onSubmitEditing={() => addTag(draft.tagInput)}
                  placeholder="Add tag and press Enter..."
                  placeholderTextColor={colors.textDim}
                  className="flex-1 text-sm bg-transparent"
                  style={{ color: colors.textMain }}
                />
              </View>
              {tagSuggestResults.length > 0 && (
                <View className="flex-row flex-wrap gap-2">
                  {tagSuggestResults.map(t => (
                    <TouchableOpacity key={t} accessibilityRole="button" accessibilityLabel={`Add tag ${t}`} onPress={() => addTag(t)} className="min-h-11 px-3 py-1 rounded-full border justify-center" style={{ backgroundColor: colors.primary + '0d', borderColor: colors.primary + '33' }}>
                      <Text className="text-xs font-bold" style={{ color: colors.primary }}>{t}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <View className="gap-2">
              <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Caption</Text>
              <TextInput
                value={draft.caption}
                onChangeText={v => patch({ caption: v })}
                placeholder="Add a note or description..."
                placeholderTextColor={colors.textDim}
                multiline
                numberOfLines={3}
                className="border rounded-xl px-4 py-3 text-sm"
                style={{ minHeight: 80, textAlignVertical: 'top', backgroundColor: colors.background, borderColor: colors.border, color: colors.textMain }}
              />
            </View></>}
          </ScrollView>
        </View>
        )}

        {(isDesktop || mobilePage === 'form') && <View className="flex-row gap-3 px-8 py-5 border-t" style={{ borderColor: colors.border }}>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel upload" onPress={onClose} className="flex-1 items-center justify-center py-3.5 rounded-xl border" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
            <Text className="font-black text-sm" style={{ color: colors.textMuted }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Start upload"
            onPress={handleUpload}
            disabled={disabled}
            className="flex-[2] items-center justify-center py-3.5 rounded-xl"
            style={{ backgroundColor: colors.primary, opacity: disabled ? 0.5 : 1 }}
          >
            <Text className="text-white font-black text-sm">
              {draft.files.length > 1 ? `Upload ${draft.files.length} Files` : 'Upload File'}
            </Text>
          </TouchableOpacity>
        </View>}
      </View>
    </Popup>
  );
}
