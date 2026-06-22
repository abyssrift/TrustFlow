import { useFileHub, type FileHubFile } from '@/contexts/FileHubContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import DraggableSheet from '@/components/common/DraggableSheet';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
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

function daysRemaining(expiresAt: string | undefined): number {
  if (!expiresAt) return 0;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export default function FileHubBin({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const c = useThemeColors();
  const { binFiles, binLoading, fetchBin, restoreFromBin } = useFileHub();
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    if (visible) fetchBin();
  }, [visible, fetchBin]);

  const handleRestore = async (file: FileHubFile) => {
    setRestoringId(file.id);
    try {
      await restoreFromBin(file.id);
    } catch {
      // error surfaced by context
    } finally {
      setRestoringId(null);
    }
  };

  const body = (
    <>
          {/* Header */}
          <View className="px-7 pt-6 pb-4 flex-row items-start justify-between border-b" style={{ borderColor: c.border }}>
            <View className="flex-1 pr-3">
              <Text className="text-[9px] font-black uppercase tracking-[0.3em] mb-1" style={{ color: c.primary }}>Intelligence Hub</Text>
              <Text className="text-2xl font-black tracking-tight" style={{ color: c.textMain }}>Bin</Text>
              <Text className="text-xs font-medium mt-0.5" style={{ color: c.textMuted }}>Deleted & hidden files — restorable for 15 days</Text>
            </View>
            <TouchableOpacity onPress={onClose} className="h-10 w-10 items-center justify-center rounded-full border" style={{ borderColor: c.border, backgroundColor: c.card }}>
              <FontAwesome name="times" size={16} color={c.textMuted} />
            </TouchableOpacity>
          </View>

          {binLoading ? (
            <View className="items-center justify-center py-20">
              <ActivityIndicator size="large" color={c.primary} />
            </View>
          ) : binFiles.length === 0 ? (
            <View className="items-center justify-center py-20 px-8">
              <FontAwesome name="trash-o" size={28} color={c.textMuted} />
              <Text className="text-sm font-bold mt-3 text-center" style={{ color: c.textMuted }}>Bin is empty</Text>
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ paddingVertical: 8 }} showsVerticalScrollIndicator={false}>
              {binFiles.map(file => {
                const { icon, color } = getMimeIcon(file.mime_type);
                const days = daysRemaining(file.expires_at);
                return (
                  <View
                    key={file.id}
                    className="flex-row items-center px-7 py-3.5 border-b"
                    style={{ borderColor: c.border + '60' }}
                  >
                    <View
                      className="w-10 h-10 rounded-xl items-center justify-center mr-3.5 flex-shrink-0 border"
                      style={{ backgroundColor: c.background, borderColor: c.border }}
                    >
                      <FontAwesome name={icon as any} size={16} color={color} />
                    </View>
                    <View className="flex-1 min-w-0 mr-3">
                      <Text numberOfLines={1} className="text-sm font-bold" style={{ color: c.textMain }}>{file.original_name}</Text>
                      <Text numberOfLines={1} className="text-[11px] mt-0.5" style={{ color: c.textMuted }}>
                        {formatFileSize(file.size_bytes)} · {file.trash_type === 'deleted' ? 'Deleted by you' : 'Removed from your inbox'} · {days === 0 ? 'Expires today' : `Expires in ${days}d`}
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => handleRestore(file)}
                      disabled={restoringId === file.id}
                      className="flex-row items-center gap-1.5 px-3.5 py-2 rounded-lg"
                      style={{ backgroundColor: c.primary }}
                    >
                      {restoringId === file.id
                        ? <ActivityIndicator size="small" color="#fff" />
                        : <FontAwesome name="undo" size={11} color="#fff" />}
                      <Text className="text-white text-xs font-black">Restore</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
              <View style={{ height: 12 }} />
            </ScrollView>
          )}
    </>
  );

  if (Platform.OS !== 'web') {
    return (
      <DraggableSheet
        visible={visible}
        onClose={onClose}
        dimBackdrop
        maxHeight="85%"
        containerClassName="overflow-hidden border-t rounded-t-3xl"
        containerStyle={{ backgroundColor: c.background, borderColor: c.border }}
      >
        {body}
      </DraggableSheet>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <View
          className="w-full rounded-3xl overflow-hidden border"
          style={{ maxWidth: 560, maxHeight: '85%', backgroundColor: c.background, borderColor: c.border }}
        >
          {body}
        </View>
      </View>
    </Modal>
  );
}
