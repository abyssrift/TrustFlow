import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useThemeColors } from '@/hooks/useThemeColors';

export default function WorkspaceReadyStep({
  onContinue,
  workspaceName,
  setupSummary,
}: {
  onContinue: () => void;
  workspaceName?: string;
  setupSummary?: {
    sizeBand?: string;
    operatingModels?: string[];
  };
}) {
  const colors = useThemeColors();
  const { width } = useWindowDimensions();
  const compact = width < 768;
  const chips = [setupSummary?.sizeBand, ...(setupSummary?.operatingModels ?? [])].filter(Boolean) as string[];

  return (
    <View className="items-center">
      <View className="h-16 w-16 items-center justify-center rounded-2xl bg-state-success-dim">
        <FontAwesome name="check" size={28} color={colors.success} />
      </View>

      <Text className={`mt-5 text-center font-extrabold text-typography-main ${compact ? 'text-[22px]' : 'text-[28px]'}`}>
        {workspaceName ? `${workspaceName} is ready` : 'Your workspace is ready'}
      </Text>
      <Text className="mt-2 text-center text-sm text-typography-muted">
        We set up a workflow and sensible defaults. Everything is editable later.
      </Text>

      {chips.length > 0 && (
        <View className="mt-6 flex-row flex-wrap justify-center gap-2">
          {chips.map((chip) => (
            <View key={chip} className="rounded-xl border border-surface-border bg-surface-card px-3 py-2">
              <Text className="text-xs font-bold text-typography-main">{chip}</Text>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Continue to workspace"
        onPress={onContinue}
        className="mt-8 min-h-[48px] w-full items-center justify-center rounded-2xl bg-brand-primary px-10"
      >
        <Text className="font-black text-brand-on-primary">Open workspace</Text>
      </TouchableOpacity>
    </View>
  );
}
