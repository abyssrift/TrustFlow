import {
  DEFAULT_OVERVIEW_METRICS,
  OVERVIEW_METRICS,
  OverviewMetricKey,
  OverviewPeriod,
  usePipelineOverviewData,
} from '@/hooks/usePipelineOverviewData';
import { useThemeColors } from '@/hooks/useThemeColors';
import { FontAwesome } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Text, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';
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

/**
 * Floor for the plot, not its height: the card this renders inside is floored to
 * a 180/360 height TIER (lib/dashboardWidgets.ts), and the plot takes whatever
 * the header and the legend leave of it — ~228px at tier 2. Deliberately under
 * that: 72px of shell header + ~91px of controls and legend + 16px of body
 * padding + this comes to 359, so the 360 TIER is what decides the card's
 * height. Raise this and the card outgrows its tier, which puts the chart back
 * to a different height from the card beside it — the bug this whole change is.
 */
const PLOT_MIN_H = 180;

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

  // recharts needs a NUMBER, not `height="100%"`: a percentage inside a
  // flex-grown box is the one thing ResponsiveContainer collapses to zero on,
  // and this box's height comes from flexGrow. Measuring is what the svg
  // sibling already does for its width, and it is stable — the plot's height is
  // decided by the flex line above it, so feeding it back in cannot grow it.
  // The measuring View carries onLayout and NO responder prop: on web,
  // react-native-web's ResizeObserver-backed onLayout never fires when one node
  // has both (global-utilities-index.md:130).
  const [plotH, setPlotH] = useState(0);
  const onPlotLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    if (h > 0 && Math.abs(h - plotH) > 1) setPlotH(h);
  };

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
    // No card, no heading and no `embedded` flag to switch them back on: the
    // dashboard widget shell is the ONLY caller of this chart (and of its svg
    // sibling), and it draws the card, the "Pipeline overview" title and the
    // Weekly/Monthly subtitle itself. The card that used to live here made this
    // widget `bare`, which exempted it from the grid's height tiers and left it
    // the one short card in a row of quantized ones.
    // ponytail: unconditional rather than the optional `embedded` prop
    // ProjectionStrip/BlockedExceptionsPanel carry — those have standalone
    // callers to stay byte-identical for and this has none, so the flag would
    // be a branch that is always true. Restore it the day a screen mounts this
    // chart on its own again.
    // `flexGrow` so the plot below can claim the card height the tier bought.
    <View className={className} style={{ flexGrow: 1 }}>
      {/* Only the controls survive the heading: the shell says what this card
          is. The inline period switch stays because the config gear exists
          only in edit mode, so this is the one-tap route to Monthly. */}
      <View className="flex-row items-center justify-end gap-3 mb-4">
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

      {/* Was a flat `height: 280`, which left dead card under it in a 360px
          tier-2 cell and clipped nothing in a taller one. Grows into whatever
          the tier left instead. */}
      <View style={{ flexGrow: 1, minHeight: PLOT_MIN_H }} onLayout={onPlotLayout}>
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
          <ResponsiveContainer width="100%" height={plotH || PLOT_MIN_H}>
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
