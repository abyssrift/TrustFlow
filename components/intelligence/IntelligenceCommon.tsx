import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';

export const Picker = ({ items, selectedId, onSelect, labelKey = 'name', disabled = false }: any) => (
  <View className={`flex-row flex-wrap gap-2 ${disabled ? 'opacity-30' : ''}`}>
    {items.map((item: any) => (
      <TouchableOpacity
        key={item.id}
        disabled={disabled}
        onPress={() => onSelect(item.id)}
        className={`px-5 py-2.5 rounded-xl border transition-all ${selectedId === item.id ? 'bg-brand-primary/5 border-brand-primary' : 'border-surface-border hover:bg-surface-background'}`}
      >
        <View className="flex-row items-center">
          {selectedId === item.id && <View className="w-1.5 h-1.5 rounded-full bg-brand-primary mr-3" />}
          <Text className={`text-[11px] font-bold tracking-tight ${selectedId === item.id ? 'text-brand-primary font-black' : 'text-typography-muted'}`}>
            {item[labelKey] || 'N/A'}
          </Text>
        </View>
      </TouchableOpacity>
    ))}
  </View>
);

export const SectionToggle = ({ active, onSelect, hasPermission }: { active: string, onSelect: (s: string) => void, hasPermission: (p: string) => boolean }) => (
  <View className="flex-row bg-surface-card rounded-2xl p-1.5 border border-surface-border mb-10 w-fit">
    {['Radar', 'Targets', 'Archives'].filter(s => s !== 'Archives' || hasPermission('archive.view')).map((s) => (
      <TouchableOpacity
        key={s}
        onPress={() => onSelect(s.toLowerCase())}
        className={`px-8 py-3 rounded-xl items-center flex-row ${active === s.toLowerCase() ? 'bg-brand-primary premium-shadow' : 'hover:bg-surface-background'}`}
      >
        <FontAwesome
          name={s === 'Radar' ? 'crosshairs' : s === 'Targets' ? 'bullseye' : 'archive'}
          size={14}
          color={active === s.toLowerCase() ? 'white' : 'rgb(var(--typography-muted))'}
          className="mr-3"
        />
        <Text className={`font-black text-[10px] uppercase tracking-widest ${active === s.toLowerCase() ? 'text-white' : 'text-typography-muted'}`}>
          {s}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);

export const KPIBoxWeb = ({ label, val, delta }: any) => (
  <View className="flex-1 min-w-[280px] bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow">
    <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">{label}</Text>
    <View className="flex-row items-baseline">
      <Text className="text-typography-main text-4xl font-black">{val}</Text>
      {delta !== undefined && (
        <View className={`ml-4 px-3 py-1 rounded-full ${delta >= 0 ? 'bg-state-success/10' : 'bg-state-danger/10'}`}>
          <Text className={`text-[10px] font-black ${delta >= 0 ? 'text-state-success' : 'text-state-danger'}`}>
            {delta >= 0 ? '+' : ''}{delta} units
          </Text>
        </View>
      )}
    </View>
  </View>
);
