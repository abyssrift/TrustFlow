import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import type { ExplorerDetailPaneProps } from './ExplorerTypes';

export default function ExplorerDetailPane<T extends import('./ExplorerTypes').ExplorerItem>({ item, capabilities, onClose, onOpen, onDownload, onShare }: ExplorerDetailPaneProps<T>) {
  const action = (label: string, icon: string, callback?: (value: T) => void) => callback && <TouchableOpacity onPress={() => callback(item)} className="min-h-[44px] flex-row items-center gap-2 rounded-xl border border-surface-border px-3 hover:bg-surface-overlay">
    <FontAwesome name={icon as never} size={12} className="text-typography-muted" /><Text className="text-typography-main text-xs font-bold">{label}</Text>
  </TouchableOpacity>;
  const canView = capabilities?.canView === true;
  return <View className="flex-1 overflow-hidden rounded-2xl border border-surface-border bg-surface-card">
    <View className="flex-row items-start gap-3 border-b border-surface-border p-4"><View className="flex-1"><Text numberOfLines={2} className="text-typography-main text-base font-black">{item.name}</Text>{item.mimeType && <Text className="mt-1 text-typography-muted text-xs">{item.mimeType}</Text>}</View>{onClose && <TouchableOpacity accessibilityLabel="Close details" onPress={onClose} className="h-11 w-11 items-center justify-center rounded-xl border border-surface-border"><FontAwesome name="times" size={12} className="text-typography-muted" /></TouchableOpacity>}</View>
    <View className="flex-row flex-wrap gap-2 border-b border-surface-border p-4">{canView && action('Open', 'external-link', onOpen)}{canView && action('Download', 'download', onDownload)}{canView && action('Share', 'share', onShare)}</View>
    <ScrollView className="flex-1" contentContainerClassName="gap-4 p-4"><Detail label="Path" value={item.canonicalPath || item.path} /><Detail label="Project" value={item.projectName} /><Detail label="Size" value={item.sizeBytes == null ? null : `${item.sizeBytes} bytes`} /><Detail label="Origin" value={item.origin} /><Text className="text-typography-dim text-[10px]">{capabilities?.canView ? 'Available in this explorer.' : 'Read access is not granted.'}</Text></ScrollView>
  </View>;
}

function Detail({ label, value }: { label: string; value?: string | null }) { return value ? <View><Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">{label}</Text><Text className="mt-1 text-typography-main text-sm" numberOfLines={3}>{value}</Text></View> : null; }
