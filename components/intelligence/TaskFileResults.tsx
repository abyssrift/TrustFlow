import { useFileHub } from '@/contexts/FileHubContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { openStorageFile } from '@/lib/storage';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Tooltip from '../common/Tooltip';

export function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileIcon(mime: string | null): React.ComponentProps<typeof FontAwesome>['name'] {
  const m = (mime || '').toLowerCase();
  if (m.includes('image')) return 'file-image-o';
  if (m.includes('pdf')) return 'file-pdf-o';
  if (m.includes('sheet') || m.includes('excel') || m.includes('csv')) return 'file-excel-o';
  if (m.includes('word')) return 'file-word-o';
  if (m.includes('video')) return 'file-video-o';
  return 'file-o';
}

/**
 * Feature C3 — cross-source search results shown under FileHub's own results.
 * Rows come from rpc_files_search (submission + task brief files the caller can
 * access); pressing a row navigates to the task, the eye icon previews the file.
 */
export default function TaskFileResults({ pad = true }: { pad?: boolean }) {
  const { search, taskResults } = useFileHub();
  const colors = useThemeColors();
  const router = useRouter();

  if (!search.trim() || taskResults.length === 0) return null;

  return (
    <View className={`w-full pt-4 pb-2 ${pad ? 'px-6' : ''}`}>
      <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2">
        From Tasks ({taskResults.length})
      </Text>
      {taskResults.map(r => {
        const isSubmission = r.source === 'submission';
        return (
          <TouchableOpacity
            key={`${r.source}-${r.file_id}`}
            onPress={() => router.push(`/task/${r.task_id}` as any)}
            className="flex-row items-center gap-3 bg-surface-card border border-surface-border rounded-2xl px-4 py-3 mb-2"
          >
            <FontAwesome name={fileIcon(r.mime_type)} size={16} color={colors.textMuted} />
            <View className="flex-1 min-w-0">
              <Text numberOfLines={1} className="text-typography-main text-sm font-bold">
                {r.file_name}
              </Text>
              <Text numberOfLines={1} className="text-typography-muted text-[11px] mt-0.5">
                {r.task_title ? `${r.task_title} · ` : ''}{formatSize(r.size_bytes)}
              </Text>
            </View>
            <View
              className="px-2 py-0.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: isSubmission ? `${colors.primary}1A` : `${colors.textMuted}1A` }}
            >
              <Text className="text-[9px] font-black uppercase tracking-wider" style={{ color: isSubmission ? colors.primary : colors.textMuted }}>
                {isSubmission ? 'Submission' : 'Brief'}
              </Text>
            </View>
            <Tooltip label="Preview file">
              <TouchableOpacity
                onPress={(e: any) => {
                  e?.stopPropagation?.();
                  openStorageFile(r.bucket, r.storage_path, r.file_name, r.mime_type);
                }}
                className="w-8 h-8 rounded-lg items-center justify-center border border-surface-border flex-shrink-0"
              >
                <FontAwesome name="eye" size={12} color={colors.textMuted} />
              </TouchableOpacity>
            </Tooltip>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
