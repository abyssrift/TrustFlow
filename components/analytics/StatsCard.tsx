import React from 'react';
import { View, Text } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';

interface StatsCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  icon: string;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  accent?: boolean;
}

export const StatsCard = ({ label, value, subValue, icon, trend, accent }: StatsCardProps) => {
  return (
    <View className={`flex-1 rounded-2xl p-5 border ${accent ? 'bg-brand-primary-dim border-brand-primary/20' : 'bg-surface-card border-surface-border'}`}>
      <View className="flex-row items-center justify-between mb-4">
        <View className={`w-10 h-10 rounded-xl items-center justify-center ${accent ? 'bg-brand-primary/10' : 'bg-surface-overlay'}`}>
          <FontAwesome name={icon as any} size={16} className={accent ? 'text-brand-primary' : 'text-brand-accent/60'} />
        </View>
        {trend && (
          <View className={`flex-row items-center px-2 py-1 rounded-lg ${trend.isPositive ? 'bg-state-success/10' : 'bg-state-danger/10'}`}>
            <FontAwesome name={trend.isPositive ? 'caret-up' : 'caret-down'} size={10} className={trend.isPositive ? 'text-state-success' : 'text-state-danger'} />
            <Text className={`text-[10px] font-black ml-1 ${trend.isPositive ? 'text-state-success' : 'text-state-danger'}`}>
              {trend.value}%
            </Text>
          </View>
        )}
      </View>
      
      <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">{label}</Text>
      <Text className={`text-2xl font-black tracking-tight mt-1 ${accent ? 'text-brand-primary' : 'text-typography-main'}`}>{value}</Text>
      {subValue && (
        <Text className="text-typography-dim text-[10px] mt-1">{subValue}</Text>
      )}
    </View>
  );
};
