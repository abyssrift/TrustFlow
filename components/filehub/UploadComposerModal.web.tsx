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
import { FileHubFolder, FileHubFolderScope, folderPath } from '@/contexts/FileHubContext';
import { useUploadManager } from '@/contexts/UploadManagerContext';
import { useFileSizeLimit } from '@/hooks/useFileSizeLimit';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useDropPulse, useFileDrop } from '@/hooks/useWebDnd';
import { groupPickedFiles } from '@/lib/filehubFolderTree';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import FolderTreePicker from '../intelligence/FolderTreePicker';
import { ALLOWED_TYPES_MESSAGE, formatFileSize, isAllowedFile } from '../intelligence/filehubShared';

export type UploadComposerModalProps = {
  visible: boolean;
  onClose: () => void;
  folderId?: string;
  // ponytail: #340 follow-up — UploadManagerContext's UploadJobInput has no
  // task field (FileHub uploads are direct/broadcast/group, never task-attached),
  // so there is nowhere to route this yet. Accepted so the payload type and deep
  // link keep carrying it; wire once a task-file upload path exists.
  taskId?: string;
};

type UploadDraft = {
  files: File[];
  visibility: 'direct' | 'broadcast';
  recipientIds: string[];
  folderId: string | null;
  tags: string[];
  tagInput: string;
  caption: string;
};

