import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';

export const SLARiskAlertWeb = ({ data }: any) => {
  if (!data?.sla_risks || data.sla_risks.length === 0) return null;
  return (
    <View className="mb-8 bg-state-danger/5 border border-state-danger/20 p-8 rounded-[32px]">
      <View className="flex-row items-center mb-6">
        <View className="w-10 h-10 rounded-full bg-state-danger/10 items-center justify-center mr-4">
          <FontAwesome name="warning" size={16} color="rgb(var(--state-danger))" />
        </View>
        <View>
          <Text className="text-state-danger font-black text-lg">SLA Risks</Text>
          <Text className="text-state-danger/70 text-xs font-medium">{data.sla_risks.length} active tasks exceeding tolerance</Text>
        </View>
      </View>
      <View className="space-y-3">
        {data.sla_risks.slice(0, 5).map((r: any, i: number) => (
          <View key={i} className="flex-row justify-between items-center bg-white/50 dark:bg-black/20 p-4 rounded-2xl border border-state-danger/10">
            <View>
              <Text className="text-typography-main font-black text-sm">{r.task_number || `TASK-${r.id.substring(0, 4)}`}</Text>
              <Text className="text-typography-muted text-[10px] uppercase font-bold">{r.stage_name}</Text>
            </View>
            <View className="flex-row items-center gap-4">
              <View className="items-end">
                <Text className="text-state-danger font-black">{r.risk_percent}%</Text>
                <Text className="text-[9px] text-typography-muted uppercase">Risk Probability</Text>
              </View>
              <TouchableOpacity className="w-8 h-8 rounded-lg bg-state-danger items-center justify-center">
                <FontAwesome name="arrow-right" size={10} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

export const StageDurationChartWeb = ({ data }: any) => {
  if (!data?.stage_duration_analysis) return null;
  const maxDays = Math.max(...data.stage_duration_analysis.map((s: any) => s.avg_duration_days));
  return (
    <View className="bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow mb-8">
      <Text className="text-typography-main font-black text-xl mb-8">Stage Duration (Days per Stage)</Text>
      <View className="space-y-6">
        {data.stage_duration_analysis.map((stage: any, idx: number) => {
          const percentage = (stage.avg_duration_days / (maxDays || 1)) * 100;
          const isSlow = stage.avg_duration_days > 2.5;
          return (
            <View key={idx}>
              <View className="flex-row justify-between mb-2">
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">{stage.stage_name}</Text>
                <Text className={`text-sm font-black ${isSlow ? 'text-state-danger' : 'text-brand-primary'}`}>{stage.avg_duration_days.toFixed(1)} Days</Text>
              </View>
              <View className="h-2.5 bg-surface-background rounded-full overflow-hidden border border-surface-border/50">
                <View className={`h-full ${isSlow ? 'bg-state-danger' : 'bg-brand-primary'} rounded-full`} style={{ width: `${percentage}%` }} />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

export const ConversionFunnelChartWeb = ({ data }: any) => {
  if (!data?.conversion_by_stage) return null;
  return (
    <View className="bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow h-full">
      <Text className="text-typography-main font-black text-xl mb-8">Task Funnel</Text>
      <View className="space-y-2">
        {data.conversion_by_stage.map((stage: any, idx: number) => {
          const rate = (stage.completion_rate || 0) * 100;
          const isGood = rate >= 85;
          return (
            <View key={idx} className="items-center">
              <View className="w-full bg-surface-background p-6 rounded-2xl border border-surface-border/50">
                <View className="flex-row justify-between mb-4">
                  <View>
                    <Text className="text-typography-main font-black text-sm">{stage.stage_name}</Text>
                    <Text className="text-typography-muted text-[10px] font-bold uppercase">{stage.task_count} Active Units</Text>
                  </View>
                  <View className="items-end">
                    <Text className={`text-lg font-black ${isGood ? 'text-state-success' : 'text-state-warning'}`}>{rate.toFixed(0)}%</Text>
                    <Text className="text-[9px] text-typography-muted uppercase">Retention</Text>
                  </View>
                </View>
                <View className="h-3 bg-surface-card rounded-full overflow-hidden border border-surface-border">
                  <View className={`h-full ${isGood ? 'bg-state-success' : 'bg-state-warning'}`} style={{ width: `${Math.min(rate, 100)}%` }} />
                </View>
              </View>
              {idx < data.conversion_by_stage.length - 1 && (
                <View className="py-2 opacity-30">
                  <View>
                    <FontAwesome name="long-arrow-down" size={20} color="rgb(var(--text-dim))" />
                  </View>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
};

export const WorkDistributionChartWeb = ({ data }: any) => {
  if (!data?.worker_engagement) return null;
  const workers = data.worker_engagement.sort((a: any, b: any) => b.action_count - a.action_count).slice(0, 6);
  const maxCount = Math.max(...workers.map((w: any) => w.action_count));
  return (
    <View className="bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow">
      <Text className="text-typography-main font-black text-xl mb-8">Team Workload</Text>
      <View className="space-y-6">
        {workers.map((worker: any, idx: number) => {
          const percentage = (worker.action_count / (maxCount || 1)) * 100;
          const overloaded = percentage > 85;
          return (
            <View key={idx}>
              <View className="flex-row justify-between mb-3 items-center">
                <View className="flex-row items-center">
                  <View className="w-8 h-8 rounded-full bg-brand-primary/10 items-center justify-center mr-3 border border-brand-primary/20">
                    <Text className="text-brand-primary font-black text-[10px]">{worker.full_name?.charAt(0) || '?'}</Text>
                  </View>
                  <Text className="text-typography-main font-bold text-sm">{worker.full_name || 'Anonymous User'}</Text>
                </View>
                <View className="flex-row items-center gap-4">
                  <Text className={`text-sm font-black ${overloaded ? 'text-state-danger' : 'text-brand-primary'}`}>{worker.action_count} OPS</Text>
                  <View className="w-12 items-end">
                    <Text className="text-typography-muted text-[10px] font-black">{Math.round(percentage)}%</Text>
                  </View>
                </View>
              </View>
              <View className="h-2 bg-surface-background rounded-full overflow-hidden">
                <View className={`h-full ${overloaded ? 'bg-state-danger' : 'bg-brand-primary'} rounded-full`} style={{ width: `${percentage}%` }} />
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

export const QualityLeaderboardWeb = ({ data }: any) => {
  if (!data?.quality_by_worker) return null;
  const workers = data.quality_by_worker.sort((a: any, b: any) => a.revision_rate - b.revision_rate).slice(0, 6);
  return (
    <View className="bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow h-full">
      <Text className="text-typography-main font-black text-xl mb-8">Quality Integrity Ratings</Text>
      <View className="space-y-4">
        {workers.map((worker: any, idx: number) => {
          const stars = worker.revision_rate <= 5 ? 5 : worker.revision_rate <= 10 ? 4 : worker.revision_rate <= 15 ? 3 : 2;
          return (
            <View key={idx} className="bg-surface-background p-5 rounded-2xl border border-surface-border/50">
              <View className="flex-row justify-between items-center mb-4">
                <Text className="text-typography-main font-black text-sm flex-1">{worker.full_name || 'Anonymous User'}</Text>
                <View className="flex-row gap-1.5">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <FontAwesome key={s} name={s <= stars ? 'star' : 'star-o'} size={14} color={s <= stars ? 'rgb(var(--state-warning))' : 'rgb(var(--text-muted))'} />
                  ))}
                </View>
              </View>
              <View className="flex-row justify-between items-center">
                <View className="flex-row items-center bg-state-success/10 px-3 py-1 rounded-full">
                  <Text className="text-state-success text-[10px] font-black uppercase">{(worker.revision_rate || 0).toFixed(1)}% REVISION</Text>
                </View>
                <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">{worker.total_tasks} Tasks</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

export const TrendComparisonCardsWeb = ({ data }: any) => {
  if (!data?.current || !data?.comparison) return null;
  const metrics = [
    { label: 'Throughput Delta', val: data.current.throughput, prev: data.comparison.throughput, suffix: ' units', hBetter: true },
    { label: 'Success Variance', val: data.current.success_rate, prev: data.comparison.success_rate, suffix: '%', hBetter: true },
    { label: 'Latency Drift', val: data.current.avg_lead_time_minutes, prev: data.comparison.avg_lead_time_minutes, suffix: 'm', hBetter: false },
    { label: 'Integrity Shift', val: data.current.revision_rate, prev: data.comparison.revision_rate, suffix: '%', hBetter: false },
  ];
  return (
    <View className="mt-8">
      <Text className="text-typography-main font-black text-2xl tracking-tight mb-8">Performance Trends</Text>
      <View className="flex-row gap-6">
        {metrics.map((m, idx) => {
          const change = (m.val || 0) - (m.prev || 0);
          const isPositive = m.hBetter ? change >= 0 : change <= 0;
          return (
            <View key={idx} className="flex-1 bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow">
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">{m.label}</Text>
              <View className="flex-row items-baseline justify-between">
                <Text className="text-typography-main text-3xl font-black">{Math.round(m.val || 0)}{m.suffix}</Text>
                <View className={`flex-row items-center px-3 py-1 rounded-full ${isPositive ? 'bg-state-success/10' : 'bg-state-danger/10'}`}>
                  <FontAwesome name={change >= 0 ? 'caret-up' : 'caret-down'} size={12} color={isPositive ? 'rgb(var(--state-success))' : 'rgb(var(--state-danger))'} className="mr-2" />
                  <Text className={`text-[10px] font-black ${isPositive ? 'text-state-success' : 'text-state-danger'}`}>
                    {Math.abs(Math.round(change))}{m.suffix}
                  </Text>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};
