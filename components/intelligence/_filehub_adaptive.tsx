import { FileHubFile, FileHubMode, FileHubProvider, useFileHub } from '@/contexts/FileHubContext';
import { useAuth } from '@/contexts/AuthContext';
import { openStorageFile } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
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
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function getMimeIcon(mimeType: string | null): { icon: string; color: string } {
  if (!mimeType) return { icon: 'file-o', color: '#94a3b8' };
  const t = mimeType.toLowerCase();
  if (t.includes('pdf')) return { icon: 'file-pdf-o', color: '#e53e3e' };
  if (t.includes('image')) return { icon: 'file-image-o', color: '#38a169' };
  if (t.includes('spreadsheet') || t.includes('excel') || t.includes('csv')) return { icon: 'file-excel-o', color: '#2f855a' };
  if (t.includes('word') || t.includes('wordprocessing')) return { icon: 'file-word-o', color: '#2b6cb0' };
  if (t.includes('zip') || t.includes('compressed')) return { icon: 'file-zip-o', color: '#d69e2e' };
  if (t.includes('video')) return { icon: 'file-video-o', color: '#805ad5' };
  if (t.includes('audio')) return { icon: 'file-audio-o', color: '#dd6b20' };
  if (t.includes('text')) return { icon: 'file-text-o', color: '#4a5568' };
  return { icon: 'file-o', color: '#94a3b8' };
}

