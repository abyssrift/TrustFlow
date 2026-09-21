import Block from '@/components/common/Block';
import type { OrganizationalAudit } from '@/lib/analyticsMetrics';
import { useThemeColors } from '@/hooks/useThemeColors';
import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';

type Stage = NonNullable<OrganizationalAudit['conversion_by_stage']>[number];
type StageGroup = { name: string; stages: Stage[] };

function groupStages(stages: Stage[]): StageGroup[] {
  const groups: StageGroup[] = [];
  for (const stage of stages) {
    const name = stage.pipeline_name || 'Pipeline';
    let group = groups[groups.length - 1];
    if (!group || group.name !== name) {
      group = { name, stages: [] };
      groups.push(group);
    }
    group.stages.push(stage);
  }
  return groups;
}

// Same validated categorical palette as TimeByCategoryPie (kanban sidebar).
// One donut per pipeline, sliced by stage. Colors cycle by stage position,
// not stage name. Pipeline stages are user-configurable per company, so
// there is no reliable "pending = grey" text mapping to lean on.
const DONUT_LIGHT = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
const DONUT_DARK = ['#3987e5', '#199e70', '#c98500', '#008300', '#9085e9', '#e66767', '#d55181', '#d95926'];

function isDarkHex(hex?: string) {
  if (!hex || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

const truncateLabel = (value: string, max: number) => (value && value.length > max ? `${value.slice(0, max - 1)}\u2026` : value || '');

export function PipelineLoadDetails({ audit }: { audit: OrganizationalAudit }) {
  const colors = useThemeColors();
  const palette = isDarkHex(colors.card) ? DONUT_DARK : DONUT_LIGHT;
  const stages = audit.conversion_by_stage || [];
  // Backend already orders by (pipeline_name, position); group in one pass.
  // Pipelines with zero active tasks add nothing to look at; drop them
  // instead of rendering an empty card in the carousel.
  const groups = groupStages(stages).filter(group => group.stages.some(stage => (stage.task_count || 0) > 0));

  const size = 92, stroke = 14, r = (size - stroke) / 2, cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const gap = 2;

  return (
    <Block title="Pipeline Load Distribution" className="mb-6">
      {groups.length === 0 ? (
        <Text className="text-typography-muted text-sm text-center py-4">No stage activity data available.</Text>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingRight: 8 }}>
          {groups.map((group, groupIndex) => {
            const total = group.stages.reduce((sum, stage) => sum + (stage.task_count || 0), 0);
            let accumulated = 0;
            const arcs = group.stages.map((stage, stageIndex) => {
              const count = stage.task_count || 0;
              const fraction = total > 0 ? count / total : 0;
              const dash = Math.max(0, fraction * circumference - (count > 0 ? gap : 0));
              const arc = (
                <Circle
                  key={stageIndex} cx={cx} cy={cy} r={r} fill="none"
                  stroke={palette[stageIndex % palette.length]} strokeWidth={stroke}
                  strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-accumulated}
                />
              );
              accumulated += fraction * circumference;
              return arc;
            });

            return (
              <View key={group.name + groupIndex} style={{ width: 220 }} className="bg-surface-background rounded-2xl border border-surface-border/50 p-4">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-3" numberOfLines={1}>{group.name}</Text>
                <View style={{ width: size, height: size, alignSelf: 'center' }} className="mb-3">
                  <Svg width={size} height={size}>
                    <G rotation={-90} origin={`${cx}, ${cy}`}>{arcs}</G>
                  </Svg>
                  <View style={{ position: 'absolute', top: 0, left: 0, width: size, height: size }} className="items-center justify-center">
                    <Text className="text-typography-main text-base font-black">{total}</Text>
                    <Text className="text-typography-muted text-[8px] font-bold uppercase tracking-widest">tasks</Text>
                  </View>
                </View>
                {group.stages.map((stage, stageIndex) => {
                  const count = stage.task_count || 0;
                  return (
                    <View key={stageIndex} className="mb-1.5 flex-row items-center gap-2">
                      <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: palette[stageIndex % palette.length] }} />
                      <Text className="flex-1 text-typography-main text-[10px] font-bold" numberOfLines={1}>{truncateLabel(stage.stage_name, 12)}</Text>
                      <Text className="text-typography-muted text-[9px] font-black">{count} {'\u00b7'} {Math.round((count / total) * 100)}%</Text>
                    </View>
                  );
                })}
              </View>
            );
          })}
        </ScrollView>
      )}
    </Block>
  );
}

export function ConversionFunnelDetails({ audit }: { audit: OrganizationalAudit }) {
  const colors = useThemeColors();
  const stages = audit.conversion_by_stage || [];
  // A funnel only makes sense within one pipeline's own stages, so connecting
  // arrows never cross from one pipeline's last stage into another's first.
  const groups = groupStages(stages).filter(group => group.stages.some(stage => (stage.task_count || 0) > 0));
  // A pipeline with zero active tasks has nothing to look at, so omit it.
  if (groups.length === 0) return null;

  return (
    <Block title="Retention Funnel" className="mb-6">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 16, paddingRight: 8 }}>
        {groups.map((group, groupIndex) => (
          <View key={group.name + groupIndex} style={{ width: 240 }} className="bg-surface-background rounded-2xl border border-surface-border/50 p-4">
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest mb-3" numberOfLines={1}>{group.name}</Text>
            {group.stages.map((stage, index) => {
              const rate = (stage.completion_rate || 0) * 100;
              const isGood = rate >= 85;
              return (
                <View key={index} className="items-center">
                  <View className="w-full bg-surface-card p-3 rounded-xl border border-surface-border/50">
                    <View className="flex-row justify-between items-center mb-2">
                      <View className="flex-1 min-w-0 mr-2">
                        <Text className="text-typography-main font-black text-xs" numberOfLines={1}>{stage.stage_name}</Text>
                        <Text className="text-typography-muted text-[8px] font-bold uppercase">{stage.task_count ?? 0} tasks</Text>
                      </View>
                      <Text className={`text-sm font-black ${isGood ? 'text-state-success' : 'text-state-warning'}`}>{Math.round(rate)}%</Text>
                    </View>
                    <View className="h-1.5 bg-surface-background rounded-full overflow-hidden border border-surface-border">
                      <View className={`h-full ${isGood ? 'bg-state-success' : 'bg-state-warning'}`} style={{ width: `${Math.min(rate, 100)}%` }} />
                    </View>
                  </View>
                  {index < group.stages.length - 1 && (
                    <View className="py-1 opacity-30">
                      <FontAwesome name="long-arrow-down" size={14} color={colors.textDim} />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </Block>
  );
}
