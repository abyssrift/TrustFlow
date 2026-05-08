import React from 'react';
import { View, Text, Dimensions } from 'react-native';
import Svg, { Rect, Defs, LinearGradient, Stop } from 'react-native-svg';

interface PerformanceChartProps {
  data: any[];
  metricKey: string;
  label: string;
}

export const PerformanceChart = ({ data, metricKey, label }: PerformanceChartProps) => {
  const chartData = [...data].reverse();
  const maxVal = Math.max(1, ...chartData.map(d => d[metricKey]));
  const chartHeight = 200;
  const chartWidth = Dimensions.get('window').width - 64; // Account for padding
  const barWidth = (chartWidth / chartData.length) * 0.7;
  const gap = (chartWidth / chartData.length) * 0.3;

  return (
    <View className="bg-surface-card border border-surface-border rounded-2xl p-5">
      <Text className="text-typography-main font-black text-base mb-6">{label}</Text>
      
      <View style={{ height: chartHeight, width: chartWidth }}>
        <Svg height={chartHeight} width={chartWidth}>
          <Defs>
            <LinearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="rgb(99,102,241)" stopOpacity="1" />
              <Stop offset="1" stopColor="rgb(99,102,241)" stopOpacity="0.4" />
            </LinearGradient>
          </Defs>
          {chartData.map((d, i) => {
            const val = d[metricKey];
            const h = (val / maxVal) * chartHeight;
            return (
              <Rect
                key={i}
                x={i * (barWidth + gap) + gap / 2}
                y={chartHeight - h}
                width={barWidth}
                height={h}
                fill="url(#grad)"
                rx={4}
              />
            );
          })}
        </Svg>
      </View>
      
      <View className="flex-row justify-between mt-4">
        <Text className="text-typography-dim text-[10px] font-bold uppercase">
          {chartData[0]?.period_label}
        </Text>
        <Text className="text-typography-dim text-[10px] font-bold uppercase">
          {chartData[chartData.length - 1]?.period_label}
        </Text>
      </View>
    </View>
  );
};
