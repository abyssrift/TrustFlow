import Tooltip from '@/components/common/Tooltip';
import { BackButton } from '@/components/common/BackButton';
import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { FileActivity, FileHubFile, FileHubFolder, FileHubFolderScope, FileHubGroup, FileHubGroupMember, FileHubMode, FileHubProvider, FileHubShareLink, FileVersion, folderAncestors, folderPath, shareLinkUrl, useFileHub } from '@/contexts/FileHubContext';
import FolderTreePicker from './FolderTreePicker';
import { ACTIVITY_META, ALLOWED_EXTENSIONS, ALLOWED_TYPES_MESSAGE, expiresInDays, formatFileSize, getInitials, getTagColor, GROUP_COLORS, isAllowedFile, TAG_PALETTE } from './filehubShared';
import FileHubChannelsMultiView from './FileHubChannelsMultiView';
import { useToast } from '@/contexts/ToastContext';
import { relDir, resolveExistingFolderLeaf } from '@/lib/filehubFolderTree';
import { randomId } from '@/lib/randomId';
import { downloadFilesAsZip, downloadFilesToDevice, openStorageFile } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
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
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Popup from '@/components/common/Popup';
import { useDoubleTap } from '@/hooks/useDoubleTap';
import { useFileSizeLimit } from '@/hooks/useFileSizeLimit';
import { useImageLightbox } from '@/hooks/useImageLightbox';
import { useThemeColors } from '@/hooks/useThemeColors';
import AdaptiveFileGrid from '../common/AdaptiveFileGrid';
import { FilePreviewModal, FilePreviewTeaser, getPreviewKind, type PreviewKind } from '../common/FilePreview';
import UserLink from '../common/UserLink';
import FileHubAnalytics from './FileHubAnalytics';
import FileHubBin from './FileHubBin';
import FileHubOverview from './FileHubOverview';
import FileHubBrowse from './FileHubBrowse';
import { useShareFile } from '../common/ShareFile';
import TaskFileResults from './TaskFileResults';




