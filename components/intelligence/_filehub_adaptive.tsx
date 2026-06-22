import { BackButton } from '@/components/common/BackButton';
import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { FileActivity, FileHubFile, FileHubGroup, FileHubGroupMember, FileHubMode, FileHubProvider, FileVersion, useFileHub } from '@/contexts/FileHubContext';
import { downloadFilesAsZip, openStorageFile } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';

import { useImageLightbox } from '@/hooks/useImageLightbox';
import { useThemeColors } from '@/hooks/useThemeColors';
import AdaptiveFileGrid from '../common/AdaptiveFileGrid';
import { FilePreviewModal, FilePreviewTeaser, getPreviewKind, type PreviewKind } from '../common/FilePreview';
import FileHubAnalytics from './FileHubAnalytics';




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

// Whole days from now until `expires_at`. Returns null when missing/already past.
function expiresInDays(expiresAt: string | null): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  return Math.ceil(ms / (1000 * 60 * 60 * 24));
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

function getInitials(name: string): string {
  return name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').slice(0, 2).join('');
}

// ─── Group colors palette ─────────────────────────────────────────────────────

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

// ─── File Detail Bottom Sheet ─────────────────────────────────────────────────

function FileDetailSheet({
  file,
  mode,
  currentUserId,
  onClose,
  autoPreview = false,
}: {
  file: FileHubFile | null;
  mode: FileHubMode;
  currentUserId: string | undefined;
  onClose: () => void;
  /** When true (Shift+Click fast-track), jump straight to the fullscreen viewer. */
  autoPreview?: boolean;
}) {
  const { markRead, hideFile, deleteFile, logActivity, fileActivity, fileVersions, restoreVersion, pinVersion } = useFileHub();
  const { showConfirm } = useAlert();
  const [downloading, setDownloading] = useState(false);
  const [tab, setTab] = useState<'details' | 'activity' | 'versions'>('details');
  const [activity, setActivity] = useState<FileActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoringLatest, setRestoringLatest] = useState(false);
  const [pinningId, setPinningId] = useState<string | null>(null);
  const colors = useThemeColors();

  // Image preview → tap to open the lightbox (single image, no list navigation).
  const isImage = !!file?.mime_type?.toLowerCase().includes('image');
  const previewMedia = useMemo(
    () =>
      file && isImage
        ? [{ id: file.id, name: file.original_name, storagePath: file.storage_path, mimeType: file.mime_type, bucket: file.bucket || 'filehub-files' }]
        : [],
    [file?.id, isImage]
  );
  const { signedUrls: previewUrls, openImage: openPreview, lightbox: previewLightbox } = useImageLightbox(previewMedia, 'filehub-files');

  // Non-image previews (spreadsheet / pdf / docx / text) → resolve a signed URL
  // and offer a full-screen viewer.
  const previewKind = file ? getPreviewKind(file.mime_type, file.original_name) : null;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  useEffect(() => {
    if (!file || !previewKind) { setPreviewUrl(null); return; }
    let cancelled = false;
    supabase.storage
      .from(file.bucket || 'filehub-files')
      .createSignedUrl(file.storage_path, 3600)
      .then(({ data }) => { if (!cancelled) setPreviewUrl(data?.signedUrl ?? null); });
    return () => { cancelled = true; };
  }, [file?.id, previewKind]);

  const hasVersionHistory = !!(file?.version_count && file.version_count > 1);

  // Shift+Click fast-track: open the fullscreen viewer as soon as the signed URL
  // resolves, skipping the metadata browsing step. Fires once per opened file.
  const autoPreviewedId = useRef<string | null>(null);
  useEffect(() => { if (!file) autoPreviewedId.current = null; }, [file?.id]);
  useEffect(() => {
    if (!autoPreview || !file || autoPreviewedId.current === file.id) return;
    if (isImage && previewUrls[file.id]) {
      autoPreviewedId.current = file.id;
      openPreview(file.id);
    } else if (previewKind && previewUrl) {
      autoPreviewedId.current = file.id;
      setPreviewOpen(true);
    }
  }, [autoPreview, file?.id, isImage, previewUrls, previewKind, previewUrl, openPreview]);

  useEffect(() => { setTab('details'); setActivity([]); setVersions([]); }, [file?.id]);
  useEffect(() => { if (file) logActivity(file.id, 'view'); }, [file?.id]);
  useEffect(() => {
    if (tab !== 'activity' || !file) return;
    setActivityLoading(true);
    fileActivity(file.id).then(setActivity).catch(console.error).finally(() => setActivityLoading(false));
  }, [tab, file?.id]);

  const loadVersions = useCallback(() => {
    if (!file) return;
    setVersionsLoading(true);
    fileVersions(file.id).then(setVersions).catch(console.error).finally(() => setVersionsLoading(false));
  }, [file?.id, fileVersions]);

  useEffect(() => {
    if (tab !== 'versions' || !file) return;
    loadVersions();
  }, [tab, file?.id, loadVersions]);

  // Preview a specific (older) version in the document viewer — selecting a
  // version resolves its own signed URL and re-renders the viewer canvas.
  const [versionPreview, setVersionPreview] = useState<{ uri: string; kind: PreviewKind; name: string; versionNo: number } | null>(null);

  if (!file) return null;

  const { icon, color } = getMimeIcon(file.mime_type);
  const isUnread = mode === 'inbox' && !file.recipient_state?.read_at;
  const isOwner = file.uploader?.id === currentUserId;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      logActivity(file.id, 'download');
      await openStorageFile(file.bucket || 'filehub-files', file.storage_path, file.original_name, file.mime_type);
    } finally {
      setDownloading(false);
    }
  };

  const handleDelete = () => {
    showConfirm(
      'Delete File',
      `Delete "${file.original_name}"?`,
      () => { deleteFile(file.id).then(() => onClose()); },
      undefined, 'Delete', 'Cancel', 'destructive'
    );
  };

  const handleVersionDownload = async (version: FileVersion) => {
    logActivity(file.id, 'download', { version_no: version.version_no });
    await openStorageFile(version.bucket || 'filehub-files', version.storage_path, version.original_name, version.mime_type ?? file.mime_type);
  };

  const handleVersionPreview = async (version: FileVersion) => {
    const kind = getPreviewKind(version.mime_type ?? file.mime_type, version.original_name);
    if (!kind) { handleVersionDownload(version); return; }
    const { data } = await supabase.storage
      .from(version.bucket || 'filehub-files')
      .createSignedUrl(version.storage_path, 3600);
    if (data?.signedUrl) {
      logActivity(file.id, 'view', { version_no: version.version_no });
      setVersionPreview({ uri: data.signedUrl, kind, name: version.original_name, versionNo: version.version_no });
    }
  };

  const handleRestore = (version: FileVersion) => {
    showConfirm(
      'Restore Version',
      `Make version ${version.version_no} the current version? The current version will be kept in history.`,
      async () => {
        setRestoringId(version.id);
        try {
          await restoreVersion(version.id);
          loadVersions();
        } finally {
          setRestoringId(null);
        }
      },
      undefined, 'Restore', 'Cancel'
    );
  };

  const handleRestoreLatest = () => {
    if (!file || versions.length === 0) return;
    const latest = versions.reduce((max, v) => (v.version_no > max.version_no ? v : max), versions[0]);
    showConfirm(
      'Restore Latest Version',
      `Make version ${latest.version_no} (the most recent) the current version?`,
      async () => {
        setRestoringLatest(true);
        try {
          await restoreVersion(latest.id);
          loadVersions();
        } finally {
          setRestoringLatest(false);
        }
      },
      undefined, 'Restore', 'Cancel'
    );
  };

  const handleTogglePin = async (version: FileVersion) => {
    setPinningId(version.id);
    try {
      await pinVersion(version.id, !version.pinned);
      setVersions(prev => prev.map(v => v.id === version.id ? { ...v, pinned: !v.pinned } : v));
    } finally {
      setPinningId(null);
    }
  };

  return (
    <>
    <Modal visible={!!file} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <TouchableOpacity className="flex-1" onPress={onClose} activeOpacity={1} />
        <View className="bg-surface-card rounded-t-[2rem] border-t border-surface-border" style={{ maxHeight: '85%' }}>
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 bg-surface-border rounded-full" />
          </View>

          {/* File header */}
          <View className="items-center px-6 pt-2 pb-4 border-b border-surface-border/50">
            {isImage && previewUrls[file.id] ? (
              <TouchableOpacity
                onPress={() => openPreview(file.id)}
                activeOpacity={0.85}
                className="w-28 h-28 rounded-2xl mb-3 overflow-hidden border border-surface-border relative"
                style={Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : undefined}
              >
                <Image source={{ uri: previewUrls[file.id] }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
                <View className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full bg-black/55 items-center justify-center">
                  <FontAwesome name="search-plus" size={11} color="#fff" />
                </View>
              </TouchableOpacity>
            ) : previewKind && previewUrl ? (
              <FilePreviewTeaser uri={previewUrl} kind={previewKind} height={112} onPress={() => setPreviewOpen(true)} />
            ) : (
              <View className="w-20 h-20 bg-surface-background border border-surface-border rounded-2xl items-center justify-center mb-3">
                <FontAwesome name={icon as any} size={36} color={color} />
              </View>
            )}
            <Text className="text-typography-main text-lg font-black text-center" numberOfLines={2}>{file.original_name}</Text>
            <Text className="text-typography-muted text-sm mt-1">
              {formatFileSize(file.size_bytes)}{file.mime_type ? ` · ${file.mime_type.split('/').pop()?.toUpperCase()}` : ''}
            </Text>
            <View className="flex-row gap-2 mt-3">
              {([
                'details',
                'activity',
                ...(hasVersionHistory ? (['versions'] as const) : []),
              ] as const).map(t => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setTab(t)}
                  className={`px-5 py-2 rounded-2xl border ${tab === t ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
                >
                  <View className="relative">
                    <Text className={`text-xs font-black capitalize ${tab === t ? 'text-brand-primary' : 'text-typography-muted'}`}>{t}</Text>
                    {t === 'versions' && file.is_stale_restore && (
                      <View className="absolute -top-1 -right-1.5 w-2 h-2 rounded-full bg-state-warning" />
                    )}
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {tab === 'details' ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40, paddingTop: 16 }}>
            {/* Metadata */}
            <View className="bg-surface-background border border-surface-border rounded-2xl overflow-hidden mb-5">
              <View className="flex-row items-center px-4 py-3.5 border-b border-surface-border/50">
                <Text className="text-typography-muted text-xs w-24">From</Text>
                <Text className="text-typography-main text-xs font-bold flex-1">{file.uploader.full_name}</Text>
              </View>
              <View className="flex-row items-center px-4 py-3.5 border-b border-surface-border/50">
                <Text className="text-typography-muted text-xs w-24">Date</Text>
                <Text className="text-typography-main text-xs font-bold flex-1">{new Date(file.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
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

            {file.tags.length > 0 && (
              <View className="mb-5">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Tags</Text>
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

            {file.caption && (
              <View className="mb-5 bg-surface-background border border-surface-border rounded-2xl px-4 py-3">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-1">Note</Text>
                <Text className="text-typography-main text-sm leading-relaxed">{file.caption}</Text>
              </View>
            )}

            {/* Recipients (sent mode) */}
            {mode === 'sent' && file.recipients && file.recipients.length > 0 && (
              <View className="mb-5">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Recipients</Text>
                {file.recipients.map(r => (
                  <View key={r.id} className="flex-row items-center gap-3 py-2">
                    <View className="w-7 h-7 rounded-full bg-surface-background border border-surface-border items-center justify-center">
                      <FontAwesome name="user" size={10} color={colors.textMuted} />
                    </View>
                    <Text className="text-typography-main text-sm font-medium flex-1">{r.full_name}</Text>
                    {r.read_at && <FontAwesome name="check" size={10} color={colors.success} />}
                  </View>
                ))}
              </View>
            )}

            <View className="gap-3">
              <TouchableOpacity
                onPress={handleDownload}
                disabled={downloading}
                className="flex-row items-center justify-center bg-brand-primary rounded-2xl py-4 gap-2"
              >
                {downloading ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome name="download" size={14} color="#fff" />}
                <Text className="text-white font-black text-base">Download</Text>
              </TouchableOpacity>

              {isUnread && (
                <TouchableOpacity
                  onPress={() => { markRead(file.id); onClose(); }}
                  className="flex-row items-center justify-center bg-surface-background border border-surface-border rounded-2xl py-3.5 gap-2"
                >
                  <FontAwesome name="check" size={13} color={colors.primary} />
                  <Text className="text-brand-primary font-black text-sm">Mark as Read</Text>
                </TouchableOpacity>
              )}

              <View className="flex-row gap-3">
                {mode === 'inbox' && (
                  <TouchableOpacity
                    onPress={() => { hideFile(file.id); onClose(); }}
                    className="flex-1 flex-row items-center justify-center bg-surface-background border border-surface-border rounded-2xl py-3 gap-1.5"
                  >
                    <FontAwesome name="eye-slash" size={11} color={colors.textMuted} />
                    <Text className="text-typography-muted font-bold text-xs">Hide</Text>
                  </TouchableOpacity>
                )}
                {isOwner && (
                  <TouchableOpacity
                    onPress={handleDelete}
                    className="flex-1 flex-row items-center justify-center bg-state-danger/10 border border-state-danger/20 rounded-2xl py-3 gap-1.5"
                  >
                    <FontAwesome name="trash-o" size={11} color={colors.danger} />
                    <Text className="text-state-danger font-bold text-xs">Delete</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </ScrollView>
          ) : tab === 'activity' ? (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 16, paddingBottom: 40 }}>
            {activityLoading ? (
              <View className="py-10 items-center"><ActivityIndicator color={colors.primary} /></View>
            ) : activity.length === 0 ? (
              <View className="py-10 items-center px-8">
                <FontAwesome name="clock-o" size={28} color={colors.textMuted} />
                <Text className="text-typography-muted text-sm mt-3 text-center">No activity recorded yet</Text>
              </View>
            ) : (
              activity.map((entry, i) => {
                const meta = ACTIVITY_META[entry.action] ?? { icon: 'circle', color: '#94a3b8', label: entry.action };
                return (
                  <View key={entry.id} className={`flex-row items-start px-6 py-3.5 ${i < activity.length - 1 ? 'border-b border-surface-border/40' : ''}`}>
                    <View className="w-8 h-8 rounded-full items-center justify-center mr-3 flex-shrink-0 mt-0.5" style={{ backgroundColor: meta.color + '20' }}>
                      <FontAwesome name={meta.icon as any} size={12} color={meta.color} />
                    </View>
                    <View className="flex-1 min-w-0">
                      <Text className="text-typography-main text-sm font-bold">
                        {entry.user.full_name}{' '}
                        <Text className="text-typography-muted font-medium">{meta.label.toLowerCase()}</Text>
                      </Text>
                      <Text className="text-typography-dim text-xs mt-0.5">{relativeDate(entry.created_at)}</Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>
          ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 16, paddingBottom: 40 }}>
            {versionsLoading ? (
              <View className="py-10 items-center"><ActivityIndicator color={colors.primary} /></View>
            ) : versions.length === 0 ? (
              <View className="py-10 items-center px-8">
                <FontAwesome name="history" size={28} color={colors.textMuted} />
                <Text className="text-typography-muted text-sm mt-3 text-center">No version history</Text>
              </View>
            ) : (
              <>
              {file.is_stale_restore && (
                <View className="flex-row items-center justify-between px-6 py-3 mb-1 bg-state-warning/10 border-b border-state-warning/20">
                  <View className="flex-row items-center gap-2 flex-1 mr-2">
                    <FontAwesome name="exclamation-triangle" size={12} color={colors.warning} />
                    <Text className="text-state-warning text-xs font-bold flex-1">
                      An older version is current — a newer version exists.
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={handleRestoreLatest}
                    disabled={restoringLatest}
                    className="flex-row items-center gap-1.5 bg-state-warning/15 border border-state-warning/30 rounded-2xl px-3 py-2"
                  >
                    {restoringLatest
                      ? <ActivityIndicator size="small" color={colors.warning} />
                      : <FontAwesome name="arrow-up" size={11} color={colors.warning} />}
                    <Text className="text-state-warning font-black text-xs">Restore Latest</Text>
                  </TouchableOpacity>
                </View>
              )}
              {versions.map((v, i) => {
                const days = v.is_current ? null : expiresInDays(v.expires_at);
                return (
                  <View key={v.id} className={`px-6 py-4 ${i < versions.length - 1 ? 'border-b border-surface-border/40' : ''}`}>
                    <View className="flex-row items-center gap-2 mb-1">
                      <Text className="text-typography-main text-sm font-black">Version {v.version_no}</Text>
                      {v.is_current && (
                        <View className="px-2 py-0.5 rounded-full bg-brand-primary/10 border border-brand-primary/30">
                          <Text className="text-brand-primary text-[10px] font-black uppercase tracking-wide">Current</Text>
                        </View>
                      )}
                    </View>
                    <Text className="text-typography-muted text-xs" numberOfLines={1}>
                      {v.uploader.full_name} · {formatFileSize(v.size_bytes)} · {relativeDate(v.created_at)}
                    </Text>
                    {!v.is_current && (
                      <Text className="text-typography-dim text-[11px] mt-0.5">
                        {v.pinned ? 'Pinned — kept forever' : (days != null ? `Expires in ${days} day${days === 1 ? '' : 's'}` : 'Expiring soon')}
                      </Text>
                    )}
                    <View className="flex-row gap-2 mt-2.5">
                      {getPreviewKind(v.mime_type ?? file.mime_type, v.original_name) && (
                        <TouchableOpacity
                          onPress={() => handleVersionPreview(v)}
                          className="flex-row items-center justify-center bg-surface-background border border-surface-border rounded-2xl px-4 py-2.5 gap-1.5"
                        >
                          <FontAwesome name="eye" size={12} color={colors.textMuted} />
                          <Text className="text-typography-muted font-bold text-xs">Preview</Text>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        onPress={() => handleVersionDownload(v)}
                        className="flex-row items-center justify-center bg-surface-background border border-surface-border rounded-2xl px-4 py-2.5 gap-1.5"
                      >
                        <FontAwesome name="download" size={12} color={colors.textMuted} />
                        <Text className="text-typography-muted font-bold text-xs">Download</Text>
                      </TouchableOpacity>
                      {!v.is_current && (
                        <TouchableOpacity
                          onPress={() => handleRestore(v)}
                          disabled={restoringId === v.id}
                          className="flex-row items-center justify-center bg-brand-primary/10 border border-brand-primary/30 rounded-2xl px-4 py-2.5 gap-1.5"
                        >
                          {restoringId === v.id
                            ? <ActivityIndicator size="small" color={colors.primary} />
                            : <FontAwesome name="undo" size={12} color={colors.primary} />}
                          <Text className="text-brand-primary font-bold text-xs">Restore</Text>
                        </TouchableOpacity>
                      )}
                      {!v.is_current && (
                        <TouchableOpacity
                          onPress={() => handleTogglePin(v)}
                          disabled={pinningId === v.id}
                          className={`flex-row items-center justify-center rounded-2xl px-4 py-2.5 gap-1.5 border ${
                            v.pinned ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'
                          }`}
                        >
                          {pinningId === v.id
                            ? <ActivityIndicator size="small" color={colors.primary} />
                            : <FontAwesome name="thumb-tack" size={12} color={v.pinned ? colors.primary : colors.textMuted} />}
                          <Text className={`font-bold text-xs ${v.pinned ? 'text-brand-primary' : 'text-typography-muted'}`}>
                            {v.pinned ? 'Pinned' : 'Pin'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                );
              })}
              </>
            )}
          </ScrollView>
          )}
        </View>
      </View>
    </Modal>
    {previewLightbox}
    {previewKind && previewUrl && (
      <FilePreviewModal
        visible={previewOpen}
        uri={previewUrl}
        kind={previewKind}
        fileName={file.original_name}
        onClose={() => setPreviewOpen(false)}
        onDownload={handleDownload}
      />
    )}
    {versionPreview && (
      <FilePreviewModal
        visible
        uri={versionPreview.uri}
        kind={versionPreview.kind}
        fileName={`${versionPreview.name} (v${versionPreview.versionNo})`}
        onClose={() => setVersionPreview(null)}
      />
    )}
    </>
  );
}

// ─── Upload helpers ───────────────────────────────────────────────────────────

const ALLOWED_EXTENSIONS = new Set([
  'pdf','doc','docx','xls','xlsx','ppt','pptx','csv','txt','rtf','odt','ods','odp',
  'jpg','jpeg','png','gif','webp','svg','bmp','tiff','tif','heic','heif','avif',
  'mp4','mov','avi','mkv','webm','m4v','wmv','flv','ogv',
  'mp3','wav','aac','ogg','flac','m4a','wma','opus',
  'zip','rar','7z','tar','gz','tgz','bz2','xz',
  'json','xml','yaml','yml','toml','sql','md','html','css','js','ts','jsx','tsx',
]);

const ALLOWED_TYPES_MESSAGE =
  '• Documents: PDF, Word, Excel, PowerPoint, CSV, TXT, RTF\n' +
  '• Images: JPG, PNG, GIF, WEBP, SVG, HEIC\n' +
  '• Video: MP4, MOV, AVI, MKV, WEBM\n' +
  '• Audio: MP3, WAV, AAC, OGG, FLAC\n' +
  '• Archives: ZIP, RAR, 7Z, TAR, GZ\n' +
  '• Data: JSON, XML, YAML, SQL, HTML, JS, TS';

function isAllowedFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ALLOWED_EXTENSIONS.has(ext);
}

// ─── Upload Sheet ─────────────────────────────────────────────────────────────

function UploadSheet({
  visible,
  onClose,
  onUploaded,
  hasPermission,
  profile,
  activeGroup,
}: {
  visible: boolean;
  onClose: () => void;
  onUploaded: () => void;
  hasPermission: (key: string) => boolean;
  profile: any;
  activeGroup?: { id: string; name: string; avatar_color: string } | null;
}) {
  const { folders, checkDuplicate, checkNameConflict, replaceFile } = useFileHub();
  const fileInputRef = useRef<any>(null);
  const folderInputRef = useRef<any>(null);

  type PickedFile = { name: string; size: number; uri: string; type?: string; webFile?: File };
  const [pickedFiles, setPickedFiles] = useState<PickedFile[]>([]);
  const [visibility, setVisibility] = useState<'direct' | 'broadcast' | 'group'>('direct');
  const [recipientSearch, setRecipientSearch] = useState('');
  const [memberResults, setMemberResults] = useState<any[]>([]);
  const [selectedRecipients, setSelectedRecipients] = useState<any[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [caption, setCaption] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const colors = useThemeColors();

  // Web-safe replacement for Alert.alert multi-button prompts (RN Alert.alert
  // does not render usable buttons on web, which hung uploads at the conflict
  // / duplicate check). Renders an in-sheet dialog and resolves on press.
  type DecisionOption = { label: string; value: string; style?: 'primary' | 'cancel' | 'default' };
  const [pendingDecision, setPendingDecision] = useState<
    { title: string; message: string; options: DecisionOption[]; resolve: (v: string) => void } | null
  >(null);
  const askDecision = (title: string, message: string, options: DecisionOption[]) =>
    new Promise<string>(resolve => setPendingDecision({ title, message, options, resolve }));

  const canBroadcast = hasPermission('filehub:broadcast');

  const resetAll = () => {
    setPickedFiles([]);
    setVisibility(activeGroup ? 'group' : 'direct');
    setRecipientSearch('');
    setMemberResults([]);
    setSelectedRecipients([]);
    setFolderId(null);
    setTags([]);
    setTagInput('');
    setCaption('');
    setUploading(false);
    setUploadingIndex(0);
    setProgress(0);
  };

  useEffect(() => {
    if (!visible) resetAll();
    else if (activeGroup) setVisibility('group');
  }, [visible, activeGroup?.id]);

  const addTag = (t: string) => {
    const clean = t.trim().toLowerCase().replace(/\s+/g, '-');
    if (!clean || tags.includes(clean)) return;
    setTags(prev => [...prev, clean]);
    setTagInput('');
  };

  const toggleRecipient = (m: any) => {
    setSelectedRecipients(prev =>
      prev.find(r => r.id === m.id) ? prev.filter(r => r.id !== m.id) : [...prev, m]
    );
  };

  const searchMembers = useCallback(async (query: string) => {
    setRecipientSearch(query);
    if (!query.trim()) { setMemberResults([]); return; }
    const { data } = await supabase.from('users').select('id, full_name, avatar_url').ilike('full_name', `%${query}%`).limit(8);
    setMemberResults(data || []);
  }, []);

  const processWebFiles = (fileList: FileList | null): PickedFile[] => {
    if (!fileList || fileList.length === 0) return [];
    const valid: PickedFile[] = [];
    const rejected: string[] = [];
    Array.from(fileList)
      .filter(f => !f.name.startsWith('.'))
      .forEach(file => {
        if (isAllowedFile(file.name)) {
          valid.push({ name: file.name, size: file.size, uri: '', type: file.type, webFile: file });
        } else {
          rejected.push(file.name);
        }
      });
    if (rejected.length > 0) {
      Alert.alert(
        'Unsupported File Type',
        `${rejected.length === 1 ? `"${rejected[0]}" is` : `${rejected.length} files are`} not supported.\n\nSupported types:\n${ALLOWED_TYPES_MESSAGE}`,
      );
    }
    return valid;
  };

  const handleWebFileChange = (e: any) => {
    const valid = processWebFiles(e.target?.files);
    if (valid.length > 0) setPickedFiles(prev => [...prev, ...valid]);
    e.target.value = '';
  };

  const handleFolderChange = (e: any) => {
    const valid = processWebFiles(e.target?.files);
    if (valid.length > 0) setPickedFiles(prev => [...prev, ...valid]);
    e.target.value = '';
  };

  const pickFile = async () => {
    if (Platform.OS === 'web') {
      fileInputRef.current?.click();
    } else {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
      if (!result.canceled && result.assets) {
        const valid: PickedFile[] = [];
        const rejected: string[] = [];
        result.assets.forEach(a => {
          if (isAllowedFile(a.name)) {
            valid.push({ name: a.name, size: a.size ?? 0, uri: a.uri, type: a.mimeType });
          } else {
            rejected.push(a.name);
          }
        });
        if (rejected.length > 0) {
          Alert.alert('Unsupported File Type', `${rejected.length === 1 ? `"${rejected[0]}" is` : `${rejected.length} files are`} not supported.\n\nSupported types:\n${ALLOWED_TYPES_MESSAGE}`);
        }
        if (valid.length > 0) setPickedFiles(prev => [...prev, ...valid]);
      }
    }
  };

  const handleUpload = async () => {
    if (pickedFiles.length === 0 || uploading) return;
    const companyId = profile?.company_id;
    if (!companyId) { Alert.alert('Error', 'Company not found.'); return; }
    if (visibility === 'direct' && selectedRecipients.length === 0) {
      Alert.alert('Error', 'Please select at least one recipient.');
      return;
    }
    if (visibility === 'group' && !activeGroup?.id) {
      Alert.alert('Error', 'No channel selected.');
      return;
    }

    setUploading(true);
    const errors: string[] = [];

    for (let i = 0; i < pickedFiles.length; i++) {
      const pf = pickedFiles[i];
      setUploadingIndex(i);
      setProgress(5);
      try {
        let contentHash = '';
        if (Platform.OS === 'web' && pf.webFile) {
          contentHash = await computeSHA256Web(pf.webFile);
        }
        setProgress(25);

        if (contentHash) {
          const dupes = await checkDuplicate(contentHash);
          if (dupes.length > 0) {
            const proceed = await askDecision(
              'Possible Duplicate',
              `"${dupes[0].original_name}" has the same content as "${pf.name}". Upload anyway?`,
              [
                { label: 'Cancel', value: 'cancel', style: 'cancel' },
                { label: 'Upload Anyway', value: 'proceed', style: 'primary' },
              ]
            );
            if (proceed !== 'proceed') continue;
          }
        }

        // Name-conflict prompt (Replace / Keep Both / Cancel)
        const groupId = visibility === 'group' ? (activeGroup?.id ?? null) : null;
        const conflict = await checkNameConflict(pf.name, visibility, groupId, folderId || null);
        if (conflict) {
          const choice = await askDecision(
            'File already exists',
            `"${pf.name}" already exists here (uploaded by ${conflict.uploader_name}). Replace it with a new version, or keep both?`,
            [
              { label: 'Cancel', value: 'cancel', style: 'cancel' },
              { label: 'Keep Both', value: 'keep', style: 'default' },
              { label: 'Replace', value: 'replace', style: 'primary' },
            ]
          );
          if (choice === 'cancel') continue;
          if (choice === 'replace') {
            const replaceId = (crypto as any).randomUUID();
            const replaceSafeName = pf.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const replacePath = `${companyId}/${replaceId}/${replaceSafeName}`;
            setProgress(40);
            let replaceStorageError;
            if (Platform.OS === 'web' && pf.webFile) {
              ({ error: replaceStorageError } = await supabase.storage.from('filehub-files').upload(replacePath, pf.webFile));
            } else {
              ({ error: replaceStorageError } = await supabase.storage.from('filehub-files').upload(replacePath, { uri: pf.uri, name: pf.name, type: pf.type ?? 'application/octet-stream' } as any));
            }
            if (replaceStorageError) throw replaceStorageError;
            setProgress(80);
            await replaceFile(conflict.id, {
              storagePath: replacePath,
              size: pf.size,
              hash: contentHash || null,
              mime: pf.type ?? null,
              caption: caption || null,
            });
            setProgress(100);
            continue;
          }
          // 'keep' falls through to the normal upload_commit path (server auto-renames)
        }

        const fileId = (crypto as any).randomUUID();
        const safeName = pf.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `${companyId}/${fileId}/${safeName}`;
        setProgress(40);

        let storageError;
        if (Platform.OS === 'web' && pf.webFile) {
          ({ error: storageError } = await supabase.storage.from('filehub-files').upload(storagePath, pf.webFile));
        } else {
          ({ error: storageError } = await supabase.storage.from('filehub-files').upload(storagePath, { uri: pf.uri, name: pf.name, type: pf.type ?? 'application/octet-stream' } as any));
        }
        if (storageError) throw storageError;
        setProgress(80);

        const { error: rpcError } = await supabase.rpc('rpc_filehub_upload_commit', {
          p_storage_path: storagePath,
          p_visibility: visibility,
          p_recipient_ids: visibility === 'direct' ? selectedRecipients.map(r => r.id) : [],
          p_folder_id: folderId || null,
          p_tags: tags,
          p_caption: caption || null,
          p_original_name: pf.name,
          p_mime_type: pf.type ?? null,
          p_size_bytes: pf.size,
          p_content_hash: contentHash || null,
          p_replaces_file_id: null,
          p_group_id: visibility === 'group' ? (activeGroup?.id ?? null) : null,
        });
        if (rpcError) throw rpcError;
        setProgress(100);
      } catch (e: any) {
        errors.push(`${pf.name}: ${e.message || 'Unknown error'}`);
      }
    }

    setUploading(false);
    setProgress(0);

    const successCount = pickedFiles.length - errors.length;
    if (errors.length > 0 && successCount > 0) {
      Alert.alert('Some uploads failed', errors.join('\n'));
    } else if (errors.length === pickedFiles.length) {
      Alert.alert('Upload Failed', errors.join('\n'));
      return;
    }

    onUploaded();
    onClose();
  };

  return (
    <>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <TouchableOpacity className="flex-1" onPress={onClose} activeOpacity={1} />
        <View className="bg-surface-card rounded-t-[2rem] border-t border-surface-border" style={{ maxHeight: '90%' }}>
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 bg-surface-border rounded-full" />
          </View>

          {Platform.OS === 'web' && (
            <>
              <input ref={fileInputRef} type="file" multiple style={{ display: 'none' }} onChange={handleWebFileChange} />
              <input ref={folderInputRef} type="file" {...({ webkitdirectory: '', multiple: '' } as any)} style={{ display: 'none' }} onChange={handleFolderChange} />
            </>
          )}

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40, gap: 20 }}>
            <View className="flex-row items-center justify-between pt-2">
              <Text className="text-typography-main text-xl font-black tracking-tight">
                {activeGroup ? `Upload to ${activeGroup.name}` : 'Upload Files'}
              </Text>
              <TouchableOpacity onPress={onClose} className="w-8 h-8 bg-surface-background border border-surface-border rounded-xl items-center justify-center">
                <FontAwesome name="times" size={12} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
              {/* File picker area */}
              {pickedFiles.length === 0 ? (
                <View className="border-2 border-dashed border-surface-border rounded-2xl items-center py-10 gap-4 px-6 mx-6">
                  <View className="w-14 h-14 bg-surface-background border border-surface-border rounded-2xl items-center justify-center">
                    <FontAwesome name="cloud-upload" size={24} color={colors.textMuted} />
                  </View>
                  <Text className="text-typography-main font-bold">Choose files to upload</Text>
                  <Text className="text-typography-muted text-xs text-center px-4">Up to 500 MB per file</Text>
                  <View className="flex-row gap-3">
                    <TouchableOpacity onPress={pickFile} className="flex-row items-center gap-2 bg-brand-primary px-5 py-2.5 rounded-xl">
                      <FontAwesome name="files-o" size={12} color="#fff" />
                      <Text className="text-white font-black text-sm">Files</Text>
                    </TouchableOpacity>
                    {Platform.OS === 'web' && (
                      <TouchableOpacity onPress={() => folderInputRef.current?.click()} className="flex-row items-center gap-2 bg-surface-background border border-surface-border px-5 py-2.5 rounded-xl">
                        <FontAwesome name="folder-open" size={12} color={colors.textMuted} />
                        <Text className="text-typography-muted font-black text-sm">Folder</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ) : (
                <AdaptiveFileGrid 
                  files={pickedFiles}
                  onRemove={(idx) => setPickedFiles(prev => prev.filter((_, i) => i !== idx))}
                  onAddMore={pickFile}
                  formatFileSize={formatFileSize} // Handing it down
                  getMimeIcon={getMimeIcon}       // Handing it down
                />
              )}
            {pickedFiles.length > 0 && (
              <>
                {/* Visibility — only show if NOT in group context */}
                {!activeGroup && (
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
                )}

                {/* Channel badge when uploading to a channel */}
                {activeGroup && (
                  <View className="flex-row items-center gap-3 bg-surface-background border border-surface-border rounded-2xl px-4 py-3">
                    <View className="w-8 h-8 rounded-xl items-center justify-center" style={{ backgroundColor: activeGroup.avatar_color + '22' }}>
                      <Text style={{ color: activeGroup.avatar_color, fontSize: 13, fontWeight: '900' }}>{getInitials(activeGroup.name)}</Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Sharing to channel</Text>
                      <Text className="text-typography-main font-bold text-sm">{activeGroup.name}</Text>
                    </View>
                  </View>
                )}

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
                            <FontAwesome name="times" size={9} color={colors.primary} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    )}
                    <View className="flex-row items-center bg-surface-background border border-surface-border rounded-2xl px-4 py-3 gap-2">
                      <FontAwesome name="search" size={12} color={colors.textMuted} />
                      <TextInput
                        value={recipientSearch}
                        onChangeText={searchMembers}
                        placeholder="Search team members…"
                        placeholderTextColor={colors.textDim}
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
                              <FontAwesome name="check" size={11} color={colors.primary} />
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
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, flexDirection: 'row', alignItems: 'center' }}>
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
                          <FontAwesome name="times" size={8} color={colors.textMuted} />
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                  <View className="flex-row items-center bg-surface-background border border-surface-border rounded-2xl px-4 py-3 gap-2">
                    <FontAwesome name="tag" size={11} color={colors.textMuted} />
                    <TextInput
                      value={tagInput}
                      onChangeText={setTagInput}
                      onSubmitEditing={() => addTag(tagInput)}
                      placeholder="Add tag…"
                      placeholderTextColor={colors.textDim}
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
                    placeholderTextColor={colors.textDim}
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
                        {pickedFiles.length > 1 ? `File ${uploadingIndex + 1} of ${pickedFiles.length} · ` : ''}
                        {progress < 25 ? 'Preparing…' : progress < 80 ? 'Uploading…' : 'Finishing…'}
                      </Text>
                      <Text className="text-brand-primary text-xs font-black">{progress}%</Text>
                    </View>
                    <View className="h-1.5 bg-surface-border rounded-full overflow-hidden">
                      <View className="h-full bg-brand-primary rounded-full" style={{ width: `${progress}%` }} />
                    </View>
                  </View>
                )}

                <TouchableOpacity
                  onPress={handleUpload}
                  disabled={uploading || (visibility === 'direct' && selectedRecipients.length === 0)}
                  className="items-center justify-center bg-brand-primary rounded-2xl py-4"
                  style={{ opacity: (uploading || (visibility === 'direct' && selectedRecipients.length === 0)) ? 0.5 : 1 }}
                >
                  {uploading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text className="text-white font-black text-base">
                        {pickedFiles.length > 1
                          ? `Send ${pickedFiles.length} Files`
                          : visibility === 'group' ? 'Share to Channel' : 'Send File'}
                      </Text>
                  }
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>

    {/* Web-safe decision dialog (replaces RN Alert.alert multi-button prompts) */}
    {pendingDecision && (
      <Modal visible transparent animationType="fade">
        <View className="flex-1 bg-black/60 items-center justify-center p-8">
          <View className="bg-surface-card rounded-3xl border border-surface-border premium-shadow w-full max-w-[420px] p-6">
            <Text className="text-typography-main text-lg font-black tracking-tight mb-2">{pendingDecision.title}</Text>
            <Text className="text-typography-muted text-sm leading-relaxed mb-5">{pendingDecision.message}</Text>
            <View className="gap-2">
              {pendingDecision.options.map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => { const r = pendingDecision.resolve; setPendingDecision(null); r(opt.value); }}
                  className={`py-3 rounded-xl items-center ${opt.style === 'primary' ? 'bg-brand-primary' : 'bg-surface-background border border-surface-border'}`}
                >
                  <Text className={`font-black text-sm ${opt.style === 'primary' ? 'text-white' : opt.style === 'cancel' ? 'text-typography-muted' : 'text-typography-main'}`}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    )}
    </>
  );
}

// ─── Group Card ───────────────────────────────────────────────────────────────

function GroupCard({ group, onPress }: { group: FileHubGroup; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      className="bg-surface-card border border-surface-border rounded-2xl px-4 py-4 mb-3 flex-row items-center gap-4"
    >
      {/* Avatar */}
      <View
        className="w-12 h-12 rounded-2xl items-center justify-center flex-shrink-0"
        style={{ backgroundColor: group.avatar_color + '22' }}
      >
        <Text style={{ color: group.avatar_color, fontSize: 16, fontWeight: '900' }}>
          {getInitials(group.name)}
        </Text>
      </View>

      {/* Info */}
      <View className="flex-1 min-w-0">
        <Text className="text-typography-main font-black text-base mb-0.5" numberOfLines={1}>{group.name}</Text>
        {group.description ? (
          <Text className="text-typography-muted text-xs mb-1" numberOfLines={1}>{group.description}</Text>
        ) : null}
        <View className="flex-row items-center gap-3">
          {/* Member count */}
          <View className="flex-row items-center gap-1.5">
            <FontAwesome name="users" size={10} color={colors.textMuted} />
            <Text className="text-typography-dim text-xs">{group.member_count} member{group.member_count !== 1 ? 's' : ''}</Text>
          </View>
          {/* File count */}
          <View className="flex-row items-center gap-1.5">
            <FontAwesome name="files-o" size={10} color={colors.textMuted} />
            <Text className="text-typography-dim text-xs">{group.file_count} file{group.file_count !== 1 ? 's' : ''}</Text>
          </View>
        </View>
      </View>

      {/* Last activity + chevron */}
      <View className="items-end gap-1.5">
        {group.last_activity && (
          <Text className="text-typography-dim text-xs">{relativeDate(group.last_activity)}</Text>
        )}
        <FontAwesome name="chevron-right" size={10} color={colors.textDim} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Group Create Sheet ───────────────────────────────────────────────────────

function GroupCreateSheet({
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
  const colors = useThemeColors();

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

  const toggleMember = (m: any) => {
    setSelectedMembers(prev => prev.find(r => r.id === m.id) ? prev.filter(r => r.id !== m.id) : [...prev, m]);
  };

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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <TouchableOpacity className="flex-1" onPress={onClose} activeOpacity={1} />
        <View className="bg-surface-card rounded-t-[2rem] border-t border-surface-border" style={{ maxHeight: '85%' }}>
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 bg-surface-border rounded-full" />
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40, gap: 20 }}>
            <View className="flex-row items-center justify-between">
              <Text className="text-typography-main text-xl font-black">New Channel</Text>
              <TouchableOpacity onPress={onClose} className="w-8 h-8 bg-surface-background border border-surface-border rounded-xl items-center justify-center">
                <FontAwesome name="times" size={12} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Color + Preview */}
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
                    className="w-8 h-8 rounded-full items-center justify-center"
                    style={{ backgroundColor: c, borderWidth: selectedColor === c ? 3 : 0, borderColor: 'white', opacity: selectedColor === c ? 1 : 0.7 }}
                  />
                ))}
              </View>
            </View>

            {/* Name */}
            <View className="gap-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Channel Name</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="e.g. Design Team"
                placeholderTextColor={colors.textDim}
                maxLength={80}
                className="bg-surface-background border border-surface-border rounded-2xl px-4 py-3 text-typography-main text-sm font-bold"
              />
            </View>

            {/* Description */}
            <View className="gap-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Description (optional)</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="What's this channel for?"
                placeholderTextColor={colors.textDim}
                multiline
                numberOfLines={2}
                maxLength={300}
                className="bg-surface-background border border-surface-border rounded-2xl px-4 py-3 text-typography-main text-sm"
                style={{ minHeight: 70, textAlignVertical: 'top' }}
              />
            </View>

            {/* Members */}
            <View className="gap-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Invite Members</Text>
              {selectedMembers.length > 0 && (
                <View className="flex-row flex-wrap gap-2 mb-1">
                  {selectedMembers.map(m => (
                    <TouchableOpacity
                      key={m.id}
                      onPress={() => toggleMember(m)}
                      className="flex-row items-center gap-1.5 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-3 py-1"
                    >
                      <Text className="text-brand-primary text-xs font-bold">{m.full_name}</Text>
                      <FontAwesome name="times" size={9} color={colors.primary} />
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View className="flex-row items-center bg-surface-background border border-surface-border rounded-2xl px-4 py-3 gap-2">
                <FontAwesome name="search" size={12} color={colors.textMuted} />
                <TextInput
                  value={memberSearch}
                  onChangeText={searchMembers}
                  placeholder="Search team members…"
                  placeholderTextColor={colors.textDim}
                  className="flex-1 text-typography-main text-sm"
                />
              </View>
              {memberResults.length > 0 && (
                <View className="bg-surface-background border border-surface-border rounded-2xl overflow-hidden">
                  {memberResults.map((m, i) => (
                    <TouchableOpacity
                      key={m.id}
                      onPress={() => toggleMember(m)}
                      className={`flex-row items-center px-4 py-3 gap-3 ${i < memberResults.length - 1 ? 'border-b border-surface-border/50' : ''}`}
                    >
                      <Text className="flex-1 text-typography-main text-sm font-medium">{m.full_name}</Text>
                      {selectedMembers.find(r => r.id === m.id) && (
                        <FontAwesome name="check" size={11} color={colors.primary} />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <TouchableOpacity
              onPress={handleCreate}
              disabled={!name.trim() || creating}
              className="items-center justify-center bg-brand-primary rounded-2xl py-4"
              style={{ opacity: !name.trim() || creating ? 0.5 : 1 }}
            >
              {creating
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text className="text-white font-black text-base">Create Channel</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── Group Members Sheet ──────────────────────────────────────────────────────

function GroupMembersSheet({
  visible,
  group,
  currentUserId,
  onClose,
  onMembersChanged,
}: {
  visible: boolean;
  group: FileHubGroup | null;
  currentUserId: string | undefined;
  onClose: () => void;
  onMembersChanged: () => void;
}) {
  const { addGroupMember, removeGroupMember, fetchGroupMembers } = useFileHub();
  const [members, setMembers] = useState<FileHubGroupMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState<any[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const colors = useThemeColors();

  useEffect(() => {
    if (!visible || !group) { setMembers([]); setAddSearch(''); setAddResults([]); return; }
    setLoadingMembers(true);
    fetchGroupMembers(group.id)
      .then(setMembers)
      .catch(console.error)
      .finally(() => setLoadingMembers(false));
  }, [visible, group?.id]);

  const searchAdd = useCallback(async (query: string) => {
    setAddSearch(query);
    if (!query.trim()) { setAddResults([]); return; }
    const { data } = await supabase.from('users').select('id, full_name').ilike('full_name', `%${query}%`).limit(6);
    // Filter out already-members
    setAddResults((data || []).filter((u: any) => !members.find(m => m.id === u.id)));
  }, [members]);

  const handleAdd = async (userId: string, fullName: string) => {
    if (!group) return;
    setAddingId(userId);
    try {
      await addGroupMember(group.id, userId);
      const updated = await fetchGroupMembers(group.id);
      setMembers(updated);
      setAddSearch('');
      setAddResults([]);
      onMembersChanged();
    } catch {
      // error shown by context
    } finally {
      setAddingId(null);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!group) return;
    const target = members.find(m => m.id === userId);
    Alert.alert(
      userId === currentUserId ? 'Leave Channel' : `Remove ${target?.full_name ?? 'member'}`,
      userId === currentUserId ? 'Are you sure you want to leave this channel?' : `Remove ${target?.full_name ?? 'this member'} from the channel?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: userId === currentUserId ? 'Leave' : 'Remove',
          style: 'destructive',
          onPress: async () => {
            setRemovingId(userId);
            try {
              await removeGroupMember(group.id, userId);
              const updated = await fetchGroupMembers(group.id);
              setMembers(updated);
              onMembersChanged();
              if (userId === currentUserId) onClose();
            } catch {
              // error shown by context
            } finally {
              setRemovingId(null);
            }
          },
        },
      ]
    );
  };

  if (!group) return null;

  const myRole = members.find(m => m.id === currentUserId)?.role;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <TouchableOpacity className="flex-1" onPress={onClose} activeOpacity={1} />
        <View className="bg-surface-card rounded-t-[2rem] border-t border-surface-border" style={{ maxHeight: '80%' }}>
          <View className="items-center pt-3 pb-2">
            <View className="w-10 h-1 bg-surface-border rounded-full" />
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40, gap: 16 }}>
            <View className="flex-row items-center justify-between">
              <Text className="text-typography-main text-xl font-black">{group.name}</Text>
              <TouchableOpacity onPress={onClose} className="w-8 h-8 bg-surface-background border border-surface-border rounded-xl items-center justify-center">
                <FontAwesome name="times" size={12} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {/* Add member search */}
            <View className="gap-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Add Member</Text>
              <View className="flex-row items-center bg-surface-background border border-surface-border rounded-2xl px-4 py-3 gap-2">
                <FontAwesome name="user-plus" size={12} color={colors.textMuted} />
                <TextInput
                  value={addSearch}
                  onChangeText={searchAdd}
                  placeholder="Search to add…"
                  placeholderTextColor={colors.textDim}
                  className="flex-1 text-typography-main text-sm"
                />
              </View>
              {addResults.length > 0 && (
                <View className="bg-surface-background border border-surface-border rounded-2xl overflow-hidden">
                  {addResults.map((m, i) => (
                    <TouchableOpacity
                      key={m.id}
                      onPress={() => handleAdd(m.id, m.full_name)}
                      disabled={addingId === m.id}
                      className={`flex-row items-center px-4 py-3 gap-3 ${i < addResults.length - 1 ? 'border-b border-surface-border/50' : ''}`}
                    >
                      <Text className="flex-1 text-typography-main text-sm">{m.full_name}</Text>
                      {addingId === m.id
                        ? <ActivityIndicator size="small" color={colors.primary} />
                        : <FontAwesome name="plus" size={11} color={colors.primary} />
                      }
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* Members list */}
            <View className="gap-2">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">
                Members ({members.length})
              </Text>
              {loadingMembers ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <View className="bg-surface-background border border-surface-border rounded-2xl overflow-hidden">
                  {members.map((m, i) => (
                    <View
                      key={m.id}
                      className={`flex-row items-center px-4 py-3 gap-3 ${i < members.length - 1 ? 'border-b border-surface-border/50' : ''}`}
                    >
                      <View className="w-8 h-8 rounded-full bg-brand-primary/10 border border-brand-primary/20 items-center justify-center">
                        <Text className="text-brand-primary text-[10px] font-black">{getInitials(m.full_name)}</Text>
                      </View>
                      <Text className="flex-1 text-typography-main text-sm font-medium">{m.full_name}</Text>
                      {m.role === 'admin' && (
                        <View className="bg-brand-primary/10 border border-brand-primary/20 rounded-full px-2 py-0.5 mr-2">
                          <Text className="text-brand-primary text-[9px] font-black">Admin</Text>
                        </View>
                      )}
                      {(myRole === 'admin' || m.id === currentUserId) && (
                        <TouchableOpacity
                          onPress={() => handleRemove(m.id)}
                          disabled={removingId === m.id}
                          className="w-7 h-7 items-center justify-center rounded-lg bg-state-danger/10"
                        >
                          {removingId === m.id
                            ? <ActivityIndicator size="small" color={colors.danger} />
                            : <FontAwesome name={m.id === currentUserId ? 'sign-out' : 'user-times'} size={11} color={colors.danger} />
                          }
                        </TouchableOpacity>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ─── File Card ────────────────────────────────────────────────────────────────

function FileCard({
  file,
  mode,
  onPress,
  selectionMode = false,
  isFileSelected = false,
  onToggleSelect,
  thumbUri,
}: {
  file: FileHubFile;
  mode: FileHubMode;
  onPress: (e?: any) => void;
  selectionMode?: boolean;
  isFileSelected?: boolean;
  onToggleSelect?: () => void;
  thumbUri?: string;
}) {
  const { icon, color } = getMimeIcon(file.mime_type);
  const isUnread = mode === 'inbox' && !file.recipient_state?.read_at;
  const colors = useThemeColors();

  return (
    <TouchableOpacity
      onPress={(e) => (selectionMode ? onToggleSelect?.() : onPress(e))}
      className={`border rounded-2xl px-4 py-4 mb-3 flex-row items-center gap-3 ${
        isFileSelected
          ? 'bg-brand-primary/10 border-brand-primary/40'
          : 'bg-surface-card border-surface-border'
      }`}
    >
      {selectionMode ? (
        <View className={`w-11 h-11 rounded-xl items-center justify-center flex-shrink-0 border-2 ${
          isFileSelected ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
        }`}>
          {isFileSelected && <FontAwesome name="check" size={16} color="#fff" />}
        </View>
      ) : (
        <View className="w-11 h-11 bg-surface-background border border-surface-border rounded-xl items-center justify-center flex-shrink-0 overflow-hidden">
          {thumbUri ? (
            <Image source={{ uri: thumbUri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <FontAwesome name={icon as any} size={20} color={colors.textMain} />
          )}
        </View>
      )}
      <View className="flex-1 min-w-0">
        <View className="flex-row items-center gap-2 mb-0.5">
          {isUnread && <View className="w-2 h-2 rounded-full bg-brand-primary flex-shrink-0" />}
          <Text className="text-typography-main font-black text-sm flex-1" numberOfLines={1}>{file.original_name}</Text>
          {!!file.version_count && file.version_count > 1 && (
            <View className="px-1.5 py-0.5 rounded-full bg-surface-background border border-surface-border flex-shrink-0">
              <Text className="text-typography-dim text-[9px] font-bold">v{file.version_count}</Text>
            </View>
          )}
          {file.is_stale_restore && (
            <View className="px-1.5 py-0.5 rounded-full bg-state-warning/10 border border-state-warning/30 flex-shrink-0">
              <Text className="text-state-warning text-[9px] font-black uppercase tracking-wide">Outdated</Text>
            </View>
          )}
        </View>
        <Text className="text-typography-muted text-xs" numberOfLines={1}>
          {file.uploader.full_name} · {file.mime_type?.split('/').pop()?.toUpperCase() ?? 'File'} · {formatFileSize(file.size_bytes)}
        </Text>
        {file.tags.length > 0 && (
          <View className="flex-row flex-wrap gap-1 mt-1.5">
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
      <Text className="text-typography-dim text-xs flex-shrink-0">{relativeDate(file.created_at)}</Text>
    </TouchableOpacity>
  );
}

// ─── Tags Manage Sheet ────────────────────────────────────────────────────────

function TagsManageSheet({ visible, onClose, onChanged }: {
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { allTagsWithCounts, renameTag, deleteTag } = useFileHub();
  const { showConfirm } = useAlert();
  const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [renamingTag, setRenamingTag] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [savingTag, setSavingTag] = useState<string | null>(null);
  const colors = useThemeColors();
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
    showConfirm(
      'Delete Tag',
      `Remove tag "${tag}" from all files?`,
      async () => { try { await deleteTag(tag); await load(); onChanged(); } catch { /* alerted */ } },
      undefined, 'Delete', 'Cancel', 'destructive'
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <TouchableOpacity className="flex-1" onPress={onClose} activeOpacity={1} />
        <View className="bg-surface-card rounded-t-[2rem] border-t border-surface-border" style={{ maxHeight: '75%' }}>
          <View className="items-center pt-3 pb-1">
            <View className="w-10 h-1 bg-surface-border rounded-full" />
          </View>
          <View className="flex-row items-center justify-between px-6 py-4 border-b border-surface-border">
            <View className="flex-row items-center gap-2">
              <FontAwesome name="tags" size={14} color={colors.primary} />
              <Text className="text-typography-main font-black text-lg">Manage Tags</Text>
            </View>
            <TouchableOpacity onPress={onClose}>
              <FontAwesome name="times" size={18} color={colors.textMuted}   />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View className="py-10 items-center"><ActivityIndicator color={colors.primary} /></View>
          ) : tags.length === 0 ? (
            <View className="py-10 items-center">
              <FontAwesome name="tags" size={28} color={colors.textDim} />
              <Text className="text-typography-muted text-sm mt-3">No tags yet</Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {tags.map(({ tag, count }) => {
                const c = getTagColor(tag);
                const isRenaming = renamingTag === tag;
                return (
                  <View key={tag} className="flex-row items-center px-5 py-4 border-b border-surface-border/50">
                    <View style={{ backgroundColor: c.bg, borderColor: c.border, borderWidth: 1 }} className="px-3 py-1 rounded-full mr-3 flex-shrink-0">
                      <Text style={{ color: c.text }} className="text-xs font-bold">{tag}</Text>
                    </View>

                    {isRenaming ? (
                      <TextInput
                        value={renameInput}
                        onChangeText={setRenameInput}
                        autoFocus
                        className="flex-1 bg-surface-background border border-brand-primary/50 rounded-xl px-3 py-2 text-sm text-typography-main mr-2"
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
                          className="w-9 h-9 bg-brand-primary/10 border border-brand-primary/20 rounded-xl items-center justify-center"
                        >
                          {savingTag === tag ? <ActivityIndicator size="small" color={colors.primary} /> : <FontAwesome name="check" size={13} color={colors.primary} />}
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setRenamingTag(null)}
                          className="w-9 h-9 bg-surface-background border border-surface-border rounded-xl items-center justify-center"
                        >
                          <FontAwesome name="times" size={13} color={colors.textMuted} />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <View className="flex-row gap-2">
                        <TouchableOpacity
                          onPress={() => { setRenamingTag(tag); setRenameInput(tag); }}
                          className="w-9 h-9 bg-surface-background border border-surface-border rounded-xl items-center justify-center"
                        >
                          <FontAwesome name="pencil" size={13} color={colors.textMuted} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleDelete(tag)}
                          className="w-9 h-9 bg-state-danger/10 border border-state-danger/20 rounded-xl items-center justify-center"
                        >
                          <FontAwesome name="trash-o" size={13} color={colors.danger} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
              <View style={{ height: 40 }} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Adaptive Component ──────────────────────────────────────────────────

function FileHubAdaptiveInner() {
  const { hasPermission, user, profile } = useAuth();
  const {
    mode, setMode,
    search, setSearch,
    selectedTag, setSelectedTag,
    files, loading,
    inboxUnreadCount,
    refresh,
    markAllRead,
    groups, groupsLoading,
    activeGroupId, setActiveGroupId,
    groupFiles, groupFilesLoading,
    refreshGroups, refreshGroupFiles,
  } = useFileHub();

  const router = useRouter();
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const colors = useThemeColors();
  const [selectedFile, setSelectedFile] = useState<FileHubFile | null>(null);
  const [fastTrackPreview, setFastTrackPreview] = useState(false);

  // Standard click → metadata sheet; Shift+Click (web) → straight to fullscreen viewer.
  const openFile = useCallback((file: FileHubFile, e?: any) => {
    const shift = !!(e?.shiftKey || e?.nativeEvent?.shiftKey);
    setFastTrackPreview(shift);
    setSelectedFile(file);
  }, []);
  const [showUpload, setShowUpload] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showManageMembers, setShowManageMembers] = useState(false);
  const [showManageTags, setShowManageTags] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [zipDownloading, setZipDownloading] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());

  const canBroadcast = hasPermission('filehub:broadcast');

  const checkColors = () => {
    const c = "var(--color-tag-blue-bg)";
    console.log('color for "Test":', c);
  };

  checkColors();

  const activeGroup = useMemo(
    () => groups.find(g => g.id === activeGroupId) ?? null,
    [groups, activeGroupId]
  );

  // Restore tab from URL param on mount
  useEffect(() => {
    const validModes: FileHubMode[] = ['inbox', 'sent', 'broadcast', 'groups'];
    if (tabParam && validModes.includes(tabParam as FileHubMode)) {
      setMode(tabParam as FileHubMode);
    }
  }, []);

  // Derive tags from the currently visible file list
  const displayFiles = mode === 'groups' && activeGroupId ? groupFiles : files;
  const displayLoading = mode === 'groups' && activeGroupId ? groupFilesLoading : loading;

  // Signed thumbnails for image rows; clicking any file opens its detail sheet,
  // where the image preview itself launches the lightbox.
  const fileMedia = useMemo(
    () => displayFiles.map(f => ({
      id: f.id,
      name: f.original_name,
      storagePath: f.storage_path,
      mimeType: f.mime_type,
      bucket: f.bucket || 'filehub-files',
    })),
    [displayFiles]
  );
  const { signedUrls: fileThumbs } = useImageLightbox(fileMedia, 'filehub-files');

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedFileIds(new Set());
  }, []);

  useEffect(() => { exitSelection(); }, [mode, activeGroupId]);

  const toggleFileSelect = useCallback((fileId: string) => {
    setSelectedFileIds(prev => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId); else next.add(fileId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedFileIds(prev =>
      prev.size === displayFiles.length
        ? new Set()
        : new Set(displayFiles.map(f => f.id))
    );
  }, [displayFiles]);

  const handleDownloadAll = async (name: string) => {
    if (zipDownloading || displayFiles.length === 0) return;
    setZipDownloading(true);
    try {
      await downloadFilesAsZip(displayFiles, name);
    } finally {
      setZipDownloading(false);
    }
  };

  const handleDownloadSelected = async () => {
    const filesToDownload = displayFiles.filter(f => selectedFileIds.has(f.id));
    if (filesToDownload.length === 0 || zipDownloading) return;
    setZipDownloading(true);
    try {
      await downloadFilesAsZip(filesToDownload, 'Selected Files');
      exitSelection();
    } finally {
      setZipDownloading(false);
    }
  };

  const allTags = useMemo(() => {
    const set = new Set<string>();
    displayFiles.forEach(f => f.tags.forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [displayFiles]);

  const tabs: { key: FileHubMode; label: string; count?: number }[] = [
    { key: 'inbox', label: 'Inbox', count: inboxUnreadCount > 0 ? inboxUnreadCount : undefined },
    { key: 'sent', label: 'Sent' },
    ...(canBroadcast ? [{ key: 'broadcast' as FileHubMode, label: 'Broadcast' }] : []),
    { key: 'groups', label: 'Channels' },
  ];

  const handleTabChange = (key: FileHubMode) => {
    setMode(key);
    setActiveGroupId(null);
    setSelectedFile(null);
    router.setParams({ tab: key });
  };

  const handleRefresh = () => {
    if (mode === 'groups') {
      refreshGroups();
      if (activeGroupId) refreshGroupFiles();
    } else {
      refresh();
    }
  };

  return (
    <View className="flex-1 bg-surface-background">
      {/* ── Header ── */}
      {(!activeGroupId || mode !== 'groups') && (
        <View className={`px-6 pb-4 ${Platform.OS === 'web' ? 'pt-6' : 'pt-14'}`}>
          <View className="flex-row items-start justify-between mb-4">
            <View className="flex-1">
              <Text className="text-brand-primary font-black uppercase tracking-[4px] text-[10px] mb-1">Intelligence Hub</Text>
              <Text className="text-typography-main text-3xl font-black">File Hub</Text>
            </View>
            <BackButton label="" />
          </View>
        </View>
      )}

      {/* ── Group detail header (replaces main header when in a group) ── */}
      {mode === 'groups' && activeGroupId && activeGroup && (
        <View className={`px-4 pb-3 flex-row items-center gap-3 ${Platform.OS === 'web' ? 'pt-4' : 'pt-12'}`}>
          <TouchableOpacity
            onPress={() => setActiveGroupId(null)}
            className="w-9 h-9 bg-surface-card border border-surface-border rounded-xl items-center justify-center flex-shrink-0"
          >
            <FontAwesome name="arrow-left" size={13} color={colors.textMain} />
          </TouchableOpacity>
          <View
            className="w-10 h-10 rounded-xl items-center justify-center flex-shrink-0"
            style={{ backgroundColor: activeGroup.avatar_color + '22' }}
          >
            <Text style={{ color: activeGroup.avatar_color, fontSize: 14, fontWeight: '900' }}>
              {getInitials(activeGroup.name)}
            </Text>
          </View>
          <View className="flex-1 min-w-0">
            <Text className="text-typography-main font-black text-base" numberOfLines={1}>{activeGroup.name}</Text>
            <Text className="text-typography-muted text-xs">{activeGroup.member_count} members</Text>
          </View>
          <TouchableOpacity
            onPress={() => setShowManageMembers(true)}
            className="px-3 py-2 bg-surface-card border border-surface-border rounded-xl flex-row items-center gap-1.5"
          >
            <FontAwesome name="users" size={11} color={colors.textMuted} />
            <Text className="text-typography-muted text-xs font-bold">Members</Text>
          </TouchableOpacity>
          {displayFiles.length > 0 && (
            <>
              <TouchableOpacity
                onPress={() => setSelectionMode(s => !s)}
                className={`w-10 h-10 rounded-xl items-center justify-center border ${
                  selectionMode
                    ? 'bg-brand-primary/10 border-brand-primary/30'
                    : 'bg-surface-card border-surface-border'
                }`}
              >
                <FontAwesome name="check-square-o" size={13} color={selectionMode ? colors.primary : colors.textMuted} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => handleDownloadAll(activeGroup?.name ?? 'Channel Files')}
                disabled={zipDownloading}
                className="w-10 h-10 bg-surface-card border border-surface-border rounded-xl items-center justify-center"
              >
                {zipDownloading
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <FontAwesome name="download" size={13} color={colors.textMuted} />
                }
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* ── Search ── */}
      <View className="px-6 mb-4 flex-row items-center gap-3">
        <View className="flex-1 flex-row items-center bg-surface-card border border-surface-border rounded-2xl px-4 py-3 gap-3">
          <FontAwesome name="search" size={12} color={colors.textMain} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder={mode === 'groups' && activeGroupId ? 'Search channel files…' : 'Search files…'}
            placeholderTextColor={colors.textMain}
            className="flex-1 text-typography-main text-sm"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <FontAwesome name="times-circle" size={12} color= {colors.accent} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity onPress={() => setShowAnalytics(true)} className="w-11 h-11 bg-surface-card border border-surface-border rounded-2xl items-center justify-center">
          <FontAwesome name="bar-chart" size={13} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={handleRefresh} className="w-11 h-11 bg-surface-card border border-surface-border rounded-2xl items-center justify-center">
          <FontAwesome name="refresh" size={13} color={colors.primary} />
        </TouchableOpacity>
        {(mode !== 'groups' || activeGroupId) && displayFiles.length > 0 && !activeGroupId && (
          <TouchableOpacity
            onPress={() => setSelectionMode(s => !s)}
            className={`w-11 h-11 rounded-2xl items-center justify-center border ${
              selectionMode ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-card border-surface-border'
            }`}
          >
            <FontAwesome name="check-square-o" size={14} color={selectionMode ? colors.primary : colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Tabs ──
          Fixed-height, non-growing wrapper + explicit per-button heights keep iOS
          Safari/Webkit from vertically stretching these flex children (which made
          the Inbox/Sent nav render with exaggerated heights on mobile web). */}
     <View style={{ height: 44, flexGrow: 0, flexShrink: 0, marginBottom: 12 }}>
     <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ paddingHorizontal: 20, gap: 6, flexDirection: 'row', alignItems: 'center', height: 44 }}>
        {tabs.map(tab => (
          <TouchableOpacity
            key={tab.key}
            onPress={() => handleTabChange(tab.key)}
            style={{ height: 36, flexShrink: 0, alignSelf: 'center' }}
            className={`flex-row items-center justify-center gap-1 px-3.5 rounded-xl border ${
              mode === tab.key
                ? 'bg-brand-primary/10 border-brand-primary/30'
                : 'bg-surface-card border-surface-border'
            }`}
          >
            <Text className={`text-xs font-black ${mode === tab.key ? 'text-brand-primary' : 'text-typography-muted'}`}>{tab.label}</Text>
            {tab.count !== undefined && (
              <View className="bg-brand-primary rounded-full px-1.5 py-0.5 min-w-[16px] items-center">
                <Text className="text-white text-[8px] font-black">{tab.count}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
      </View>

      {/* ── Tag filter (shown when viewing files) ── */}
      {(mode !== 'groups' || activeGroupId) && allTags.length > 0 && (
        <View className="flex-row items-center flex-shrink-0 mb-3">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, gap: 8, flexDirection: 'row', alignItems: 'center' }}>
            {allTags.map(tag => {
              const c = getTagColor(tag);
              const isSelected = selectedTag === tag;
              return (
                <TouchableOpacity
                  key={tag}
                  onPress={() => setSelectedTag(isSelected ? null : tag)}
                  style={isSelected ? undefined : { backgroundColor: c.bg, borderColor: c.border }}
                  className={`px-3 py-1.5 rounded-full border ${isSelected ? 'bg-brand-primary/10 border-brand-primary/30' : ''}`}
                >
                  <Text style={isSelected ? undefined : { color: c.text }} className={`text-[11px] font-bold ${isSelected ? 'text-brand-primary' : ''}`}>{tag}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            onPress={() => setShowManageTags(true)}
            className="px-3 py-2 flex-shrink-0"
          >
            <FontAwesome name="tags" size={14} color={colors.textMain} />
          </TouchableOpacity>
        </View>
      )}

      {mode === 'inbox' && inboxUnreadCount > 0 && (
        <View className="px-6 mb-3">
          <View className="flex-row items-center justify-between gap-3 rounded-2xl border border-brand-primary/20 bg-brand-primary/5 px-4 py-3">
            <View className="flex-1 min-w-0">
              <Text className="text-brand-primary text-[10px] font-black uppercase tracking-[0.2em] mb-0.5">
                Inbox
              </Text>
              <Text className="text-typography-main text-sm font-semibold">
                {inboxUnreadCount} unread file{inboxUnreadCount === 1 ? '' : 's'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={markAllRead}
              className="h-10 px-4 bg-brand-primary rounded-xl items-center justify-center"
            >
              <Text className="text-white text-[10px] font-black uppercase tracking-widest">
                Read All
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── GROUPS mode — list view ── */}
      {mode === 'groups' && !activeGroupId && (
        <>
          {/* Groups list header */}
          <View className="px-6 mb-3 flex-row items-center justify-between">
            <Text className="text-typography-main font-black text-lg">Your Channels</Text>
            <TouchableOpacity
              onPress={() => setShowCreateGroup(true)}
              className="flex-row items-center gap-2 bg-brand-primary px-4 py-2 rounded-xl"
            >
              <FontAwesome name="plus" size={11} color={colors.textMain} />
              <Text className="text-white font-black text-xs">New Channel</Text>
            </TouchableOpacity>
          </View>

          {groupsLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : groups.length === 0 ? (
            <View className="flex-1 items-center justify-center px-6">
              <View className="bg-surface-card p-10 rounded-[2.5rem] border border-surface-border items-center w-full">
                <View className="w-16 h-16 bg-brand-primary/10 rounded-full border border-brand-primary/20 items-center justify-center mb-4">
                  <FontAwesome name="users" size={24} color={colors.primary} />
                </View>
                <Text className="text-typography-main text-xl font-black mt-2 mb-2 text-center">No Channels Yet</Text>
                <Text className="text-typography-muted text-sm text-center leading-relaxed mb-6">
                  Create a channel to share files with your team in a persistent shared space.
                </Text>
                <TouchableOpacity
                  onPress={() => setShowCreateGroup(true)}
                  className="bg-brand-primary px-6 py-3 rounded-2xl flex-row items-center gap-2"
                >
                  <FontAwesome name="plus" size={12} color={colors.textMain} />
                  <Text className="text-white font-black">Create First Channel</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
              {groups.map(g => (
                <GroupCard key={g.id} group={g} onPress={() => setActiveGroupId(g.id)} />
              ))}
              <View style={{ height: 100 }} />
            </ScrollView>
          )}
        </>
      )}

      {/* ── GROUPS mode — group file list ── */}
      {mode === 'groups' && activeGroupId && (
        <>
          {displayLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : displayFiles.length === 0 ? (
            <View className="flex-1 items-center justify-center px-6">
              <View className="bg-surface-card p-10 rounded-[2.5rem] border border-surface-border items-center w-full">
                <FontAwesome name="files-o" size={32} color={colors.textMuted} />
                <Text className="text-typography-main text-xl font-black mt-4 mb-2 text-center">
                  {search ? 'No Results' : 'No Files Yet'}
                </Text>
                <Text className="text-typography-muted text-sm text-center leading-relaxed">
                  {search ? `No files match "${search}".` : 'Upload the first file to this channel.'}
                </Text>
              </View>
            </View>
          ) : (
            <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
              {displayFiles.map(file => (
                <FileCard
                  key={file.id}
                  file={file}
                  mode="groups"
                  onPress={(e) => openFile(file, e)}
                  thumbUri={file.mime_type?.toLowerCase().includes('image') ? fileThumbs[file.id] : undefined}
                  selectionMode={selectionMode}
                  isFileSelected={selectedFileIds.has(file.id)}
                  onToggleSelect={() => toggleFileSelect(file.id)}
                />
              ))}
              <View style={{ height: selectionMode ? 140 : 100 }} />
            </ScrollView>
          )}
        </>
      )}

      {/* ── Inbox / Sent / Broadcast file list ── */}
      {mode !== 'groups' && (
        <>
          {displayLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : displayFiles.length === 0 ? (
            <View className="flex-1 items-center justify-center px-6">
              <View className="bg-surface-card p-10 rounded-[2.5rem] border border-surface-border items-center w-full">
                <FontAwesome name="inbox" size={32} color={colors.textMuted} />
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
              {displayFiles.map(file => (
                <FileCard
                  key={file.id}
                  file={file}
                  mode={mode}
                  onPress={(e) => openFile(file, e)}
                  thumbUri={file.mime_type?.toLowerCase().includes('image') ? fileThumbs[file.id] : undefined}
                  selectionMode={selectionMode}
                  isFileSelected={selectedFileIds.has(file.id)}
                  onToggleSelect={() => toggleFileSelect(file.id)}
                />
              ))}
              <View style={{ height: selectionMode ? 140 : 100 }} />
            </ScrollView>
          )}
        </>
      )}

      {/* ── Selection toolbar (replaces FAB when in selection mode) ── */}
      {selectionMode ? (
        <View className="absolute bottom-6 left-5 right-5 bg-surface-card border border-surface-border rounded-2xl px-4 py-3 flex-row items-center gap-3 premium-shadow">
          <TouchableOpacity
            onPress={toggleSelectAll}
            className={`w-9 h-9 rounded-xl items-center justify-center border-2 flex-shrink-0 ${
              selectedFileIds.size === displayFiles.length && displayFiles.length > 0
                ? 'bg-brand-primary border-brand-primary'
                : selectedFileIds.size > 0 ? 'border-brand-primary bg-surface-background' : 'border-surface-border bg-surface-background'
            }`}
          >
            {selectedFileIds.size === displayFiles.length && displayFiles.length > 0
              ? <FontAwesome name="check" size={13} color="#fff" />
              : selectedFileIds.size > 0 ? <View className="w-3 h-0.5 bg-brand-primary rounded-full" /> : null
            }
          </TouchableOpacity>
          <Text className="flex-1 text-typography-main text-sm font-bold">
            {selectedFileIds.size === 0 ? 'Tap to select' : `${selectedFileIds.size} selected`}
          </Text>
          {selectedFileIds.size > 0 && (
            <TouchableOpacity
              onPress={handleDownloadSelected}
              disabled={zipDownloading}
              className="flex-row items-center gap-1.5 bg-brand-primary px-4 py-2.5 rounded-xl"
            >
              {zipDownloading ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome name="download" size={13} color="#fff" />}
              <Text className="text-white font-black text-sm">Download {selectedFileIds.size}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={exitSelection} className="w-9 h-9 items-center justify-center flex-shrink-0">
            <FontAwesome name="times" size={15} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      ) : (
        (mode !== 'groups' || activeGroupId) && (
          <TouchableOpacity
            onPress={() => setShowUpload(true)}
            className="absolute right-6 bottom-8 w-14 h-14 bg-brand-primary rounded-full items-center justify-center premium-shadow"
          >
            <FontAwesome name="plus" size={20} color="#fff" />
          </TouchableOpacity>
        )
      )}

      {/* ── File detail sheet ── */}
      <FileDetailSheet
        file={selectedFile}
        mode={mode}
        currentUserId={user?.id}
        autoPreview={fastTrackPreview}
        onClose={() => { setSelectedFile(null); setFastTrackPreview(false); }}
      />

      {/* ── Upload sheet ── */}
      <UploadSheet
        visible={showUpload}
        onClose={() => setShowUpload(false)}
        onUploaded={() => { mode === 'groups' && activeGroupId ? refreshGroupFiles() : refresh(); }}
        hasPermission={hasPermission}
        profile={profile}
        activeGroup={activeGroup ? { id: activeGroup.id, name: activeGroup.name, avatar_color: activeGroup.avatar_color } : null}
      />

      {/* ── Group create sheet ── */}
      <GroupCreateSheet
        visible={showCreateGroup}
        onClose={() => setShowCreateGroup(false)}
        onCreated={(id) => { refreshGroups(); setActiveGroupId(id); }}
      />

      {/* ── Group members sheet ── */}
      <GroupMembersSheet
        visible={showManageMembers}
        group={activeGroup}
        currentUserId={user?.id}
        onClose={() => setShowManageMembers(false)}
        onMembersChanged={refreshGroups}
      />

      {/* ── Tags manage sheet ── */}
      <TagsManageSheet
        visible={showManageTags}
        onClose={() => setShowManageTags(false)}
        onChanged={handleRefresh}
      />

      {/* ── Analytics Dashboard ── */}
      <FileHubAnalytics visible={showAnalytics} onClose={() => setShowAnalytics(false)} />
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
