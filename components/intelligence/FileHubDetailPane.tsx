import { useAlert } from '@/contexts/AlertContext';
import { FileActivity, useFileHub } from '@/contexts/FileHubContext';
import { useFileViewer, type ViewerMedia } from '@/hooks/useFileViewer';
import { useThemeColors } from '@/hooks/useThemeColors';
import { openStorageFile } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { FilePreviewTeaser, getPreviewKind } from '../common/FilePreview';
import Tooltip from '../common/Tooltip';
import { useShareFile } from './ShareFallbackSheet';
import { fileIcon, formatSize } from './TaskFileResults';

export type DetailFile = {
  source: 'filehub' | 'submission' | 'task_brief';
  file_id: string;
  bucket: string;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number;
  created_at?: string | null;
  task_id?: string | null;
  task_title?: string | null;
  project_name?: string | null;
  task_category?: string | null;
  submission_id?: string | null;
};

// Unified version row across sources (filehub versions, brief per-file versions,
// submission revisions). `dl` present when the version is a downloadable file.
type VRow = {
  id: string; version_no: number; created_at: string; is_current: boolean;
  sub?: string; dl?: { bucket: string; storage_path: string; name: string; mime: string | null };
};

const isImage = (m: string | null) => !!m && m.toLowerCase().includes('image');