async function computeSHA256Web(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const digest = await (crypto as any).subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((b: number) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ─── File Detail Bottom Sheet ─────────────────────────────────────────────────

function FileDetailSheet({
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
  const [downloading, setDownloading] = useState(false);

  if (!file) return null;

  const { icon, color } = getMimeIcon(file.mime_type);
  const isUnread = mode === 'inbox' && !file.recipient_state?.read_at;
  const isOwner = file.uploaded_by === currentUserId;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await openStorageFile(file.bucket || 'filehub-files', file.storage_path);
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = () => {
    Alert.alert('Delete File', `Delete "${file.original_name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteFile(file.id); onClose(); } },
    ]);
  };

  return (
    <Modal visible={!!file} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <TouchableOpacity className="flex-1" onPress={onClose} activeOpacity={1} />
        <View className="bg-surface-card rounded-t-[2rem] border-t border-surface-border" style={{ maxHeight: '80%' }}>
          {/* Handle */}
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 bg-surface-border rounded-full" />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40 }}>
            {/* File icon */}
            <View className="items-center py-6">
              <View className="w-20 h-20 bg-surface-background border border-surface-border rounded-2xl items-center justify-center mb-3">
                <FontAwesome name={icon as any} size={36} color={color} />
              </View>
              <Text className="text-typography-main text-lg font-black text-center" numberOfLines={2}>{file.original_name}</Text>
              <Text className="text-typography-muted text-sm mt-1">
                {formatFileSize(file.size_bytes)}{file.mime_type ? ` · ${file.mime_type.split('/').pop()?.toUpperCase()}` : ''}
              </Text>
            </View>

            {/* Metadata rows */}
            <View className="bg-surface-background rounded-2xl border border-surface-border overflow-hidden mb-4">
              <View className="flex-row items-center px-4 py-3.5 border-b border-surface-border/50">
                <Text className="text-typography-muted text-xs w-24">Sent by</Text>
                <Text className="text-typography-main text-xs font-bold flex-1">{file.uploader.full_name}</Text>
              </View>
              <View className="flex-row items-center px-4 py-3.5 border-b border-surface-border/50">
                <Text className="text-typography-muted text-xs w-24">Date</Text>
                <Text className="text-typography-main text-xs font-bold flex-1">
                  {new Date(file.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </Text>
              </View>
              {file.folder && (
                <View className="flex-row items-center px-4 py-3.5 border-b border-surface-border/50">
                  <Text className="text-typography-muted text-xs w-24">Folder</Text>
                  <Text className="text-typography-main text-xs font-bold flex-1">{file.folder.name}</Text>
                </View>
              )}
              {file.visibility === 'broadcast' && (
                <View className="flex-row items-center px-4 py-3.5">
                  <Text className="text-typography-muted text-xs w-24">Audience</Text>
                  <Text className="text-typography-main text-xs font-bold flex-1">Entire Company</Text>
                </View>
              )}
            </View>

            {/* Caption */}
            {file.caption && (
              <View className="bg-surface-background rounded-2xl border border-surface-border px-4 py-3.5 mb-4">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1.5">Caption</Text>
                <Text className="text-typography-main text-sm leading-relaxed">{file.caption}</Text>
              </View>
            )}

            {/* Tags */}
            {file.tags.length > 0 && (
              <View className="flex-row flex-wrap gap-2 mb-5">
                {file.tags.map(tag => (
                  <View key={tag} className="px-3 py-1 rounded-full bg-surface-background border border-surface-border">
                    <Text className="text-typography-muted text-xs font-bold">{tag}</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Actions */}
            <View className="gap-3">
              <TouchableOpacity
                onPress={handleDownload}
                disabled={downloading}
                className="flex-row items-center justify-center bg-brand-primary rounded-2xl py-4 gap-2"
              >
                {downloading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <FontAwesome name="download" size={14} color="#fff" />
                }
                <Text className="text-white font-black">Download</Text>
              </TouchableOpacity>

              {isUnread && (
                <TouchableOpacity
                  onPress={() => { markRead(file.id); onClose(); }}
                  className="flex-row items-center justify-center bg-surface-card border border-surface-border rounded-2xl py-3.5 gap-2"
                >
                  <FontAwesome name="check" size={14} color="var(--color-primary)" />
                  <Text className="text-brand-primary font-black">Mark as Read</Text>
                </TouchableOpacity>
              )}

              <View className="flex-row gap-3">
                {mode === 'inbox' && (
                  <TouchableOpacity
                    onPress={() => { hideFile(file.id); onClose(); }}
                    className="flex-1 flex-row items-center justify-center bg-surface-background border border-surface-border rounded-2xl py-3 gap-1.5"
                  >
                    <FontAwesome name="eye-slash" size={12} color="var(--color-text-muted)" />
                    <Text className="text-typography-muted font-bold text-sm">Hide</Text>
                  </TouchableOpacity>
                )}
                {isOwner && (
                  <TouchableOpacity
                    onPress={handleDelete}
                    className="flex-1 flex-row items-center justify-center bg-state-danger/10 border border-state-danger/20 rounded-2xl py-3 gap-1.5"
                  >
                    <FontAwesome name="trash-o" size={12} color="var(--color-danger)" />
                    <Text className="text-state-danger font-bold text-sm">Delete</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Upload Bottom Sheet ──────────────────────────────────────────────────────

function UploadSheet({
  visible,
  onClose,
  onUploaded,
  hasPermission,
  profile,
}: {
  visible: boolean;
  onClose: () => void;
  onUploaded: () => void;
  hasPermission: (key: string) => boolean;
  profile: any;
}) {
  const { folders, checkDuplicate } = useFileHub();
  const fileInputRef = useRef<any>(null);
  const [pickedFile, setPickedFile] = useState<{ name: string; size: number; uri: string; type?: string; webFile?: File } | null>(null);
  const [visibility, setVisibility] = useState<'direct' | 'broadcast'>('direct');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<any[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState<1 | 2>(1);

  const canBroadcast = hasPermission('filehub:broadcast');

  const resetAll = () => {
    setPickedFile(null);
    setVisibility('direct');
    setRecipientSearch('');
    setMemberResults([]);
    setSelectedRecipients([]);
    setFolderId(null);
    setTags([]);
    setTagInput('');
    setCaption('');
    setProgress(0);
    setStep(1);
  };

  useEffect(() => {
    if (!visible) resetAll();
  }, [visible]);

  const searchMembers = useCallback(async (query: string) => {
    setRecipientSearch(query);
    if (!query.trim()) { setMemberResults([]); return; }
    const { data } = await supabase
      .from('users')
      .select('id, full_name, avatar_url')
      .ilike('full_name', `%${query}%`)
      .limit(6);
    setMemberResults(data || []);
  }, []);

  const toggleRecipient = (member: any) => {
    setSelectedRecipients(prev =>
      prev.find(r => r.id === member.id)
        ? prev.filter(r => r.id !== member.id)
        : [...prev, member]
    );
  };

  const addTag = (t: string) => {
    const clean = t.trim().toLowerCase().replace(/\s+/g, '-');
    if (!clean || tags.includes(clean)) return;
    setTags(prev => [...prev, clean]);
    setTagInput('');
  };

  const pickFile = async () => {
    if (Platform.OS === 'web') {
      fileInputRef.current?.click();
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      setPickedFile({ name: asset.name, size: asset.size ?? 0, uri: asset.uri, type: asset.mimeType });
      setStep(2);
    }
  };

  const handleWebFileChange = (e: any) => {
    const file = e.target?.files?.[0];
    if (file) {
      setPickedFile({ name: file.name, size: file.size, uri: '', type: file.type, webFile: file });
      setStep(2);
    }
  };

  const handleUpload = async () => {
    if (!pickedFile || uploading) return;
    const companyId = profile?.company_id;
    if (!companyId) { Alert.alert('Error', 'Company not found.'); return; }
    if (visibility === 'direct' && selectedRecipients.length === 0) {
      Alert.alert('Recipients required', 'Please add at least one recipient for a direct send.');
      return;
    }

    setUploading(true);
    setProgress(10);
    try {
      let contentHash: string | null = null;
      let uploadBlob: File | Blob | null = null;

      if (Platform.OS === 'web' && pickedFile.webFile) {
        contentHash = await computeSHA256Web(pickedFile.webFile);
        uploadBlob = pickedFile.webFile;
      } else {
        const response = await fetch(pickedFile.uri);
        uploadBlob = await response.blob();
      }
      setProgress(25);

      if (contentHash) {
        const dupes = await checkDuplicate(contentHash);
        if (dupes.length > 0) {
          const proceed = await new Promise<boolean>(resolve => {
            Alert.alert(
              'Possible Duplicate',
              `A file with the same content exists: "${dupes[0].original_name}". Upload anyway?`,
              [
                { text: 'Cancel', onPress: () => resolve(false), style: 'cancel' },
                { text: 'Upload', onPress: () => resolve(true) },
              ]
            );
          });
          if (!proceed) { setUploading(false); setProgress(0); return; }
        }
      }

      const fileId = Platform.OS === 'web'
        ? (crypto as any).randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const safeName = pickedFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${companyId}/${fileId}/${safeName}`;
      setProgress(40);

      const { error: storageError } = await supabase.storage
        .from('filehub-files')
        .upload(storagePath, uploadBlob!);
      if (storageError) throw storageError;
      setProgress(80);

      const { error: rpcError } = await supabase.rpc('rpc_filehub_upload_commit', {
        p_storage_path: storagePath,
        p_visibility: visibility,
        p_recipient_ids: visibility === 'direct' ? selectedRecipients.map(r => r.id) : [],
        p_folder_id: folderId,
        p_tags: tags,
        p_caption: caption || null,
        p_original_name: pickedFile.name,
        p_mime_type: pickedFile.type || null,
        p_size_bytes: pickedFile.size,
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <TouchableOpacity className="flex-1" onPress={onClose} activeOpacity={1} />
        <View className="bg-surface-card rounded-t-[2rem] border-t border-surface-border" style={{ maxHeight: '90%' }}>
          {/* Handle */}
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 bg-surface-border rounded-full" />
          </View>

          {Platform.OS === 'web' && (
            <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={handleWebFileChange} />
          )}

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40, gap: 20 }}>
            {/* Header */}
            <View className="flex-row items-center justify-between pt-2">
              <Text className="text-typography-main text-xl font-black tracking-tight">Upload File</Text>
              <TouchableOpacity onPress={onClose} className="w-8 h-8 bg-surface-background border border-surface-border rounded-xl items-center justify-center">
                <FontAwesome name="times" size={12} color="var(--color-text-muted)" />
              </TouchableOpacity>
            </View>

            {/* Step 1: File picker */}
            {step === 1 || !pickedFile ? (
              <TouchableOpacity
                onPress={pickFile}
                className="border-2 border-dashed border-surface-border rounded-2xl items-center py-10 gap-3"
              >
                <View className="w-14 h-14 bg-surface-background border border-surface-border rounded-2xl items-center justify-center">
                  <FontAwesome name="cloud-upload" size={24} color="var(--color-text-muted)" />
                </View>
                <Text className="text-typography-main font-bold">Choose a file</Text>
                <Text className="text-typography-muted text-sm">Tap to browse</Text>
              </TouchableOpacity>
            ) : (
              /* File picked — show details */
              <TouchableOpacity
                onPress={pickFile}
                className="flex-row items-center bg-surface-background border border-surface-border rounded-2xl px-4 py-4 gap-3"
              >
                <View className="w-11 h-11 bg-brand-primary/10 rounded-xl items-center justify-center flex-shrink-0">
                  <FontAwesome name={getMimeIcon(pickedFile.type ?? null).icon as any} size={20} color="var(--color-primary)" />
                </View>
                <View className="flex-1 min-w-0">
                  <Text className="text-typography-main font-bold text-sm" numberOfLines={1}>{pickedFile.name}</Text>
                  <Text className="text-typography-muted text-xs mt-0.5">{formatFileSize(pickedFile.size)}</Text>
                </View>
                <Text className="text-brand-primary text-xs font-bold">Change</Text>
              </TouchableOpacity>
            )}

            {pickedFile && (
              <>
                {/* Visibility */}
                <View className="gap-2">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Send as</Text>
                  <View className="flex-row gap-2">
                    <TouchableOpacity
                      onPress={() => setVisibility('direct')}
                      className={`flex-1 items-center py-3 rounded-2xl border ${visibility === 'direct' ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
                    >
                      <Text className={`font-black text-sm ${visibility === 'direct' ? 'text-brand-primary' : 'text-typography-muted'}`}>Direct</Text>
                    </TouchableOpacity>
                    {canBroadcast && (
                      <TouchableOpacity
                        onPress={() => setVisibility('broadcast')}
                        className={`flex-1 items-center py-3 rounded-2xl border ${visibility === 'broadcast' ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
                      >
                        <Text className={`font-black text-sm ${visibility === 'broadcast' ? 'text-brand-primary' : 'text-typography-muted'}`}>Broadcast</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {/* Recipients */}
                {visibility === 'direct' && (
                  <View className="gap-2">
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Recipients</Text>
                    {selectedRecipients.length > 0 && (
                      <View className="flex-row flex-wrap gap-2">
                        {selectedRecipients.map(r => (
                          <TouchableOpacity
                            key={r.id}
                            onPress={() => toggleRecipient(r)}
                            className="flex-row items-center gap-1.5 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-3 py-1"
                          >
                            <Text className="text-brand-primary text-xs font-bold">{r.full_name}</Text>
                            <FontAwesome name="times" size={9} color="var(--color-primary)" />
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    <View className="flex-row items-center bg-surface-background border border-surface-border rounded-2xl px-4 py-3 gap-2">
                      <FontAwesome name="search" size={12} color="var(--color-text-muted)" />
                      <TextInput
                        value={recipientSearch}
                        onChangeText={searchMembers}
                        placeholder="Search team members…"
                        placeholderTextColor="var(--color-text-dim)"
                        className="flex-1 text-typography-main text-sm"
                      />
                    </View>
                    {memberResults.length > 0 && (
                      <View className="bg-surface-background border border-surface-border rounded-2xl overflow-hidden">
                        {memberResults.map((m, i) => (
                          <TouchableOpacity
                            key={m.id}
                            onPress={() => toggleRecipient(m)}
                            className={`flex-row items-center px-4 py-3 gap-3 ${i < memberResults.length - 1 ? 'border-b border-surface-border/50' : ''}`}
                          >
                            <Text className="flex-1 text-typography-main text-sm font-medium">{m.full_name}</Text>
                            {selectedRecipients.find(r => r.id === m.id) && (
                              <FontAwesome name="check" size={11} color="var(--color-primary)" />
                            )}
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                {/* Folder */}
                {folders.length > 0 && (
                  <View className="gap-2">
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Folder</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View className="flex-row gap-2">
                        <TouchableOpacity
                          onPress={() => setFolderId(null)}
                          className={`px-4 py-2 rounded-xl border ${!folderId ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
                        >
                          <Text className={`text-xs font-bold ${!folderId ? 'text-brand-primary' : 'text-typography-muted'}`}>None</Text>
                        </TouchableOpacity>
                        {folders.map(f => (
                          <TouchableOpacity
                            key={f.id}
                            onPress={() => setFolderId(f.id)}
                            className={`px-4 py-2 rounded-xl border ${folderId === f.id ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
                          >
                            <Text className={`text-xs font-bold ${folderId === f.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{f.name}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                )}

                {/* Tags */}
                <View className="gap-2">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Tags</Text>
                  {tags.length > 0 && (
                    <View className="flex-row flex-wrap gap-2">
                      {tags.map(t => (
                        <TouchableOpacity
                          key={t}
                          onPress={() => setTags(prev => prev.filter(x => x !== t))}
                          className="flex-row items-center gap-1.5 bg-surface-background border border-surface-border rounded-full px-3 py-1"
                        >
                          <Text className="text-typography-muted text-xs font-bold">{t}</Text>
                          <FontAwesome name="times" size={8} color="var(--color-text-muted)" />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                  <View className="flex-row items-center bg-surface-background border border-surface-border rounded-2xl px-4 py-3 gap-2">
                    <FontAwesome name="tag" size={11} color="var(--color-text-muted)" />
                    <TextInput
                      value={tagInput}
                      onChangeText={setTagInput}
                      onSubmitEditing={() => addTag(tagInput)}
                      placeholder="Add tag…"
                      placeholderTextColor="var(--color-text-dim)"
                      className="flex-1 text-typography-main text-sm"
                      returnKeyType="done"
                    />
                  </View>
                </View>

                {/* Caption */}
                <View className="gap-2">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Caption</Text>
                  <TextInput
                    value={caption}
                    onChangeText={setCaption}
                    placeholder="Add a note…"
                    placeholderTextColor="var(--color-text-dim)"
                    multiline
                    numberOfLines={3}
                    className="bg-surface-background border border-surface-border rounded-2xl px-4 py-3 text-typography-main text-sm"
                    style={{ minHeight: 80, textAlignVertical: 'top' }}
                  />
                </View>

                {/* Progress */}
                {uploading && (
                  <View className="bg-surface-background border border-surface-border rounded-2xl px-4 py-3 gap-2">
                    <View className="flex-row justify-between mb-1">
                      <Text className="text-typography-main text-xs font-bold">
                        {progress < 40 ? 'Preparing…' : progress < 80 ? 'Uploading…' : 'Finishing…'}
                      </Text>
                      <Text className="text-brand-primary text-xs font-black">{progress}%</Text>
                    </View>
                    <View className="h-1.5 bg-surface-border rounded-full overflow-hidden">
                      <View className="h-full bg-brand-primary rounded-full" style={{ width: `${progress}%` }} />
                    </View>
                  </View>
                )}

                {/* Submit */}
                <TouchableOpacity
                  onPress={handleUpload}
                  disabled={uploading || (visibility === 'direct' && selectedRecipients.length === 0)}
                  className="items-center justify-center bg-brand-primary rounded-2xl py-4"
                  style={{ opacity: (uploading || (visibility === 'direct' && selectedRecipients.length === 0)) ? 0.5 : 1 }}
                >
                  {uploading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text className="text-white font-black text-base">Send File</Text>
                  }
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── File Card ────────────────────────────────────────────────────────────────

function FileCard({ file, mode, onPress }: { file: FileHubFile; mode: FileHubMode; onPress: () => void }) {
  const { icon, color } = getMimeIcon(file.mime_type);
  const isUnread = mode === 'inbox' && !file.recipient_state?.read_at;

  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-surface-card border border-surface-border rounded-2xl px-4 py-4 mb-3 flex-row items-center gap-3"
    >
      <View className="w-11 h-11 bg-surface-background border border-surface-border rounded-xl items-center justify-center flex-shrink-0">
        <FontAwesome name={icon as any} size={20} color={color} />
      </View>
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center gap-2 mb-0.5">
          {isUnread && <View className="w-2 h-2 rounded-full bg-brand-primary flex-shrink-0" />}
          <Text className="text-typography-main font-black text-sm flex-1" numberOfLines={1}>{file.original_name}</Text>
        </View>
        <Text className="text-typography-muted text-xs" numberOfLines={1}>
          {file.uploader.full_name} · {file.mime_type?.split('/').pop()?.toUpperCase() ?? 'File'} · {formatFileSize(file.size_bytes)}
        </Text>
      </View>
      <Text className="text-typography-dim text-xs flex-shrink-0">{relativeDate(file.created_at)}</Text>
    </TouchableOpacity>
  );
}

// ─── Main Adaptive Component ──────────────────────────────────────────────────

function FileHubAdaptiveInner() {
  const { hasPermission, user, profile } = useAuth();
  const {
    mode, setMode,
    search, setSearch,
    selectedFolderId, setSelectedFolderId,
    selectedTag, setSelectedTag,
    files, loading,
    refresh,
  } = useFileHub();

  const [selectedFile, setSelectedFile] = useState<FileHubFile | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const unreadCount = useMemo(
    () => files.filter(f => !f.recipient_state?.read_at).length,
    [files]
  );
  const canBroadcast = hasPermission('filehub:broadcast');

  const allTags = useMemo(() => {
    const set = new Set<string>();
    files.forEach(f => f.tags.forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [files]);

  const tabs: { key: FileHubMode; label: string; count?: number }[] = [
    { key: 'inbox', label: 'Inbox', count: mode === 'inbox' && unreadCount > 0 ? unreadCount : undefined },
    { key: 'sent', label: 'Sent' },
    ...(canBroadcast ? [{ key: 'broadcast' as FileHubMode, label: 'Broadcast' }] : []),
  ];

  return (
    <View className="flex-1 bg-surface-background">
      {/* ── Header ── */}
      <View className="px-6 pt-14 pb-4">
        <Text className="text-brand-primary font-black uppercase tracking-[4px] text-[10px] mb-1">Intelligence Hub</Text>
        <Text className="text-typography-main text-3xl font-black">File Hub</Text>
      </View>

      {/* ── Search ── */}
      <View className="px-6 mb-4 flex-row items-center gap-3">
        <View className="flex-1 flex-row items-center bg-surface-card border border-surface-border rounded-2xl px-4 py-3 gap-3">
          <FontAwesome name="search" size={12} color="var(--color-text-muted)" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search files..."
            placeholderTextColor="var(--color-text-dim)"
            className="flex-1 text-typography-main text-sm"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <FontAwesome name="times-circle" size={12} color="var(--color-text-muted)" />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity onPress={refresh} className="w-11 h-11 bg-surface-card border border-surface-border rounded-2xl items-center justify-center">
          <FontAwesome name="refresh" size={13} color="var(--color-primary)" />
        </TouchableOpacity>
      </View>

      {/* ── Tabs ── */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-shrink-0 mb-3" contentContainerStyle={{ paddingHorizontal: 24, gap: 8, flexDirection: 'row' }}>
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => { setMode(tab.key); }}
            className={`flex-row items-center gap-1.5 px-5 py-2.5 rounded-2xl border ${
              mode === tab.key
                ? 'bg-brand-primary/10 border-brand-primary/30'
                : 'bg-surface-card border-surface-border'
            }`}
          >
            <Text className={`text-sm font-black ${mode === tab.key ? 'text-brand-primary' : 'text-typography-muted'}`}>{tab.label}</Text>
            {tab.count !== undefined && (
              <View className="bg-brand-primary rounded-full px-1.5 py-0.5 min-w-[18px] items-center">
                <Text className="text-white text-[9px] font-black">{tab.count}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Tag filter ── */}
      {allTags.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-shrink-0 mb-3" contentContainerStyle={{ paddingHorizontal: 24, gap: 8, flexDirection: 'row' }}>
          {allTags.map(tag => (
            <TouchableOpacity
              key={tag}
              onPress={() => setSelectedTag(selectedTag === tag ? null : tag)}
              className={`px-3 py-1.5 rounded-full border ${selectedTag === tag ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-card border-surface-border'}`}
            >
              <Text className={`text-[11px] font-bold ${selectedTag === tag ? 'text-brand-primary' : 'text-typography-muted'}`}>{tag}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* ── File list ── */}
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="var(--color-primary)" />
        </View>
      ) : files.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <View className="bg-surface-card p-10 rounded-[2.5rem] border border-surface-border items-center w-full">
            <FontAwesome name="inbox" size={32} color="var(--color-text-muted)" />
            <Text className="text-typography-main text-xl font-black mt-4 mb-2 text-center">
              {search ? 'No Results' : mode === 'inbox' ? 'Inbox Empty' : mode === 'sent' ? 'Nothing Sent' : 'No Broadcasts'}
            </Text>
            <Text className="text-typography-muted text-sm text-center leading-relaxed">
              {search
                ? `No files match "${search}".`
                : mode === 'inbox'
                ? 'Files sent directly to you will appear here.'
                : mode === 'sent'
                ? 'Files you send will appear here.'
                : 'Company-wide broadcasts will appear here.'}
            </Text>
          </View>
        </View>
      ) : (
        <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
          {files.map(file => (
            <FileCard key={file.id} file={file} mode={mode} onPress={() => setSelectedFile(file)} />
          ))}
          <View style={{ height: 100 }} />
        </ScrollView>
      )}

      {/* ── FAB ── */}
      <TouchableOpacity
        onPress={() => setShowUpload(true)}
        className="absolute right-6 bottom-8 w-14 h-14 bg-brand-primary rounded-full items-center justify-center premium-shadow"
      >
        <FontAwesome name="plus" size={20} color="#fff" />
      </TouchableOpacity>

      {/* ── File detail sheet ── */}
      <FileDetailSheet
        file={selectedFile}
        mode={mode}
        currentUserId={user?.id}
        onClose={() => setSelectedFile(null)}
      />

      {/* ── Upload sheet ── */}
      <UploadSheet
        visible={showUpload}
        onClose={() => setShowUpload(false)}
        onUploaded={refresh}
        hasPermission={hasPermission}
        profile={profile}
      />
    </View>
  );
}

export default function FileHubAdaptive() {
  return (
    <FileHubProvider>
      <FileHubAdaptiveInner />
    </FileHubProvider>
  );
}
