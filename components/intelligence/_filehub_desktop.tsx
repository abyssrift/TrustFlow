import { useAuth } from '@/contexts/AuthContext';
import { FileActivity, FileHubFile, FileHubFolder, FileHubGroup, FileHubGroupMember, FileHubMode, FileHubProvider, useFileHub } from '@/contexts/FileHubContext';
import { openStorageFile } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function relativeDate(dateStr: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 7)}w ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

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

async function computeSHA256(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await (crypto as any).subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b: number) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getInitials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').slice(0, 2).join('');
}

const GROUP_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#06b6d4', '#f97316',
];

const TAG_PALETTE = [
  { bg: '#fef3c7', text: '#92400e', border: '#fde68a' },
  { bg: '#dcfce7', text: '#166534', border: '#bbf7d0' },
  { bg: '#dbeafe', text: '#1e40af', border: '#bfdbfe' },
  { bg: '#f3e8ff', text: '#6b21a8', border: '#e9d5ff' },
  { bg: '#ffe4e6', text: '#9f1239', border: '#fecdd3' },
  { bg: '#ccfbf1', text: '#134e4a', border: '#99f6e4' },
  { bg: '#ffedd5', text: '#7c2d12', border: '#fed7aa' },
  { bg: '#e0e7ff', text: '#3730a3', border: '#c7d2fe' },
];