// ─── Helpers ─────────────────────────────────────────────────────────────────
// Shared byte-identical helpers (formatFileSize, expiresInDays, getInitials,
// GROUP_COLORS, TAG_PALETTE, getTagColor, ACTIVITY_META) now live in
// `./filehubShared`. The helpers below intentionally remain local because their
// implementations differ from the desktop shell's.

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
  autoPreview = false,
}: {
  file: FileHubFile | null;
  mode: FileHubMode;
  currentUserId: string | undefined;
  onClose: () => void;
  /** When true (Shift+Click fast-track), jump straight to the fullscreen viewer. */
  autoPreview?: boolean;
}) {
  const { markRead, hideFile, deleteFile, logActivity, fileActivity, fileVersions, restoreVersion, pinVersion, folders, moveFile, createShareLink, revokeShareLink, listShareLinks } = useFileHub();
  const { showConfirm } = useAlert();
  const { successToast } = useToast();
  const { share, shareSheet } = useShareFile();
  const [downloading, setDownloading] = useState(false);
  const [showMoveFolder, setShowMoveFolder] = useState(false);
  const [showShareLink, setShowShareLink] = useState(false);
  const [shareLinks, setShareLinks] = useState<FileHubShareLink[]>([]);
  const [shareLinksLoading, setShareLinksLoading] = useState(false);
  const [creatingShareLink, setCreatingShareLink] = useState(false);
  const [shareExpiryHours, setShareExpiryHours] = useState(168);
  const [shareDownloadAllowed, setShareDownloadAllowed] = useState(true);

  // The "Move to Folder" picker must only offer folders from this file's own
  // scope (Direct/Broadcast/its channel) — folders don't cross those lines.
  const fileFolderScope: FileHubFolderScope = file?.visibility === 'group' ? 'group' : file?.visibility === 'broadcast' ? 'broadcast' : 'direct';
  const fileScopedFolders = useMemo(
    () => folders.filter(f => f.scope === fileFolderScope && (f.group_id ?? null) === (file?.group_id ?? null)),
    [folders, fileFolderScope, file?.group_id]
  );
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
  const [versionPreview, setVersionPreview] = useState<{ uri: string; kind: PreviewKind | 'image'; name: string; versionNo: number; sizeBytes?: number } | null>(null);

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

  const handleShareOut = () => share({
    fileId: file.id,
    bucket: file.bucket || 'filehub-files',
    storagePath: file.storage_path,
    name: file.original_name,
    mimeType: file.mime_type,
    sizeBytes: file.size_bytes,
  });

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
    const isImage = (version.mime_type ?? file.mime_type ?? '').toLowerCase().startsWith('image');
    const kind = getPreviewKind(version.mime_type ?? file.mime_type, version.original_name);
    if (!kind && !isImage) { handleVersionDownload(version); return; }
    const { data } = await supabase.storage
      .from(version.bucket || 'filehub-files')
      .createSignedUrl(version.storage_path, 3600);
    if (data?.signedUrl) {
      logActivity(file.id, 'view', { version_no: version.version_no });
      setVersionPreview({ uri: data.signedUrl, kind: kind ?? 'image', name: version.original_name, versionNo: version.version_no, sizeBytes: version.size_bytes });
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
    <Popup visible={!!file} onClose={onClose} presentation="auto" maxWidth={420}>

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
              <FilePreviewTeaser uri={previewUrl} kind={previewKind} height={112} onPress={() => setPreviewOpen(true)} sizeBytes={file.size_bytes} />
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
                <UserLink userId={file.uploader.id} name={file.uploader.full_name} className="text-typography-main text-xs font-bold flex-1" />
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

              <TouchableOpacity
                onPress={handleShareOut}
                className="flex-row items-center justify-center bg-surface-background border border-surface-border rounded-2xl py-3.5 gap-2"
              >
                <FontAwesome name="share" size={13} color={colors.primary} />
                <Text className="text-brand-primary font-black text-sm">Share</Text>
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

              {isOwner && (
                <>
                  <TouchableOpacity
                    onPress={() => setShowMoveFolder(true)}
                    className="flex-row items-center justify-center bg-surface-background border border-surface-border rounded-2xl py-3.5 gap-2"
                  >
                    <FontAwesome name="folder-o" size={13} color={colors.primary} />
                    <Text className="text-typography-main font-black text-sm">
                      {file.folder ? `In "${file.folder.name}" — Move` : 'Move to Folder'}
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      setShareLinksLoading(true);
                      listShareLinks(file.id).then(setShareLinks).catch(console.error).finally(() => setShareLinksLoading(false));
                      setShowShareLink(true);
                    }}
                    className="flex-row items-center justify-center bg-surface-background border border-surface-border rounded-2xl py-3.5 gap-2"
                  >
                    <FontAwesome name="link" size={13} color={colors.primary} />
                    <Text className="text-brand-primary font-black text-sm">Share Link</Text>
                  </TouchableOpacity>
                </>
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
                        <UserLink userId={entry.user.id} name={entry.user.full_name} tab="activity" className="text-typography-main text-sm font-bold" />{' '}
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
                      <UserLink userId={v.uploader.id} name={v.uploader.full_name} className="text-typography-muted text-xs" /> · {formatFileSize(v.size_bytes)} · {relativeDate(v.created_at)}
                    </Text>
                    {!v.is_current && (
                      <Text className="text-typography-dim text-[11px] mt-0.5">
                        {v.pinned ? 'Pinned — kept forever' : (days != null ? `Expires in ${days} day${days === 1 ? '' : 's'}` : 'Expiring soon')}
                      </Text>
                    )}
                    <View className="flex-row gap-2 mt-2.5">
                      {(getPreviewKind(v.mime_type ?? file.mime_type, v.original_name) || (v.mime_type ?? file.mime_type ?? '').toLowerCase().startsWith('image')) && (
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
    </Popup>
    <Popup visible={showMoveFolder} onClose={() => setShowMoveFolder(false)} presentation="auto" maxWidth={420}>
      <View className="px-6 pt-2 pb-6">
        <Text className="text-typography-main font-black text-lg mb-4">Move to Folder</Text>
        <ScrollView showsVerticalScrollIndicator={false}>
          <TouchableOpacity
            onPress={() => { moveFile(file.id, null); setShowMoveFolder(false); }}
            className="flex-row items-center gap-3 py-3.5 border-b border-surface-border/40"
          >
            <FontAwesome name="folder-open-o" size={14} color={!file.folder_id ? colors.primary : colors.textMuted} />
            <Text className={`flex-1 text-sm font-bold ${!file.folder_id ? 'text-brand-primary' : 'text-typography-main'}`}>No folder</Text>
            {!file.folder_id && <FontAwesome name="check" size={12} color={colors.primary} />}
          </TouchableOpacity>
          {[...fileScopedFolders].sort((a, b) => folderPath(fileScopedFolders, a.id).localeCompare(folderPath(fileScopedFolders, b.id))).map(f => (
            <TouchableOpacity
              key={f.id}
              onPress={() => { moveFile(file.id, f.id); setShowMoveFolder(false); }}
              className="flex-row items-center gap-3 py-3.5 border-b border-surface-border/40"
            >
              <FontAwesome name="folder-o" size={14} color={file.folder_id === f.id ? colors.primary : colors.textMuted} />
              <Text className={`flex-1 text-sm font-bold ${file.folder_id === f.id ? 'text-brand-primary' : 'text-typography-main'}`}>{folderPath(fileScopedFolders, f.id)}</Text>
              {file.folder_id === f.id && <FontAwesome name="check" size={12} color={colors.primary} />}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </Popup>
    <Popup visible={showShareLink} onClose={() => setShowShareLink(false)} presentation="auto" maxWidth={420}>
      <View className="px-6 pt-2 pb-6">
        <Text className="text-typography-main font-black text-lg mb-4">Share "{file.original_name}"</Text>

        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Expires In</Text>
        <View className="flex-row gap-2 mb-4">
          {[
            { label: '1 Day', hours: 24 },
            { label: '7 Days', hours: 168 },
            { label: '30 Days', hours: 720 },
          ].map(opt => (
            <TouchableOpacity
              key={opt.hours}
              onPress={() => setShareExpiryHours(opt.hours)}
              className={`flex-1 items-center py-2.5 rounded-xl border ${shareExpiryHours === opt.hours ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}
            >
              <Text className={`text-xs font-black ${shareExpiryHours === opt.hours ? 'text-brand-primary' : 'text-typography-muted'}`}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          onPress={() => setShareDownloadAllowed(v => !v)}
          className="flex-row items-center justify-between rounded-xl border border-surface-border bg-surface-background px-4 py-3 mb-5"
        >
          <View className="flex-1 min-w-0 pr-3">
            <Text className="text-typography-main text-xs font-black">Allow Downloads</Text>
            <Text className="text-typography-dim text-[10px] mt-0.5">
              {shareDownloadAllowed ? 'Visitors can download the file.' : 'Visitors cannot download — link carries no file bytes.'}
            </Text>
          </View>
          <View className={`w-10 h-6 rounded-full justify-center px-0.5 ${shareDownloadAllowed ? 'bg-brand-primary' : 'bg-surface-border'}`}>
            <View className="w-5 h-5 rounded-full bg-white" style={{ marginLeft: shareDownloadAllowed ? 16 : 0 }} />
          </View>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={async () => {
            setCreatingShareLink(true);
            try {
              await createShareLink(file.id, shareExpiryHours, shareDownloadAllowed);
              setShareLinksLoading(true);
              listShareLinks(file.id).then(setShareLinks).catch(console.error).finally(() => setShareLinksLoading(false));
            } catch { /* alerted */ } finally {
              setCreatingShareLink(false);
            }
          }}
          disabled={creatingShareLink}
          className="flex-row items-center justify-center bg-brand-primary rounded-2xl py-3.5 gap-2 mb-5"
        >
          {creatingShareLink ? <ActivityIndicator size="small" color="#fff" /> : <FontAwesome name="plus" size={12} color="#fff" />}
          <Text className="text-white font-black text-sm">Create Link</Text>
        </TouchableOpacity>

        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-2">Active Links</Text>
        {shareLinksLoading ? (
          <View className="py-4 items-center"><ActivityIndicator color={colors.primary} /></View>
        ) : shareLinks.filter(l => !l.revoked_at && new Date(l.expires_at).getTime() > Date.now()).length === 0 ? (
          <Text className="text-typography-dim text-xs py-2">No active share links.</Text>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {shareLinks.filter(l => !l.revoked_at && new Date(l.expires_at).getTime() > Date.now()).map(link => (
              <View key={link.id} className="border border-surface-border rounded-xl px-3 py-2 mb-2">
                <Text className="text-typography-main text-xs font-bold mb-1" numberOfLines={1}>{shareLinkUrl(link.token)}</Text>
                <Text className="text-typography-dim text-[9px] mb-2">
                  Expires {new Date(link.expires_at).toLocaleDateString()} · {link.view_count} view{link.view_count === 1 ? '' : 's'}
                  {link.download_allowed === false ? ' · downloads off' : ''}
                  {/* Other people's links show here too now — say whose. */}
                  {link.creator_name && link.can_revoke === false ? ` · by ${link.creator_name}` : ''}
                </Text>
                <View className="flex-row gap-1.5">
                  <TouchableOpacity
                    onPress={async () => {
                      await Clipboard.setStringAsync(shareLinkUrl(link.token));
                      successToast('Link copied');
                    }}
                    className="flex-1 flex-row items-center justify-center gap-1 bg-surface-background border border-surface-border rounded-lg py-1.5"
                  >
                    <FontAwesome name="copy" size={10} color={colors.primary} />
                    <Text className="text-brand-primary text-xs font-bold">Copy</Text>
                  </TouchableOpacity>
                  {/* undefined on a link minted this session (create returns no
                      can_revoke) — always ours, so missing means allowed. */}
                  {link.can_revoke !== false && (
                  <TouchableOpacity
                    onPress={() => {
                      showConfirm(
                        'Revoke Link',
                        'Anyone with this link will lose access immediately.',
                        async () => {
                          try {
                            await revokeShareLink(link.id);
                            setShareLinksLoading(true);
                            listShareLinks(file.id).then(setShareLinks).catch(console.error).finally(() => setShareLinksLoading(false));
                          } catch { /* alerted */ }
                        },
                        undefined, 'Revoke', 'Cancel', 'destructive'
                      );
                    }}
                    className="flex-1 flex-row items-center justify-center gap-1 bg-state-danger/10 border border-state-danger/20 rounded-lg py-1.5"
                  >
                    <FontAwesome name="ban" size={10} color={colors.danger} />
                    <Text className="text-state-danger text-xs font-bold">Revoke</Text>
                  </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Popup>
    {previewLightbox}
    {previewKind && previewUrl && (
      <FilePreviewModal
        visible={previewOpen}
        uri={previewUrl}
        kind={previewKind}
        fileName={file.original_name}
        onClose={() => setPreviewOpen(false)}
        onDownload={handleDownload}
        onShare={handleShareOut}
        sizeBytes={file.size_bytes}
      />
    )}
    {shareSheet}
    {versionPreview && versionPreview.kind === 'image' && (
      <Modal visible transparent animationType="fade" onRequestClose={() => setVersionPreview(null)}>
        <View className="flex-1 items-center justify-center p-5" style={{ backgroundColor: 'rgba(0,0,0,0.85)' }}>
          <View className="absolute top-12 left-0 right-0 items-center px-6">
            <Text className="text-white font-black text-xs text-center" numberOfLines={1}>{`${versionPreview.name} (v${versionPreview.versionNo})`}</Text>
          </View>
          <Image source={{ uri: versionPreview.uri }} style={{ width: '92%', height: '80%' }} resizeMode="contain" />
          <Tooltip label="Close">
            <TouchableOpacity onPress={() => setVersionPreview(null)} className="absolute top-10 right-5 w-11 h-11 rounded-full items-center justify-center" style={{ backgroundColor: 'rgba(255,255,255,0.15)' }}>
              <FontAwesome name="times" size={20} color="#fff" />
            </TouchableOpacity>
          </Tooltip>
        </View>
      </Modal>
    )}
    {versionPreview && versionPreview.kind !== 'image' && (
      <FilePreviewModal
        visible
        uri={versionPreview.uri}
        kind={versionPreview.kind}
        fileName={`${versionPreview.name} (v${versionPreview.versionNo})`}
        onClose={() => setVersionPreview(null)}
        sizeBytes={versionPreview.sizeBytes}
      />
    )}
    </>
  );
}

// ─── Upload Sheet ─────────────────────────────────────────────────────────────

function UploadSheet({
  visible,
  onClose,
  onUploaded,
  hasPermission,
  profile,
  activeGroup,
  defaultFolderId = null,
}: {
  visible: boolean;
  onClose: () => void;
  onUploaded: () => void;
  hasPermission: (key: string) => boolean;
  profile: any;
  activeGroup?: { id: string; name: string; avatar_color: string } | null;
  defaultFolderId?: string | null;
}) {
  const { folders, checkDuplicate, checkNameConflict, replaceFile, refreshFolders } = useFileHub();
  const { showAlert } = useAlert();
  const fileInputRef = useRef<any>(null);
  const folderInputRef = useRef<any>(null);

  type PickedFile = { name: string; size: number; uri: string; type?: string; webFile?: File; relPath?: string };
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
  const maxFileSizeBytes = useFileSizeLimit();

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

  // Folders are scoped: a channel's folders never appear outside it, and
  // Direct/Broadcast are separate trees too — so the picker only ever offers
  // folders matching whatever this upload will actually target.
  const uploadScope: FileHubFolderScope = activeGroup ? 'group' : (visibility === 'broadcast' ? 'broadcast' : 'direct');
  const scopedFolders = useMemo(
    () => folders.filter(f => f.scope === uploadScope && (f.group_id ?? null) === (activeGroup?.id ?? null)),
    [folders, uploadScope, activeGroup?.id]
  );

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
    else {
      // Smart leveling: preselect the folder the user is currently browsing.
      if (activeGroup) setVisibility('group');
      setFolderId(defaultFolderId ?? null);
    }
  }, [visible, activeGroup?.id, defaultFolderId]);

  // Mobile web: block tab close / refresh mid-upload, so bytes can't be
  // stranded between a file's storage PUT and its commit. No-op on native
  // (no window), where the OS owns app lifecycle anyway.
  useEffect(() => {
    if (!uploading || typeof window === 'undefined' || !window.addEventListener) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [uploading]);

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
          valid.push({ name: file.name, size: file.size, uri: '', type: file.type, webFile: file, relPath: (file as any).webkitRelativePath || undefined });
        } else {
          rejected.push(file.name);
        }
      });
    if (rejected.length > 0) {
      showAlert(
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
    if (!companyId) { showAlert('Error', 'Company not found.'); return; }
    if (visibility === 'direct' && selectedRecipients.length === 0) {
      showAlert('Error', 'Please select at least one recipient.');
      return;
    }
    if (visibility === 'group' && !activeGroup?.id) {
      showAlert('Error', 'No channel selected.');
      return;
    }

    setUploading(true);
    const errors: string[] = [];
    // Remembered "…for all" answers so a huge batch needs one click, not one per file.
    let dupeAll: string | null = null;
    let conflictAll: string | null = null;
    // One id for this whole upload, so the destination folder reads as a single
    // new version rather than N unrelated file changes. Same contract as the
    // desktop path in UploadManagerContext.
    const batchId = randomId();

    // Folder uploads keep their Explorer structure, but the folders are no
    // longer pre-created here. Each file passes its relative directory to
    // rpc_filehub_upload_commit, which get-or-creates the sub-tree under the
    // chosen target and lands the file in the leaf — all in one transaction.
    // A folder can only exist because a file committed into it, so a
    // half-failed batch can never leave empty folders behind.
    const hadFolderUpload = pickedFiles.some(pf => !!relDir(pf.relPath));

    for (let i = 0; i < pickedFiles.length; i++) {
      const pf = pickedFiles[i];
      const relDirPath = relDir(pf.relPath);
      // Only needed to scope the pre-upload dup / name checks; a brand-new
      // sub-folder (null) is empty by definition, so those checks are skipped.
      const existingLeaf = relDirPath
        ? resolveExistingFolderLeaf(folderId || null, relDirPath, scopedFolders)
        : (folderId || null);
      const folderIsNew = relDirPath !== '' && existingLeaf === null;
      const checkFolderId = existingLeaf ?? (folderId || null);
      setUploadingIndex(i);
      setProgress(5);
      try {
        if (maxFileSizeBytes !== null && maxFileSizeBytes !== undefined && pf.size > maxFileSizeBytes) {
          errors.push(`${pf.name}: exceeds your plan's ${formatFileSize(maxFileSizeBytes as number)} per-file limit.`);
          continue;
        }
        let contentHash = '';
        if (Platform.OS === 'web' && pf.webFile) {
          contentHash = await computeSHA256Web(pf.webFile);
        }
        setProgress(25);

        if (contentHash && !folderIsNew) {
          const dupes = await checkDuplicate(contentHash, checkFolderId);
          if (dupes.length > 0) {
            let proceed: string = dupeAll ?? await askDecision(
              'Possible Duplicate',
              `"${dupes[0].original_name}" has the same content as "${pf.name}". Upload anyway?`,
              [
                { label: 'Skip', value: 'cancel', style: 'cancel' },
                { label: 'Skip All Duplicates', value: 'cancel_all', style: 'cancel' },
                { label: 'Upload Anyway', value: 'proceed', style: 'primary' },
                { label: 'Upload All Anyway', value: 'proceed_all', style: 'default' },
              ]
            );
            if (proceed.endsWith('_all')) { proceed = proceed.slice(0, -4); dupeAll = proceed; }
            if (proceed !== 'proceed') continue;
          }
        }

        // Name-conflict prompt (Replace / Keep Both / Cancel) — only meaningful
        // when the target folder already exists.
        const groupId = visibility === 'group' ? (activeGroup?.id ?? null) : null;
        const conflict = folderIsNew ? null : await checkNameConflict(pf.name, visibility, groupId, checkFolderId);
        if (conflict) {
          let choice: string = conflictAll ?? await askDecision(
            'File already exists',
            `"${pf.name}" already exists here (uploaded by ${conflict.uploader_name}). Replace it with a new version, or keep both?`,
            [
              { label: 'Skip', value: 'cancel', style: 'cancel' },
              { label: 'Skip All Conflicts', value: 'cancel_all', style: 'cancel' },
              { label: 'Keep Both', value: 'keep', style: 'default' },
              { label: 'Replace', value: 'replace', style: 'primary' },
              { label: 'Replace All', value: 'replace_all', style: 'default' },
            ]
          );
          if (choice.endsWith('_all')) { choice = choice.slice(0, -4); conflictAll = choice; }
          if (choice === 'cancel') continue;
          if (choice === 'replace') {
            const replaceId = randomId();
            const replaceSafeName = pf.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const replacePath = `${companyId}/${replaceId}/${replaceSafeName}`;
            setProgress(40);
            let replaceStorageError;
            if (Platform.OS === 'web' && pf.webFile) {
              ({ error: replaceStorageError } = await supabase.storage.from('filehub-files').upload(replacePath, pf.webFile, { contentType: pf.type || 'application/octet-stream' }));
            } else {
              ({ error: replaceStorageError } = await supabase.storage.from('filehub-files').upload(replacePath, { uri: pf.uri, name: pf.name, type: pf.type ?? 'application/octet-stream' } as any, { contentType: pf.type || 'application/octet-stream' }));
            }
            if (replaceStorageError) throw replaceStorageError;
            setProgress(80);
            try {
              await replaceFile(conflict.id, {
                storagePath: replacePath,
                size: pf.size,
                hash: contentHash || null,
                mime: pf.type ?? null,
                caption: caption || null,
                batchId,
              });
            } catch (commitErr) {
              // Bytes landed but the DB row didn't — remove the orphan object
              // so it can't linger in storage untracked.
              await supabase.storage.from('filehub-files').remove([replacePath]).catch(() => {});
              throw commitErr;
            }
            setProgress(100);
            continue;
          }
          // 'keep' falls through to the normal upload_commit path (server auto-renames)
        }

        const fileId = randomId();
        const safeName = pf.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const storagePath = `${companyId}/${fileId}/${safeName}`;
        setProgress(40);

        let storageError;
        if (Platform.OS === 'web' && pf.webFile) {
          ({ error: storageError } = await supabase.storage.from('filehub-files').upload(storagePath, pf.webFile, { contentType: pf.type || 'application/octet-stream' }));
        } else {
          ({ error: storageError } = await supabase.storage.from('filehub-files').upload(storagePath, { uri: pf.uri, name: pf.name, type: pf.type ?? 'application/octet-stream' } as any, { contentType: pf.type || 'application/octet-stream' }));
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
          // Server get-or-creates this sub-tree under p_folder_id and lands the
          // file in the leaf, atomically with the row insert.
          p_rel_dir: relDirPath || null,
          p_batch_id: batchId,
        });
        if (rpcError) {
          // Bytes landed but the commit failed — drop the orphan object so it
          // can't linger untracked in storage. Best-effort only; the daily
          // filehub-orphan-sweep is the real net.
          await supabase.storage.from('filehub-files').remove([storagePath]).catch(() => {});
          throw rpcError;
        }
        setProgress(100);
      } catch (e: any) {
        errors.push(`${pf.name}: ${e.message || 'Unknown error'}`);
      }
    }

    // Folders were created server-side during commit — pull them in so the
    // new sub-tree shows up. Only folders that actually received a file exist.
    if (hadFolderUpload) refreshFolders();

    setUploading(false);
    setProgress(0);

    const successCount = pickedFiles.length - errors.length;
    if (errors.length > 0 && successCount > 0) {
      showAlert('Some uploads failed', errors.join('\n'));
    } else if (errors.length === pickedFiles.length) {
      showAlert('Upload Failed', errors.join('\n'));
      return;
    }

    onUploaded();
    onClose();
  };

  return (
    <>
    <Popup visible={visible} onClose={onClose} presentation="auto" maxWidth={420}>

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
              <Tooltip label="Close">
                <TouchableOpacity onPress={onClose} className="w-8 h-8 bg-surface-background border border-surface-border rounded-xl items-center justify-center">
                  <FontAwesome name="times" size={12} color={colors.textMuted} />
                </TouchableOpacity>
              </Tooltip>
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
                        <FontAwesome name="folder-open-o" size={12} color={colors.textMuted} />
                        <Text className="text-typography-muted font-black text-sm">Folder</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ) : (
                <AdaptiveFileGrid
                  files={pickedFiles}
                  onRemove={(indices) => {
                    const drop = new Set(indices);
                    setPickedFiles(prev => prev.filter((_, i) => !drop.has(i)));
                  }}
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
                          <Tooltip key={r.id} label="Remove recipient">
                            <TouchableOpacity
                              onPress={() => toggleRecipient(r)}
                              className="flex-row items-center gap-1.5 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-3 py-1"
                            >
                              <Text className="text-brand-primary text-xs font-bold">{r.full_name}</Text>
                              <FontAwesome name="times" size={9} color={colors.primary} />
                            </TouchableOpacity>
                          </Tooltip>
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

                {/* Folder — explorer tree */}
                {scopedFolders.length > 0 && (
                  <View className="gap-2">
                    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Destination</Text>
                    {folderId && (
                      <Text className="text-[11px] font-bold" style={{ color: colors.primary }}>
                        {folderPath(scopedFolders, folderId)}
                      </Text>
                    )}
                    <FolderTreePicker
                      folders={scopedFolders}
                      selectedId={folderId}
                      onSelect={setFolderId}
                      colors={colors}
                    />
                  </View>
                )}

                {/* Tags */}
                <View className="gap-2">
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Tags</Text>
                  {tags.length > 0 && (
                    <View className="flex-row flex-wrap gap-2">
                      {tags.map(t => (
                        <Tooltip key={t} label="Remove tag">
                          <TouchableOpacity
                            onPress={() => setTags(prev => prev.filter(x => x !== t))}
                            className="flex-row items-center gap-1.5 bg-surface-background border border-surface-border rounded-full px-3 py-1"
                          >
                            <Text className="text-typography-muted text-xs font-bold">{t}</Text>
                            <FontAwesome name="times" size={8} color={colors.textMuted} />
                          </TouchableOpacity>
                        </Tooltip>
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
    </Popup>

    {/* Web-safe decision dialog (replaces RN Alert.alert multi-button prompts) */}
    {pendingDecision && (() => {
      const decisionContent = (
        <View className="p-6">
          <Text className="text-lg font-black tracking-tight mb-2" style={{ color: colors.textMain }}>{pendingDecision.title}</Text>
          <Text className="text-sm leading-relaxed mb-5" style={{ color: colors.textMuted }}>{pendingDecision.message}</Text>
          <View className="gap-2">
            {pendingDecision.options.map(opt => (
              <TouchableOpacity
                key={opt.value}
                onPress={() => { const r = pendingDecision.resolve; setPendingDecision(null); r(opt.value); }}
                className="py-3 rounded-xl items-center"
                style={opt.style === 'primary' ? { backgroundColor: colors.primary } : { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border }}
              >
                <Text
                  className="font-black text-sm"
                  style={opt.style === 'primary' ? { color: '#fff' } : opt.style === 'cancel' ? { color: colors.textMuted } : { color: colors.textMain }}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      );

      if (Platform.OS === 'web') {
        return (
          <Popup
            visible
            onClose={() => {}}
            presentation="centered"
            dismissible={false}
            maxWidth={420}
            containerClassName="rounded-3xl overflow-hidden premium-shadow"
          >
            {decisionContent}
          </Popup>
        );
      }

      // TODO(#93-native): remove this branch once native is testable — see issue #93/#115.
      // Old raw-Modal path preserved untouched so native behavior doesn't change yet.
      return (
        <Modal visible transparent animationType="fade">
          <View className="flex-1 bg-black/60 items-center justify-center p-8">
            <View className="rounded-3xl border premium-shadow w-full max-w-[420px]" style={{ backgroundColor: colors.card, borderColor: colors.border }}>
              {decisionContent}
            </View>
          </View>
        </Modal>
      );
    })()}
    </>
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
    <Popup visible={visible} onClose={onClose} presentation="auto" maxWidth={420}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40, gap: 20 }}>
            <View className="flex-row items-center justify-between">
              <Text className="text-typography-main text-xl font-black">New Channel</Text>
              <Tooltip label="Close">
                <TouchableOpacity onPress={onClose} className="w-8 h-8 bg-surface-background border border-surface-border rounded-xl items-center justify-center">
                  <FontAwesome name="times" size={12} color={colors.textMuted} />
                </TouchableOpacity>
              </Tooltip>
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
                    <Tooltip key={m.id} label="Remove member">
                      <TouchableOpacity
                        onPress={() => toggleMember(m)}
                        className="flex-row items-center gap-1.5 bg-brand-primary/10 border border-brand-primary/20 rounded-full px-3 py-1"
                      >
                        <Text className="text-brand-primary text-xs font-bold">{m.full_name}</Text>
                        <FontAwesome name="times" size={9} color={colors.primary} />
                      </TouchableOpacity>
                    </Tooltip>
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
    </Popup>
  );
}

// ─── Group Members Sheet ──────────────────────────────────────────────────────

function GroupMembersSheet({
  visible,
  group,
  currentUserId,
  canManageOverride,
  onClose,
  onMembersChanged,
}: {
  visible: boolean;
  group: FileHubGroup | null;
  currentUserId: string | undefined;
  canManageOverride: boolean;
  onClose: () => void;
  onMembersChanged: () => void;
}) {
  const { addGroupMember, removeGroupMember, fetchGroupMembers, renameGroup, deleteGroup } = useFileHub();
  const { hasPermission } = useAuth();
  const router = useRouter();
  const [members, setMembers] = useState<FileHubGroupMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [addSearch, setAddSearch] = useState('');
  const [addResults, setAddResults] = useState<any[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(group?.name ?? '');
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const colors = useThemeColors();
  const { showConfirm } = useAlert();

  useEffect(() => { setRenameValue(group?.name ?? ''); setIsRenaming(false); }, [group?.id, group?.name]);

  const commitRename = async () => {
    if (!group) return;
    const name = renameValue.trim();
    setIsRenaming(false);
    if (!name || name === group.name) { setRenameValue(group.name); return; }
    setRenaming(true);
    try {
      await renameGroup(group.id, name);
      onMembersChanged();
    } catch {
      setRenameValue(group.name);
    } finally {
      setRenaming(false);
    }
  };

  const handleDeleteGroup = () => {
    if (!group) return;
    showConfirm(
      'Delete Channel',
      `Permanently delete "${group.name}"? Its files move to the Bin and members lose access.`,
      async () => {
        setDeleting(true);
        try {
          await deleteGroup(group.id);
          onMembersChanged();
          onClose();
        } finally {
          setDeleting(false);
        }
      },
      undefined,
      'Delete',
      'Cancel',
      'destructive'
    );
  };

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
    const isSelf = userId === currentUserId;
    showConfirm(
      isSelf ? 'Leave Channel' : `Remove ${target?.full_name ?? 'member'}`,
      isSelf ? 'Are you sure you want to leave this channel?' : `Remove ${target?.full_name ?? 'this member'} from the channel?`,
      async () => {
        setRemovingId(userId);
        try {
          await removeGroupMember(group.id, userId);
          const updated = await fetchGroupMembers(group.id);
          setMembers(updated);
          onMembersChanged();
          if (isSelf) onClose();
        } catch {
          // error shown by context
        } finally {
          setRemovingId(null);
        }
      },
      undefined,
      isSelf ? 'Leave' : 'Remove',
      'Cancel',
      'destructive'
    );
  };

  if (!group) return null;

  // Override-manage users act as a virtual channel admin even though they
  // hold no real filehub_group_members row (kept that way so they don't
  // show up in the roster themselves).
  const myRole = members.find(m => m.id === currentUserId)?.role ?? (canManageOverride ? 'admin' : undefined);

  // Server decides whether we may know who can share (null = not our business).
  const showsShareColumn = members.some(m => m.can_share !== null && m.can_share !== undefined);
  const canEditRoles = hasPermission('role.manage');

  return (
    <Popup visible={visible} onClose={onClose} presentation="auto" maxWidth={420}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 40, gap: 16 }}>
            <View className="flex-row items-center justify-between gap-2">
              {isRenaming ? (
                <TextInput
                  value={renameValue}
                  onChangeText={setRenameValue}
                  onBlur={commitRename}
                  onSubmitEditing={commitRename}
                  autoFocus
                  editable={!renaming}
                  className="flex-1 text-typography-main text-xl font-black bg-surface-background border border-brand-primary/30 rounded-lg px-3 py-1"
                />
              ) : (
                <TouchableOpacity
                  onPress={() => myRole === 'admin' && setIsRenaming(true)}
                  disabled={myRole !== 'admin'}
                  className="flex-1 flex-row items-center gap-2"
                >
                  <Text className="text-typography-main text-xl font-black" numberOfLines={1}>{group.name}</Text>
                  {myRole === 'admin' && <FontAwesome name="pencil-square-o" size={12} color={colors.textMuted} />}
                </TouchableOpacity>
              )}
              <Tooltip label="Close">
                <TouchableOpacity onPress={onClose} className="w-8 h-8 bg-surface-background border border-surface-border rounded-xl items-center justify-center flex-shrink-0">
                  <FontAwesome name="times" size={12} color={colors.textMuted} />
                </TouchableOpacity>
              </Tooltip>
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
              <View className="flex-row items-center justify-between">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">
                  Members ({members.length})
                </Text>
                {showsShareColumn && (
                  <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Can share</Text>
                )}
              </View>
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
                      <UserLink userId={m.id} name={m.full_name} className="flex-1 text-typography-main text-sm font-medium" />
                      {/* can_share is null when the server decided we may not know. */}
                      {m.can_share !== null && m.can_share !== undefined && (
                        <Tooltip
                          label={m.can_share
                            ? `${m.full_name} can create share links for files they can access`
                            : `${m.full_name} can only share files they uploaded themselves`}
                        >
                          <FontAwesome
                            name={m.can_share ? 'share-alt' : 'ban'}
                            size={11}
                            color={m.can_share ? colors.primary : colors.textDim}
                            style={{ width: 18, textAlign: 'center' }}
                          />
                        </Tooltip>
                      )}
                      {m.role === 'admin' && (
                        <View className="bg-brand-primary/10 border border-brand-primary/20 rounded-full px-2 py-0.5 mr-2">
                          <Text className="text-brand-primary text-[9px] font-black">Admin</Text>
                        </View>
                      )}
                      {(myRole === 'admin' || m.id === currentUserId) && (
                        <Tooltip label={m.id === currentUserId ? 'Leave channel' : 'Remove member'}>
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
                        </Tooltip>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Sharing is a role permission, so send the reader straight to the
                role editor rather than making them hunt for it. */}
            {showsShareColumn && (
              <View className="border border-surface-border rounded-2xl px-4 py-3 bg-surface-background">
                <Text className="text-typography-dim text-[11px] leading-relaxed">
                  Sharing is granted by role, not per channel. Members without it can only
                  share files they uploaded themselves.
                </Text>
                {canEditRoles && (
                  <TouchableOpacity
                    onPress={() => { onClose(); router.push('/admin/roles?tab=roles'); }}
                    className="flex-row items-center gap-2 mt-2.5"
                  >
                    <FontAwesome name="filter" size={11} color={colors.primary} />
                    <Text className="text-brand-primary font-black text-xs">Change sharing permissions</Text>
                    <FontAwesome name="chevron-right" size={12} color={colors.primary} />
                  </TouchableOpacity>
                )}
              </View>
            )}

            {myRole === 'admin' && (
              <TouchableOpacity
                onPress={handleDeleteGroup}
                disabled={deleting}
                className="flex-row items-center justify-center gap-2 bg-state-danger/10 border border-state-danger/20 rounded-2xl px-4 py-3"
              >
                {deleting ? <ActivityIndicator size="small" color={colors.danger} /> : <FontAwesome name="trash-o" size={12} color={colors.danger} />}
                <Text className="text-state-danger font-black text-sm">Delete Channel</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
    </Popup>
  );
}

// ─── File Card ────────────────────────────────────────────────────────────────

function FolderCard({ folder, onNavigate, onRename, onDelete }: {
  folder: FileHubFolder;
  onNavigate: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const colors = useThemeColors();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(folder.name);

  const commitRename = () => {
    setIsRenaming(false);
    if (renameValue.trim() && renameValue.trim() !== folder.name) onRename(renameValue.trim());
  };

  const folderIcon = (
    <View className="w-11 h-11 bg-surface-background border border-surface-border rounded-xl items-center justify-center flex-shrink-0">
      <FontAwesome name="folder-o" size={20} color={colors.primary} />
    </View>
  );

  // Renaming: static container so the TextInput owns all touches.
  if (isRenaming) {
    return (
      <View className="border rounded-2xl px-4 py-4 mb-3 flex-row items-center gap-3 bg-surface-card border-surface-border">
        {folderIcon}
        <TextInput
          value={renameValue}
          onChangeText={setRenameValue}
          onBlur={commitRename}
          onSubmitEditing={commitRename}
          autoFocus
          className="flex-1 text-typography-main font-black text-sm bg-transparent"
        />
      </View>
    );
  }

  // The whole card is the tap target (matches FileCard) so folders and files
  // have the same hit area; pencil/trash are nested touchables that handle
  // their own presses.
  return (
    <TouchableOpacity onPress={onNavigate} className="border rounded-2xl px-4 py-4 mb-3 flex-row items-center gap-3 bg-surface-card border-surface-border">
      {folderIcon}
      <View className="flex-1 min-w-0">
        <Text className="text-typography-main font-black text-sm" numberOfLines={1}>{folder.name}</Text>
      </View>
      <TouchableOpacity onPress={() => { setRenameValue(folder.name); setIsRenaming(true); }} className="w-9 h-9 items-center justify-center">
        <FontAwesome name="pencil-square-o" size={12} color={colors.textMuted} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onDelete} className="w-9 h-9 items-center justify-center">
        <FontAwesome name="trash-o" size={12} color={colors.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

function NewFolderCard({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const colors = useThemeColors();
  const [showInput, setShowInput] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    await onCreate(name.trim());
    setName('');
    setShowInput(false);
    setCreating(false);
  };

  if (showInput) {
    return (
      <View className="border rounded-2xl px-4 py-3 mb-3 flex-row items-center gap-2 bg-surface-card border-brand-primary/40">
        <TextInput
          value={name}
          onChangeText={setName}
          onSubmitEditing={handleCreate}
          onBlur={() => { if (!name.trim()) setShowInput(false); }}
          placeholder="Folder name"
          placeholderTextColor={colors.textDim}
          autoFocus
          className="flex-1 text-typography-main text-sm bg-transparent"
        />
        <TouchableOpacity onPress={handleCreate} disabled={creating} className="px-3 py-1.5 bg-brand-primary rounded-xl">
          <Text className="text-white text-xs font-black">Add</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <TouchableOpacity
      onPress={() => setShowInput(true)}
      className="border border-dashed rounded-2xl px-4 py-3.5 mb-3 flex-row items-center justify-center gap-2 border-surface-border"
    >
      <FontAwesome name="plus" size={12} color={colors.textMuted} />
      <Text className="text-typography-muted text-sm font-bold">New folder</Text>
    </TouchableOpacity>
  );
}

function FileCard({
  file,
  mode,
  onPress,
  selectionMode = false,
  isFileSelected = false,
  onToggleSelect,
  onLongPress,
  thumbUri,
}: {
  file: FileHubFile;
  mode: FileHubMode;
  onPress: (e?: any) => void;
  selectionMode?: boolean;
  isFileSelected?: boolean;
  onToggleSelect?: () => void;
  onLongPress?: () => void;
  thumbUri?: string;
}) {
  const { icon, color } = getMimeIcon(file.mime_type);
  const isUnread = mode === 'inbox' && !file.recipient_state?.read_at;
  const colors = useThemeColors();

  return (
    <TouchableOpacity
      onPress={(e) => (selectionMode ? onToggleSelect?.() : onPress(e))}
      onLongPress={selectionMode ? undefined : onLongPress}
      delayLongPress={350}
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
          <UserLink userId={file.uploader.id} name={file.uploader.full_name} className="text-typography-muted text-xs" /> · {file.mime_type?.split('/').pop()?.toUpperCase() ?? 'File'} · {formatFileSize(file.size_bytes)}
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
    <Popup visible={visible} onClose={onClose} presentation="auto" maxWidth={420}>
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
                          <FontAwesome name="pencil-square-o" size={13} color={colors.textMuted} />
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
    </Popup>
  );
}

// ─── Main Adaptive Component ──────────────────────────────────────────────────

function FileHubAdaptiveInner() {
  const { hasPermission, user, profile } = useAuth();
  const { showConfirm, showAlert } = useAlert();
  const {
    mode, setMode,
    search, setSearch,
    selectedTag, setSelectedTag,
    files, folders, loading,
    selectedFolderId, setSelectedFolderId,
    createFolder, renameFolder, deleteFolder,
    inboxUnreadCount,
    refresh,
    markAllRead,
    groups, groupsLoading,
    channelOverrideMode, setChannelOverrideMode,
    activeGroupId, setActiveGroupId,
    groupFiles, groupFilesLoading,
    refreshGroups, refreshGroupFiles,
    hideFile, deleteFile,
  } = useFileHub();

  const canOverrideChannels = hasPermission('filehub:group_override');
  const canManageOverride = hasPermission('filehub:group_override_manage');

  const router = useRouter();
  const { tab: tabParam, file: fileParam } = useLocalSearchParams<{ tab?: string; file?: string }>();
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  // Floating tab bar sits at insets.bottom + 24/16 and is ~76px tall; clear it with margin.
  const tabBarClearance = Math.max(insets.bottom, Platform.OS === 'ios' ? 24 : 16) + 76;
  const [selectedFile, setSelectedFile] = useState<FileHubFile | null>(null);
  const [fastTrackPreview, setFastTrackPreview] = useState(false);
  const isDoubleTap = useDoubleTap();

  // Standard click → metadata sheet; double-tap/double-click, or Shift+Click
  // (web) → straight to fullscreen viewer.
  const openFile = useCallback((file: FileHubFile, e?: any) => {
    const isDouble = isDoubleTap(file.id);
    setFastTrackPreview(!!(e?.shiftKey || e?.nativeEvent?.shiftKey) || isDouble);
    setSelectedFile(file);
  }, [isDoubleTap]);
  const [showUpload, setShowUpload] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showManageMembers, setShowManageMembers] = useState(false);
  const [showManageTags, setShowManageTags] = useState(false);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showBin, setShowBin] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
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
    const validModes: FileHubMode[] = ['overview', 'browse', 'inbox', 'sent', 'broadcast', 'groups'];
    if (tabParam && validModes.includes(tabParam as FileHubMode)) {
      setMode(tabParam as FileHubMode);
    }
  }, []);

  // Deep link (?file=<id>) from global search — open the file directly.
  useEffect(() => {
    if (!fileParam) return;
    let cancelled = false;
    supabase.rpc('rpc_filehub_browse', { p_file_id: fileParam }).then(({ data }) => {
      const row = (data as any)?.items?.[0];
      if (!cancelled && row) openStorageFile(row.bucket, row.storage_path, row.file_name, row.mime_type);
    });
    router.setParams({ file: undefined });
    return () => { cancelled = true; };
  }, [fileParam]);

  // Channel files come back flat (unfiltered by folder) from rpc_filehub_group_list_files,
  // so folder scoping for channels happens client-side to match the server-side
  // p_folder_id filtering that inbox/sent/broadcast already get from fetchFiles.
  const displayFiles = mode === 'groups' && activeGroupId
    ? groupFiles.filter(f => (f.folder_id ?? null) === selectedFolderId)
    : files;
  const displayLoading = mode === 'groups' && activeGroupId ? groupFilesLoading : loading;

  // Reset folder navigation when entering/leaving a channel so it doesn't
  // inherit wherever Inbox/Sent/Broadcast last left off (or bleed between channels).
  useEffect(() => { setSelectedFolderId(null); }, [activeGroupId]);

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

  // Web zips; Android saves straight into a user-picked folder via SAF (no zip
  // support there). Other native platforms fall back to opening files one by one.
  const saveFiles = async (filesToSave: FileHubFile[], zipName: string) => {
    // A single file never needs zipping — open it directly so media (image /
    // video / PDF) streams into the device's native previewer instead of
    // downloading as an opaque .zip archive (#5). openStorageFile already picks
    // inline-stream vs. attachment-download per platform and file type.
    if (filesToSave.length === 1) {
      const f = filesToSave[0];
      await openStorageFile(f.bucket || 'filehub-files', f.storage_path, f.original_name, f.mime_type);
      return;
    }
    if (Platform.OS === 'web') {
      await downloadFilesAsZip(filesToSave, zipName);
      return;
    }
    if (Platform.OS !== 'android') {
      showAlert('Not Supported', 'Batch download isn\'t available on this device yet — open each file individually instead.');
      return;
    }
    const { savedCount, failedCount, cancelled } = await downloadFilesToDevice(filesToSave);
    if (cancelled) return;
    if (savedCount === 0) {
      showAlert('Download Failed', `Couldn't save any of the ${failedCount} file(s). Check your connection and try again.`);
    } else if (failedCount > 0) {
      showAlert('Partially Saved', `Saved ${savedCount} file(s); ${failedCount} failed.`);
    } else {
      showAlert('Saved', `${savedCount} file(s) saved to the selected folder.`);
    }
  };

  const handleDownloadAll = async (name: string) => {
    if (zipDownloading || displayFiles.length === 0) return;
    setZipDownloading(true);
    try {
      await saveFiles(displayFiles, name);
    } finally {
      setZipDownloading(false);
    }
  };

  const handleDownloadSelected = async () => {
    const filesToDownload = displayFiles.filter(f => selectedFileIds.has(f.id));
    if (filesToDownload.length === 0 || zipDownloading) return;
    setZipDownloading(true);
    try {
      await saveFiles(filesToDownload, 'Selected Files');
      exitSelection();
    } finally {
      setZipDownloading(false);
    }
  };

  const handleDeleteSelected = () => {
    const filesToDelete = displayFiles.filter(f => selectedFileIds.has(f.id));
    if (filesToDelete.length === 0) return;
    showConfirm(
      'Delete Files',
      `Delete ${filesToDelete.length} file${filesToDelete.length === 1 ? '' : 's'}? This cannot be undone.`,
      () => {
        Promise.all(filesToDelete.map(f => (f.uploader?.id === user?.id ? deleteFile(f.id) : hideFile(f.id))))
          .then(() => exitSelection());
      },
      undefined, 'Delete', 'Cancel', 'destructive'
    );
  };

  const enterSelectionWith = useCallback((fileId: string) => {
    setSelectionMode(true);
    setSelectedFileIds(new Set([fileId]));
  }, []);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    displayFiles.forEach(f => f.tags.forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [displayFiles]);

  // Folders are scoped: Direct (Inbox+Sent share one tree, since they're the
  // same underlying files viewed from two ends), Broadcast, and one
  // independent tree per channel. contextFolders narrows the full company
  // list down to whichever tree applies to the tab/channel currently open.
  const contextScope: FileHubFolderScope = mode === 'groups' ? 'group' : mode === 'broadcast' ? 'broadcast' : 'direct';
  const contextGroupId = mode === 'groups' ? activeGroupId : null;
  const contextFolders = useMemo(
    () => folders.filter(f => f.scope === contextScope && (f.group_id ?? null) === contextGroupId),
    [folders, contextScope, contextGroupId]
  );

  // Explorer-style browsing: subfolders of whichever directory is currently
  // open sit above its files.
  const subfolders = useMemo(() => {
    return contextFolders.filter(f => f.parent_id === selectedFolderId).sort((a, b) => a.name.localeCompare(b.name));
  }, [contextFolders, selectedFolderId]);
  const breadcrumbChain = selectedFolderId ? folderAncestors(contextFolders, selectedFolderId) : [];
  const handleCreateFolder = useCallback(
    (name: string) => createFolder(name, selectedFolderId, contextScope, contextGroupId),
    [createFolder, selectedFolderId, contextScope, contextGroupId]
  );
  const handleDeleteFolder = useCallback((id: string, name: string) => {
    const hasChildren = folders.some(f => f.parent_id === id);
    showConfirm(
      'Delete Folder',
      `Delete "${name}"?${hasChildren ? ' Its subfolders will be deleted too.' : ''} Files will stay but lose the folder label.`,
      () => deleteFolder(id),
      undefined, 'Delete', 'Cancel', 'destructive'
    );
  }, [folders, deleteFolder, showConfirm]);

  const tabs: { key: FileHubMode; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'browse', label: 'Browse' },
    { key: 'groups', label: 'Channels' },
    { key: 'inbox', label: 'Inbox', count: inboxUnreadCount > 0 ? inboxUnreadCount : undefined },
    ...(canBroadcast ? [{ key: 'broadcast' as FileHubMode, label: 'Broadcast' }] : []),
  ];

  const handleTabChange = (key: FileHubMode) => {
    setMode(key);
    setActiveGroupId(null);
    setSelectedFile(null);
    router.setParams({ tab: key });
  };

  const handleRefresh = () => {
    if (mode === 'overview' || mode === 'browse') { setRefreshKey(k => k + 1); return; }
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
            <BackButton label="" fallbackHref="/intelligence" />
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
        <TouchableOpacity
          onPress={() => handleTabChange('sent')}
          className={`w-11 h-11 rounded-2xl items-center justify-center border ${mode === 'sent' ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-card border-surface-border'}`}
        >
          <FontAwesome name="paper-plane-o" size={13} color={mode === 'sent' ? colors.primary : colors.textMain} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowBin(true)} className="w-11 h-11 bg-surface-card border border-surface-border rounded-2xl items-center justify-center">
          <FontAwesome name="trash-o" size={13} color={colors.primary} />
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

      {/* ── Overview / Browse tabs (own their data, full-height) ── */}
      {mode === 'overview' && (
        <FileHubOverview
          key={`overview-${refreshKey}`}
          compact
          onUpload={() => setShowUpload(true)}
          onNewChannel={() => setShowCreateGroup(true)}
          onGoTab={handleTabChange}
        />
      )}
      {mode === 'browse' && <FileHubBrowse key={`browse-${refreshKey}`} compact />}

      {mode !== 'overview' && mode !== 'browse' && (<>
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

      {(mode !== 'groups' || activeGroupId) && (
        <View className="flex-row items-center flex-wrap px-6 mb-3 gap-x-1.5">
          <TouchableOpacity onPress={() => setSelectedFolderId(null)} className="py-1">
            <Text className={`text-xs font-black ${!selectedFolderId ? 'text-typography-main' : 'text-typography-muted'}`}>All Files</Text>
          </TouchableOpacity>
          {breadcrumbChain.map((f, i) => (
            <React.Fragment key={f.id}>
              <FontAwesome name="chevron-right" size={10} color={colors.textDim} />
              <TouchableOpacity onPress={() => setSelectedFolderId(f.id)} className="py-1">
                <Text className={`text-xs font-black ${i === breadcrumbChain.length - 1 ? 'text-typography-main' : 'text-typography-muted'}`} numberOfLines={1}>{f.name}</Text>
              </TouchableOpacity>
            </React.Fragment>
          ))}
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
            <Text className="text-typography-main font-black text-lg">
              {channelOverrideMode ? 'All Channels' : 'Your Channels'}
            </Text>
            <View className="flex-row items-center gap-2">
              {(canOverrideChannels || canManageOverride) && (
                <TouchableOpacity
                  onPress={() => setChannelOverrideMode(!channelOverrideMode)}
                  className={`flex-row items-center gap-1.5 px-3 h-9 rounded-xl border ${
                    channelOverrideMode ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-card border-surface-border'
                  }`}
                >
                  <FontAwesome name="eye" size={12} color={channelOverrideMode ? colors.primary : colors.textMuted} />
                  <Text className={`text-xs font-black ${channelOverrideMode ? 'text-brand-primary' : 'text-typography-muted'}`}>
                    All
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                onPress={() => setShowCreateGroup(true)}
                className="flex-row items-center gap-2 bg-brand-primary px-4 py-2 rounded-xl"
              >
                <FontAwesome name="plus" size={11} color={colors.textMain} />
                <Text className="text-white font-black text-xs">New Channel</Text>
              </TouchableOpacity>
            </View>
          </View>

          {groupsLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : (
            <View className="flex-1">
              <FileHubChannelsMultiView
                groups={groups}
                loading={false}
                searchValue={search}
                onPressGroup={(g) => setActiveGroupId(g.id)}
                onCreateChannel={() => setShowCreateGroup(true)}
              />
            </View>
          )}
        </>
      )}

      {/* ── GROUPS mode — group file list (folders above files, same explorer as Inbox/Sent/Broadcast) ── */}
      {mode === 'groups' && activeGroupId && (
        <>
          {displayLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : displayFiles.length === 0 && subfolders.length === 0 ? (
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
              {!search && <View className="w-full"><NewFolderCard onCreate={handleCreateFolder} /></View>}
            </View>
          ) : (
            <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
              {!selectionMode && subfolders.map(f => (
                <FolderCard
                  key={f.id}
                  folder={f}
                  onNavigate={() => setSelectedFolderId(f.id)}
                  onRename={(name) => renameFolder(f.id, name)}
                  onDelete={() => handleDeleteFolder(f.id, f.name)}
                />
              ))}
              {!selectionMode && <NewFolderCard onCreate={handleCreateFolder} />}
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
                  onLongPress={() => enterSelectionWith(file.id)}
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
          ) : displayFiles.length === 0 && subfolders.length === 0 ? (
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
              {!search && <View className="w-full"><NewFolderCard onCreate={handleCreateFolder} /></View>}
              <TaskFileResults pad={false} />
            </View>
          ) : (
            <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
              {!selectionMode && subfolders.map(f => (
                <FolderCard
                  key={f.id}
                  folder={f}
                  onNavigate={() => setSelectedFolderId(f.id)}
                  onRename={(name) => renameFolder(f.id, name)}
                  onDelete={() => handleDeleteFolder(f.id, f.name)}
                />
              ))}
              {!selectionMode && <NewFolderCard onCreate={handleCreateFolder} />}
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
                  onLongPress={() => enterSelectionWith(file.id)}
                />
              ))}
              <TaskFileResults pad={false} />
              <View style={{ height: selectionMode ? 140 : 100 }} />
            </ScrollView>
          )}
        </>
      )}

      </>)}

      {/* ── Selection toolbar (replaces FAB when in selection mode) ── */}
      {selectionMode ? (
        <View className="absolute left-5 right-5 bg-surface-card border border-surface-border rounded-2xl px-4 py-2 flex-row items-center gap-2.5 premium-shadow" style={{ bottom: tabBarClearance }}>
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
          {selectedFileIds.size > 0 && (
            <TouchableOpacity
              onPress={handleDeleteSelected}
              className="flex-row items-center gap-1.5 bg-state-danger/10 border border-state-danger/20 px-4 py-2.5 rounded-xl"
            >
              <FontAwesome name="trash-o" size={13} color={colors.danger} />
              <Text className="text-state-danger font-black text-sm">Delete</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={exitSelection} className="w-9 h-9 items-center justify-center flex-shrink-0">
            <FontAwesome name="times" size={15} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      ) : (
        (mode !== 'groups' || (activeGroupId && (!activeGroup?.is_override || canManageOverride))) && (
          <TouchableOpacity
            onPress={() => setShowUpload(true)}
            className="absolute right-6 w-14 h-14 bg-brand-primary rounded-full items-center justify-center premium-shadow"
            style={{ bottom: tabBarClearance }}
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
        defaultFolderId={selectedFolderId}
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
        canManageOverride={canManageOverride}
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

      {/* ── Bin ── */}
      <FileHubBin visible={showBin} onClose={() => setShowBin(false)} />
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
