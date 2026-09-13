import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import type { ExplorerBreadcrumb } from './ExplorerTypes';

export default function ExplorerBreadcrumbs({ items, onNavigate }: { items: ExplorerBreadcrumb[]; onNavigate: (id: string | null) => void }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="items-center gap-1">
    <TouchableOpacity accessibilityLabel="Explorer root" onPress={() => onNavigate(null)} className="min-h-[44px] min-w-[44px] items-center justify-center rounded-xl hover:bg-surface-overlay">
      <FontAwesome name="home" size={14} className="text-typography-muted" />
    </TouchableOpacity>
    {items.map((item, index) => <View key={item.id} className="flex-row items-center gap-1">
      <FontAwesome name="chevron-right" size={9} className="text-typography-dim" />
      <TouchableOpacity accessibilityLabel={`Open ${item.label}`} onPress={() => onNavigate(item.id)} className="min-h-[44px] justify-center rounded-xl px-2 hover:bg-surface-overlay">
        <Text numberOfLines={1} className={`text-xs font-bold ${index === items.length - 1 ? 'text-typography-main' : 'text-typography-muted'}`}>{item.label}</Text>
      </TouchableOpacity>
    </View>)}
  </ScrollView>;
}
