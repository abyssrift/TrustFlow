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
import Svg, { Circle, Line as SvgLine, Polyline } from 'react-native-svg';

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

/** Floor for the plot now, not its height — it grows into the card's tier. */
const CHART_H = 170;
const PAD_TOP = 12;
const PAD_BOTTOM = 12;

export default function PipelineOverviewChartNative({
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
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const { data, loading, error } = usePipelineOverviewData(pipelineIds, period, refreshKey);

  const colorFor = (colorKey: string) => (colors as any)[colorKey] ?? colors.primary;
  const enabled = OVERVIEW_METRICS.filter(m => metrics.includes(m.key));

  // The plot box takes what the widget shell's height tier left over instead of
  // a flat 170, so a 360px cell is chart rather than chart-plus-dead-space. Both
  // dimensions come off the same onLayout — an svg needs literal numbers, and
  // that node deliberately carries no responder prop (react-native-web's
  // onLayout never fires when one node has both; this component IS the web
  // renderer below 640px, so that trap applies here too).
  const plotStyle = { flexGrow: 1, minHeight: CHART_H };
  const onPlotLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w > 0 && Math.abs(w - width) > 1) setWidth(w);
    if (h > 0 && Math.abs(h - height) > 1) setHeight(h);
  };

  const chartH = height || CHART_H;
  const plotH = chartH - PAD_TOP - PAD_BOTTOM;

  // Normalize each metric to its own max so lines with different units share
  // one band as a trend overview. Absolute latest values live in the legend.
  const seriesFor = (key: OverviewMetricKey): { points: string; dots: { x: number; y: number }[] } => {
    if (width === 0 || data.length === 0) return { points: '', dots: [] };
    const vals = data.map(d => (d as any)[key] as number);
    const max = Math.max(1, ...vals);
    const stepX = data.length > 1 ? width / (data.length - 1) : 0;
    const dots = vals.map((v, i) => ({
      x: data.length > 1 ? i * stepX : width / 2,
      y: PAD_TOP + plotH - (v / max) * plotH,
    }));
    return { points: dots.map(d => `${d.x},${d.y}`).join(' '), dots };
  };

  const latest = (key: OverviewMetricKey): number => (data.length ? (data[data.length - 1] as any)[key] : 0);

  return (
    // No card and no heading — the widget shell draws both, and it is the only
    // caller. Keeping them here is what made this widget `bare`, which exempted
    // it from the grid's height tiers and left the graph shorter than every card
    // beside it. See PipelineOverviewChart.tsx for the same note in full.
    // `flexGrow` so the plot can claim the height the tier bought.
    <View className={className} style={{ flexGrow: 1 }}>
      {/* Controls only. The inline period switch stays: the config gear exists
          only in edit mode, so this is the one-tap route to Monthly. */}
      <View className="flex-row items-center justify-end mb-4">
        <View className="flex-row items-center gap-2">
          <View className="flex-row bg-surface-background border border-surface-border rounded-lg p-0.5">
            {(['week', 'month'] as OverviewPeriod[]).map(p => (
              <TouchableOpacity
                key={p}
                onPress={() => onSetPeriod(p)}
                className={`px-2.5 py-1 rounded-md ${period === p ? 'bg-brand-primary' : ''}`}
              >
                <Text className={`text-[8px] font-black uppercase tracking-widest ${period === p ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
                  {p === 'week' ? 'Wk' : 'Mo'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {onCustomize && (
            <TouchableOpacity
              onPress={onCustomize}
              className="bg-surface-overlay border border-surface-border w-8 h-8 rounded-xl items-center justify-center"
            >
              <FontAwesome name="sliders" size={12} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Legend / toggles with latest value */}
      <View className="flex-row flex-wrap gap-2 mb-4">
        {OVERVIEW_METRICS.map(m => {
          const on = metrics.includes(m.key);
          return (
            <TouchableOpacity
              key={m.key}
              onPress={() => onToggleMetric(m.key)}
              className={`flex-row items-center gap-1.5 px-2.5 py-1 rounded-full border ${on ? 'border-surface-border bg-surface-overlay' : 'border-surface-border/50 opacity-40'}`}
            >
              <View className="w-2 h-2 rounded-full" style={{ backgroundColor: colorFor(m.colorKey) }} />
              <Text className={`text-[9px] font-black uppercase tracking-widest ${on ? 'text-typography-main' : 'text-typography-muted'}`}>
                {m.label}{on && !loading ? ` ${latest(m.key)}${m.unit ?? ''}` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={plotStyle} className="items-center justify-center">
          <ActivityIndicator size="small" color={colors.primary} />
        </View>
      ) : error ? (
        <View style={plotStyle} className="items-center justify-center opacity-60">
          <FontAwesome name="exclamation-triangle" size={20} color={colors.textDim} />
          <Text className="text-typography-muted text-[11px] mt-2">{error}</Text>
        </View>
      ) : enabled.length === 0 ? (
        <View style={plotStyle} className="items-center justify-center opacity-50">
          <Text className="text-typography-muted text-[11px]">Enable a metric above to plot it.</Text>
        </View>
      ) : data.length === 0 ? (
        <View style={plotStyle} className="items-center justify-center opacity-50">
          <FontAwesome name="line-chart" size={22} color={colors.textDim} />
          <Text className="text-typography-muted text-[11px] mt-2">No activity in this window.</Text>
        </View>
      ) : (
        <>
          <View style={plotStyle} onLayout={onPlotLayout}>
            {width > 0 && (
              <Svg height={chartH} width={width}>
                {/* baseline */}
                <SvgLine x1={0} y1={PAD_TOP + plotH} x2={width} y2={PAD_TOP + plotH} stroke={colors.border} strokeWidth={1} />
                {enabled.map(m => {
                  const s = seriesFor(m.key);
                  const stroke = colorFor(m.colorKey);
                  return (
                    <React.Fragment key={m.key}>
                      {data.length > 1 ? (
                        <Polyline points={s.points} fill="none" stroke={stroke} strokeWidth={2.5} />
                      ) : null}
                      {s.dots.map((d, i) => (
                        <Circle key={i} cx={d.x} cy={d.y} r={3} fill={stroke} />
                      ))}
                    </React.Fragment>
                  );
                })}
              </Svg>
            )}
          </View>
          {/* X-axis labels */}
          <View className="flex-row justify-between mt-2" style={{ width }}>
            {data.map((d, i) => (
              <Text key={i} className="text-typography-dim text-[8px] font-bold" numberOfLines={1}>{d.label}</Text>
            ))}
          </View>
        </>
      )}
    </View>
  );
}