function getTagColor(tag: string): { bg: string; text: string; border: string } {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = (hash * 31 + tag.charCodeAt(i)) >>> 0;
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

const ACTIVITY_META: Record<string, { icon: string; color: string; label: string }> = {
  upload:   { icon: 'upload',   color: '#10b981', label: 'Uploaded'   },
  download: { icon: 'download', color: '#3b82f6', label: 'Downloaded' },
  view:     { icon: 'eye',      color: '#8b5cf6', label: 'Viewed'     },
  delete:   { icon: 'trash-o',  color: '#ef4444', label: 'Deleted'    },
  share:    { icon: 'share',    color: '#f59e0b', label: 'Shared'     },
};

// ─── Upload Modal ─────────────────────────────────────────────────────────────

type UploadDraft = {
  file: File | null;
  visibility: 'direct' | 'broadcast' | 'group';
  recipientIds: string[];
  folderId: string | null;
  tags: string[];
  tagInput: string;
  caption: string;
};

const EMPTY_DRAFT = (defaultVisibility: 'direct' | 'group' = 'direct'): UploadDraft => ({
  file: null,
  visibility: defaultVisibility,
  recipientIds: [],
  folderId: null,
  tags: [],
  tagInput: '',
  caption: '',
});

function UploadModal({
  visible,
  folders,
  onClose,
  onUploaded,
  checkDuplicate,
  hasPermission,
  profile,
  activeGroup,
}: {
  visible: boolean;
  folders: FileHubFolder[];
  onClose: () => void;
  onUploaded: () => void;
  checkDuplicate: (hash: string) => Promise<any[]>;
  hasPermission: (key: string) => boolean;
  profile: any;
  activeGroup?: { id: string; name: string; avatar_color: string } | null;
}) {
  const fileInputRef = useRef<any>(null);
  const [draft, setDraft] = useState<UploadDraft>(EMPTY_DRAFT(activeGroup ? 'group' : 'direct'));
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [tagSuggestResults, setTagSuggestResults] = useState<string[]>([]);

  const patch = (updates: Partial<UploadDraft>) => setDraft(prev => ({ ...prev, ...updates }));

  useEffect(() => {
    if (!visible) {
      setDraft(EMPTY_DRAFT(activeGroup ? 'group' : 'direct'));
      setProgress(0);
      setRecipientSearch('');
      setMemberResults([]);
    } else if (activeGroup) {
      setDraft(prev => ({ ...prev, visibility: 'group' }));
    }
  }, [visible, activeGroup?.id]);

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

  const handlePickFile = () => {
    if (Platform.OS === 'web' && fileInputRef.current) fileInputRef.current.click();
  };

  const handleFileChange = (e: any) => {
    const file = e.target?.files?.[0];
    if (file) patch({ file });
  };

  const handleUpload = async () => {
    if (!draft.file || uploading) return;
    const companyId = profile?.company_id;
    if (!companyId) { Alert.alert('Error', 'Company not found.'); return; }
    if (draft.visibility === 'group' && !activeGroup?.id) {
      Alert.alert('Error', 'No group selected.'); return;
    }

    setUploading(true);
    setProgress(5);
    try {
      const contentHash = await computeSHA256(draft.file);
      setProgress(15);

      const dupes = await checkDuplicate(contentHash);
      if (dupes.length > 0) {
        const proceed = await new Promise<boolean>(resolve =>
          Alert.alert('Possible Duplicate', `"${dupes[0].original_name}" has the same content. Upload anyway?`, [
            { text: 'Cancel', onPress: () => resolve(false), style: 'cancel' },
            { text: 'Upload Anyway', onPress: () => resolve(true) },
          ])
        );
        if (!proceed) { setUploading(false); setProgress(0); return; }
      }

      const fileId = (crypto as any).randomUUID();
      const safeName = draft.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${companyId}/${fileId}/${safeName}`;
      setProgress(25);

      const { error: storageError } = await supabase.storage.from('filehub-files').upload(storagePath, draft.file);
      if (storageError) throw storageError;
      setProgress(80);

      const { error: rpcError } = await supabase.rpc('rpc_filehub_upload_commit', {
        p_storage_path: storagePath,
        p_visibility: draft.visibility,
        p_recipient_ids: draft.visibility === 'direct' ? draft.recipientIds : [],
        p_folder_id: draft.folderId,
        p_tags: draft.tags,
        p_caption: draft.caption || null,
        p_original_name: draft.file.name,
        p_mime_type: draft.file.type || null,
        p_size_bytes: draft.file.size,
        p_content_hash: contentHash,
        p_replaces_file_id: null,
        p_group_id: draft.visibility === 'group' ? (activeGroup?.id ?? null) : null,
      });
      if (rpcError) throw rpcError;
      setProgress(100);
      onUploaded();
      onClose();
    } catch (e: any) {
      Alert.alert('Upload Failed', e.message || 'Something went wrong.');
    } finally {
      setUploading(false);
      setProgress(0);
    }
  };

  const canBroadcast = hasPermission('filehub:broadcast');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/40 items-center justify-center p-8">
        <View className="bg-surface-card rounded-[2rem] border border-surface-border premium-shadow w-full max-w-[560px]" style={{ maxHeight: '100%' }}>
          <View className="flex-row items-center justify-between px-8 pt-7 pb-5 border-b border-surface-border">
            <Text className="text-typography-main text-xl font-black tracking-tight">
              {activeGroup ? `Upload to ${activeGroup.name}` : 'Upload File'}
            </Text>
            <TouchableOpacity onPress={onClose} className="w-8 h-8 items-center justify-center rounded-xl bg-surface-background border border-surface-border">
              <FontAwesome name="times" size={12} color="var(--color-text-muted)" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32, gap: 20 }}>
            {Platform.OS === 'web' && (
              <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleFileChange} />
            )}

            {/* File picker */}
            <TouchableOpacity
              onPress={handlePickFile}
              className="border-2 border-dashed border-surface-border rounded-2xl items-center justify-center py-8 px-4 gap-3"
              style={{ borderStyle: 'dashed' }}
            >
              {draft.file ? (
                <>
                  <View className="w-12 h-12 bg-brand-primary/10 rounded-2xl items-center justify-center">
                    <FontAwesome name={getMimeIcon(draft.file.type).icon as any} size={22} color="var(--color-primary)" />
                  </View>
                  <Text className="text-typography-main font-bold text-sm text-center" numberOfLines={2}>{draft.file.name}</Text>
                  <Text className="text-typography-muted text-xs">{formatFileSize(draft.file.size)}</Text>
                  <Text className="text-brand-primary text-xs font-bold">Click to change</Text>
                </>
              ) : (
                <>
                  <View className="w-12 h-12 bg-surface-background rounded-2xl border border-surface-border items-center justify-center">
                    <FontAwesome name="cloud-upload" size={22} color="var(--color-text-muted)" />
                  </View>
                  <Text className="text-typography-main font-bold text-sm">Choose a file</Text>
                  <Text className="text-typography-muted text-xs">Any file type up to 500 MB</Text>
                </>
              )}
            </TouchableOpacity>

            {/* Visibility — hidden when uploading to a group (locked to group) */}
            {!activeGroup ? (
              <View className="gap-2">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Visibility</Text>
                <View className="flex-row gap-2">
                  {[
                    { value: 'direct', label: 'Direct Send', icon: 'user' },
                    ...(canBroadcast ? [{ value: 'broadcast', label: 'Broadcast', icon: 'bullhorn' }] : []),
                  ].map(opt => (
                    <TouchableOpacity
                      key={opt.value}
                      onPress={() => patch({ visibility: opt.value as any, recipientIds: [] })}
                      className={`flex-1 flex-row items-center justify-center gap-2 py-3 rounded-xl border ${
                        draft.visibility === opt.value
                          ? 'bg-brand-primary/10 border-brand-primary/30'
                          : 'bg-surface-background border-surface-border'
                      }`}
                    >
                      <FontAwesome
                        name={opt.icon as any}
                        size={12}
                        color={draft.visibility === opt.value ? 'var(--color-primary)' : 'var(--color-text-muted)'}
                      />
                      <Text className={`text-sm font-black ${draft.visibility === opt.value ? 'text-brand-primary' : 'text-typography-muted'}`}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ) : (
              /* Group badge */
              <View className="flex-row items-center gap-3 bg-surface-background border border-surface-border rounded-xl px-4 py-3">
                <View
                  className="w-9 h-9 rounded-xl items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: activeGroup.avatar_color + '22' }}
                >
                  <Text style={{ color: activeGroup.avatar_color, fontSize: 13, fontWeight: '900' }}>
                    {getInitials(activeGroup.name)}
                  </Text>
                </View>
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Sharing to group</Text>
                  <Text className="text-typography-main font-bold text-sm">{activeGroup.name}</Text>
                </View>
                <View className="bg-brand-primary/10 border border-brand-primary/20 rounded-full px-2.5 py-1">
                  <Text className="text-brand-primary text-[10px] font-black">Group</Text>
                </View>
              </View>
            )}

            {/* Recipients */}
            {draft.visibility === 'direct' && (
              <View className="gap-2">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Recipients</Text>
                {draft.recipientIds.length > 0 && (
                  <View className="flex-row flex-wrap gap-2 mb-1">
                    {memberResults
                      .filter(m => draft.recipientIds.includes(m.id))
                      .map(m => (
                        <View key={m.id} className="flex-row items-center gap-1.5 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-3 py-1">
                          <Text className="text-brand-primary text-xs font-bold">{m.full_name}</Text>
                          <TouchableOpacity onPress={() => toggleRecipient(m.id)}>
                            <FontAwesome name="times" size={9} color="var(--color-primary)" />
                          </TouchableOpacity>
                        </View>
                      ))}
                  </View>
                )}
                <View className="flex-row items-center bg-surface-background border border-surface-border rounded-xl px-4 py-2.5 gap-2">
                  <FontAwesome name="search" size={11} color="var(--color-text-muted)" />
                  <TextInput
                    value={recipientSearch}
                    onChangeText={searchMembers}
                    placeholder="Search team members..."
                    placeholderTextColor="var(--color-text-dim)"
                    className="flex-1 text-typography-main text-sm outline-none bg-transparent"
                  />
                  {searchingMembers && <ActivityIndicator size="small" color="var(--color-primary)" />}
                </View>
                {memberResults.length > 0 && (
                  <View className="bg-surface-card border border-surface-border rounded-xl overflow-hidden">
                    {memberResults.map((m, i) => (
                      <TouchableOpacity
                        key={m.id}
                        onPress={() => toggleRecipient(m.id)}
                        className={`flex-row items-center px-4 py-3 gap-3 ${i < memberResults.length - 1 ? 'border-b border-surface-border/50' : ''}`}
                      >
                        <View className="w-7 h-7 rounded-full bg-surface-background border border-surface-border items-center justify-center">
                          <FontAwesome name="user" size={11} color="var(--color-text-muted)" />
                        </View>
                        <Text className="flex-1 text-typography-main text-sm font-medium">{m.full_name}</Text>
                        {draft.recipientIds.includes(m.id) && <FontAwesome name="check" size={11} color="var(--color-primary)" />}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Folder — hidden for group uploads when no folders exist in this group */}
            {(!activeGroup || folders.length > 0) && (
              <View className="gap-2">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Folder</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row', alignItems: 'center' }}>
                  <TouchableOpacity
                    onPress={() => patch({ folderId: null })}
                    className={`px-4 py-2 rounded-xl border ${!draft.folderId ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
                  >
                    <Text className={`text-xs font-bold ${!draft.folderId ? 'text-brand-primary' : 'text-typography-muted'}`}>No folder</Text>
                  </TouchableOpacity>
                  {folders.map(f => (
                    <TouchableOpacity
                      key={f.id}
                      onPress={() => patch({ folderId: f.id })}
                      className={`px-4 py-2 rounded-xl border ${draft.folderId === f.id ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
                    >
                      <Text className={`text-xs font-bold ${draft.folderId === f.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{f.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Tags */}
            <View className="gap-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Tags</Text>
              {draft.tags.length > 0 && (
                <View className="flex-row flex-wrap gap-2">
                  {draft.tags.map(tag => (
                    <View key={tag} className="flex-row items-center gap-1.5 bg-surface-background border border-surface-border rounded-full px-3 py-1">
                      <Text className="text-typography-muted text-xs font-bold">{tag}</Text>
                      <TouchableOpacity onPress={() => patch({ tags: draft.tags.filter(t => t !== tag) })}>
                        <FontAwesome name="times" size={9} color="var(--color-text-muted)" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}
              <View className="flex-row items-center bg-surface-background border border-surface-border rounded-xl px-4 py-2.5 gap-2">
                <FontAwesome name="tag" size={11} color="var(--color-text-muted)" />
                <TextInput
                  value={draft.tagInput}
                  onChangeText={v => { patch({ tagInput: v }); fetchTagSuggestions(v); }}
                  onKeyPress={handleTagKeyPress}
                  onSubmitEditing={() => addTag(draft.tagInput)}
                  placeholder="Add tag and press Enter..."
                  placeholderTextColor="var(--color-text-dim)"
                  className="flex-1 text-typography-main text-sm outline-none bg-transparent"
                />
              </View>
              {tagSuggestResults.length > 0 && (
                <View className="flex-row flex-wrap gap-2">
                  {tagSuggestResults.map(t => (
                    <TouchableOpacity key={t} onPress={() => addTag(t)} className="px-3 py-1 rounded-full bg-brand-primary/5 border border-brand-primary/20">
                      <Text className="text-brand-primary text-xs font-bold">{t}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Caption */}
            <View className="gap-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Caption</Text>
              <TextInput
                value={draft.caption}
                onChangeText={v => patch({ caption: v })}
                placeholder="Add a note or description..."
                placeholderTextColor="var(--color-text-dim)"
                multiline
                numberOfLines={3}
                className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main text-sm outline-none"
                style={{ minHeight: 80, textAlignVertical: 'top' }}
              />
            </View>

            {/* Progress */}
            {uploading && (
              <View className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 gap-2">
                <View className="flex-row items-center justify-between mb-1">
                  <Text className="text-typography-main text-xs font-bold">
                    {progress < 25 ? 'Computing hash…' : progress < 80 ? 'Uploading…' : 'Committing…'}
                  </Text>
                  <Text className="text-brand-primary text-xs font-black">{progress}%</Text>
                </View>
                <View className="h-1.5 bg-surface-border rounded-full overflow-hidden">
                  <View className="h-full bg-brand-primary rounded-full" style={{ width: `${progress}%` }} />
                </View>
              </View>
            )}

            {/* Actions */}
            <View className="flex-row gap-3 pt-2">
              <TouchableOpacity
                onPress={onClose}
                disabled={uploading}
                className="flex-1 items-center justify-center py-3.5 rounded-xl border border-surface-border bg-surface-background"
              >
                <Text className="text-typography-muted font-black text-sm">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleUpload}
                disabled={!draft.file || uploading || (draft.visibility === 'direct' && draft.recipientIds.length === 0)}
                className="flex-[2] items-center justify-center py-3.5 rounded-xl bg-brand-primary"
                style={{ opacity: (!draft.file || uploading || (draft.visibility === 'direct' && draft.recipientIds.length === 0)) ? 0.5 : 1 }}
              >
                {uploading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text className="text-white font-black text-sm">
                    {draft.visibility === 'group' ? 'Share to Group' : 'Upload File'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Group Create Modal ───────────────────────────────────────────────────────

function GroupCreateModal({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (groupId: string) => void;
}) {
  const { createGroup } = useFileHub();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedColor, setSelectedColor] = useState(GROUP_COLORS[0]);
  const [memberSearch, setMemberSearch] = useState('');
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!visible) {
      setName(''); setDescription(''); setSelectedColor(GROUP_COLORS[0]);
      setMemberSearch(''); setMemberResults([]); setSelectedMembers([]);
    }
  }, [visible]);

  const searchMembers = useCallback(async (query: string) => {
    setMemberSearch(query);
    if (!query.trim()) { setMemberResults([]); return; }
    const { data } = await supabase.from('users').select('id, full_name').ilike('full_name', `%${query}%`).limit(8);
    setMemberResults(data || []);
  }, []);

  const toggleMember = (m: any) =>
    setSelectedMembers(prev => prev.find(r => r.id === m.id) ? prev.filter(r => r.id !== m.id) : [...prev, m]);

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const id = await createGroup(name.trim(), description.trim() || null, selectedColor, selectedMembers.map(m => m.id));
      onCreated(id);
      onClose();
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/40 items-center justify-center p-8">
        <View className="bg-surface-card rounded-[2rem] border border-surface-border premium-shadow w-full max-w-[480px]">
          <View className="flex-row items-center justify-between px-8 pt-7 pb-5 border-b border-surface-border">
            <Text className="text-typography-main text-xl font-black">Create Group</Text>
            <TouchableOpacity onPress={onClose} className="w-8 h-8 items-center justify-center rounded-xl bg-surface-background border border-surface-border">
              <FontAwesome name="times" size={12} color="var(--color-text-muted)" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32, gap: 20 }}>
            {/* Avatar preview + color picker */}
            <View className="items-center gap-4">
              <View
                className="w-20 h-20 rounded-3xl items-center justify-center"
                style={{ backgroundColor: selectedColor + '22' }}
              >
                <Text style={{ color: selectedColor, fontSize: 28, fontWeight: '900' }}>
                  {name ? getInitials(name) : '?'}
                </Text>
              </View>
              <View className="flex-row gap-3">
                {GROUP_COLORS.map(c => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setSelectedColor(c)}
                    className="w-7 h-7 rounded-full items-center justify-center"
                    style={{ backgroundColor: c, borderWidth: selectedColor === c ? 3 : 0, borderColor: 'white', opacity: selectedColor === c ? 1 : 0.7 }}
                  />
                ))}
              </View>
            </View>

            {/* Name */}
            <View className="gap-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Group Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Design Team"
                placeholderTextColor="var(--color-text-dim)"
                maxLength={80}
                className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main text-sm font-bold outline-none"
              />
            </View>

            {/* Description */}
            <View className="gap-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Description (optional)</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="What's this group for?"
                placeholderTextColor="var(--color-text-dim)"
                multiline
                numberOfLines={2}
                maxLength={300}
                className="bg-surface-background border border-surface-border rounded-xl px-4 py-3 text-typography-main text-sm outline-none"
                style={{ minHeight: 70, textAlignVertical: 'top' }}
              />
            </View>

            {/* Members */}
            <View className="gap-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Invite Members</Text>
              {selectedMembers.length > 0 && (
                <View className="flex-row flex-wrap gap-2">
                  {selectedMembers.map(m => (
                    <TouchableOpacity
                      key={m.id}
                      onPress={() => toggleMember(m)}
                      className="flex-row items-center gap-1.5 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-3 py-1"
                    >
                      <Text className="text-brand-primary text-xs font-bold">{m.full_name}</Text>
                      <FontAwesome name="times" size={9} color="var(--color-primary)" />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View className="flex-row items-center bg-surface-background border border-surface-border rounded-xl px-4 py-2.5 gap-2">
                <FontAwesome name="search" size={11} color="var(--color-text-muted)" />
                <TextInput
                  value={memberSearch}
                  onChangeText={searchMembers}
                  placeholder="Search team members..."
                  placeholderTextColor="var(--color-text-dim)"
                  className="flex-1 text-typography-main text-sm outline-none bg-transparent"
                />
              </View>
              {memberResults.length > 0 && (
                <View className="bg-surface-background border border-surface-border rounded-xl overflow-hidden">
                  {memberResults.map((m, i) => (
                    <TouchableOpacity
                      key={m.id}
                      onPress={() => toggleMember(m)}
                      className={`flex-row items-center px-4 py-3 gap-3 ${i < memberResults.length - 1 ? 'border-b border-surface-border/50' : ''}`}
                    >
                      <Text className="flex-1 text-typography-main text-sm font-medium">{m.full_name}</Text>
                      {selectedMembers.find(r => r.id === m.id) && <FontAwesome name="check" size={11} color="var(--color-primary)" />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <View className="flex-row gap-3">
              <TouchableOpacity onPress={onClose} disabled={creating} className="flex-1 items-center justify-center py-3.5 rounded-xl border border-surface-border bg-surface-background">
                <Text className="text-typography-muted font-black text-sm">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCreate}
                disabled={!name.trim() || creating}
                className="flex-[2] items-center justify-center py-3.5 rounded-xl bg-brand-primary"
                style={{ opacity: !name.trim() || creating ? 0.5 : 1 }}
              >
                {creating ? <ActivityIndicator size="small" color="#fff" /> : <Text className="text-white font-black text-sm">Create Group</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Folder Panel ─────────────────────────────────────────────────────────────

function FolderPanel() {
  const { folders, selectedFolderId, setSelectedFolderId, createFolder, renameFolder, deleteFolder } = useFileHub();
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newFolderName.trim()) return;
    setCreating(true);
    await createFolder(newFolderName.trim());
    setNewFolderName('');
    setShowNewFolder(false);
    setCreating(false);
  };

  const startRename = (f: FileHubFolder) => { setRenamingId(f.id); setRenameValue(f.name); };

  const commitRename = async () => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return; }
    await renameFolder(renamingId, renameValue.trim());
    setRenamingId(null);
  };

  const handleDeleteFolder = (id: string, name: string) => {
    Alert.alert('Delete Folder', `Delete "${name}"? Files in this folder will stay but lose the folder label.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteFolder(id) },
    ]);
  };

  return (
    <View className="px-5 py-4 border-b border-surface-border">
      <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-3">Folders</Text>

      <TouchableOpacity
        onPress={() => setSelectedFolderId(null)}
        className={`flex-row items-center px-3 py-2 rounded-xl mb-1 ${!selectedFolderId ? 'bg-brand-primary/10' : 'hover:bg-surface-overlay'}`}
      >
        <FontAwesome name="folder-open-o" size={12} color={!selectedFolderId ? 'var(--color-primary)' : 'var(--color-text-muted)'} />
        <Text className={`ml-2.5 text-sm font-bold flex-1 ${!selectedFolderId ? 'text-brand-primary' : 'text-typography-main'}`}>All Files</Text>
      </TouchableOpacity>

      {folders.map(f => (
        <View key={f.id} className={`flex-row items-center px-3 py-2 rounded-xl mb-1 ${selectedFolderId === f.id ? 'bg-brand-primary/10' : 'hover:bg-surface-overlay'}`}>
          {renamingId === f.id ? (
            <TextInput
              value={renameValue}
              onChangeText={setRenameValue}
              onBlur={commitRename}
              onSubmitEditing={commitRename}
              autoFocus
              className="flex-1 text-typography-main text-sm font-bold outline-none bg-transparent"
            />
          ) : (
            <TouchableOpacity className="flex-1 flex-row items-center gap-2.5" onPress={() => setSelectedFolderId(f.id)}>
              <FontAwesome name="folder-o" size={12} color={selectedFolderId === f.id ? 'var(--color-primary)' : 'var(--color-text-muted)'} />
              <Text className={`text-sm font-bold flex-1 ${selectedFolderId === f.id ? 'text-brand-primary' : 'text-typography-main'}`} numberOfLines={1}>{f.name}</Text>
            </TouchableOpacity>
          )}
          <View className="flex-row gap-1 ml-1">
            <TouchableOpacity onPress={() => startRename(f)} className="w-6 h-6 items-center justify-center rounded-lg hover:bg-surface-overlay">
              <FontAwesome name="pencil" size={9} color="var(--color-text-muted)" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleDeleteFolder(f.id, f.name)} className="w-6 h-6 items-center justify-center rounded-lg hover:bg-surface-overlay">
              <FontAwesome name="trash-o" size={9} color="var(--color-text-muted)" />
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {showNewFolder ? (
        <View className="flex-row items-center gap-2 mt-1">
          <TextInput
            value={newFolderName}
            onChangeText={setNewFolderName}
            onSubmitEditing={handleCreate}
            onBlur={() => { if (!newFolderName.trim()) setShowNewFolder(false); }}
            placeholder="Folder name"
            placeholderTextColor="var(--color-text-dim)"
            autoFocus
            className="flex-1 text-typography-main text-sm border border-brand-primary/40 bg-brand-primary/5 rounded-xl px-3 py-1.5 outline-none"
          />
          <TouchableOpacity onPress={handleCreate} disabled={creating} className="px-3 py-1.5 bg-brand-primary rounded-xl">
            <Text className="text-white text-xs font-black">Add</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity
          onPress={() => setShowNewFolder(true)}
          className="flex-row items-center gap-2.5 px-3 py-2 rounded-xl hover:bg-surface-overlay mt-1"
        >
          <FontAwesome name="plus" size={10} color="var(--color-text-muted)" />
          <Text className="text-typography-muted text-sm">New folder</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─── File Row ─────────────────────────────────────────────────────────────────

function FileRow({
  file,
  selected,
  mode,
  onPress,
}: {
  file: FileHubFile;
  selected: boolean;
  mode: FileHubMode;
  onPress: () => void;
}) {
  const { icon, color } = getMimeIcon(file.mime_type);
  const isUnread = mode === 'inbox' && !file.recipient_state?.read_at;

  return (
    <TouchableOpacity
      onPress={onPress}
      className={`flex-row items-center px-6 py-4 border-b border-surface-border/40 transition-colors ${
        selected ? 'bg-brand-primary/5 border-l-2 border-l-brand-primary' : 'hover:bg-surface-overlay/60'
      }`}
    >
      <View className="w-9 h-9 rounded-xl bg-surface-background border border-surface-border items-center justify-center mr-3.5 flex-shrink-0">
        <FontAwesome name={icon as any} size={16} color={color} />
      </View>
      <View className="flex-1 min-w-0 mr-3">
        <View className="flex-row items-center gap-2 mb-0.5">
          {isUnread && <View className="w-2 h-2 rounded-full bg-brand-primary flex-shrink-0" />}
          <Text className="text-typography-main font-bold text-sm flex-1" numberOfLines={1}>{file.original_name}</Text>
        </View>
        <Text className="text-typography-muted text-[11px]" numberOfLines={1}>
          {file.uploader.full_name} · {formatFileSize(file.size_bytes)}
        </Text>
        {file.tags.length > 0 && (
          <View className="flex-row flex-wrap gap-1 mt-1">
            {file.tags.slice(0, 2).map(tag => {
              const c = getTagColor(tag);
              return (
                <View key={tag} style={{ backgroundColor: c.bg, borderColor: c.border, borderWidth: 1 }} className="px-1.5 py-0.5 rounded-full">
                  <Text style={{ color: c.text }} className="text-[9px] font-bold">{tag}</Text>
                </View>
              );
            })}
            {file.tags.length > 2 && (
              <View className="px-1.5 py-0.5 rounded-full bg-surface-background border border-surface-border">
                <Text className="text-[9px] font-bold text-typography-dim">+{file.tags.length - 2}</Text>
              </View>
            )}
          </View>
        )}
      </View>
      <Text className="text-typography-dim text-[11px] flex-shrink-0">{relativeDate(file.created_at)}</Text>
    </TouchableOpacity>
  );
}

// ─── Detail Panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  file,
  mode,
  currentUserId,
  onClose,
}: {
  file: FileHubFile | null;
  mode: FileHubMode;
  currentUserId: string | undefined;
  onClose: () => void;
}) {
  const { markRead, hideFile, deleteFile, logActivity, fileActivity } = useFileHub();
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [tab, setTab] = useState<'details' | 'activity'>('details');
  const [activity, setActivity] = useState<FileActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => { setTab('details'); setActivity([]); }, [file?.id]);
  useEffect(() => { if (file) logActivity(file.id, 'view'); }, [file?.id]);
  useEffect(() => {
    if (tab !== 'activity' || !file) return;
    setActivityLoading(true);
    fileActivity(file.id).then(setActivity).catch(console.error).finally(() => setActivityLoading(false));
  }, [tab, file?.id]);

  const handleDownload = async () => {
    if (!file) return;
    setDownloadLoading(true);
    try {
      logActivity(file.id, 'download');
      await openStorageFile(file.bucket || 'filehub-files', file.storage_path);
    } finally {
      setDownloadLoading(false);
    }
  };

  const handleDelete = () => {
    if (!file) return;
    Alert.alert('Delete File', `Delete "${file.original_name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteFile(file.id); onClose(); } },
    ]);
  };

  const handleHide = () => {
    if (!file) return;
    Alert.alert('Hide File', 'Remove this file from your inbox?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Hide', onPress: () => { hideFile(file.id); onClose(); } },
    ]);
  };

  if (!file) {
    return (
      <View className="flex-1 items-center justify-center px-8">
        <View className="w-16 h-16 bg-surface-background rounded-full border border-surface-border items-center justify-center mb-4">
          <FontAwesome name="file-o" size={24} color="var(--color-text-muted)" />
        </View>
        <Text className="text-typography-muted text-sm text-center font-medium">Select a file to view details</Text>
      </View>
    );
  }

  const { icon, color } = getMimeIcon(file.mime_type);
  const isUnread = mode === 'inbox' && !file.recipient_state?.read_at;
  const isOwner = file.uploaded_by === currentUserId;

  return (
    <View className="flex-1 flex-col" style={{ minHeight: 0 }}>
      {/* File header */}
      <View className="px-7 pt-6 pb-4 border-b border-surface-border/50 flex-shrink-0">
        <View className="bg-surface-background rounded-2xl border border-surface-border items-center justify-center py-8 mb-4">
          <FontAwesome name={icon as any} size={44} color={color} />
        </View>
        <Text className="text-typography-main text-base font-black tracking-tight mb-0.5 leading-snug" numberOfLines={2}>{file.original_name}</Text>
        <Text className="text-typography-muted text-xs">
          {formatFileSize(file.size_bytes)}{file.mime_type ? ` · ${file.mime_type.split('/').pop()?.toUpperCase()}` : ''}
        </Text>
        <View className="flex-row gap-2 mt-3">
          {(['details', 'activity'] as const).map(t => (
            <TouchableOpacity
              key={t}
              onPress={() => setTab(t)}
              className={`px-4 py-1.5 rounded-xl border ${tab === t ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
            >
              <Text className={`text-xs font-black capitalize ${tab === t ? 'text-brand-primary' : 'text-typography-muted'}`}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {tab === 'details' ? (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 28, paddingTop: 20 }}>
          <View className="mb-4 pb-4 border-b border-surface-border/50">
            <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2">Sent by</Text>
            <Text className="text-typography-main text-sm font-bold">{file.uploader.full_name}</Text>
            <Text className="text-typography-dim text-xs mt-0.5">{relativeDate(file.created_at)}</Text>
          </View>

          {mode === 'sent' && file.recipients && file.recipients.length > 0 && (
            <View className="mb-4 pb-4 border-b border-surface-border/50">
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2">
                Recipients ({file.recipient_count ?? file.recipients.length})
              </Text>
              {file.recipients.slice(0, 5).map(r => (
                <View key={r.id} className="flex-row items-center gap-2 mb-1.5">
                  <View className="w-6 h-6 rounded-full bg-surface-background border border-surface-border items-center justify-center">
                    <FontAwesome name="user" size={9} color="var(--color-text-muted)" />
                  </View>
                  <Text className="text-typography-main text-xs font-medium flex-1">{r.full_name}</Text>
                  {r.read_at && <FontAwesome name="check" size={9} color="var(--color-success, #38a169)" />}
                </View>
              ))}
              {(file.recipient_count ?? 0) > 5 && (
                <Text className="text-typography-muted text-xs mt-1">+{(file.recipient_count ?? 0) - 5} more</Text>
              )}
            </View>
          )}

          {mode === 'broadcast' && (
            <View className="mb-4 pb-4 border-b border-surface-border/50">
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1">Audience</Text>
              <Text className="text-typography-main text-sm font-bold">Entire Company</Text>
            </View>
          )}

          {file.folder && (
            <View className="mb-4 pb-4 border-b border-surface-border/50">
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1">Folder</Text>
              <View className="flex-row items-center gap-2">
                <FontAwesome name="folder" size={12} color="var(--color-text-muted)" />
                <Text className="text-typography-main text-sm font-bold">{file.folder.name}</Text>
              </View>
            </View>
          )}

          {file.caption && (
            <View className="mb-4 pb-4 border-b border-surface-border/50">
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2">Caption</Text>
              <Text className="text-typography-main text-sm leading-relaxed">{file.caption}</Text>
            </View>
          )}

          {file.tags.length > 0 && (
            <View className="mb-5 pb-4 border-b border-surface-border/50">
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2">Tags</Text>
              <View className="flex-row flex-wrap gap-2">
                {file.tags.map(tag => {
                  const c = getTagColor(tag);
                  return (
                    <View key={tag} style={{ backgroundColor: c.bg, borderColor: c.border, borderWidth: 1 }} className="px-3 py-1 rounded-full">
                      <Text style={{ color: c.text }} className="text-xs font-bold">{tag}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          <View className="gap-2.5">
            <TouchableOpacity
              onPress={handleDownload}
              disabled={downloadLoading}
              className="flex-row items-center justify-center bg-brand-primary rounded-xl px-4 py-3.5 gap-2"
            >
              {downloadLoading ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome name="download" size={13} color="#fff" />}
              <Text className="text-white font-black text-sm">Download</Text>
            </TouchableOpacity>

            {isUnread && (
              <TouchableOpacity
                onPress={() => markRead(file.id)}
                className="flex-row items-center justify-center bg-surface-card border border-surface-border rounded-xl px-4 py-3 gap-2"
              >
                <FontAwesome name="check" size={13} color="var(--color-primary)" />
                <Text className="text-brand-primary font-black text-sm">Mark as Read</Text>
              </TouchableOpacity>
            )}

            <View className="flex-row gap-2">
              {mode === 'inbox' && (
                <TouchableOpacity
                  onPress={handleHide}
                  className="flex-1 flex-row items-center justify-center bg-surface-background border border-surface-border rounded-xl px-3 py-2.5 gap-1.5"
                >
                  <FontAwesome name="eye-slash" size={11} color="var(--color-text-muted)" />
                  <Text className="text-typography-muted font-bold text-xs">Hide</Text>
                </TouchableOpacity>
              )}
              {isOwner && (
                <TouchableOpacity
                  onPress={handleDelete}
                  className="flex-1 flex-row items-center justify-center bg-state-danger/10 border border-state-danger/20 rounded-xl px-3 py-2.5 gap-1.5"
                >
                  <FontAwesome name="trash-o" size={11} color="var(--color-danger)" />
                  <Text className="text-state-danger font-bold text-xs">Delete</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </ScrollView>
      ) : (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 16 }}>
          {activityLoading ? (
            <View className="py-10 items-center">
              <ActivityIndicator color="var(--color-primary)" />
            </View>
          ) : activity.length === 0 ? (
            <View className="py-10 items-center px-8">
              <FontAwesome name="clock-o" size={24} color="var(--color-text-dim)" />
              <Text className="text-typography-muted text-sm mt-3 text-center">No activity recorded yet</Text>
            </View>
          ) : (
            activity.map((entry, i) => {
              const meta = ACTIVITY_META[entry.action] ?? { icon: 'circle', color: '#94a3b8', label: entry.action };
              return (
                <View key={entry.id} className={`flex-row items-start px-6 py-3 ${i < activity.length - 1 ? 'border-b border-surface-border/40' : ''}`}>
                  <View className="w-7 h-7 rounded-full items-center justify-center mr-3 flex-shrink-0 mt-0.5" style={{ backgroundColor: meta.color + '20' }}>
                    <FontAwesome name={meta.icon as any} size={11} color={meta.color} />
                  </View>
                  <View className="flex-1 min-w-0">
                    <Text className="text-typography-main text-xs font-bold">
                      {entry.user.full_name}{' '}
                      <Text className="text-typography-muted font-medium">{meta.label.toLowerCase()}</Text>
                    </Text>
                    <Text className="text-typography-dim text-[10px] mt-0.5">{relativeDate(entry.created_at)}</Text>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </View>
  );
}

// ─── Group Members Panel (right panel in groups mode) ─────────────────────────

function GroupMembersPanel({
  group,
  currentUserId,
  onGroupChanged,
}: {
  group: FileHubGroup;
  currentUserId: string | undefined;
  onGroupChanged: () => void;
}) {
  const { addGroupMember, removeGroupMember, fetchGroupMembers } = useFileHub();
  const [members, setMembers] = useState<FileHubGroupMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState<any[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    fetchGroupMembers(group.id).then(setMembers).catch(console.error).finally(() => setLoadingMembers(false));
  }, [group.id, fetchGroupMembers]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const searchAdd = useCallback(async (query: string) => {
    setAddSearch(query);
    if (!query.trim()) { setAddResults([]); return; }
    const { data } = await supabase.from('users').select('id, full_name').ilike('full_name', `%${query}%`).limit(6);
    setAddResults((data || []).filter((u: any) => !members.find(m => m.id === u.id)));
  }, [members]);

  const handleAdd = async (userId: string) => {
    setAddingId(userId);
    try {
      await addGroupMember(group.id, userId);
      await loadMembers();
      setAddSearch(''); setAddResults([]);
      onGroupChanged();
    } catch {
    } finally {
      setAddingId(null);
    }
  };

  const handleRemove = async (userId: string) => {
    const target = members.find(m => m.id === userId);
    const isSelf = userId === currentUserId;
    Alert.alert(
      isSelf ? 'Leave Group' : `Remove ${target?.full_name ?? 'member'}`,
      isSelf ? 'Leave this group?' : `Remove ${target?.full_name} from the group?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isSelf ? 'Leave' : 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemovingId(userId);
            try {
              await removeGroupMember(group.id, userId);
              await loadMembers();
              onGroupChanged();
            } catch {
            } finally {
              setRemovingId(null);
            }
          },
        },
      ]
    );
  };

  const myRole = members.find(m => m.id === currentUserId)?.role;

  return (
    <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 24 }}>
      {/* Group header */}
      <View className="items-center mb-6">
        <View
          className="w-16 h-16 rounded-3xl items-center justify-center mb-3"
          style={{ backgroundColor: group.avatar_color + '22' }}
        >
          <Text style={{ color: group.avatar_color, fontSize: 22, fontWeight: '900' }}>{getInitials(group.name)}</Text>
        </View>
        <Text className="text-typography-main text-lg font-black text-center">{group.name}</Text>
        {group.description && (
          <Text className="text-typography-muted text-xs text-center mt-1 leading-relaxed">{group.description}</Text>
        )}
        <View className="flex-row items-center gap-4 mt-3">
          <View className="flex-row items-center gap-1.5">
            <FontAwesome name="users" size={11} color="var(--color-text-muted)" />
            <Text className="text-typography-dim text-xs">{group.member_count} members</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <FontAwesome name="files-o" size={11} color="var(--color-text-muted)" />
            <Text className="text-typography-dim text-xs">{group.file_count} files</Text>
          </View>
        </View>
      </View>

      {/* Add member */}
      <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-3">Add Member</Text>
      <View className="flex-row items-center bg-surface-background border border-surface-border rounded-xl px-4 py-2.5 gap-2 mb-2">
        <FontAwesome name="user-plus" size={11} color="var(--color-text-muted)" />
        <TextInput
          value={addSearch}
          onChangeText={searchAdd}
          placeholder="Search to invite..."
          placeholderTextColor="var(--color-text-dim)"
          className="flex-1 text-typography-main text-sm outline-none bg-transparent"
        />
      </View>
      {addResults.length > 0 && (
        <View className="bg-surface-background border border-surface-border rounded-xl overflow-hidden mb-4">
          {addResults.map((m, i) => (
            <TouchableOpacity
              key={m.id}
              onPress={() => handleAdd(m.id)}
              disabled={addingId === m.id}
              className={`flex-row items-center px-4 py-3 gap-3 ${i < addResults.length - 1 ? 'border-b border-surface-border/50' : ''}`}
            >
              <Text className="flex-1 text-typography-main text-sm">{m.full_name}</Text>
              {addingId === m.id ? <ActivityIndicator size="small" color="var(--color-primary)" /> : <FontAwesome name="plus" size={11} color="var(--color-primary)" />}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Members list */}
      <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-3">Members ({members.length})</Text>
      {loadingMembers ? (
        <ActivityIndicator size="small" color="var(--color-primary)" />
      ) : (
        <View className="bg-surface-background border border-surface-border rounded-xl overflow-hidden">
          {members.map((m, i) => (
            <View
              key={m.id}
              className={`flex-row items-center px-4 py-3 gap-3 ${i < members.length - 1 ? 'border-b border-surface-border/50' : ''}`}
            >
              <View className="w-8 h-8 rounded-full bg-brand-primary/10 border border-brand-primary/20 items-center justify-center flex-shrink-0">
                <Text className="text-brand-primary text-[10px] font-black">{getInitials(m.full_name)}</Text>
              </View>
              <Text className="flex-1 text-typography-main text-sm font-medium">{m.full_name}</Text>
              {m.role === 'admin' && (
                <View className="bg-brand-primary/10 border border-brand-primary/20 rounded-full px-2 py-0.5 mr-1">
                  <Text className="text-brand-primary text-[9px] font-black">Admin</Text>
                </View>
              )}
              {(myRole === 'admin' || m.id === currentUserId) && (
                <TouchableOpacity
                  onPress={() => handleRemove(m.id)}
                  disabled={removingId === m.id}
                  className="w-7 h-7 items-center justify-center rounded-lg bg-state-danger/10"
                >
                  {removingId === m.id ? (
                    <ActivityIndicator size="small" color="var(--color-danger)" />
                  ) : (
                    <FontAwesome name={m.id === currentUserId ? 'sign-out' : 'user-times'} size={11} color="var(--color-danger)" />
                  )}
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Tags Manage Modal ────────────────────────────────────────────────────────

function TagsManageModal({ visible, onClose, onChanged }: {
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { allTagsWithCounts, renameTag, deleteTag } = useFileHub();
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [savingTag, setSavingTag] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    allTagsWithCounts().then(setTags).catch(console.error).finally(() => setLoading(false));
  }, [allTagsWithCounts]);

  useEffect(() => {
    if (visible) load();
    else { setTags([]); setRenamingTag(null); }
  }, [visible, load]);

  const handleRenameSave = async (oldTag: string) => {
    const trimmed = renameInput.trim();
    if (!trimmed || trimmed === oldTag) { setRenamingTag(null); return; }
    setSavingTag(oldTag);
    try {
      await renameTag(oldTag, trimmed);
      await load();
      onChanged();
    } catch { /* alerted in context */ } finally {
      setSavingTag(null);
      setRenamingTag(null);
    }
  };

  const handleDelete = (tag: string) => {
    Alert.alert('Delete Tag', `Remove tag "${tag}" from all files?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        try { await deleteTag(tag); await load(); onChanged(); } catch { /* alerted */ }
      }},
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/50 items-center justify-center p-6">
        <View className="bg-surface-card rounded-2xl border border-surface-border w-full max-w-md" style={{ maxHeight: '70%' }}>
          <View className="flex-row items-center justify-between px-6 py-4 border-b border-surface-border">
            <View className="flex-row items-center gap-2">
              <FontAwesome name="tags" size={14} color="var(--color-primary)" />
              <Text className="text-typography-main font-black text-lg">Manage Tags</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="w-8 h-8 items-center justify-center">
              <FontAwesome name="times" size={16} color="var(--color-text-muted)" />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View className="py-10 items-center"><ActivityIndicator color="var(--color-primary)" /></View>
          ) : tags.length === 0 ? (
            <View className="py-10 items-center">
              <FontAwesome name="tags" size={24} color="var(--color-text-dim)" />
              <Text className="text-typography-muted text-sm mt-3">No tags yet</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {tags.map(({ tag, count }) => {
                const c = getTagColor(tag);
                const isRenaming = renamingTag === tag;
                return (
                  <View key={tag} className="flex-row items-center px-5 py-3.5 border-b border-surface-border/50">
                    <View style={{ backgroundColor: c.bg, borderColor: c.border, borderWidth: 1 }} className="px-2.5 py-1 rounded-full mr-3 flex-shrink-0">
                      <Text style={{ color: c.text }} className="text-xs font-bold">{tag}</Text>
                    </View>

                    {isRenaming ? (
                      <TextInput
                        value={renameInput}
                        onChangeText={setRenameInput}
                        autoFocus
                        className="flex-1 bg-surface-background border border-brand-primary/50 rounded-lg px-2 py-1 text-sm text-typography-main mr-2"
                        onSubmitEditing={() => handleRenameSave(tag)}
                      />
                    ) : (
                      <Text className="flex-1 text-typography-muted text-xs">{count} file{count !== 1 ? 's' : ''}</Text>
                    )}

                    {isRenaming ? (
                      <View className="flex-row gap-2">
                        <TouchableOpacity
                          onPress={() => handleRenameSave(tag)}
                          disabled={!!savingTag}
                          className="w-8 h-8 bg-brand-primary/10 border border-brand-primary/20 rounded-lg items-center justify-center"
                        >
                          {savingTag === tag ? <ActivityIndicator size="small" color="var(--color-primary)" /> : <FontAwesome name="check" size={12} color="var(--color-primary)" />}
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setRenamingTag(null)}
                          className="w-8 h-8 bg-surface-background border border-surface-border rounded-lg items-center justify-center"
                        >
                          <FontAwesome name="times" size={12} color="var(--color-text-muted)" />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View className="flex-row gap-2">
                        <TouchableOpacity
                          onPress={() => { setRenamingTag(tag); setRenameInput(tag); }}
                          className="w-8 h-8 bg-surface-background border border-surface-border rounded-lg items-center justify-center"
                        >
                          <FontAwesome name="pencil" size={12} color="var(--color-text-muted)" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDelete(tag)}
                          className="w-8 h-8 bg-state-danger/10 border border-state-danger/20 rounded-lg items-center justify-center"
                        >
                          <FontAwesome name="trash-o" size={12} color="var(--color-danger)" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
              <View style={{ height: 12 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Desktop Component ───────────────────────────────────────────────────

function FileHubDesktopInner() {
  const { hasPermission, user, profile } = useAuth();
  const {
    mode, setMode,
    search, setSearch,
    selectedTag, setSelectedTag,
    files, folders, loading,
    refresh,
    checkDuplicate,
    groups, groupsLoading,
    activeGroupId, setActiveGroupId,
    groupFiles, groupFilesLoading,
    refreshGroups, refreshGroupFiles,
  } = useFileHub();

  const [selectedFile, setSelectedFile] = useState<FileHubFile | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showManageTags, setShowManageTags] = useState(false);

  const activeGroup = useMemo(() => groups.find(g => g.id === activeGroupId) ?? null, [groups, activeGroupId]);
  const displayFiles = mode === 'groups' && activeGroupId ? groupFiles : files;

  const uploadFolders = useMemo(() => {
    if (!activeGroupId) return folders;
    const usedFolderIds = new Set(groupFiles.map(f => f.folder_id).filter(Boolean));
    return folders.filter(f => usedFolderIds.has(f.id));
  }, [folders, activeGroupId, groupFiles]);
  const displayLoading = mode === 'groups' && activeGroupId ? groupFilesLoading : loading;

  const allTags = useMemo(() => {
    const set = new Set<string>();
    displayFiles.forEach(f => f.tags.forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [displayFiles]);

  const unreadCount = useMemo(() => {
    if (mode !== 'inbox') return 0;
    return files.filter(f => !f.recipient_state?.read_at).length;
  }, [files, mode]);
  const canBroadcast = hasPermission('filehub:broadcast');

  useEffect(() => {
    if (!selectedFile) return;
    const updated = displayFiles.find(f => f.id === selectedFile.id);
    setSelectedFile(updated ?? null);
  }, [displayFiles]);

  const tabs: { key: FileHubMode; label: string; count?: number }[] = [
    { key: 'inbox', label: 'Inbox', count: mode === 'inbox' && unreadCount > 0 ? unreadCount : undefined },
    { key: 'sent', label: 'Sent' },
    ...(canBroadcast ? [{ key: 'broadcast' as FileHubMode, label: 'Broadcast' }] : []),
    { key: 'groups', label: 'Groups' },
  ];

  const handleTabChange = (key: FileHubMode) => {
    setMode(key);
    setActiveGroupId(null);
    setSelectedFile(null);
  };

  const handleRefresh = () => {
    if (mode === 'groups') { refreshGroups(); if (activeGroupId) refreshGroupFiles(); }
    else refresh();
  };

  return (
    <View className="flex-1 bg-surface-background flex-col">
      {/* ── Header ── */}
      <View className="px-10 pt-8 pb-5 flex-row flex-wrap items-start justify-between gap-4 border-b border-surface-border flex-shrink-0">
        <View className="min-w-0">
          <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[9px] mb-1">Intelligence Hub</Text>
          <Text className="text-typography-main text-4xl font-black tracking-tighter">File Hub</Text>
        </View>
        <View className="flex-row items-center gap-3 flex-wrap justify-end">
          <View className="flex-row items-center bg-surface-card border border-surface-border rounded-xl px-4 py-2.5 gap-3 w-full max-w-[320px] min-w-[200px]">
            <FontAwesome name="search" size={12} color="var(--color-text-muted)" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder={mode === 'groups' && activeGroupId ? 'Search group files...' : 'Search files...'}
              placeholderTextColor="var(--color-text-dim)"
              className="flex-1 text-typography-main text-sm font-medium outline-none bg-transparent"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')}>
                <FontAwesome name="times-circle" size={12} color="var(--color-text-muted)" />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            onPress={handleRefresh}
            className="h-10 w-10 items-center justify-center bg-surface-card border border-surface-border rounded-xl shrink-0"
          >
            <FontAwesome name="refresh" size={13} color="var(--color-primary)" />
          </TouchableOpacity>
          {/* Upload button — show if not on groups list (no activeGroupId in groups mode) */}
          {(mode !== 'groups' || activeGroupId) && (
            <TouchableOpacity
              onPress={() => setShowUpload(true)}
              className="flex-row items-center gap-2 bg-brand-primary px-5 py-2.5 rounded-xl shrink-0"
            >
              <FontAwesome name="upload" size={12} color="#fff" />
              <Text className="text-white font-black text-sm tracking-wide">
                {mode === 'groups' && activeGroupId ? 'Upload to Group' : 'Upload File'}
              </Text>
            </TouchableOpacity>
          )}
          {mode === 'groups' && !activeGroupId && (
            <TouchableOpacity
              onPress={() => setShowCreateGroup(true)}
              className="flex-row items-center gap-2 bg-brand-primary px-5 py-2.5 rounded-xl shrink-0"
            >
              <FontAwesome name="plus" size={12} color="#fff" />
              <Text className="text-white font-black text-sm tracking-wide">New Group</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Tabs ── */}
      <View className="px-10 pt-4 pb-3 flex-row items-center gap-2 flex-shrink-0 border-b border-surface-border">
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => handleTabChange(tab.key)}
            className={`flex-row items-center gap-2 px-5 py-2 rounded-xl border transition-colors ${
              mode === tab.key
                ? 'bg-brand-primary/10 border-brand-primary/30'
                : 'bg-surface-card border-surface-border hover:bg-surface-overlay'
            }`}
          >
            <Text className={`text-sm font-black ${mode === tab.key ? 'text-brand-primary' : 'text-typography-muted'}`}>
              {tab.label}
            </Text>
            {tab.count !== undefined && (
              <View className="bg-brand-primary rounded-full px-2 py-0.5 min-w-[20px] items-center">
                <Text className="text-white text-[9px] font-black">{tab.count}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Two-column body ── */}
      <View className="flex-1 flex-row" style={{ minHeight: 0 }}>

        {/* ══ LEFT COLUMN ══ */}
        <View style={{ flex: 0.62 }} className="border-r border-surface-border flex-col">

          {/* Groups list mode */}
          {mode === 'groups' && !activeGroupId && (
            <>
              {groupsLoading ? (
                <View className="flex-1 items-center justify-center">
                  <ActivityIndicator size="large" color="var(--color-primary)" />
                </View>
              ) : groups.length === 0 ? (
                <View className="flex-1 items-center justify-center px-8">
                  <View className="bg-surface-card p-10 rounded-[2.5rem] border border-surface-border items-center w-full max-w-sm premium-shadow">
                    <View className="w-14 h-14 bg-brand-primary/10 rounded-full border border-brand-primary/20 items-center justify-center mb-4">
                      <FontAwesome name="users" size={24} color="var(--color-primary)" />
                    </View>
                    <Text className="text-typography-main text-xl font-black mb-2 text-center">No Groups Yet</Text>
                    <Text className="text-typography-muted text-sm text-center leading-relaxed mb-6">
                      Create a shared group space where team members can upload and access files together.
                    </Text>
                    <TouchableOpacity
                      onPress={() => setShowCreateGroup(true)}
                      className="bg-brand-primary px-6 py-3 rounded-xl flex-row items-center gap-2"
                    >
                      <FontAwesome name="plus" size={12} color="#fff" />
                      <Text className="text-white font-black text-sm">Create First Group</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20 }}>
                  {groups.map(g => (
                    <TouchableOpacity
                      key={g.id}
                      onPress={() => { setActiveGroupId(g.id); setSelectedFile(null); }}
                      className="flex-row items-center gap-4 bg-surface-card border border-surface-border rounded-2xl px-5 py-4 mb-3 hover:bg-surface-overlay transition-colors"
                    >
                      <View
                        className="w-12 h-12 rounded-2xl items-center justify-center flex-shrink-0"
                        style={{ backgroundColor: g.avatar_color + '22' }}
                      >
                        <Text style={{ color: g.avatar_color, fontSize: 16, fontWeight: '900' }}>{getInitials(g.name)}</Text>
                      </View>
                      <View className="flex-1 min-w-0">
                        <Text className="text-typography-main font-black text-base mb-0.5" numberOfLines={1}>{g.name}</Text>
                        {g.description && (
                          <Text className="text-typography-muted text-xs mb-1" numberOfLines={1}>{g.description}</Text>
                        )}
                        <View className="flex-row items-center gap-4">
                          <View className="flex-row items-center gap-1.5">
                            <FontAwesome name="users" size={10} color="var(--color-text-muted)" />
                            <Text className="text-typography-dim text-xs">{g.member_count} members</Text>
                          </View>
                          <View className="flex-row items-center gap-1.5">
                            <FontAwesome name="files-o" size={10} color="var(--color-text-muted)" />
                            <Text className="text-typography-dim text-xs">{g.file_count} files</Text>
                          </View>
                        </View>
                      </View>
                      <View className="items-end gap-1">
                        {g.last_activity && <Text className="text-typography-dim text-xs">{relativeDate(g.last_activity)}</Text>}
                        <FontAwesome name="chevron-right" size={10} color="var(--color-text-dim)" />
                      </View>
                    </TouchableOpacity>
                  ))}
                  <View style={{ height: 20 }} />
                </ScrollView>
              )}
            </>
          )}

          {/* Groups — drill-down into a specific group */}
          {mode === 'groups' && activeGroupId && (
            <>
              {/* Group sub-header */}
              <View className="px-5 py-3 border-b border-surface-border flex-row items-center gap-3 flex-shrink-0">
                <TouchableOpacity
                  onPress={() => { setActiveGroupId(null); setSelectedFile(null); }}
                  className="w-8 h-8 bg-surface-background border border-surface-border rounded-lg items-center justify-center flex-shrink-0"
                >
                  <FontAwesome name="arrow-left" size={12} color="var(--color-text-main)" />
                </TouchableOpacity>
                {activeGroup && (
                  <View
                    className="w-9 h-9 rounded-xl items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: activeGroup.avatar_color + '22' }}
                  >
                    <Text style={{ color: activeGroup.avatar_color, fontSize: 13, fontWeight: '900' }}>{getInitials(activeGroup.name)}</Text>
                  </View>
                )}
                <View className="flex-1 min-w-0">
                  <Text className="text-typography-main font-black text-sm" numberOfLines={1}>{activeGroup?.name}</Text>
                  <Text className="text-typography-dim text-[11px]">{activeGroup?.member_count} members · {activeGroup?.file_count} files</Text>
                </View>
              </View>

              {/* Tag filter */}
              {allTags.length > 0 && (
                <View className="flex-row items-center border-b border-surface-border flex-shrink-0">
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 10, gap: 8, flexDirection: 'row', alignItems: 'center' }}
                  >
                    {allTags.map(tag => {
                      const c = getTagColor(tag);
                      const isSelected = selectedTag === tag;
                      return (
                        <TouchableOpacity
                          key={tag}
                          onPress={() => setSelectedTag(isSelected ? null : tag)}
                          style={isSelected ? undefined : { backgroundColor: c.bg, borderColor: c.border }}
                          className={`px-3 py-1 rounded-full border flex-shrink-0 ${isSelected ? 'bg-brand-primary/10 border-brand-primary/30' : ''}`}
                        >
                          <Text style={isSelected ? undefined : { color: c.text }} className={`text-[11px] font-bold ${isSelected ? 'text-brand-primary' : ''}`}>{tag}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  <TouchableOpacity
                    onPress={() => setShowManageTags(true)}
                    className="px-3 py-2.5 border-l border-surface-border flex-shrink-0"
                  >
                    <FontAwesome name="tags" size={13} color="var(--color-text-muted)" />
                  </TouchableOpacity>
                </View>
              )}

              {/* Group file list */}
              {displayLoading ? (
                <View className="flex-1 items-center justify-center"><ActivityIndicator size="large" color="var(--color-primary)" /></View>
              ) : displayFiles.length === 0 ? (
                <View className="flex-1 items-center justify-center px-8">
                  <View className="bg-surface-card p-10 rounded-[2.5rem] border border-surface-border items-center w-full max-w-sm premium-shadow">
                    <FontAwesome name="files-o" size={24} color="var(--color-text-muted)" />
                    <Text className="text-typography-main text-xl font-black mt-4 mb-2 text-center">
                      {search ? 'No Results' : 'No Files Yet'}
                    </Text>
                    <Text className="text-typography-muted text-sm text-center leading-relaxed">
                      {search ? `No files match "${search}".` : 'Upload the first file to this group.'}
                    </Text>
                  </View>
                </View>
              ) : (
                <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
                  <View className="flex-row items-center px-6 py-3 bg-surface-background/60 border-b border-surface-border/60">
                    <View className="w-9 mr-3.5" />
                    <Text className="flex-1 text-typography-muted text-[9px] font-black uppercase tracking-widest">File</Text>
                    <Text className="w-20 text-right text-typography-muted text-[9px] font-black uppercase tracking-widest">Date</Text>
                  </View>
                  {displayFiles.map(file => (
                    <FileRow
                      key={file.id}
                      file={file}
                      selected={selectedFile?.id === file.id}
                      mode="groups"
                      onPress={() => setSelectedFile(prev => prev?.id === file.id ? null : file)}
                    />
                  ))}
                  <View style={{ height: 40 }} />
                </ScrollView>
              )}
            </>
          )}

          {/* Inbox / Sent / Broadcast */}
          {mode !== 'groups' && (
            <>
              <FolderPanel />

              {allTags.length > 0 && (
                <View className="flex-row items-center border-b border-surface-border flex-shrink-0">
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ flex: 1 }}
                    contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 10, gap: 8, flexDirection: 'row', alignItems: 'center' }}
                  >
                    {allTags.map(tag => {
                      const c = getTagColor(tag);
                      const isSelected = selectedTag === tag;
                      return (
                        <TouchableOpacity
                          key={tag}
                          onPress={() => setSelectedTag(isSelected ? null : tag)}
                          style={isSelected ? undefined : { backgroundColor: c.bg, borderColor: c.border }}
                          className={`px-3 py-1 rounded-full border flex-shrink-0 ${isSelected ? 'bg-brand-primary/10 border-brand-primary/30' : ''}`}
                        >
                          <Text style={isSelected ? undefined : { color: c.text }} className={`text-[11px] font-bold ${isSelected ? 'text-brand-primary' : ''}`}>{tag}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                  <TouchableOpacity
                    onPress={() => setShowManageTags(true)}
                    className="px-3 py-2.5 border-l border-surface-border flex-shrink-0"
                  >
                    <FontAwesome name="tags" size={13} color="var(--color-text-muted)" />
                  </TouchableOpacity>
                </View>
              )}

              {displayLoading ? (
                <View className="flex-1 items-center justify-center"><ActivityIndicator size="large" color="var(--color-primary)" /></View>
              ) : displayFiles.length === 0 ? (
                <View className="flex-1 items-center justify-center px-8">
                  <View className="bg-surface-card p-10 rounded-[2.5rem] border border-surface-border items-center w-full max-w-sm premium-shadow">
                    <View className="w-14 h-14 bg-surface-background rounded-full border border-surface-border items-center justify-center mb-4">
                      <FontAwesome name="inbox" size={24} color="var(--color-text-muted)" />
                    </View>
                    <Text className="text-typography-main text-xl font-black mb-2 text-center">
                      {search ? 'No Results' : mode === 'inbox' ? 'Inbox Empty' : mode === 'sent' ? 'Nothing Sent' : 'No Broadcasts'}
                    </Text>
                    <Text className="text-typography-muted text-sm text-center leading-relaxed">
                      {search ? `No files match "${search}".` : mode === 'inbox' ? 'Files sent directly to you will appear here.' : mode === 'sent' ? 'Files you send to others will appear here.' : 'Company-wide broadcasts will appear here.'}
                    </Text>
                  </View>
                </View>
              ) : (
                <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
                  <View className="flex-row items-center px-6 py-3 bg-surface-background/60 border-b border-surface-border/60">
                    <View className="w-9 mr-3.5" />
                    <Text className="flex-1 text-typography-muted text-[9px] font-black uppercase tracking-widest">File</Text>
                    <Text className="w-20 text-right text-typography-muted text-[9px] font-black uppercase tracking-widest">Date</Text>
                  </View>
                  {displayFiles.map(file => (
                    <FileRow
                      key={file.id}
                      file={file}
                      selected={selectedFile?.id === file.id}
                      mode={mode}
                      onPress={() => setSelectedFile(prev => prev?.id === file.id ? null : file)}
                    />
                  ))}
                  <View style={{ height: 40 }} />
                </ScrollView>
              )}
            </>
          )}
        </View>

        {/* ══ RIGHT COLUMN ══ */}
        <View style={{ flex: 0.38 }} className="flex-col border-l border-surface-border">
          {/* Groups list → empty state */}
          {mode === 'groups' && !activeGroupId && (
            <View className="flex-1 items-center justify-center px-6">
              <View className="w-14 h-14 bg-surface-background rounded-full border border-surface-border items-center justify-center mb-4">
                <FontAwesome name="users" size={20} color="var(--color-text-muted)" />
              </View>
              <Text className="text-typography-muted text-sm text-center font-medium">Select a group to view its files and members</Text>
            </View>
          )}

          {/* Groups drill-down → members panel OR file detail */}
          {mode === 'groups' && activeGroupId && activeGroup && (
            selectedFile
              ? <DetailPanel file={selectedFile} mode="groups" currentUserId={user?.id} onClose={() => setSelectedFile(null)} />
              : <GroupMembersPanel group={activeGroup} currentUserId={user?.id} onGroupChanged={refreshGroups} />
          )}

          {/* Inbox / Sent / Broadcast → file detail */}
          {mode !== 'groups' && (
            <DetailPanel
              file={selectedFile}
              mode={mode}
              currentUserId={user?.id}
              onClose={() => setSelectedFile(null)}
            />
          )}
        </View>
      </View>

      {/* ── Upload Modal ── */}
      <UploadModal
        visible={showUpload}
        folders={uploadFolders}
        onClose={() => setShowUpload(false)}
        onUploaded={() => { mode === 'groups' && activeGroupId ? refreshGroupFiles() : refresh(); }}
        checkDuplicate={checkDuplicate}
        hasPermission={hasPermission}
        profile={profile}
        activeGroup={activeGroup ? { id: activeGroup.id, name: activeGroup.name, avatar_color: activeGroup.avatar_color } : null}
      />

      {/* ── Group Create Modal ── */}
      <GroupCreateModal
        visible={showCreateGroup}
        onClose={() => setShowCreateGroup(false)}
        onCreated={(id) => { refreshGroups(); setActiveGroupId(id); }}
      />

      {/* ── Tags Manage Modal ── */}
      <TagsManageModal
        visible={showManageTags}
        onClose={() => setShowManageTags(false)}
        onChanged={handleRefresh}
      />
    </View>
  );
}

export default function FileHubDesktop() {
  return (
    <FileHubProvider>
      <FileHubDesktopInner />
    </FileHubProvider>
  );
}
