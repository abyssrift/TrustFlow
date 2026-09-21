import React from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import Block from '@/components/common/Block';
import { useThemeColors } from '@/hooks/useThemeColors';
import type { OrganizationalAudit } from '@/lib/analyticsMetrics';

type AtAGlanceProps = {
  audit: OrganizationalAudit;
};

const RING_SIZE = 132;
const RING_STROKE = 10;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

function formatDelta(value: number): string {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${formatCount(rounded)}`;
  if (rounded < 0) return `\u2212${formatCount(Math.abs(rounded))}`;
  return '0';
}

export default function AtAGlance({ audit }: AtAGlanceProps) {
  const colors = useThemeColors();
  const completedSuccessfullyLabel = 'Completed successfully';
  const successRateLabel = 'Success rate';
  const throughput = Number.isFinite(audit.current.throughput) ? audit.current.throughput : null;
  const previousThroughput = Number.isFinite(audit.comparison.throughput)
    ? audit.comparison.throughput
    : null;
  const delta = throughput !== null && previousThroughput !== null
    ? throughput - previousThroughput
    : null;

  // Older RPC payloads may omit sample_size and intentionally take the
  // no-data path below.
  const sampleSize = audit.current.sample_size;
  const successRate = audit.current.success_rate;
  const hasSuccessRate = typeof sampleSize === 'number'
    && Number.isFinite(sampleSize)
    && sampleSize > 0
    && typeof successRate === 'number'
    && Number.isFinite(successRate);
  const ringRate = hasSuccessRate ? Math.min(100, Math.max(0, successRate)) : 0;
  const dashOffset = RING_CIRCUMFERENCE * (1 - ringRate / 100);

  return (
    <Block title="At a glance">
      <View className="flex-row flex-wrap items-center gap-6">
        <View className="flex-1 basis-[240px] min-w-[220px]">
          <Text className="text-typography-muted text-xs">{completedSuccessfullyLabel}</Text>
          <Text
            accessibilityRole="text"
            accessibilityLabel={throughput === null
              ? `${completedSuccessfullyLabel} unavailable`
              : `${completedSuccessfullyLabel}: ${formatCount(throughput)} tasks`}
            className="text-typography-main text-5xl font-bold mt-1"
          >
            {throughput === null ? '\u2014' : formatCount(throughput)}
          </Text>
          <Text className="text-typography-muted text-sm mt-2">
            {delta === null
              ? 'Previous range unavailable'
              : `${formatDelta(delta)} vs ${formatCount(previousThroughput!)} previously`}
          </Text>
        </View>

        <View className="flex-1 basis-[220px] min-w-[220px] flex-row items-center gap-4">
          {hasSuccessRate ? (
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel={`${successRateLabel} ${Math.round(successRate)} percent. Successful terminal tasks divided by ${formatCount(sampleSize)} tasks created in the selected range.`}
              className="items-center justify-center"
            >
              <Svg width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}>
                <G rotation={-90} origin={`${RING_SIZE / 2}, ${RING_SIZE / 2}`}>
                  <Circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    fill="none"
                    stroke={colors.border}
                    strokeWidth={RING_STROKE}
                  />
                  <Circle
                    cx={RING_SIZE / 2}
                    cy={RING_SIZE / 2}
                    r={RING_RADIUS}
                    fill="none"
                    stroke={colors.primary}
                    strokeWidth={RING_STROKE}
                    strokeLinecap="round"
                    strokeDasharray={`${RING_CIRCUMFERENCE} ${RING_CIRCUMFERENCE}`}
                    strokeDashoffset={dashOffset}
                  />
                </G>
              </Svg>
              <Text className="absolute text-typography-main text-2xl font-bold">
                {Math.round(successRate)}%
              </Text>
            </View>
          ) : (
            <View className="flex-1 min-w-0 py-3">
              <Text className="text-typography-main text-sm font-semibold">{successRateLabel} unavailable</Text>
              <Text className="text-typography-muted text-xs mt-1">
                No task sample for this range.
              </Text>
            </View>
          )}
          {hasSuccessRate && (
            <View className="flex-1 min-w-0">
              <Text className="text-typography-main text-sm font-semibold">{successRateLabel}</Text>
              <Text className="text-typography-muted text-xs mt-1">
                Tasks completed successfully out of tasks created in this range.
              </Text>
              <Text className="text-typography-muted text-xs mt-2">
                {formatCount(sampleSize)} tasks created.
              </Text>
            </View>
          )}
        </View>
      </View>
    </Block>
  );
}