function ago(iso: string | null | undefined): string {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

const ACTION_ICON: Record<FileActivity['action'], any> = {
  upload: 'upload', download: 'download', view: 'eye', delete: 'trash-o', share: 'share',
};

/**
 * Preview-biased detail pane for the Browse tab (#146). Every source now gets
 * Details / Versions / Activity (#143 Phase 3): FileHub files via the context
 * data methods; brief/submission files via their own version RPCs
 * (rpc_task_attachment_versions / rpc_submission_versions) and the filehub_files
 * pointer row (rpc_filehub_pointer_id) for FK-logged activity.
 */
export default function FileHubDetailPane({
  file, onClose, onDeleted, compact,
}: {
  file: DetailFile;
  onClose: () => void;
  onDeleted?: (fileId: string) => void;
  compact?: boolean;
}) {
  const colors = useThemeColors();
  const router = useRouter();
  const { fileVersions, fileActivity, deleteFile, logActivity } = useFileHub();
  const { showConfirm } = useAlert();
  const { share, shareSheet } = useShareFile();

  const isFileHub = file.source === 'filehub';
  const kind = getPreviewKind(file.mime_type, file.file_name);
  const image = isImage(file.mime_type);

  const [tab, setTab] = useState<'details' | 'versions' | 'activity'>('details');
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [versions, setVersions] = useState<VRow[] | null>(null);
  const [activity, setActivity] = useState<FileActivity[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  // filehub_files id used for activity — the file's own id for filehub, the
  // pointer row for task files (resolved async so activity can be FK-logged).
  const [pointerId, setPointerId] = useState<string | null>(null);
  const activityId = isFileHub ? file.file_id : pointerId;

  // Single-item viewer for the fullscreen "Open" action.
  const media: ViewerMedia[] = useMemo(
    () => [{ id: file.file_id, name: file.file_name, storagePath: file.storage_path, mimeType: file.mime_type, bucket: file.bucket, sizeBytes: file.size_bytes }],
    [file.file_id, file.storage_path],
  );
  const { handlePress, viewer } = useFileViewer(media, file.bucket, { onShare: () => shareOut() });
  const openFull = () => { handlePress(media[0]); if (activityId) logActivity(activityId, 'view'); };

  // Reset + resolve preview URL when the selected file changes.
  useEffect(() => {
    setTab('details'); setVersions(null); setActivity(null); setSignedUrl(null); setPointerId(null);
    let cancelled = false;
    if ((image || kind) && !file.storage_path.startsWith('http')) {
      supabase.storage.from(file.bucket).createSignedUrl(file.storage_path, 3600)
        .then(({ data }) => { if (!cancelled && data?.signedUrl) setSignedUrl(data.signedUrl); });
    } else if (file.storage_path.startsWith('http')) {
      setSignedUrl(file.storage_path);
    }
    return () => { cancelled = true; };
  }, [file.file_id, file.storage_path]);

  // Resolve the activity id + log a view on open (filehub: own id; task: pointer row).
  useEffect(() => {
    let cancelled = false;
    if (isFileHub) { logActivity(file.file_id, 'view'); return; }
    supabase.rpc('rpc_filehub_pointer_id', { p_source: file.source, p_source_id: file.file_id })
      .then(({ data }) => { if (!cancelled && data) { setPointerId(data as string); logActivity(data as string, 'view'); } });
    return () => { cancelled = true; };
  }, [file.file_id]);

  // Version history — filehub versions, brief per-file versions, or submission revisions.
  const loadVersions = async () => {
    try {
      if (file.source === 'filehub') {
        const vs = await fileVersions(file.file_id);
        setVersions(vs.map(v => ({ id: v.id, version_no: v.version_no, created_at: v.created_at, is_current: v.is_current, sub: formatSize(v.size_bytes), dl: { bucket: v.bucket || file.bucket, storage_path: v.storage_path, name: v.original_name, mime: v.mime_type } })));
      } else if (file.source === 'task_brief') {
        const { data } = await supabase.rpc('rpc_task_attachment_versions', { p_attachment_id: file.file_id });
        setVersions(((data as any[]) || []).map(v => ({ id: v.id, version_no: v.version_no, created_at: v.created_at, is_current: v.is_current, dl: { bucket: v.bucket || file.bucket, storage_path: v.storage_path, name: v.file_name, mime: v.mime_type } })));
      } else if (file.submission_id) {
        const { data } = await supabase.rpc('rpc_submission_versions', { p_submission_id: file.submission_id });
        setVersions(((data as any[]) || []).map(v => ({ id: v.id, version_no: v.version_no, created_at: v.created_at, is_current: v.is_current, sub: v.content ? String(v.content).slice(0, 60) : undefined })));
      } else { setVersions([]); }
    } catch { setVersions([]); }
  };

  useEffect(() => {
    if (tab === 'versions' && versions === null) loadVersions();
    if (tab === 'activity' && activity === null && activityId) fileActivity(activityId).then(setActivity).catch(() => setActivity([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, file.file_id, pointerId]);

  const download = () => { if (activityId) logActivity(activityId, 'download'); openStorageFile(file.bucket, file.storage_path, file.file_name, file.mime_type); };

  const shareOut = () => share({
    fileId: isFileHub ? file.file_id : null,
    bucket: file.bucket,
    storagePath: file.storage_path,
    name: file.file_name,
    mimeType: file.mime_type,
    sizeBytes: file.size_bytes,
  });

  const confirmDelete = () => {
    showConfirm(
      'Delete file?',
      `"${file.file_name}" will be moved to the bin.`,
      async () => {
        setDeleting(true);
        try { await deleteFile(file.file_id); onDeleted?.(file.file_id); onClose(); }
        finally { setDeleting(false); }
      },
      undefined, 'Delete', 'Cancel', 'destructive',
    );
  };

  const Preview = (
    <View className={`${compact ? 'w-full h-56' : 'flex-1'} bg-surface-background items-center justify-center overflow-hidden`}>
      {image && signedUrl ? (
        <Image source={{ uri: signedUrl }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
      ) : kind && signedUrl ? (
        <View className="w-full h-full">
          <FilePreviewTeaser uri={signedUrl} kind={kind} height={compact ? 224 : 560} onPress={openFull} sizeBytes={file.size_bytes} />
        </View>
      ) : (
        <TouchableOpacity onPress={openFull} className="items-center gap-3 px-6">
          <FontAwesome name={fileIcon(file.mime_type)} size={44} color={colors.textMuted} />
          <Text className="text-typography-muted text-xs font-black uppercase tracking-widest">
            {file.file_name.split('.').pop() || 'File'}
          </Text>
          <View className="flex-row items-center gap-2 bg-brand-primary px-4 py-2 rounded-xl">
            <FontAwesome name="external-link" size={11} color="#fff" />
            <Text className="text-white font-black text-xs">Open</Text>
          </View>
        </TouchableOpacity>
      )}
      {(image || kind) && signedUrl && (
        <TouchableOpacity onPress={openFull} className="absolute bottom-3 right-3 flex-row items-center gap-2 bg-black/60 px-3 py-2 rounded-xl">
          <FontAwesome name="search-plus" size={11} color="#fff" />
          <Text className="text-white font-black text-[11px]">Fullscreen</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  const Props = (
    <View className={`${compact ? 'w-full' : 'w-[320px]'} border-surface-border ${compact ? 'border-t' : 'border-l'} flex-col`} style={{ minHeight: 0 }}>
      {/* Header */}
      <View className="px-5 pt-5 pb-3 border-b border-surface-border">
        <View className="flex-row items-start gap-2">
          <Text className="flex-1 text-typography-main text-base font-black" numberOfLines={2}>{file.file_name}</Text>
          <Tooltip label="Close">
            <TouchableOpacity onPress={onClose} className="w-8 h-8 rounded-lg items-center justify-center border border-surface-border">
              <FontAwesome name="times" size={13} color={colors.textMuted} />
            </TouchableOpacity>
          </Tooltip>
        </View>
        <View className="flex-row items-center gap-2 mt-2">
          <SourceBadge source={file.source} colors={colors} />
          <Text className="text-typography-muted text-[11px]">{formatSize(file.size_bytes)}</Text>
        </View>
      </View>

      {/* Actions */}
      <View className="px-5 py-3 flex-row items-center gap-2 border-b border-surface-border">
        <ActionBtn icon="external-link" label="Open" onPress={openFull} colors={colors} primary />
        <ActionBtn icon="download" label="Download" onPress={download} colors={colors} />
        <ActionBtn icon="share" label="Share" onPress={shareOut} colors={colors} />
        {isFileHub && <ActionBtn icon="trash-o" label={deleting ? '…' : 'Delete'} onPress={confirmDelete} colors={colors} danger />}
      </View>
      {shareSheet}

      {/* Tabs — Details / Versions / Activity for every source (task files use
          their own version RPCs + the filehub pointer row for activity). */}
      <View className="px-5 pt-3 flex-row items-center gap-2">
        {(['details', 'versions', 'activity'] as const).map(t => (
          <TouchableOpacity key={t} onPress={() => setTab(t)} className={`px-4 py-1.5 rounded-xl border ${tab === t ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-background border-surface-border'}`}>
            <Text className={`text-xs font-black capitalize ${tab === t ? 'text-brand-primary' : 'text-typography-muted'}`}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView className="flex-1 no-scrollbar" contentContainerStyle={{ padding: 20, paddingTop: 12 }}>
        {tab === 'details' && (
          <View className="gap-3">
            <Field label="Type" value={file.mime_type || 'Unknown'} colors={colors} />
            <Field label="Size" value={formatSize(file.size_bytes)} colors={colors} />
            {file.created_at && <Field label="Added" value={ago(file.created_at)} colors={colors} />}
            {file.task_title && <LinkField label="Task" value={file.task_title} onPress={() => file.task_id && router.push(`/task/${file.task_id}` as any)} colors={colors} />}
            {file.project_name && <Field label="Project" value={file.project_name} colors={colors} />}
            {file.task_category && <Field label="Category" value={file.task_category} colors={colors} />}
          </View>
        )}

        {tab === 'versions' && (
          versions === null ? <ActivityIndicator color={colors.primary} />
            : versions.length === 0 ? <Text className="text-typography-muted text-sm">No version history.</Text>
            : (
              <View className="gap-2">
                {versions.map(v => (
                  <View key={v.id} className="flex-row items-center gap-3 rounded-xl border border-surface-border px-3 py-2.5">
                    <View className="flex-1 min-w-0">
                      <View className="flex-row items-center gap-2">
                        <Text className="text-typography-main text-sm font-bold">v{v.version_no}</Text>
                        {v.is_current && <View className="bg-brand-primary/15 px-2 py-0.5 rounded-full"><Text className="text-brand-primary text-[8px] font-black uppercase">Current</Text></View>}
                      </View>
                      <Text className="text-typography-muted text-[10px] mt-0.5" numberOfLines={1}>{[v.sub, ago(v.created_at)].filter(Boolean).join(' · ')}</Text>
                    </View>
                    {v.dl && (
                      <Tooltip label="Download this version">
                        <TouchableOpacity
                          onPress={() => { if (activityId) logActivity(activityId, 'download', { version_no: v.version_no }); openStorageFile(v.dl!.bucket, v.dl!.storage_path, v.dl!.name, v.dl!.mime); }}
                          className="w-8 h-8 rounded-lg items-center justify-center border border-surface-border"
                        >
                          <FontAwesome name="download" size={11} color={colors.textMuted} />
                        </TouchableOpacity>
                      </Tooltip>
                    )}
                  </View>
                ))}
              </View>
            )
        )}

        {tab === 'activity' && (
          activity === null ? <ActivityIndicator color={colors.primary} />
            : activity.length === 0 ? <Text className="text-typography-muted text-sm">No activity yet.</Text>
            : (
              <View className="gap-2.5">
                {activity.map(a => (
                  <View key={a.id} className="flex-row items-center gap-3">
                    <FontAwesome name={ACTION_ICON[a.action] || 'circle'} size={12} color={colors.textMuted} />
                    <Text className="flex-1 text-typography-main text-[12px]" numberOfLines={1}>
                      <Text className="font-bold">{a.user?.full_name || 'Someone'}</Text> {a.action === 'view' ? 'viewed' : `${a.action}ed`}
                    </Text>
                    <Text className="text-typography-muted text-[10px]">{ago(a.created_at)}</Text>
                  </View>
                ))}
              </View>
            )
        )}
      </ScrollView>
    </View>
  );

  return (
    <View className={`flex-1 bg-surface-card border border-surface-border rounded-3xl overflow-hidden ${compact ? 'flex-col' : 'flex-row'}`} style={{ minHeight: 0 }}>
      {Preview}
      {Props}
      {viewer}
    </View>
  );
}

function SourceBadge({ source, colors }: { source: string; colors: any }) {
  const label = source === 'filehub' ? 'FileHub' : source === 'submission' ? 'Submission' : 'Brief';
  const tint = source === 'filehub' ? colors.primary : colors.textMuted;
  return (
    <View className="px-2 py-0.5 rounded-full" style={{ backgroundColor: `${tint}1A` }}>
      <Text className="text-[9px] font-black uppercase tracking-wider" style={{ color: tint }}>{label}</Text>
    </View>
  );
}

function ActionBtn({ icon, label, onPress, colors, primary, danger }: { icon: any; label: string; onPress: () => void; colors: any; primary?: boolean; danger?: boolean }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`flex-row items-center gap-1.5 px-3.5 py-2 rounded-xl ${primary ? 'bg-brand-primary' : danger ? 'bg-state-danger/10 border border-state-danger/20' : 'bg-surface-background border border-surface-border'}`}
    >
      <FontAwesome name={icon} size={11} color={primary ? '#fff' : danger ? colors.danger : colors.textMuted} />
      <Text className={`font-black text-[12px] ${primary ? 'text-white' : danger ? 'text-state-danger' : 'text-typography-main'}`}>{label}</Text>
    </TouchableOpacity>
  );
}

function Field({ label, value, colors }: { label: string; value: string; colors: any }) {
  return (
    <View>
      <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1">{label}</Text>
      <Text className="text-typography-main text-sm" numberOfLines={2}>{value}</Text>
    </View>
  );
}

function LinkField({ label, value, onPress, colors }: { label: string; value: string; onPress: () => void; colors: any }) {
  return (
    <View>
      <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-1">{label}</Text>
      <TouchableOpacity onPress={onPress} className="flex-row items-center gap-1.5">
        <Text className="text-brand-primary text-sm font-bold" numberOfLines={1}>{value}</Text>
        <FontAwesome name="external-link" size={10} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );
}
