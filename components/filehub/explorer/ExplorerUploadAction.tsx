import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import type { ExplorerUploadDestination } from './ExplorerTypes';

export default function ExplorerUploadAction({ destination }: { destination?: ExplorerUploadDestination | null }) {
  if (!destination) return null;
  return <TouchableOpacity accessibilityLabel={destination.accessibilityLabel || destination.label || 'Upload file'} disabled={destination.disabled} onPress={destination.onPress} className={`min-h-[44px] flex-row items-center justify-center gap-2 rounded-xl px-4 ${destination.disabled ? 'bg-surface-overlay' : 'bg-brand-primary hover:bg-brand-primary-hover active:bg-brand-primary-active'}`}>
    <FontAwesome name="upload" size={12} className={destination.disabled ? 'text-typography-dim' : 'text-white'} /><Text className={destination.disabled ? 'text-typography-dim text-xs font-bold' : 'text-white text-xs font-bold'}>{destination.label || 'Upload'}</Text>
  </TouchableOpacity>;
}
