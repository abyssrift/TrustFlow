import Block from '@/components/common/Block';
import { useCanonicalAnalyticsTargets } from '@/hooks/useCanonicalAnalyticsTargets';
import { useThemeColors } from '@/hooks/useThemeColors';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';

type TargetWatchProps = { enabled: boolean };

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

export default function TargetWatch({ enabled }: TargetWatchProps) {
  const colors = useThemeColors();
  const router = useRouter();
  const { targets, loading, error } = useCanonicalAnalyticsTargets({ enabled });
  if (!enabled) return null;

  const activeVolumeTargets = targets
    .filter(target => target.type === 'volume'
      && target.storedStatus === 'active'
      && target.targetQuantity !== null
      && target.targetQuantity > 0
      && target.observedValue !== null
      && target.progressUnit === 'tasks')
    .slice(0, 3);

  return (
    <Block
      title="Target watch"
      right={(
        <TouchableOpacity
          onPress={() => router.push('/intelligence/targets')}
          accessibilityRole="link"
          accessibilityLabel="View targets"
          className="min-h-[36px] flex-row items-center gap-2 px-3 rounded-xl border border-surface-border"
        >
          <Text className="text-typography-main text-xs font-semibold">All targets</Text>
          <FontAwesome name="arrow-right" size={11} color={colors.textDim} />
        </TouchableOpacity>
      )}
    >
      {loading ? (
        <View className="flex-row items-center gap-2 py-1">
          <ActivityIndicator size="small" color={colors.primary} />
          <Text className="text-typography-muted text-xs">Loading targets…</Text>
        </View>
      ) : error ? (
        <Text className="text-typography-muted text-sm">Target data is unavailable right now.</Text>
      ) : activeVolumeTargets.length === 0 ? (
        <Text className="text-typography-muted text-sm">No active volume targets to watch.</Text>
      ) : (
        <View className="gap-4">
          {activeVolumeTargets.map(target => {
            const observed = target.observedValue!;
            const quantity = target.targetQuantity!;
            const fill = quantity > 0 ? Math.min(100, Math.max(0, observed / quantity * 100)) : 0;
            return (
              <View key={target.id} className="flex-row items-center gap-4">
                <View className="flex-1 min-w-0">
                  <Text className="text-typography-main text-sm font-semibold" numberOfLines={1}>
                    {target.stageName}
                  </Text>
                  <Text className="text-typography-muted text-xs mt-0.5" numberOfLines={1}>
                    {target.pipelineName}
                  </Text>
                  <View
                    accessible
                    accessibilityRole="progressbar"
                    accessibilityLabel={`${target.stageName}: ${formatCount(observed)} of ${formatCount(quantity)} tasks`}
                    accessibilityValue={{ min: 0, max: quantity, now: Math.min(quantity, Math.max(0, observed)) }}
                    className="h-1.5 mt-2 overflow-hidden rounded-full bg-surface-background"
                  >
                    <View className="h-full rounded-full bg-brand-primary" style={{ width: `${fill}%` }} />
                  </View>
                </View>
                <Text className="text-typography-main text-sm font-semibold tabular-nums">
                  {formatCount(observed)} / {formatCount(quantity)}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </Block>
  );
}