const EMPTY_DRAFT = (folderId: string | null): UploadDraft => ({
  files: [],
  visibility: 'direct',
  recipientIds: [],
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

// Picked-file preview grid — copied verbatim from _filehub_desktop.tsx's local
// AdaptiveFileGrid (it was never exported). A picked folder collapses to one tile.
function AdaptiveFileGrid({
  files,
  onRemove,
  onAddMore,
}: {
  files: File[];
  onRemove: (indices: number[]) => void;
  onAddMore: () => void;
}) {
  const [containerWidth, setContainerWidth] = useState(496);
  const gap = 12;
  const minSquareSize = 100;
  let numCols = Math.floor((containerWidth + gap) / (minSquareSize + gap));
  if (numCols < 2) numCols = 2;
  const exactSquareSize = Math.floor((containerWidth - (gap * (numCols - 1))) / numCols);

  if (files.length === 0) return null;

  const entries = groupPickedFiles(files, f => (f as any).webkitRelativePath, f => f.size);

  return (
    <View
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      className="flex-row flex-wrap w-full bg-surface-card border border-surface-border rounded-2xl p-4"
      style={{ gap }}
    >
      {entries.map(entry => {
        if (entry.kind === 'folder') {
          return (
            <View
              key={`dir-${entry.name}`}
              style={{ width: exactSquareSize, height: exactSquareSize }}
              className="rounded-xl overflow-hidden border border-surface-border bg-surface-background relative"
            >
              <View className="flex-1 items-center justify-center p-2" style={{ backgroundColor: '#f59e0b12' }}>
                <FontAwesome name="folder-o" size={exactSquareSize > 100 ? 36 : 28} color="#f59e0b" />
                <View className="mt-3 bg-surface-background px-2 py-1 rounded-md border border-surface-border shadow-sm" style={{ maxWidth: '90%' }}>
                  <Text className="text-[10px] font-black text-typography-muted" numberOfLines={1}>
                    {entry.name}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => onRemove(entry.indices)}
                className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/50 rounded-full items-center justify-center hover:bg-black/70 transition-colors"
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
        const imageSource = isImage ? URL.createObjectURL(pf) : '';

        return (
          <View
            key={`${pf.name}-${idx}`}
            style={{ width: exactSquareSize, height: exactSquareSize }}
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
                <FontAwesome name={icon as any} size={exactSquareSize > 100 ? 36 : 28} color={color} />
                <View className="mt-3 bg-surface-background px-2 py-1 rounded-md border border-surface-border shadow-sm">
                  <Text className="text-[10px] font-black uppercase text-typography-muted" numberOfLines={1}>
                    {pf.name.split('.').pop() || 'FILE'}
                  </Text>
                </View>
              </View>
            )}
            <TouchableOpacity
              onPress={() => onRemove([idx])}
              className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/50 rounded-full items-center justify-center hover:bg-black/70 transition-colors"
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

      <TouchableOpacity
        onPress={onAddMore}
        style={{ width: exactSquareSize, height: exactSquareSize }}
        className="rounded-xl border-2 border-dashed border-surface-border bg-surface-background items-center justify-center hover:bg-surface-overlay transition-colors"
      >
        <FontAwesome name="plus" size={20} color="#94a3b8" />
        <Text className="text-typography-muted text-[10px] font-black mt-2 tracking-wide uppercase">Add More</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function UploadComposerModal({ visible, onClose, folderId }: UploadComposerModalProps) {
  const { profile, hasPermission } = useAuth();
  const { startUpload } = useUploadManager();
  const { showAlert } = useAlert();
  const colors = useThemeColors();
  const maxFileSizeBytes = useFileSizeLimit();
  const { height: winHeight } = useWindowDimensions();

  const fileInputRef = useRef<any>(null);
  const folderInputRef = useRef<any>(null);
  const [draft, setDraft] = useState<UploadDraft>(() => EMPTY_DRAFT(folderId ?? null));
  const [recipientSearch, setRecipientSearch] = useState('');
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [tagSuggestResults, setTagSuggestResults] = useState<string[]>([]);

  // Own copy of the folder tree — the context's fetchFolders, inlined. Cheap
  // one-shot select; the real destination sub-tree is get-or-created server-side
  // at commit regardless.
  const [folders, setFolders] = useState<FileHubFolder[]>([]);
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    supabase
      .from('filehub_folders')
      .select('id, name, parent_id, scope, group_id')
      .order('name')
      .then(({ data }) => { if (!cancelled) setFolders((data as FileHubFolder[]) || []); });
    return () => { cancelled = true; };
  }, [visible]);

  const patch = (updates: Partial<UploadDraft>) => setDraft(prev => ({ ...prev, ...updates }));

  const uploadScope: FileHubFolderScope = draft.visibility === 'broadcast' ? 'broadcast' : 'direct';
  const scopedFolders = useMemo(
    () => folders.filter(f => f.scope === uploadScope && (f.group_id ?? null) === null),
    [folders, uploadScope],
  );

  useEffect(() => {
    if (!visible) {
      setDraft(EMPTY_DRAFT(folderId ?? null));
      setRecipientSearch('');
      setMemberResults([]);
    } else {
      setDraft(prev => ({ ...prev, folderId: folderId ?? null }));
    }
  }, [visible, folderId]);

  const searchMembers = useCallback(async (query: string) => {
    setRecipientSearch(query);
    if (!query.trim()) { setMemberResults([]); return; }
    setSearchingMembers(true);
    try {
      const { data } = await supabase.from('users').select('id, full_name, avatar_url').ilike('full_name', `%${query}%`).limit(8);
      setMemberResults(data || []);
    } finally {
      setSearchingMembers(false);
    }
  }, []);

  const fetchTagSuggestions = useCallback(async (prefix: string) => {
    if (!prefix.trim()) { setTagSuggestResults([]); return; }
    const { data } = await supabase.rpc('rpc_filehub_tag_suggestions', { p_prefix: prefix, p_limit: 8 });
    setTagSuggestResults((data || []).filter((t: string) => !draft.tags.includes(t)));
  }, [draft.tags]);

  const toggleRecipient = (id: string) => {
    patch({ recipientIds: draft.recipientIds.includes(id) ? draft.recipientIds.filter(r => r !== id) : [...draft.recipientIds, id] });
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

  const processWebFiles = (fileList: FileList | null): File[] => {
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
  };

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

  const canBroadcast = hasPermission('filehub:broadcast');

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
      recipientIds: draft.recipientIds,
      groupId: null,
      tags: draft.tags,
      caption: draft.caption || null,
      maxFileSizeBytes: maxFileSizeBytes ?? null,
      scopedFolders,
      label: draft.visibility === 'broadcast' ? 'Broadcast' : 'Direct',
    });
    onClose();
  };

  const disabled = draft.files.length === 0 || (draft.visibility === 'direct' && draft.recipientIds.length === 0);

  return (
    <Popup
      visible={visible}
      onClose={onClose}
      presentation="centered"
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
        <View className="flex-row items-center justify-between px-8 pt-7 pb-5 border-b" style={{ borderColor: colors.border }}>
          <Text className="text-xl font-black tracking-tight" style={{ color: colors.textMain }}>Upload Files</Text>
          <TouchableOpacity onPress={onClose} className="w-8 h-8 items-center justify-center rounded-xl border" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
            <FontAwesome name="times" size={12} color={colors.textMuted} />
          </TouchableOpacity>
        </View>

        <View style={{ flexDirection: 'row', minHeight: 0 }}>
          {/* Left column: file staging */}
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, maxHeight: winHeight * 0.62 }} contentContainerStyle={{ padding: 28, gap: 20 }}>
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
                  <TouchableOpacity onPress={() => fileInputRef.current?.click()} className="flex-row items-center gap-2 px-5 py-2.5 rounded-xl" style={{ backgroundColor: colors.primary }}>
                    <FontAwesome name="files-o" size={12} color="#fff" />
                    <Text className="text-white font-black text-sm">Files</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => folderInputRef.current?.click()} className="flex-row items-center gap-2 border px-5 py-2.5 rounded-xl" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                    <FontAwesome name="folder-open-o" size={12} color={colors.textMuted} />
                    <Text className="font-black text-sm" style={{ color: colors.textMuted }}>Folder</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <AdaptiveFileGrid
                files={draft.files}
                onRemove={(indices) => {
                  const drop = new Set(indices);
                  patch({ files: draft.files.filter((_, i) => !drop.has(i)) });
                }}
                onAddMore={() => fileInputRef.current?.click()}
              />
            )}
          </ScrollView>

          <View style={{ width: 1, backgroundColor: colors.border }} />

          {/* Right column: destination + metadata */}
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1, maxHeight: winHeight * 0.62 }} contentContainerStyle={{ padding: 28, gap: 20 }}>
            <View className="gap-2">
              <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Visibility</Text>
              <View className="flex-row gap-2">
                {[
                  { value: 'direct', label: 'Direct Send', icon: 'user' },
                  ...(canBroadcast ? [{ value: 'broadcast', label: 'Broadcast', icon: 'bullhorn' }] : []),
                ].map(opt => (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => patch({ visibility: opt.value as any, recipientIds: [] })}
                    className="flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl border"
                    style={{
                      backgroundColor: draft.visibility === opt.value ? colors.primary + '1a' : colors.background,
                      borderColor: draft.visibility === opt.value ? colors.primary + '4d' : colors.border,
                    }}
                  >
                    <FontAwesome name={opt.icon as any} size={12} color={draft.visibility === opt.value ? colors.primary : colors.textMuted} />
                    <Text className="text-sm font-black" style={{ color: draft.visibility === opt.value ? colors.primary : colors.textMuted }}>{opt.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {draft.visibility === 'direct' && (
              <View className="gap-2">
                <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Recipients</Text>
                {draft.recipientIds.length > 0 && (
                  <View className="flex-row flex-wrap gap-2 mb-1">
                    {memberResults
                      .filter(m => draft.recipientIds.includes(m.id))
                      .map(m => (
                        <View key={m.id} className="flex-row items-center gap-1.5 border rounded-full px-3 py-1" style={{ backgroundColor: colors.primary + '1a', borderColor: colors.primary + '33' }}>
                          <Text className="text-xs font-bold" style={{ color: colors.primary }}>{m.full_name}</Text>
                          <TouchableOpacity onPress={() => toggleRecipient(m.id)}>
                            <FontAwesome name="times" size={9} color={colors.primary} />
                          </TouchableOpacity>
                        </View>
                      ))}
                  </View>
                )}
                <View className="flex-row items-center border rounded-xl px-4 py-2.5 gap-2" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                  <FontAwesome name="search" size={11} color={colors.textMuted} />
                  <TextInput
                    value={recipientSearch}
                    onChangeText={searchMembers}
                    placeholder="Search team members..."
                    placeholderTextColor={colors.textDim}
                    className="flex-1 text-sm bg-transparent"
                    style={{ color: colors.textMain }}
                  />
                  {searchingMembers && <ActivityIndicator size="small" color={colors.primary} />}
                </View>
                {memberResults.length > 0 && (
                  <View className="border rounded-xl overflow-hidden" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
                    {memberResults.map((m, i) => (
                      <TouchableOpacity
                        key={m.id}
                        onPress={() => toggleRecipient(m.id)}
                        className="flex-row items-center px-4 py-3 gap-3"
                        style={i < memberResults.length - 1 ? { borderBottomWidth: 1, borderColor: colors.border + '80' } : undefined}
                      >
                        <View className="w-7 h-7 rounded-full border items-center justify-center" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                          <FontAwesome name="user" size={11} color={colors.textMuted} />
                        </View>
                        <Text className="flex-1 text-sm font-medium" style={{ color: colors.textMain }}>{m.full_name}</Text>
                        {draft.recipientIds.includes(m.id) && <FontAwesome name="check" size={11} color={colors.primary} />}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}

            <View className="gap-2">
              <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Destination</Text>
              {draft.folderId && (
                <Text className="text-[11px] font-bold" style={{ color: colors.primary }}>
                  {folderPath(scopedFolders, draft.folderId)}
                </Text>
              )}
              <FolderTreePicker
                folders={scopedFolders}
                selectedId={draft.folderId}
                onSelect={(id) => patch({ folderId: id })}
                colors={colors}
              />
            </View>

            <View className="gap-2">
              <Text className="text-[10px] font-black uppercase tracking-widest" style={{ color: colors.textMuted }}>Tags</Text>
              {draft.tags.length > 0 && (
                <View className="flex-row flex-wrap gap-2">
                  {draft.tags.map(tag => (
                    <View key={tag} className="flex-row items-center gap-1.5 border rounded-full px-3 py-1" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
                      <Text className="text-xs font-bold" style={{ color: colors.textMuted }}>{tag}</Text>
                      <TouchableOpacity onPress={() => patch({ tags: draft.tags.filter(t => t !== tag) })}>
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
                    <TouchableOpacity key={t} onPress={() => addTag(t)} className="px-3 py-1 rounded-full border" style={{ backgroundColor: colors.primary + '0d', borderColor: colors.primary + '33' }}>
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
            </View>
          </ScrollView>
        </View>

        <View className="flex-row gap-3 px-8 py-5 border-t" style={{ borderColor: colors.border }}>
          <TouchableOpacity onPress={onClose} className="flex-1 items-center justify-center py-3.5 rounded-xl border" style={{ backgroundColor: colors.background, borderColor: colors.border }}>
            <Text className="font-black text-sm" style={{ color: colors.textMuted }}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleUpload}
            disabled={disabled}
            className="flex-[2] items-center justify-center py-3.5 rounded-xl"
            style={{ backgroundColor: colors.primary, opacity: disabled ? 0.5 : 1 }}
          >
            <Text className="text-white font-black text-sm">
              {draft.files.length > 1 ? `Upload ${draft.files.length} Files` : 'Upload File'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Popup>
  );
}
