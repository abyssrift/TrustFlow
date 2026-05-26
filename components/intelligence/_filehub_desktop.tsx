import { FileHubFile, FileHubFolder, FileHubMode, FileHubProvider, useFileHub } from '@/contexts/FileHubContext';
import { useAuth } from '@/contexts/AuthContext';
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

// ─── Upload Modal ─────────────────────────────────────────────────────────────

type UploadDraft = {
  file: File | null;
  visibility: 'direct' | 'broadcast';
  recipientIds: string[];
  folderId: string | null;
  tags: string[];
  tagInput: string;
  caption: string;
};

const EMPTY_DRAFT: UploadDraft = {
  file: null,
  visibility: 'direct',
  recipientIds: [],
  folderId: null,
  tags: [],
  tagInput: '',
  caption: '',
};

function UploadModal({
  visible,
  folders,
  onClose,
  onUploaded,
  checkDuplicate,
  hasPermission,
  profile,
}: {
  visible: boolean;
  folders: FileHubFolder[];
  onClose: () => void;
  onUploaded: () => void;
  checkDuplicate: (hash: string) => Promise<any[]>;
  hasPermission: (key: string) => boolean;
  profile: any;
}) {
  const fileInputRef = useRef<any>(null);
  const [draft, setDraft] = useState<UploadDraft>(EMPTY_DRAFT);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [recipientSearch, setRecipientSearch] = useState('');
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [searchingMembers, setSearchingMembers] = useState(false);
  const [tagSuggestResults, setTagSuggestResults] = useState<string[]>([]);

  const patch = (updates: Partial<UploadDraft>) => setDraft(prev => ({ ...prev, ...updates }));

  useEffect(() => {
    if (!visible) {
      setDraft(EMPTY_DRAFT);
      setProgress(0);
      setRecipientSearch('');
      setMemberResults([]);
    }
  }, [visible]);

  const searchMembers = useCallback(async (query: string) => {
    setRecipientSearch(query);
    if (!query.trim()) { setMemberResults([]); return; }
    setSearchingMembers(true);
    try {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, avatar_url')
        .ilike('full_name', `%${query}%`)
        .limit(8);
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
    patch({ recipientIds: draft.recipientIds.includes(id)
      ? draft.recipientIds.filter(r => r !== id)
      : [...draft.recipientIds, id]
    });
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
    if (Platform.OS === 'web' && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: any) => {
    const file = e.target?.files?.[0];
    if (file) patch({ file });
  };

  const handleUpload = async () => {
    if (!draft.file || uploading) return;
    const companyId = profile?.company_id;
    if (!companyId) { Alert.alert('Error', 'Company not found.'); return; }

    setUploading(true);
    setProgress(5);
    try {
      const contentHash = await computeSHA256(draft.file);
      setProgress(15);

      const dupes = await checkDuplicate(contentHash);
      if (dupes.length > 0) {
        const proceed = await new Promise<boolean>(resolve => {
          Alert.alert(
            'Possible Duplicate',
            `A file with the same content already exists: "${dupes[0].original_name}". Upload anyway?`,
            [
              { text: 'Cancel', onPress: () => resolve(false), style: 'cancel' },
              { text: 'Upload Anyway', onPress: () => resolve(true) },
            ]
          );
        });
        if (!proceed) { setUploading(false); setProgress(0); return; }
      }

      const fileId = (crypto as any).randomUUID();
      const safeName = draft.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${companyId}/${fileId}/${safeName}`;
      setProgress(25);

      const { error: storageError } = await supabase.storage
        .from('filehub-files')
        .upload(storagePath, draft.file);
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
        <View className="bg-surface-card rounded-[2rem] border border-surface-border premium-shadow w-full max-w-[560px]">
          {/* Header */}
          <View className="flex-row items-center justify-between px-8 pt-7 pb-5 border-b border-surface-border">
            <Text className="text-typography-main text-xl font-black tracking-tight">Upload File</Text>
            <TouchableOpacity onPress={onClose} className="w-8 h-8 items-center justify-center rounded-xl bg-surface-background border border-surface-border">
              <FontAwesome name="times" size={12} color="var(--color-text-muted)" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 32, gap: 20 }}>
            {/* File picker */}
            {Platform.OS === 'web' && (
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
            )}
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
                  <Text className="text-brand-primary text-xs font-bold">Tap to change</Text>
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

            {/* Visibility */}
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
                        {draft.recipientIds.includes(m.id) && (
                          <FontAwesome name="check" size={11} color="var(--color-primary)" />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Folder */}
            <View className="gap-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Folder</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View className="flex-row gap-2">
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
                </View>
              </ScrollView>
            </View>

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
                    <TouchableOpacity
                      key={t}
                      onPress={() => addTag(t)}
                      className="px-3 py-1 rounded-full bg-brand-primary/5 border border-brand-primary/20"
                    >
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
                  <Text className="text-white font-black text-sm">Upload File</Text>
                )}
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

  const startRename = (f: FileHubFolder) => {
    setRenamingId(f.id);
    setRenameValue(f.name);
  };

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

      {/* All Files */}
      <TouchableOpacity
        onPress={() => setSelectedFolderId(null)}
        className={`flex-row items-center px-3 py-2 rounded-xl mb-1 ${!selectedFolderId ? 'bg-brand-primary/10' : 'hover:bg-surface-overlay'}`}
      >
        <FontAwesome name="folder-open-o" size={12} color={!selectedFolderId ? 'var(--color-primary)' : 'var(--color-text-muted)'} />
        <Text className={`ml-2.5 text-sm font-bold flex-1 ${!selectedFolderId ? 'text-brand-primary' : 'text-typography-main'}`}>All Files</Text>
      </TouchableOpacity>

      {/* Folder rows */}
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

      {/* New folder input */}
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
  const { markRead, hideFile, deleteFile } = useFileHub();
  const [downloadLoading, setDownloadLoading] = useState(false);

  const handleDownload = async () => {
    if (!file) return;
    setDownloadLoading(true);
    try {
      await openStorageFile(file.bucket || 'filehub-files', file.storage_path);
    } finally {
      setDownloadLoading(false);
    }
  };

  const handleDelete = () => {
    if (!file) return;
    Alert.alert('Delete File', `Delete "${file.original_name}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteFile(file.id);
          onClose();
        },
      },
    ]);
  };

  const handleHide = () => {
    if (!file) return;
    Alert.alert('Hide File', 'Remove this file from your inbox? The sender is not notified.', [
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
        <Text className="text-typography-muted text-sm text-center font-medium">
          Select a file to preview its details
        </Text>
      </View>
    );
  }

  const { icon, color } = getMimeIcon(file.mime_type);
  const isUnread = mode === 'inbox' && !file.recipient_state?.read_at;
  const isOwner = file.uploaded_by === currentUserId;

  return (
    <ScrollView className="flex-1" showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 28 }}>
      {/* File icon / preview */}
      <View className="bg-surface-background rounded-2xl border border-surface-border items-center justify-center py-10 mb-5">
        <FontAwesome name={icon as any} size={52} color={color} />
      </View>

      {/* Title & meta */}
      <Text className="text-typography-main text-lg font-black tracking-tight mb-1 leading-snug">{file.original_name}</Text>
      <Text className="text-typography-muted text-sm mb-5">
        {formatFileSize(file.size_bytes)}{file.mime_type ? ` · ${file.mime_type.split('/').pop()?.toUpperCase()}` : ''}
      </Text>

      {/* Sent by */}
      <View className="mb-4 pb-4 border-b border-surface-border/50">
        <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2">Sent by</Text>
        <Text className="text-typography-main text-sm font-bold">{file.uploader.full_name}</Text>
        <Text className="text-typography-dim text-xs mt-0.5">{relativeDate(file.created_at)}</Text>
      </View>

      {/* Recipients (shown for sent & broadcast) */}
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

      {/* Folder */}
      {file.folder && (
        <View className="mb-4 pb-4 border-b border-surface-border/50">
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1">Folder</Text>
          <View className="flex-row items-center gap-2">
            <FontAwesome name="folder" size={12} color="var(--color-text-muted)" />
            <Text className="text-typography-main text-sm font-bold">{file.folder.name}</Text>
          </View>
        </View>
      )}

      {/* Caption */}
      {file.caption && (
        <View className="mb-4 pb-4 border-b border-surface-border/50">
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2">Caption</Text>
          <Text className="text-typography-main text-sm leading-relaxed">{file.caption}</Text>
        </View>
      )}

      {/* Tags */}
      {file.tags.length > 0 && (
        <View className="mb-5 pb-4 border-b border-surface-border/50">
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2">Tags</Text>
          <View className="flex-row flex-wrap gap-2">
            {file.tags.map(tag => (
              <View key={tag} className="px-3 py-1 rounded-full bg-surface-background border border-surface-border">
                <Text className="text-typography-muted text-xs font-bold">{tag}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Actions */}
      <View className="gap-2.5">
        <TouchableOpacity
          onPress={handleDownload}
          disabled={downloadLoading}
          className="flex-row items-center justify-center bg-brand-primary rounded-xl px-4 py-3.5 gap-2"
        >
          {downloadLoading
            ? <ActivityIndicator size="small" color="#fff" />
            : <FontAwesome name="download" size={13} color="#fff" />
          }
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
  } = useFileHub();

  const [selectedFile, setSelectedFile] = useState<FileHubFile | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  // Derive unique tags from current file list
  const allTags = useMemo(() => {
    const set = new Set<string>();
    files.forEach(f => f.tags.forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [files]);

  const unreadCount = useMemo(
    () => files.filter(f => !f.recipient_state?.read_at).length,
    [files]
  );

  const canBroadcast = hasPermission('filehub:broadcast');

  // Keep selectedFile in sync with updated list data
  useEffect(() => {
    if (!selectedFile) return;
    const updated = files.find(f => f.id === selectedFile.id);
    setSelectedFile(updated ?? null);
  }, [files]);

  const tabs: { key: FileHubMode; label: string; count?: number }[] = [
    { key: 'inbox', label: 'Inbox', count: mode === 'inbox' && unreadCount > 0 ? unreadCount : undefined },
    { key: 'sent', label: 'Sent' },
    ...(canBroadcast ? [{ key: 'broadcast' as FileHubMode, label: 'Broadcast' }] : []),
  ];

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
              placeholder="Search files..."
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
            onPress={refresh}
            className="h-10 w-10 items-center justify-center bg-surface-card border border-surface-border rounded-xl shrink-0"
          >
            <FontAwesome name="refresh" size={13} color="var(--color-primary)" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setShowUpload(true)}
            className="flex-row items-center gap-2 bg-brand-primary px-5 py-2.5 rounded-xl shrink-0"
          >
            <FontAwesome name="upload" size={12} color="#fff" />
            <Text className="text-white font-black text-sm tracking-wide">Upload File</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Tabs ── */}
      <View className="px-10 pt-4 pb-3 flex-row items-center gap-2 flex-shrink-0 border-b border-surface-border">
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => { setMode(tab.key); setSelectedFile(null); }}
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
        {/* ── Left: Folders + File list ── */}
        <View style={{ flex: 0.62 }} className="border-r border-surface-border flex-col">
          <FolderPanel />

          {/* Tag filter row */}
          {allTags.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="border-b border-surface-border flex-shrink-0"
              contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 10, gap: 8, flexDirection: 'row' }}
            >
              {allTags.map(tag => (
                <TouchableOpacity
                  key={tag}
                  onPress={() => setSelectedTag(selectedTag === tag ? null : tag)}
                  className={`px-3 py-1 rounded-full border flex-shrink-0 ${
                    selectedTag === tag
                      ? 'bg-brand-primary/10 border-brand-primary/30'
                      : 'bg-surface-card border-surface-border'
                  }`}
                >
                  <Text className={`text-[11px] font-bold ${selectedTag === tag ? 'text-brand-primary' : 'text-typography-muted'}`}>
                    {tag}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}

          {/* File list */}
          {loading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color="var(--color-primary)" />
            </View>
          ) : files.length === 0 ? (
            <View className="flex-1 items-center justify-center px-8">
              <View className="bg-surface-card p-10 rounded-[2.5rem] border border-surface-border items-center w-full max-w-sm premium-shadow">
                <View className="w-14 h-14 bg-surface-background rounded-full border border-surface-border items-center justify-center mb-4">
                  <FontAwesome name="inbox" size={24} color="var(--color-text-muted)" />
                </View>
                <Text className="text-typography-main text-xl font-black mb-2 text-center">
                  {search ? 'No Results' : mode === 'inbox' ? 'Inbox Empty' : mode === 'sent' ? 'Nothing Sent' : 'No Broadcasts'}
                </Text>
                <Text className="text-typography-muted text-sm text-center leading-relaxed">
                  {search
                    ? `No files match "${search}".`
                    : mode === 'inbox'
                    ? 'Files sent directly to you will appear here.'
                    : mode === 'sent'
                    ? 'Files you send to others will appear here.'
                    : 'Company-wide broadcasts will appear here.'}
                </Text>
              </View>
            </View>
          ) : (
            <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
              {/* Table header */}
              <View className="flex-row items-center px-6 py-3 bg-surface-background/60 border-b border-surface-border/60">
                <View className="w-9 mr-3.5" />
                <Text className="flex-1 text-typography-muted text-[9px] font-black uppercase tracking-widest">File</Text>
                <Text className="w-20 text-right text-typography-muted text-[9px] font-black uppercase tracking-widest">Date</Text>
              </View>

              {files.map(file => (
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
        </View>

        {/* ── Right: Detail panel ── */}
        <View style={{ flex: 0.38 }} className="flex-col border-l border-surface-border">
          <DetailPanel
            file={selectedFile}
            mode={mode}
            currentUserId={user?.id}
            onClose={() => setSelectedFile(null)}
          />
        </View>
      </View>

      {/* ── Upload Modal ── */}
      <UploadModal
        visible={showUpload}
        folders={folders}
        onClose={() => setShowUpload(false)}
        onUploaded={refresh}
        checkDuplicate={checkDuplicate}
        hasPermission={hasPermission}
        profile={profile}
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
