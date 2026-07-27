import {
  DEFAULT_OVERVIEW_METRICS,
  OVERVIEW_METRICS,
  OverviewMetricKey,
  OverviewPeriod,
  usePipelineOverviewData,
} from '@/hooks/usePipelineOverviewData';
import { useThemeColors } from '@/hooks/useThemeColors';
import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View } from 'react-native';
import Tooltip from '@/components/common/Tooltip';
import {
  CartesianGrid, Line, LineChart,
  Tooltip as RechartTooltip,
  ResponsiveContainer,
  XAxis, YAxis,
} from 'recharts';

export { DEFAULT_OVERVIEW_METRICS };
export type { OverviewMetricKey };

interface Props {
  pipelineIds: string[];
  metrics: OverviewMetricKey[];
  period: OverviewPeriod;
  onToggleMetric: (key: OverviewMetricKey) => void;
  onSetPeriod: (p: OverviewPeriod) => void;
  onCustomize?: () => void;
  refreshKey?: number;
  className?: string;
}

export default function PipelineOverviewChart({
  pipelineIds,
  metrics,
  period,
  onToggleMetric,
  onSetPeriod,
  onCustomize,
  refreshKey = 0,
  className,
}: Props) {
  const colors = useThemeColors();
  const { data: chartData, loading, error } = usePipelineOverviewData(pipelineIds, period, refreshKey);

  const colorFor = (colorKey: string) => (colors as any)[colorKey] ?? colors.primary;
  const enabled = OVERVIEW_METRICS.filter(m => metrics.includes(m.key));
  const hasRightAxis = enabled.some(m => m.axis === 'right');

  const tooltipStyle = {
    backgroundColor: colors.card,
    border: `1px solid ${colors.border}`,
    borderRadius: 12,
    fontSize: 11,
    color: colors.textMain,
  };

  return (
    <View className={`bg-surface-card p-10 rounded-[32px] border border-surface-border premium-shadow ${className || ''}`}>
      <View className="flex-row items-start justify-between mb-8">
        <View>
          <Text className="text-typography-main text-2xl font-black tracking-tight">Pipeline Throughput</Text>
          <Text className="text-typography-muted text-xs mt-1 font-medium">
            Combined performance across {pipelineIds.length} tracked pipeline{pipelineIds.length !== 1 ? 's' : ''}.
          </Text>
        </View>
        <View className="flex-row items-center gap-3">
          {/* Period granularity */}
          <View className="flex-row bg-surface-background border border-surface-border rounded-lg p-0.5">
            {(['week', 'month'] as OverviewPeriod[]).map(p => (
              <TouchableOpacity
                key={p}
                onPress={() => onSetPeriod(p)}
                className={`px-3 py-1.5 rounded-md transition-all ${period === p ? 'bg-brand-primary premium-shadow' : ''}`}
              >
                <Text className={`text-[9px] font-black uppercase tracking-widest ${period === p ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
                  {p === 'week' ? 'Weekly' : 'Monthly'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {onCustomize && (
            <Tooltip label="Customize metrics">
              <TouchableOpacity
                onPress={onCustomize}
                className="bg-surface-overlay border border-surface-border w-9 h-9 rounded-xl items-center justify-center active:scale-95 transition-all"
              >
                <FontAwesome name="sliders" size={14} color={colors.textMuted} />
              </TouchableOpacity>
            </Tooltip>
          )}
        </View>
      </View>

      {/* Metric legend / toggles */}
      <View className="flex-row flex-wrap gap-2 mb-6">
        {OVERVIEW_METRICS.map(m => {
          const on = metrics.includes(m.key);
          return (
            <TouchableOpacity
              key={m.key}
              onPress={() => onToggleMetric(m.key)}
              className={`flex-row items-center gap-2 px-3 py-1.5 rounded-full border transition-all ${on ? 'border-surface-border bg-surface-overlay' : 'border-surface-border/50 opacity-40'}`}
            >
              <View className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: colorFor(m.colorKey) }} />
              <Text className={`text-[10px] font-black uppercase tracking-widest ${on ? 'text-typography-main' : 'text-typography-muted'}`}>
                {m.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={{ height: 280 }}>
        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : error ? (
          <View className="flex-1 items-center justify-center opacity-60">
            <FontAwesome name="exclamation-triangle" size={22} color={colors.textDim} />
            <Text className="text-typography-muted text-xs mt-2">{error}</Text>
          </View>
        ) : enabled.length === 0 ? (
          <View className="flex-1 items-center justify-center opacity-50">
            <FontAwesome name="line-chart" size={24} color={colors.textDim} />
            <Text className="text-typography-muted text-xs mt-2">Enable a metric above to plot it.</Text>
          </View>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: colors.textDim }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fontSize: 9, fill: colors.textDim }} axisLine={false} tickLine={false} width={36} />
              {hasRightAxis && (
                <YAxis yAxisId="r" orientation="right" domain={[0, 100]} unit="%" tick={{ fontSize: 9, fill: colors.textDim }} axisLine={false} tickLine={false} width={40} />
              )}
              <RechartTooltip contentStyle={tooltipStyle} cursor={{ stroke: colors.border }} />
              {enabled.map(m => (
                <Line
                  key={m.key}
                  yAxisId={m.axis === 'right' ? 'r' : 'l'}
                  type="monotone"
                  dataKey={m.key}
                  name={m.label}
                  stroke={colorFor(m.colorKey)}
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: colorFor(m.colorKey) }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <View className="flex-1 items-center justify-center opacity-50">
            <FontAwesome name="line-chart" size={24} color={colors.textDim} />
            <Text className="text-typography-muted text-xs mt-2">No activity recorded in this window.</Text>
          </View>
        )}
      </View>
    </View>
  );
}
