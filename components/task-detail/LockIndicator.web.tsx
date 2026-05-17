import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, View } from 'react-native';

type Props = {
  declaredMinutes?: number;
  reason?: string;
  compact?: boolean;
};

export default function LockIndicatorWeb({ declaredMinutes, reason, compact = false }: Props) {
  const colors = useThemeColors();

  if (compact) {
    return (
      <View className="inline-flex flex-row items-center gap-2 px-3 py-2 rounded-lg bg-state-warning/15 border border-state-warning/30">
        <FontAwesome name="lock" size={11} color={colors.warning} />
        <Text className="text-state-warning text-xs font-black uppercase tracking-wide">Locked</Text>
      </View>
    );
  }

  return (
    <View className="bg-state-warning/10 border border-state-warning/30 rounded-xl p-4 flex-row items-start gap-3 mb-4">
      <View className="w-8 h-8 rounded-lg bg-state-warning/20 items-center justify-center flex-shrink-0 mt-0.5">
        <FontAwesome name="lock" size={12} color={colors.warning} />
      </View>

      <View className="flex-1 min-w-0">
        <View className="flex-row items-center gap-2 mb-1">
          <Text className="text-state-warning font-black text-xs uppercase tracking-wider">
            Approval Pending
          </Text>
        </View>

        {declaredMinutes !== undefined && (
          <Text className="text-state-warning text-xs leading-4 font-medium">
            You declared {declaredMinutes} min. Manager review required to advance.
          </Text>
        )}

        {reason && (
          <Text className="text-state-warning/70 text-xs mt-1 leading-3">
            {reason}
          </Text>
        )}
      </View>
    </View>
  );
}
