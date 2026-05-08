import React from 'react';
import { View, Text } from 'react-native';

interface EfficiencyIndicatorProps {
  percentage: number;
  label: string;
  subLabel?: string;
}

export const EfficiencyIndicator = ({ percentage, label, subLabel }: EfficiencyIndicatorProps) => {
  const isGood = percentage >= 90;
  const isFair = percentage >= 70;
  
  const statusColor = isGood ? 'bg-state-success' : isFair ? 'bg-brand-primary' : 'bg-state-warning';
  const textColor = isGood ? 'text-state-success' : isFair ? 'text-brand-primary' : 'text-state-warning';
  const dimColor = isGood ? 'bg-state-success/10' : isFair ? 'bg-brand-primary/10' : 'bg-state-warning/10';

  return (
    <View className="bg-surface-card border border-surface-border rounded-2xl p-5">
      <View className="flex-row items-center justify-between mb-4">
        <View>
          <Text className="text-typography-main font-black text-lg">{label}</Text>
          {subLabel && <Text className="text-typography-muted text-xs">{subLabel}</Text>}
        </View>
        <View className={`${dimColor} px-3 py-1.5 rounded-xl`}>
          <Text className={`font-black text-base ${textColor}`}>{percentage}%</Text>
        </View>
      </View>

      <View className="h-3 bg-surface-overlay rounded-full overflow-hidden">
        <View 
          className={`h-full rounded-full ${statusColor}`}
          style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
      </View>
      
      <View className="flex-row justify-between mt-2">
        <Text className="text-typography-dim text-[10px] font-bold uppercase">Efficiency Floor</Text>
        <Text className="text-typography-dim text-[10px] font-bold uppercase">Optimal</Text>
      </View>
    </View>
  );
};
