import React from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import Svg, { Rect, Defs, LinearGradient, Stop, Line, Text as SvgText } from 'react-native-svg';
import { PerformancePeriod } from '@/contexts/AnalyticsContext';

interface Props {
  data: PerformancePeriod[];
}

export const TimerDeliverabilityChart = ({ data }: Props) => {
  const { width: windowWidth } = useWindowDimensions();
  const chartData = [...data].reverse().map(r => ({
    ...r,
    deliverability_rate:
      (r.within_budget_tasks + r.over_budget_tasks) > 0
        ? Math.round((r.within_budget_tasks / (r.within_budget_tasks + r.over_budget_tasks)) * 100)
        : null,
  }));

  const hasAnyData = chartData.some(r => r.within_budget_tasks > 0 || r.over_budget_tasks > 0);
  const chartHeight = 180;
  const chartWidth = Math.max(100, windowWidth - 88);
  const maxTasks = Math.max(1, ...chartData.map(d => d.within_budget_tasks + d.over_budget_tasks));
  const colW = chartWidth / chartData.length;
  const barW = colW * 0.35;

  return (
    <View className="bg-surface-card border border-surface-border rounded-2xl p-5">
      <Text className="text-typography-main font-black text-base mb-1">Timer Deliverability</Text>
      <Text className="text-typography-muted text-xs mb-5">
        Did you finish tasks within the assigned time budget?
      </Text>

      {!hasAnyData ? (
        <View className="py-8 items-center">
          <Text className="text-typography-muted text-sm text-center">
            No tasks with estimated hours completed yet.
          </Text>
        </View>
      ) : (
        <>
          <View style={{ height: chartHeight, width: chartWidth }}>
            <Svg height={chartHeight} width={chartWidth}>
              <Defs>
                <LinearGradient id="gradSuccess" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="rgb(34,197,94)" stopOpacity="1" />
                  <Stop offset="1" stopColor="rgb(34,197,94)" stopOpacity="0.5" />
                </LinearGradient>
                <LinearGradient id="gradDanger" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="rgb(239,68,68)" stopOpacity="1" />
                  <Stop offset="1" stopColor="rgb(239,68,68)" stopOpacity="0.5" />
                </LinearGradient>
              </Defs>

              {chartData.map((d, i) => {
                const cx = i * colW + colW / 2;
                const total = d.within_budget_tasks + d.over_budget_tasks;
                const withinH = ((d.within_budget_tasks / maxTasks) * chartHeight * 0.9);
                const overH   = ((d.over_budget_tasks   / maxTasks) * chartHeight * 0.9);

                return (
                  <React.Fragment key={i}>
                    {/* Within budget bar (left of center) */}
                    {d.within_budget_tasks > 0 && (
                      <Rect
                        x={cx - barW - 1}
                        y={chartHeight - withinH}
                        width={barW}
                        height={withinH}
                        fill="url(#gradSuccess)"
                        rx={3}
                      />
                    )}
                    {/* Over budget bar (right of center) */}
                    {d.over_budget_tasks > 0 && (
                      <Rect
                        x={cx + 1}
                        y={chartHeight - overH}
                        width={barW}
                        height={overH}
                        fill="url(#gradDanger)"
                        rx={3}
                      />
                    )}
                  </React.Fragment>
                );
              })}
            </Svg>
          </View>

          {/* Period labels */}
          <View className="flex-row justify-between mt-2">
            <Text className="text-typography-dim text-[9px] font-bold uppercase">
              {chartData[0]?.period_label}
            </Text>
            <Text className="text-typography-dim text-[9px] font-bold uppercase">
              {chartData[chartData.length - 1]?.period_label}
            </Text>
          </View>

          {/* Legend */}
          <View className="flex-row gap-4 mt-3">
            <View className="flex-row items-center gap-1.5">
              <View className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgb(34,197,94)' }} />
              <Text className="text-typography-dim text-[9px] font-bold uppercase tracking-wide">Within budget</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <View className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgb(239,68,68)' }} />
              <Text className="text-typography-dim text-[9px] font-bold uppercase tracking-wide">Over budget</Text>
            </View>
          </View>

          {/* Deliverability rate badges for recent periods */}
          <View className="flex-row gap-2 mt-4 flex-wrap">
            {chartData.slice(-4).reverse().map((d, i) => {
              if (d.deliverability_rate === null) return null;
              const isGood = d.deliverability_rate >= 75;
              return (
                <View
                  key={i}
                  className={`px-3 py-1.5 rounded-xl ${isGood ? 'bg-state-success/10' : 'bg-state-danger/10'}`}
                >
                  <Text className="text-typography-dim text-[9px] font-bold uppercase">{d.period_label}</Text>
                  <Text className={`font-black text-sm ${isGood ? 'text-state-success' : 'text-state-danger'}`}>
                    {d.deliverability_rate}%
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
};
