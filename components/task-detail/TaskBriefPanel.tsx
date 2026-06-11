import { useAuth } from '@/contexts/AuthContext';
import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { openStorageFile, TASK_BRIEF_BUCKET } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as DocumentPicker from 'expo-document-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import React, { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import CollapsibleCard from './CollapsibleCard';

function getFileIcon(mimeType: string | null, colors: ReturnType<typeof useThemeColors>): { name: string; color: string } {
  const t = (mimeType || '').toLowerCase();
  if (t.includes('image')) return { name: 'file-image-o', color: colors.warning };
  if (t.includes('pdf')) return { name: 'file-pdf-o', color: colors.danger };
  if (t.includes('spreadsheet') || t.includes('excel') || t.includes('csv')) return { name: 'file-excel-o', color: colors.success };
  if (t.includes('word') || t.includes('document') || t.includes('text')) return { name: 'file-text-o', color: colors.info };
  return { name: 'file-o', color: colors.textMuted };
}

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

export default function TaskBriefPanel() {
  const { data, refresh } = useTaskDetail();
  const { user } = useAuth();
  const colors = useThemeColors();
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!data) return null;

  const canUpload = data.permissions.is_manager || data.permissions.is_creator || data.permissions.is_owner;
  const hasFiles = data.task_attachments.length > 0;

  if (!hasFiles && !canUpload) return null;

  const uploadFiles = async (files: { uri: string; name: string; size: number; type: string }[]) => {
    if (!user || files.length === 0) return;
    setUploading(true);
    setErrorMsg(null);

    try {
      const uploaded: any[] = [];

      for (const file of files) {
        let finalUri = file.uri;

        if (file.type.startsWith('image/')) {
          try {
            const result = await ImageManipulator.manipulateAsync(
              file.uri,
              [{ resize: { width: 2000 } }],
              { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
            );
            finalUri = result.uri;
          } catch { /* keep original */ }
        }

        const response = await fetch(finalUri);
        const blob = await response.blob();
        const ext = file.name.split('.').pop() || 'bin';
        const path = `${data.task.company_id}/tasks/${data.task.id}/brief/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;

        const { data: storageData, error: storageErr } = await supabase.storage
          .from(TASK_BRIEF_BUCKET)
          .upload(path, blob, { contentType: file.type, upsert: true });

        if (storageErr) throw storageErr;

        uploaded.push({
          file_name: file.name,
          file_url: storageData.path,
          storage_path: storageData.path,
          file_size: file.size,
          mime_type: file.type,
          category: getCategory(file.type),
        });
      }

      const { error: rpcErr } = await supabase.rpc('rpc_add_task_attachments', {
        p_task_id: data.task.id,
        p_attachments: uploaded,
      });

      if (rpcErr) throw rpcErr;
      await refresh();
    } catch (err: any) {
      setErrorMsg(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
    });
    if (!result.canceled) {
      await uploadFiles(result.assets.map(a => ({
        uri: a.uri,
        name: a.fileName || `image_${Date.now()}.jpg`,
        size: a.fileSize || 0,
        type: a.mimeType || 'image/jpeg',
      })));
    }
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', multiple: true });
    if (!result.canceled) {
      await uploadFiles(result.assets.map(a => ({
        uri: a.uri,
        name: a.name,
        size: a.size || 0,
        type: a.mimeType || 'application/octet-stream',
      })));
    }
  };

  return (
    <CollapsibleCard
      title="Task Brief"
      headerRight={
        <View className="bg-brand-primary/10 px-2 py-0.5 rounded-md border border-brand-primary/20">
          <Text className="text-brand-primary text-[8px] font-black uppercase tracking-tighter">
            {data.task_attachments.length} {data.task_attachments.length === 1 ? 'File' : 'Files'}
          </Text>
        </View>
      }
    >
      {errorMsg && (
        <View className="bg-state-danger/10 border border-state-danger/30 rounded-xl p-3 mb-3">
          <Text className="text-state-danger text-xs">{errorMsg}</Text>
        </View>
      )}

      {hasFiles && (
        <View className="gap-2 mb-3">
          {data.task_attachments.map((att) => {
            const { name: iconName, color: iconColor } = getFileIcon(att.mime_type, colors);
            const size = formatSize(att.file_size);
            return (
              <TouchableOpacity
                key={att.id}
                onPress={() => openStorageFile(TASK_BRIEF_BUCKET, att.storage_path || att.file_url, att.file_name)}
                className="flex-row items-center bg-surface-background px-3 py-2.5 rounded-xl border border-surface-border/50 active:opacity-70"
              >
                <View className="w-8 h-8 rounded-lg bg-surface-card items-center justify-center mr-3">
                  <FontAwesome name={iconName as any} size={14} color={iconColor} />
                </View>
                <View className="flex-1 mr-2">
                  <Text className="text-typography-main text-xs font-bold" numberOfLines={1}>
                    {att.file_name}
                  </Text>
                  <View className="flex-row items-center mt-0.5 gap-2">
                    {size ? (
                      <Text className="text-typography-muted text-[9px] font-black uppercase">{size}</Text>
                    ) : null}
                    {att.uploaded_by?.full_name ? (
                      <Text className="text-typography-dim text-[9px]">{att.uploaded_by.full_name}</Text>
                    ) : null}
                  </View>
                </View>
                <FontAwesome name="external-link" size={10} color={colors.textMuted} />
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {!hasFiles && canUpload && (
        <View className="py-4 items-center opacity-40 mb-2">
          <FontAwesome name="folder-open-o" size={20} color={colors.textDim} />
          <Text className="text-typography-muted text-xs mt-2 text-center">
            No brief files yet. Add reference materials for the assignee.
          </Text>
        </View>
      )}

      {canUpload && (
        <View className="flex-row gap-3 pt-2 border-t border-surface-border/30">
          <TouchableOpacity
            onPress={pickImage}
            disabled={uploading}
            className="flex-row items-center bg-surface-background px-3 py-2 rounded-xl border border-surface-border active:opacity-70"
          >
            <FontAwesome name="camera" size={11} color={colors.primary} />
            <Text className="text-brand-primary text-[10px] font-black uppercase ml-1.5">Add Photo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={pickDocument}
            disabled={uploading}
            className="flex-row items-center bg-surface-background px-3 py-2 rounded-xl border border-surface-border active:opacity-70"
          >
            <FontAwesome name="paperclip" size={11} color={colors.primary} />
            <Text className="text-brand-primary text-[10px] font-black uppercase ml-1.5">Attach File</Text>
          </TouchableOpacity>

          {uploading && (
            <View className="flex-row items-center ml-auto">
              <ActivityIndicator size="small" color={colors.primary} />
              <Text className="text-typography-muted text-[10px] ml-2">Uploading...</Text>
            </View>
          )}
        </View>
      )}
    </CollapsibleCard>
  );
}
