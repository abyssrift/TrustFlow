import React from 'react';
import { Text, View } from 'react-native';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartTooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useThemeColors } from '@/hooks/useThemeColors';
import {
  canProject,
  confidenceCaption,
  noProjectionReason,
  type ProjectionSeries,
} from './projection';

// Issue #198 / plan §16.1 — THE projection chart. Web variant (recharts).
//
// Read components/charts/projection.ts before changing anything here. The one
// rule: this file contains no pace maths and must never contain any. It draws
// what the caller hands it. §16.1's failure mode is five surfaces each
// computing their own projected date and disagreeing on screen.
//
// The .tsx sibling is the native implementation (react-native-svg). recharts
// is web-only and cannot render under React Native, which is why this split
// exists rather than one shared file — same reasoning and same shape as
// PortfolioFlowTab.tsx / PortfolioFlowTab.web.tsx.
//
// Tooltip/theming idiom is copied from PipelineOverviewChart.tsx on purpose:
// inline style objects from useThemeColors, NOT NativeWind classes, because
// recharts renders its tooltip into a portal where theme token classes go
// black (see the NativeWind/Modal note in Tooltip.tsx).

const fmtShort = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export default function ProjectionChart({
  series,
  title,
  subtitle,
  height = 220,
}: {
  series: ProjectionSeries;
  title: string;
  subtitle?: string;
  height?: number;
}) {
  const c = useThemeColors();
  const projecting = canProject(series);

  // Suppressing the projected arm is done HERE, by rebuilding the rows, rather
  // than by hiding a <Line>. A hidden line still puts its values into the
  // tooltip and the y-domain, so a forecast we decided not to show would still
  // be readable on hover and would still stretch the axis. §16.2 means it is
  // not on the screen in any form.
  const rows = series.points.map(p => ({
    date: p.date,
    label: fmtShort(p.date),
    actual: p.actual,
    projected: projecting ? p.projected : null,
  }));

  const tooltipStyle = {
    backgroundColor: c.card,
    border: `1px solid ${c.border}`,
    borderRadius: 12,
    fontSize: 11,
    color: c.textMain,
  };

  const hasAnyActual = series.points.some(p => p.actual != null);

  return (
    <View className="bg-surface-card border border-surface-border rounded-2xl p-4 md:p-5">
      <View className="flex-row items-start justify-between gap-3 mb-1">
        <View className="flex-1 min-w-0">
          <Text className="text-typography-main text-sm font-bold">{title}</Text>
          {!!subtitle && (
            <Text className="text-typography-muted text-[11px] mt-0.5">{subtitle}</Text>
          )}
        </View>
        {projecting && !!series.projectedEnd && (
          <View className="items-end">
            <Text className="text-typography-dim text-[9px] font-black uppercase tracking-[0.15em]">
              Projected finish
            </Text>
            <Text
              className="text-sm font-bold mt-0.5"
              style={{ color: series.confidence === 'low' ? c.warning : c.textMain }}
            >
              {fmtShort(series.projectedEnd)}
            </Text>
          </View>
        )}
      </View>

      {/* Legend. Two states of ONE measure, so they share a hue and are told
          apart by line style — not two colours, which would read as two
          different things being measured. */}
      <View className="flex-row items-center flex-wrap gap-4 mt-2 mb-3">
        <View className="flex-row items-center gap-1.5">
          <View style={{ width: 14, height: 2, backgroundColor: c.primary }} />
          <Text className="text-typography-muted text-[10px] font-semibold">Completed</Text>
        </View>
        {projecting && (
          <View className="flex-row items-center gap-1.5">
            <View className="flex-row items-center" style={{ gap: 2 }}>
              {[0, 1, 2].map(i => (
                <View key={i} style={{ width: 4, height: 2, backgroundColor: c.primary, opacity: 0.75 }} />
              ))}
            </View>
            <Text className="text-typography-muted text-[10px] font-semibold">At current pace</Text>
          </View>
        )}
        {!!series.dueDate && (
          <View className="flex-row items-center gap-1.5">
            <View style={{ width: 2, height: 10, backgroundColor: c.danger }} />
            <Text className="text-typography-muted text-[10px] font-semibold">Due</Text>
          </View>
        )}
      </View>

      {hasAnyActual ? (
        <View style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={c.border} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 9, fill: c.textDim }}
                axisLine={false}
                tickLine={false}
                minTickGap={24}
              />
              {/* ONE y-axis, always. Never a second scale on the right — two
                  y-scales is the single most common charting mistake and this
                  chart has exactly one measure anyway. */}
              <YAxis
                tick={{ fontSize: 9, fill: c.textDim }}
                axisLine={false}
                tickLine={false}
                width={30}
                allowDecimals={false}
                domain={[0, Math.max(series.target, 1)]}
              />
              <RechartTooltip
                contentStyle={tooltipStyle}
                cursor={{ stroke: c.border }}
                formatter={(v: any, name: any) => [`${v} ${series.unitLabel}`, name]}
              />
              <ReferenceLine
                y={series.target}
                stroke={c.textDim}
                strokeDasharray="4 4"
                label={{ value: 'All done', fontSize: 9, fill: c.textDim, position: 'insideTopRight' }}
              />
              {!!series.dueDate && (
                <ReferenceLine
                  x={fmtShort(series.dueDate)}
                  stroke={c.danger}
                  strokeDasharray="2 3"
                  label={{ value: 'Due', fontSize: 9, fill: c.danger, position: 'insideTopLeft' }}
                />
              )}
              <Line
                type="monotone"
                dataKey="actual"
                name="Completed"
                stroke={c.primary}
                strokeWidth={2}
                dot={{ r: 2.5, fill: c.primary }}
                activeDot={{ r: 5 }}
                connectNulls={false}
                isAnimationActive={false}
              />
              {projecting && (
                <Line
                  type="monotone"
                  dataKey="projected"
                  name="At current pace"
                  stroke={c.primary}
                  strokeOpacity={0.75}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </View>
      ) : (
        <View className="items-center justify-center" style={{ height }}>
          <Text className="text-typography-dim text-xs text-center" style={{ maxWidth: 320 }}>
            Nothing completed yet, so there is no progress to plot.
          </Text>
        </View>
      )}

      {/* The honesty line. Always present — either it says how thin the
          forecast is, or it says why there isn't one. §16.2. */}
      <Text className="text-typography-dim text-[10px] leading-4 mt-3">
        {projecting ? confidenceCaption(series) : noProjectionReason(series)}
      </Text>
    </View>
  );
}
