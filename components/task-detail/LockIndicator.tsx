import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, View } from 'react-native';

type Props = {
  declaredMinutes?: number;
  reason?: string;
};

export default function LockIndicator({ declaredMinutes, reason }: Props) {
  const colors = useThemeColors();

  return (
    <View className="bg-state-warning/15 border border-state-warning/40 rounded-2xl p-4 flex-row items-start gap-3 mb-4">
      <View className="w-9 h-9 rounded-xl bg-state-warning/25 items-center justify-center flex-shrink-0 mt-0.5">
        <FontAwesome name="lock" size={14} color={colors.warning} />
      </View>

      <View className="flex-1">
        <View className="flex-row items-center gap-2 mb-1.5">
          <Text className="text-state-warning font-black text-xs uppercase tracking-wider">
            Stage Locked
          </Text>
          <Text className="text-state-warning/70 text-[10px] font-bold">Awaiting Manager Approval</Text>
        </View>

        {declaredMinutes !== undefined && (
          <Text className="text-state-warning text-sm leading-5 font-medium">
            You declared {declaredMinutes} minute{declaredMinutes !== 1 ? 's' : ''} of work. Advancement will unlock once your manager reviews and approves.
          </Text>
        )}

        {reason && (
          <Text className="text-state-warning/80 text-xs mt-2 leading-4">
            {reason}
          </Text>
        )}
      </View>
    </View>
  );
}
