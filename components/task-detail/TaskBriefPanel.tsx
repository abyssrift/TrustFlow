import { useAlert } from '@/contexts/AlertContext';
import { useAuth } from '@/contexts/AuthContext';
import { useTaskDetail, type DeletedTaskAttachmentData, type TaskAttachmentData, type TaskAttachmentVersionData } from '@/contexts/TaskDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { downloadFilesAsZip, openStorageFile, TASK_BRIEF_BUCKET } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import DraggableSheet from '@/components/common/DraggableSheet';
import ImageLightbox from '@/components/common/ImageLightbox';
import CollapsibleCard from './CollapsibleCard';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function formatSize(bytes: number | null) {
  if (!bytes || bytes === 0) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getCategory(mimeType: string): string {
  const t = mimeType.toLowerCase();
  if (t.includes('image')) return 'image';
  if (t.includes('pdf') || t.includes('word') || t.includes('document') || t.includes('text')) return 'document';
  if (t.includes('spreadsheet') || t.includes('excel') || t.includes('csv')) return 'spreadsheet';
  return 'other';
}

function getFileIcon(mimeType: string | null, colors: ReturnType<typeof useThemeColors>): { name: string; color: string } {
  const t = (mimeType || '').toLowerCase();
  if (t.includes('image')) return { name: 'file-image-o', color: colors.warning };
  if (t.includes('pdf')) return { name: 'file-pdf-o', color: colors.danger };
  if (t.includes('spreadsheet') || t.includes('excel') || t.includes('csv')) return { name: 'file-excel-o', color: colors.success };
  if (t.includes('word') || t.includes('document') || t.includes('text')) return { name: 'file-text-o', color: colors.info };
  return { name: 'file-o', color: colors.textMuted };
}

// ─── Adaptive File Grid ───────────────────────────────────────────────────────
function AdaptiveFileGrid({
  files,
  signedUrls = {},
  onPressFile,
  onRemove,
  onReplace,
  onHistory,
  replacingId = null,
  isUploading = false
}: {
  files: any[];
  signedUrls?: Record<string, string>;
  onPressFile?: (pf: any) => void;
  onRemove?: (id: string) => void;
  onReplace?: (pf: any) => void;
  onHistory?: (pf: any) => void;
  replacingId?: string | null;
  isUploading?: boolean;
}) {
  const [containerWidth, setContainerWidth] = useState(0);
  const colors = useThemeColors();
  
  const gap = 12;
  const minSquareSize = 90;
  const availableWidth = containerWidth > 0 ? containerWidth : 300;
  
  let numCols = Math.floor((availableWidth + gap) / (minSquareSize + gap));
  if (numCols < 2) numCols = 2; 
  const exactSquareSize = Math.floor((availableWidth - (gap * (numCols - 1))) / numCols);

  if (files.length === 0) return null;

  return (
    <View 
      onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      className="flex-row flex-wrap w-full bg-surface-card border border-surface-border rounded-xl p-3 mb-4"
      style={{ gap }}
    >
      {files.map((pf) => {
        const isImage = pf.type?.toLowerCase().includes('image') || pf.mime_type?.toLowerCase().includes('image');
        const { name: icon, color } = getFileIcon(pf.type || pf.mime_type || null, colors);

        // Local previews (web File during upload) use an object URL; stored attachments
        // need a signed URL since the bucket is private — a raw storage path won't load.
        const localUri = Platform.OS === 'web' && pf.uri instanceof File
            ? URL.createObjectURL(pf.uri)
            : null;
        const uri = localUri || signedUrls[pf.id] || '';
        const isResolving = isImage && !uri;

        return (
          <View
            key={pf.id}
            style={{ width: exactSquareSize, height: exactSquareSize }}
            className="rounded-xl overflow-hidden border border-surface-border bg-surface-background relative"
          >
            {/* Press-to-open target is an absolute-fill touchable; the overlay buttons
                below are SIBLINGS, not children — nested touchables silently swallow
                presses on react-native-web. */}
            <TouchableOpacity
              activeOpacity={onPressFile ? 0.7 : 1}
              disabled={!onPressFile || isResolving}
              onPress={() => onPressFile?.(pf)}
              style={Platform.OS === 'web' && onPressFile ? ({ cursor: 'pointer' } as any) : null}
              className="absolute inset-0"
            >
              {isImage ? (
                isResolving ? (
                  <View className="flex-1 items-center justify-center absolute inset-0 bg-surface-background">
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : (
                  <Image
                    source={{ uri }}
                    style={{ flex: 1, width: '100%', height: '100%', position: 'absolute' }}
                    resizeMode="cover"
                  />
                )
              ) : (
                <View className="flex-1 items-center justify-center p-2 bg-surface-background">
                  <FontAwesome name={icon as any} size={exactSquareSize > 80 ? 32 : 24} color={color} />
                  <View className="mt-2 bg-surface-card px-2 py-0.5 rounded-md border border-surface-border">
                    <Text className="text-[9px] font-black uppercase text-typography-muted" numberOfLines={1}>
                      {pf.name.split('.').pop()?.toUpperCase() || 'FILE'}
                    </Text>
                  </View>
                </View>
              )}
            </TouchableOpacity>

            {onRemove && !isUploading && (
              <TouchableOpacity
                onPress={() => onRemove(pf.id)}
                className="absolute top-1.5 right-1.5 w-6 h-6 bg-black/60 rounded-full items-center justify-center hover:bg-black/80"
              >
                <FontAwesome name="times" size={10} color="#fff" />
              </TouchableOpacity>
            )}

            {onReplace && !isUploading && (
              <TouchableOpacity
                onPress={() => onReplace(pf)}
                disabled={replacingId !== null}
                className={`absolute top-1.5 ${onRemove ? 'right-9' : 'right-1.5'} w-6 h-6 bg-black/60 rounded-full items-center justify-center hover:bg-black/80`}
              >
                {replacingId === pf.id ? (
                  <ActivityIndicator size="small" color="#fff" style={{ transform: [{ scale: 0.5 }] }} />
                ) : (
                  <FontAwesome name="refresh" size={10} color="#fff" />
                )}
              </TouchableOpacity>
            )}

            {onHistory && (pf.version_count ?? 1) > 1 && (
              <TouchableOpacity
                onPress={() => onHistory(pf)}
                className="absolute top-1.5 left-1.5 flex-row items-center bg-black/60 rounded-full px-2 py-1 hover:bg-black/80"
              >
                <FontAwesome name="history" size={8} color="#fff" />
                <Text className="text-white text-[8px] font-black ml-1">v{pf.version_count}</Text>
              </TouchableOpacity>
            )}

            <View pointerEvents="none" className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1">
              <Text className="text-white text-[9px] font-bold text-center" numberOfLines={1}>
                {formatSize(pf.file_size || pf.size_bytes || pf.size)}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function TaskBriefPanel() {
  const {
    data, refresh,
    replaceTaskAttachment, taskAttachmentVersions, restoreTaskAttachmentVersion,
    deleteTaskAttachment, restoreTaskAttachment, listDeletedTaskAttachments,
  } = useTaskDetail();
  const { user } = useAuth();
  const { showConfirm } = useAlert();
  const colors = useThemeColors();
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [signedUrls, setSignedUrls] = useState<Record<string, string>>({});
  const [zipping, setZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState<{ done: number; total: number } | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Feature D: replace / history / soft-delete
  const [replacingId, setReplacingId] = useState<string | null>(null);
  const [historyFor, setHistoryFor] = useState<TaskAttachmentData | null>(null);
  const [historyVersions, setHistoryVersions] = useState<TaskAttachmentVersionData[] | null>(null);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedFiles, setDeletedFiles] = useState<DeletedTaskAttachmentData[] | null>(null);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  // Resolve signed URLs for image attachments (private bucket — raw paths won't render).
  const imageAttachments = useMemo(
    () =>
      (data?.task_attachments ?? []).filter(
        (a) => a.mime_type?.toLowerCase().includes('image') && (a.storage_path || a.file_url)
      ),
    [data?.task_attachments]
  );
  // Stable key so the effect only re-runs when the actual set of images changes.
  const imageKey = imageAttachments.map((a) => a.id).join(',');

  useEffect(() => {
    if (imageAttachments.length === 0) {
      setSignedUrls({});
      return;
    }
    let cancelled = false;
    setSignedUrls({}); // clear stale URLs so tiles show the loading state while we fetch
    (async () => {
      const paths = imageAttachments.map((a) => a.storage_path || a.file_url);
      const { data: signed, error } = await supabase.storage
        .from(TASK_BRIEF_BUCKET)
        .createSignedUrls(paths, 3600);
      if (cancelled || error || !signed) return;
      const map: Record<string, string> = {};
      signed.forEach((s, i) => {
        if (s.signedUrl) map[imageAttachments[i].id] = s.signedUrl;
      });
      setSignedUrls(map);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageKey]);

  if (!data) return null;

  const canUpload = data.permissions.is_manager || data.permissions.is_creator || data.permissions.is_owner;
  const hasFiles = data.task_attachments.length > 0;

  // Uploads one file to a fresh path in the brief bucket, returns the storage path.
  const uploadOne = async (file: { uri: string; name: string; size: number; type: string }): Promise<string> => {
    let finalUri = file.uri;
    if (file.type.startsWith('image/')) {
      try {
        const result = await ImageManipulator.manipulateAsync(file.uri, [{ resize: { width: 2000 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
        finalUri = result.uri;
      } catch {}
    }
    const response = await fetch(finalUri);
    const blob = await response.blob();
    const ext = file.name.split('.').pop() || 'bin';
    const path = `${data.task.company_id}/tasks/${data.task.id}/brief/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
    const { data: storageData, error: storageErr } = await supabase.storage.from(TASK_BRIEF_BUCKET).upload(path, blob, { contentType: file.type, upsert: true });
    if (storageErr) throw storageErr;
    return storageData.path;
  };

  const uploadFiles = async (files: { uri: string; name: string; size: number; type: string }[]) => {
    if (!user || files.length === 0) return;
    setUploading(true);
    setErrorMsg(null);
    try {
      const uploaded: any[] = [];
      for (const file of files) {
        const path = await uploadOne(file);
        uploaded.push({ file_name: file.name, file_url: path, storage_path: path, file_size: file.size, mime_type: file.type, category: getCategory(file.type) });
      }
      const { error: rpcErr } = await supabase.rpc('rpc_add_task_attachments', { p_task_id: data.task.id, p_attachments: uploaded });
      if (rpcErr) throw rpcErr;
      await refresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  // ── Feature D handlers ───────────────────────────────────────────────────

  // Replace: pick one file, upload new bytes to a fresh path, then pointer-swap via RPC.
  const handleReplace = async (pf: any) => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: false });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    setReplacingId(pf.id);
    setErrorMsg(null);
    try {
      const path = await uploadOne({ uri: a.uri, name: a.name, size: a.size || 0, type: a.mimeType || 'application/octet-stream' });
      await replaceTaskAttachment(pf.id, { storage_path: path, file_name: a.name, file_size: a.size || 0, mime_type: a.mimeType || 'application/octet-stream' });
    } catch (err: any) {
      setErrorMsg(err.message || 'Replace failed');
    } finally {
      setReplacingId(null);
    }
  };

  const handleDelete = (id: string) => {
    const att = data.task_attachments.find(a => a.id === id);
    // showConfirm, not Alert.alert — multi-button Alert.alert is a no-op on web
    showConfirm(
      'Delete File',
      `"${att?.file_name || 'This file'}" will be removed from the brief. Management can restore it later.`,
      () => deleteTaskAttachment(id).catch(err => setErrorMsg(err.message)),
      undefined,
      'Delete',
      'Cancel',
      'destructive'
    );
  };

  const openHistory = async (pf: any) => {
    const att = data.task_attachments.find(a => a.id === pf.id);
    if (!att) return;
    setHistoryFor(att);
    setHistoryVersions(null);
    try {
      setHistoryVersions(await taskAttachmentVersions(att.id));
    } catch {
      setHistoryFor(null); // taskAttachmentVersions already toasts
    }
  };

  const handleRestoreVersion = (v: TaskAttachmentVersionData) => {
    // showConfirm, not Alert.alert — multi-button Alert.alert is a no-op on web
    showConfirm(
      'Restore Version',
      `The file will revert to v${v.version_no}. The current version stays in history.`,
      async () => {
        setRestoringVersionId(v.id);
        try {
          await restoreTaskAttachmentVersion(v.id);
          if (historyFor) setHistoryVersions(await taskAttachmentVersions(historyFor.id));
        } catch {
          // restoreTaskAttachmentVersion already toasts
        } finally {
          setRestoringVersionId(null);
        }
      },
      undefined,
      'Restore'
    );
  };

  const toggleDeletedFiles = async () => {
    if (showDeleted) { setShowDeleted(false); return; }
    try {
      const rows = await listDeletedTaskAttachments();
      setDeletedFiles(rows);
      setShowDeleted(true);
    } catch {
      // listDeletedTaskAttachments already toasts
    }
  };

  const handleRestoreFile = async (id: string) => {
    setRestoringId(id);
    try {
      await restoreTaskAttachment(id);
      setDeletedFiles(prev => prev ? prev.filter(f => f.id !== id) : prev);
    } catch {
      // restoreTaskAttachment already toasts
    } finally {
      setRestoringId(null);
    }
  };

  const downloadOne = (pf: any) => {
    const path = pf.storage_path || pf.uri;
    if (!path) return;
    openStorageFile(TASK_BRIEF_BUCKET, path, pf.name);
  };

  const handlePressFile = (pf: any) => {
    const isImage = pf.mime_type?.toLowerCase().includes('image');
    const signed = signedUrls[pf.id];
    // Images open in the lightbox (navigable, with format-convert downloads);
    // everything else downloads directly.
    if (isImage && signed) {
      const idx = imageAttachments.findIndex((a) => a.id === pf.id);
      if (idx >= 0) {
        setLightboxIndex(idx);
        return;
      }
    }
    downloadOne(pf);
  };

  const lightboxItem = lightboxIndex != null ? imageAttachments[lightboxIndex] : null;

  const downloadAll = async () => {
    if (zipping || data.task_attachments.length === 0) return;
    setZipping(true);
    setErrorMsg(null);
    try {
      await downloadFilesAsZip(
        data.task_attachments.map(a => ({
          storage_path: a.storage_path || a.file_url,
          bucket: TASK_BRIEF_BUCKET,
          original_name: a.file_name,
        })),
        `task-brief-${data.task.id}`,
        (done, total) => setZipProgress({ done, total })
      );
    } catch (err: any) {
      setErrorMsg(err.message || 'Download failed');
    } finally {
      setZipping(false);
      setZipProgress(null);
    }
  };

  const downloadAllBtn = data.task_attachments.length > 0 && Platform.OS === 'web' ? (
    <TouchableOpacity
      onPress={downloadAll}
      disabled={zipping}
      hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
      className="flex-row items-center bg-surface-background px-2 py-0.5 rounded-md border border-surface-border active:opacity-70"
      style={Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : undefined}
    >
      {zipping ? (
        <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.7 }] }} />
      ) : (
        <FontAwesome name="download" size={9} color={colors.primary} />
      )}
      <Text className="text-brand-primary text-[8px] font-black uppercase tracking-tighter ml-1">
        {zipping ? (zipProgress ? `${zipProgress.done}/${zipProgress.total}` : 'Zipping') : 'Download all'}
      </Text>
    </TouchableOpacity>
  ) : null;

  return (
    <CollapsibleCard title="Task Brief" headerRight={<View className="flex-row items-center gap-2">{downloadAllBtn}<View className="bg-brand-primary/10 px-2 py-0.5 rounded-md border border-brand-primary/20"><Text className="text-brand-primary text-[8px] font-black uppercase tracking-tighter">{data.task_attachments.length} Files</Text></View></View>}>
      {errorMsg && <View className="bg-state-danger/10 border border-state-danger/30 rounded-xl p-3 mb-3"><Text className="text-state-danger text-xs">{errorMsg}</Text></View>}

      {hasFiles && (
        <AdaptiveFileGrid
          files={data.task_attachments.map(a => ({ id: a.id, uri: a.file_url, storage_path: a.storage_path, name: a.file_name, size: a.file_size, mime_type: a.mime_type, version_count: a.version_count }))}
          signedUrls={signedUrls}
          onPressFile={handlePressFile}
          onRemove={canUpload ? handleDelete : undefined}
          onReplace={canUpload ? handleReplace : undefined}
          onHistory={openHistory}
          replacingId={replacingId}
          isUploading={uploading}
        />
      )}

      {(data.permissions.is_manager || data.permissions.is_owner) && (
        <View className="mb-3">
          <TouchableOpacity onPress={toggleDeletedFiles} className="flex-row items-center py-1">
            <FontAwesome name={showDeleted ? 'chevron-up' : 'chevron-down'} size={9} color={colors.textDim} />
            <Text className="text-typography-dim text-[9px] font-black uppercase tracking-wider ml-1.5">
              Deleted
            </Text>
            {(() => {
              const deletedCount = deletedFiles ? deletedFiles.length : (data.stats?.deleted_attachment_count ?? 0);
              return deletedCount > 0 ? (
                <View className="bg-state-danger/15 border border-state-danger/30 rounded-full min-w-[16px] px-1.5 py-0.5 ml-1.5 items-center">
                  <Text className="text-state-danger text-[8px] font-black leading-none">{deletedCount}</Text>
                </View>
              ) : null;
            })()}
          </TouchableOpacity>

          {showDeleted && (
            (deletedFiles?.length ?? 0) === 0 ? (
              <Text className="text-typography-dim text-[10px] mt-1">No deleted files</Text>
            ) : (
              deletedFiles!.map((f) => {
                const { name: icon, color } = getFileIcon(f.mime_type, colors);
                return (
                  <View key={f.id} className="flex-row items-center mt-2 pb-2 border-b border-surface-border/20 last:border-0 opacity-70">
                    <FontAwesome name={icon as any} size={13} color={color} />
                    <View className="flex-1 ml-2">
                      <Text className="text-typography-label text-xs" numberOfLines={1}>{f.file_name}</Text>
                      <Text className="text-typography-dim text-[9px]">
                        {formatSize(f.file_size)}{f.file_size ? ' · ' : ''}deleted {new Date(f.deleted_at).toLocaleDateString()}{f.deleted_by?.full_name ? ` by ${f.deleted_by.full_name}` : ''}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRestoreFile(f.id)}
                      disabled={restoringId === f.id}
                      className={`flex-row items-center bg-surface-background px-2.5 py-1 rounded-lg border border-surface-border ${restoringId === f.id ? 'opacity-50' : ''}`}
                    >
                      {restoringId === f.id ? (
                        <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.6 }] }} />
                      ) : (
                        <FontAwesome name="undo" size={9} color={colors.primary} />
                      )}
                      <Text className="text-brand-primary text-[9px] font-black uppercase ml-1.5">Restore</Text>
                    </TouchableOpacity>
                  </View>
                );
              })
            )
          )}
        </View>
      )}

      {canUpload && (
        <View className="flex-row gap-3 pt-2 border-t border-surface-border/30">
          <TouchableOpacity onPress={async () => {
              const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, allowsMultipleSelection: true });
              if (!result.canceled) await uploadFiles(result.assets.map(a => ({ uri: a.uri, name: a.fileName || `image_${Date.now()}.jpg`, size: a.fileSize || 0, type: a.mimeType || 'image/jpeg' })));
            }}
            disabled={uploading} className="flex-row items-center bg-surface-background px-3 py-2 rounded-xl border border-surface-border active:opacity-70"
          >
            <FontAwesome name="camera" size={11} color={colors.primary} />
            <Text className="text-brand-primary text-[10px] font-black uppercase ml-1.5">Add Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={async () => {
              const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true });
              if (!result.canceled) await uploadFiles(result.assets.map(a => ({ uri: a.uri, name: a.name, size: a.size || 0, type: a.mimeType || 'application/octet-stream' })));
            }}
            disabled={uploading} className="flex-row items-center bg-surface-background px-3 py-2 rounded-xl border border-surface-border active:opacity-70"
          >
            <FontAwesome name="paperclip" size={11} color={colors.primary} />
            <Text className="text-brand-primary text-[10px] font-black uppercase ml-1.5">Attach File</Text>
          </TouchableOpacity>
          {uploading && <ActivityIndicator size="small" color={colors.primary} className="ml-auto" />}
        </View>
      )}

      {lightboxItem && lightboxIndex != null && (
        <ImageLightbox
          visible
          uri={signedUrls[lightboxItem.id] || ''}
          fileName={lightboxItem.file_name}
          index={lightboxIndex}
          total={imageAttachments.length}
          hasPrev={lightboxIndex > 0}
          hasNext={lightboxIndex < imageAttachments.length - 1}
          onPrev={() => setLightboxIndex((i) => (i != null && i > 0 ? i - 1 : i))}
          onNext={() => setLightboxIndex((i) => (i != null && i < imageAttachments.length - 1 ? i + 1 : i))}
          onClose={() => setLightboxIndex(null)}
          onDownloadOriginal={() =>
            openStorageFile(TASK_BRIEF_BUCKET, lightboxItem.storage_path || lightboxItem.file_url, lightboxItem.file_name)
          }
        />
      )}

      {/* Feature D: version history sheet — newest first, restore = pointer move.
          Inline colors on purpose — theme-token classes go black inside RN Modal on web. */}
      <DraggableSheet visible={!!historyFor} onClose={() => setHistoryFor(null)} dimBackdrop containerClassName="rounded-t-[2rem] border-t" containerStyle={{ backgroundColor: colors.card, borderColor: colors.border }}>
        <ScrollView className="px-6 pt-6 pb-10">
          <Text style={{ color: colors.textMain, fontSize: 18, fontWeight: '900', marginBottom: 4 }}>Version History</Text>
          {historyFor && (
            <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 11, marginBottom: 16 }}>{historyFor.file_name}</Text>
          )}

          {historyVersions === null ? (
            <View style={{ paddingVertical: 30, alignItems: 'center' }}>
              <ActivityIndicator size="small" color={colors.primary} />
            </View>
          ) : (
            historyVersions.map((v) => {
              const { name: icon, color } = getFileIcon(v.mime_type, colors);
              return (
                <View key={v.id} style={{ borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                    <Text style={{ color: colors.textMain, fontSize: 13, fontWeight: '900' }}>v{v.version_no}</Text>
                    {v.is_current ? (
                      <View style={{ backgroundColor: colors.success + '22', borderColor: colors.success + '55', borderWidth: 1, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8 }}>
                        <Text style={{ color: colors.success, fontSize: 9, fontWeight: '900', textTransform: 'uppercase' }}>Current</Text>
                      </View>
                    ) : (
                      <TouchableOpacity
                        onPress={() => handleRestoreVersion(v)}
                        disabled={restoringVersionId !== null}
                        style={{
                          flexDirection: 'row', alignItems: 'center', marginLeft: 'auto',
                          backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1,
                          borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
                          opacity: restoringVersionId !== null && restoringVersionId !== v.id ? 0.5 : 1,
                        }}
                      >
                        {restoringVersionId === v.id ? (
                          <ActivityIndicator size="small" color={colors.primary} style={{ transform: [{ scale: 0.6 }] }} />
                        ) : (
                          <FontAwesome name="undo" size={9} color={colors.primary} />
                        )}
                        <Text style={{ color: colors.primary, fontSize: 9, fontWeight: '900', textTransform: 'uppercase', marginLeft: 6 }}>Restore</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <Text style={{ color: colors.textDim, fontSize: 10, marginBottom: 6 }}>
                    {new Date(v.created_at).toLocaleString()}{v.created_by?.full_name ? ` · by ${v.created_by.full_name}` : ''}
                  </Text>

                  {/* Every version stays downloadable — tap the file row */}
                  <TouchableOpacity
                    onPress={() => v.storage_path && openStorageFile(TASK_BRIEF_BUCKET, v.storage_path, v.file_name || 'file')}
                    style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 2 }}
                  >
                    <FontAwesome name={icon as any} size={11} color={color} />
                    <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 11, marginLeft: 6, flex: 1 }}>{v.file_name}</Text>
                    {v.file_size != null && <Text style={{ color: colors.textDim, fontSize: 9, marginRight: 6 }}>{formatSize(v.file_size)}</Text>}
                    <FontAwesome name="download" size={10} color={colors.primary} />
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </ScrollView>
      </DraggableSheet>
    </CollapsibleCard>
  );
}