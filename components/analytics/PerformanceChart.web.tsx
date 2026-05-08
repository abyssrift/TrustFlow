import React from 'react';
import { View, Text } from 'react-native';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

interface PerformanceChartProps {
  data: any[];
  metricKey: string;
  label: string;
}

const ChartTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <View className="bg-surface-overlay border border-surface-border rounded-xl px-3 py-2">
      <Text className="text-typography-dim text-[10px] mb-0.5">{label}</Text>
      <Text className="text-typography-main font-black text-sm">{payload[0]?.value.toLocaleString()}</Text>
    </View>
  );
};

export const PerformanceChart = ({ data, metricKey, label }: PerformanceChartProps) => {
  const chartData = [...data].reverse();

  return (
    <View className="bg-surface-card border border-surface-border rounded-2xl p-6">
      <Text className="text-typography-main font-black text-base mb-6">{label}</Text>
      <View style={{ height: 300, width: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorMetric" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.2} />
                <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} opacity={0.5} />
            <XAxis 
              dataKey="period_label" 
              tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }} 
              axisLine={false} 
              tickLine={false} 
            />
            <YAxis 
              tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }} 
              axisLine={false} 
              tickLine={false} 
            />
            <Tooltip content={<ChartTooltip />} />
            <Area 
              type="monotone" 
              dataKey={metricKey} 
              stroke="var(--color-primary)" 
              fill="url(#colorMetric)" 
              strokeWidth={3} 
              dot={{ r: 4, fill: 'var(--color-primary)', strokeWidth: 2, stroke: 'var(--color-text-main)' }} 
              activeDot={{ r: 6, strokeWidth: 0 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </View>
    </View>
  );
};
