import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';

const PERIODS = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'year', label: 'Year' },
];

export const PeriodToggle = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  return (
    <View className="flex-row bg-surface-card border border-surface-border p-1 rounded-2xl">
      {PERIODS.map((p) => (
        <TouchableOpacity
          key={p.id}
          onPress={() => onChange(p.id)}
          className={`flex-1 py-2 rounded-xl items-center ${value === p.id ? 'bg-brand-primary' : 'bg-transparent'}`}
        >
          <Text className={`text-xs font-black uppercase tracking-widest ${value === p.id ? 'text-white' : 'text-typography-muted'}`}>
            {p.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
};
