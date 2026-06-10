import React from 'react';
import { View, Text } from 'react-native';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from 'recharts';
import { PerformancePeriod } from '@/contexts/AnalyticsContext';
import { useThemeColors } from '@/hooks/useThemeColors';

interface Props {
  data: PerformancePeriod[];
}

const ChartTooltip = ({ active, payload, label }: any) => {
  const colors = useThemeColors();
  if (!active || !payload?.length) return null;
  const within  = payload.find((p: any) => p.dataKey === 'within_budget_tasks');
  const over    = payload.find((p: any) => p.dataKey === 'over_budget_tasks');
  const rate    = payload.find((p: any) => p.dataKey === 'deliverability_rate');
  return (
    <View className="bg-surface-overlay border border-surface-border rounded-xl px-4 py-3 gap-1">
      <Text className="text-typography-dim text-[10px] mb-1">{label}</Text>
      {within && (
        <Text className="text-state-success text-xs font-bold">
          Within budget: {within.value} task{within.value !== 1 ? 's' : ''}
        </Text>
      )}
      {over && (
        <Text className="text-state-danger text-xs font-bold">
          Over budget: {over.value} task{over.value !== 1 ? 's' : ''}
        </Text>
      )}
      {rate && rate.value !== null && (
        <Text className="text-typography-main text-xs font-black mt-1">
          Deliverability: {rate.value}%
        </Text>
      )}
    </View>
  );
};

export const TimerDeliverabilityChart = ({ data }: Props) => {
  const colors = useThemeColors();
  const chartData = [...data].reverse().map(r => ({
    ...r,
    deliverability_rate:
      (r.within_budget_tasks + r.over_budget_tasks) > 0
        ? Math.round((r.within_budget_tasks / (r.within_budget_tasks + r.over_budget_tasks)) * 100)
        : null,
  }));

  const hasAnyData = chartData.some(
    r => r.within_budget_tasks > 0 || r.over_budget_tasks > 0,
  );

  return (
    <View className="bg-surface-card border border-surface-border rounded-2xl p-6">
      <View className="mb-6">
        <Text className="text-typography-main font-black text-base">Timer Deliverability</Text>
        <Text className="text-typography-muted text-xs mt-1">
          Did you finish tasks within the assigned time budget?
        </Text>
      </View>

      {!hasAnyData ? (
        <View className="py-10 items-center">
          <Text className="text-typography-muted text-sm text-center">
            No tasks with estimated hours completed yet.{'\n'}
            Set time budgets on tasks to track deliverability.
          </Text>
        </View>
      ) : (
        <View style={{ height: 300, width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 40, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} opacity={0.5} />
              <XAxis
                dataKey="period_label"
                tick={{ fill: colors.textDim, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              {/* Left axis: task counts */}
              <YAxis
                yAxisId="tasks"
                tick={{ fill: colors.textDim, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
              />
              {/* Right axis: deliverability rate % */}
              <YAxis
                yAxisId="rate"
                orientation="right"
                domain={[0, 100]}
                tick={{ fill: colors.textDim, fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip content={<ChartTooltip />} />
              <ReferenceLine
                yAxisId="rate"
                y={100}
                stroke={colors.success}
                strokeDasharray="4 4"
                strokeOpacity={0.4}
              />
              <Bar
                yAxisId="tasks"
                dataKey="within_budget_tasks"
                name="Within budget"
                fill={colors.success}
                fillOpacity={0.85}
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
              <Bar
                yAxisId="tasks"
                dataKey="over_budget_tasks"
                name="Over budget"
                fill={colors.danger}
                fillOpacity={0.85}
                radius={[4, 4, 0, 0]}
                maxBarSize={40}
              />
              <Line
                yAxisId="rate"
                type="monotone"
                dataKey="deliverability_rate"
                name="Deliverability %"
                stroke={colors.primary}
                strokeWidth={2.5}
                dot={{ r: 4, fill: colors.primary, strokeWidth: 2, stroke: colors.card }}
                activeDot={{ r: 6, strokeWidth: 0 }}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </View>
      )}

      {hasAnyData && (
        <View className="flex-row gap-4 mt-4 flex-wrap">
          <View className="flex-row items-center gap-1.5">
            <View className="w-3 h-3 rounded-sm bg-state-success" />
            <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-wide">Within budget</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="w-3 h-3 rounded-sm bg-state-danger" />
            <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-wide">Over budget</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="w-6 h-0.5 bg-brand-primary" />
            <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-wide">Deliverability %</Text>
          </View>
        </View>
      )}
    </View>
  );
};
