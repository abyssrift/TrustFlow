import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip as RechartTooltip, XAxis, YAxis,
} from 'recharts';
import { useRouter } from 'expo-router';
import { useAnalytics, ThroughputPeriod, StageDwell } from '@/contexts/AnalyticsContext';
import { useState, useEffect, useCallback } from 'react';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDwell(s: number): string {
  if (s <= 0) return '0m';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

const DwellTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d: StageDwell = payload[0]?.payload;
  return (
    <View className="bg-surface-card border border-surface-border rounded-xl p-3 gap-1 shadow-xl">
      <Text className="text-typography-main font-black text-sm">{d.stage_name}</Text>
      <div className="h-px bg-surface-border my-1" />
      <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Performance Metrics</Text>
      <Text className="text-typography-main text-xs font-black">Avg: <Text className="text-brand-primary">{fmtDwell(d.avg_seconds)}</Text></Text>
      <Text className="text-typography-muted text-[10px]">Median: {fmtDwell(d.median_seconds)}</Text>
      <Text className="text-typography-muted text-[10px]">P75: {fmtDwell(d.p75_seconds)}</Text>
      <View className="flex-row items-center gap-2 mt-1">
        <Text className="text-typography-muted text-[9px] font-bold">{d.sample_count} samples</Text>
        <View className="w-1 h-1 rounded-full bg-surface-border" />
        <Text className="text-typography-muted text-[9px] font-bold">{d.reversal_count} reversals</Text>
      </View>
      {d.is_bottleneck && (
        <View className="mt-2 bg-state-warning-dim border border-state-warning/20 px-2 py-1 rounded-md">
          <Text className="text-state-warning text-[9px] font-black uppercase">⚠ Bottleneck Detected</Text>
        </View>
      )}
    </View>
  );
};


export const SLARiskAlertWeb = ({ data, className }: { data: any, className?: string }) => {
  const router = useRouter();
  if (!data?.sla_risks || data.sla_risks.length === 0) return null;

  return (
    <View className={`mb-8 bg-surface-card border border-state-danger/30 p-8 rounded-[32px] premium-shadow ${className || ''}`}>
      <View className="flex-row items-center mb-6">
        <View className="w-10 h-10 rounded-full bg-state-danger-dim items-center justify-center mr-4 border border-state-danger/20">
          <FontAwesome name="warning" size={16} color="var(--color-danger)" />
        </View>
        <View className="flex-1 flex-row items-center justify-between">
          <View>
            <Text className="text-state-danger font-black text-lg tracking-tight">SLA Risks</Text>
            <Text className="text-typography-muted text-xs font-medium">{data.sla_risks.length} active tasks exceeding tolerance</Text>
          </View>
          <View className="flex-row items-center gap-2 px-3 py-1.5 bg-surface-background border border-surface-border rounded-xl">
             <FontAwesome name="info-circle" size={10} color="var(--color-text-dim)" />
             <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">SLA: Service Level Agreement (Time Risk)</Text>
          </View>
        </View>
      </View>
      <View className="gap-3">
        {data.sla_risks.slice(0, 5).map((r: any, i: number) => (
          <TouchableOpacity 
            key={i} 
            onPress={() => router.push(`/task/${r.id}`)}
            className="flex-row justify-between items-center bg-surface-background p-4 rounded-2xl border border-surface-border hover:border-state-danger/40 transition-all"
          >
            <View className="flex-row items-center gap-4">
              <View className="w-1 h-8 rounded-full bg-state-danger/40" />
              <View>
                <Text className="text-typography-main font-black text-sm">{r.task_number || `TASK-${r.id.substring(0, 4)}`}</Text>
                <Text className="text-typography-muted text-[10px] uppercase font-bold tracking-widest">{r.stage_name}</Text>
              </View>
            </View>
            <View className="flex-row items-center gap-6">
              <View className="items-end">
                <Text className="text-state-danger font-black text-lg">{r.risk_percent}%</Text>
                <Text className="text-[9px] text-typography-muted uppercase font-black">Risk Probability</Text>
              </View>
              <View className="w-10 h-10 rounded-xl bg-state-danger items-center justify-center shadow-sm shadow-state-danger/20">
                <FontAwesome name="chevron-right" size={12} color="var(--color-on-primary)" />
              </View>
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
};

export const StageDurationChartWeb = ({ data, className }: { data: any, className?: string }) => {
  if (!data?.stage_duration_analysis) return null;
  const maxDays = Math.max(...data.stage_duration_analysis.map((s: any) => s.avg_duration_days));
  return (
    <View className={`bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow mb-8 ${className || ''}`}>
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

export const ConversionFunnelChartWeb = ({ data, className }: { data: any, className?: string }) => {
  if (!data?.conversion_by_stage) return null;
  return (
    <View className={`bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow ${className || ''}`}>
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
                  <FontAwesome name="long-arrow-down" size={20} color="var(--color-text-dim)" />
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
};

export const WorkDistributionChartWeb = ({ data, className }: { data: any, className?: string }) => {
  if (!data?.worker_engagement) return null;
  const workers = data.worker_engagement.sort((a: any, b: any) => b.action_count - a.action_count).slice(0, 6);
  const maxCount = Math.max(...workers.map((w: any) => w.action_count));
  return (
    <View className={`bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow ${className || ''}`}>
      <Text className="text-typography-main font-black text-xl mb-8">Team Workload</Text>
      <View className="space-y-6">
        {workers.map((worker: any, idx: number) => {
          const percentage = (worker.action_count / (maxCount || 1)) * 100;
          const overloaded = percentage > 85;
          return (
            <View key={idx}>
              <View className="flex-row justify-between mb-3 items-center">
                <View className="flex-row items-center">
                  <View className="w-8 h-8 rounded-full bg-surface-card border border-surface-border overflow-hidden mr-3">
                    {worker.avatar_url ? (
                      <Image source={{ uri: worker.avatar_url }} className="w-full h-full" />
                    ) : (
                      <View className="w-full h-full items-center justify-center bg-brand-primary/5">
                        <Text className="text-brand-primary font-black text-[10px]">
                          {(worker.full_name || 'A')[0].toUpperCase()}
                        </Text>
                      </View>
                    )}
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

export const QualityLeaderboardWeb = ({ data, className }: { data: any, className?: string }) => {
  if (!data?.quality_by_worker) return null;

  const workers = data.quality_by_worker
    .map((w: any) => ({
      ...w,
      integrityScore: Math.max(0, 100 - (w.revision_rate || 0)),
    }))
    .sort((a: any, b: any) => b.integrityScore - a.integrityScore)
    .slice(0, 6);

  return (
    <View className={`bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow ${className || ''}`}>
      <View className="flex-row justify-between items-start mb-8">
        <View className="flex-1 mr-4">
          <Text className="text-typography-muted text-xs font-bold tracking-widest uppercase mb-1">Performance Matrix</Text>
          <Text className="text-typography-main text-3xl font-black">Quality Integrity</Text>
          <Text className="text-typography-muted text-[11px] mt-2 leading-relaxed max-w-[480px]">
            Integrity measures first-pass accuracy. It is calculated as <Text className="text-brand-primary font-bold">100% minus the Rework Rate</Text>. 
            A higher score indicates tasks were completed successfully without requiring any revisions.
          </Text>
        </View>
        <View className="bg-brand-primary-dim px-4 py-2 rounded-xl border border-brand-primary/20">
          <Text className="text-brand-primary font-bold text-sm">Top Contributors</Text>
        </View>
      </View>

      <View className="flex-row flex-wrap gap-6">
        {workers.map((worker: any, idx: number) => {
          const score = worker.integrityScore;
          const stars = score >= 95 ? 5 : score >= 90 ? 4 : score >= 80 ? 3 : 2;
          
          const colorClass = score >= 90 ? 'bg-state-success' : score >= 75 ? 'bg-state-warning' : 'bg-state-danger';
          const bgDimClass = score >= 90 ? 'bg-state-success-dim' : score >= 75 ? 'bg-state-warning-dim' : 'bg-state-danger-dim';
          const textClass = score >= 90 ? 'text-state-success' : score >= 75 ? 'text-state-warning' : 'text-state-danger';
          const borderClass = score >= 90 ? 'border-state-success/20' : score >= 75 ? 'border-state-warning/20' : 'border-state-danger/20';

          return (
            <View 
              key={idx} 
              className="flex-1 min-w-[300px] bg-surface-background p-6 rounded-2xl border border-surface-border/50 hover:border-brand-primary/30 transition-all duration-300"
            >
              <View className="flex-row justify-between items-start mb-4">
                <View className="flex-row items-center gap-3">
                  <View className={`w-8 h-8 ${bgDimClass} rounded-lg items-center justify-center border ${borderClass}`}>
                    <Text className={`${textClass} font-black text-xs`}>#{idx + 1}</Text>
                  </View>
                  <View className="w-10 h-10 rounded-full bg-surface-card border border-surface-border overflow-hidden">
                    {worker.avatar_url ? (
                      <Image source={{ uri: worker.avatar_url }} className="w-full h-full" />
                    ) : (
                      <View className="w-full h-full items-center justify-center bg-brand-primary/5">
                        <Text className="text-brand-primary font-black text-xs">
                          {(worker.full_name || 'A')[0].toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text className="text-typography-main font-black text-base flex-1" numberOfLines={1}>
                    {worker.full_name || 'Anonymous User'}
                  </Text>
                </View>
                
                <View className="flex-row gap-1">
                  {[1, 2, 3, 4, 5].map((s) => (
                    <FontAwesome 
                      key={s} 
                      name={s <= stars ? 'star' : 'star-o'} 
                      size={14} 
                      color={s <= stars ? 'var(--color-warning)' : 'var(--color-text-dim)'} 
                    />
                  ))}
                </View>
              </View>

              <View className="gap-3">
                <View className="flex-row justify-between items-end">
                  <Text className="text-typography-muted text-xs font-bold uppercase">Integrity Score</Text>
                  <Text className={`${textClass} text-xl font-black`}>{score.toFixed(1)}%</Text>
                </View>

                <View className="h-2 bg-surface-card rounded-full overflow-hidden">
                  <View 
                    className={`h-full ${colorClass}`} 
                    style={{ width: `${score}%` }} 
                  />
                </View>

                <View className="flex-row justify-between items-center pt-2">
                  <View className="flex-row items-center gap-1.5">
                    <FontAwesome name="wrench" size={10} color="var(--color-text-dim)" />
                    <Text className="text-typography-muted text-[10px] font-bold uppercase">
                      {(worker.revision_rate || 0).toFixed(1)}% Rework
                    </Text>
                  </View>
                  <View className="flex-row items-center gap-1.5">
                    <FontAwesome name="check-circle" size={10} color="var(--color-text-dim)" />
                    <Text className="text-typography-muted text-[10px] font-bold uppercase">
                      {worker.total_tasks || 0} Tasks
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
};

export const TrendComparisonCardsWeb = ({ data, className }: { data: any, className?: string }) => {
  if (!data?.current || !data?.comparison) return null;
  const metrics = [
    { label: 'Throughput Delta', val: data.current.throughput, prev: data.comparison.throughput, suffix: ' units', hBetter: true },
    { label: 'Success Variance', val: data.current.success_rate, prev: data.comparison.success_rate, suffix: '%', hBetter: true },
    { label: 'Latency Drift', val: data.current.avg_lead_time_minutes, prev: data.comparison.avg_lead_time_minutes, suffix: 'm', hBetter: false },
    { label: 'Integrity Shift', val: data.current.revision_rate, prev: data.comparison.revision_rate, suffix: '%', hBetter: false },
  ];
  return (
    <View className={`mt-8 ${className || ''}`}>
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
                <View className={`flex-row items-center px-3 py-1 rounded-full ${isPositive ? 'bg-state-success-dim' : 'bg-state-danger-dim'}`}>
                  <FontAwesome name={change >= 0 ? 'caret-up' : 'caret-down'} size={12} color={isPositive ? 'var(--color-success)' : 'var(--color-danger)'} style={{ marginRight: 8 }} />
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

export const SLARiskAlertMiniWeb = ({ data, onViewAll, className }: { data: any, onViewAll: () => void, className?: string }) => {
  const count = data?.sla_risks?.length || 0;
  if (count === 0) return null;

  return (
    <View className={`bg-state-danger-dim border border-state-danger/20 p-6 rounded-2xl flex-row items-center justify-between mb-4 ${className || ''}`}>
      <View className="flex-row items-center gap-4">
        <View className="w-10 h-10 rounded-full bg-state-danger-dim items-center justify-center border border-state-danger/10">
          <FontAwesome name="warning" size={16} color="var(--color-danger)" />
        </View>
        <View>
          <Text className="text-state-danger font-black text-sm">SLA Risks</Text>
          <Text className="text-typography-main font-bold text-base">{count} active tasks in risk!</Text>
        </View>
      </View>
      <TouchableOpacity onPress={onViewAll} className="bg-state-danger px-4 py-2 rounded-xl active:scale-95 transition-all">
        <Text className="text-brand-on-primary text-[10px] font-black uppercase tracking-widest">View All</Text>
      </TouchableOpacity>
    </View>
  );
};

export const StageDurationMiniWeb = ({ data, onViewAll, className }: { data: any, onViewAll: () => void, className?: string }) => {
  const slowStages = data?.stage_duration_analysis?.filter((s: any) => s.avg_duration_days > 2.5).length || 0;
  
  return (
    <View className={`bg-surface-card p-6 rounded-2xl border border-surface-border flex-row items-center justify-between mb-4 ${className || ''}`}>
      <View className="flex-row items-center gap-4">
        <View className="w-10 h-10 rounded-full bg-brand-primary-dim items-center justify-center">
          <FontAwesome name="clock-o" size={16} color="var(--color-primary)" />
        </View>
        <View>
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Stage Durations</Text>
          <Text className="text-typography-main font-bold text-base">
            {slowStages > 0 ? `${slowStages} stages exceeding target` : 'All stages within target'}
          </Text>
        </View>
      </View>
      <TouchableOpacity onPress={onViewAll} className="bg-surface-overlay border border-surface-border px-4 py-2 rounded-xl active:scale-95 transition-all">
        <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">View All</Text>
      </TouchableOpacity>
    </View>
  );
};

export const ConversionFunnelMiniWeb = ({ data, onViewAll, className }: { data: any, onViewAll: () => void, className?: string }) => {
  const stages = data?.conversion_by_stage || [];
  const overallRetention = stages.length > 0 ? (stages[stages.length - 1].completion_rate * 100).toFixed(0) : '0';
  
  return (
    <View className={`bg-surface-card p-6 rounded-2xl border border-surface-border flex-row items-center justify-between mb-4 ${className || ''}`}>
      <View className="flex-row items-center gap-4">
        <View className="w-10 h-10 rounded-full bg-state-success-dim items-center justify-center">
          <FontAwesome name="filter" size={16} color="var(--color-success)" />
        </View>
        <View>
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Task Funnel</Text>
          <Text className="text-typography-main font-bold text-base">Overall Retention: {overallRetention}%</Text>
        </View>
      </View>
      <TouchableOpacity onPress={onViewAll} className="bg-surface-overlay border border-surface-border px-4 py-2 rounded-xl active:scale-95 transition-all">
        <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">View All</Text>
      </TouchableOpacity>
    </View>
  );
};

export const TrendComparisonMiniWeb = ({ data, onViewAll, className }: { data: any, onViewAll: () => void, className?: string }) => {
  const curThr = data?.current?.throughput || 0;
  const prevThr = data?.comparison?.throughput || 0;
  const change = curThr - prevThr;
  const isPositive = change >= 0;

  return (
    <View className={`bg-surface-card p-6 rounded-2xl border border-surface-border flex-row items-center justify-between ${className || ''}`}>
      <View className="flex-row items-center gap-4">
        <View className="w-10 h-10 rounded-full bg-brand-primary-dim items-center justify-center">
          <FontAwesome name="line-chart" size={16} color="var(--color-primary)" />
        </View>
        <View>
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Performance Trends</Text>
          <View className="flex-row items-center gap-2">
            <Text className="text-typography-main font-bold text-base">Throughput: {curThr} units</Text>
            <View className={`px-2 py-0.5 rounded-full ${isPositive ? 'bg-state-success-dim' : 'bg-state-danger-dim'}`}>
              <Text className={`text-[9px] font-black ${isPositive ? 'text-state-success' : 'text-state-danger'}`}>
                {isPositive ? '+' : ''}{change}
              </Text>
            </View>
          </View>
        </View>
      </View>
      <TouchableOpacity onPress={onViewAll} className="bg-surface-overlay border border-surface-border px-4 py-2 rounded-xl active:scale-95 transition-all">
        <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">View All</Text>
      </TouchableOpacity>
    </View>
  );
};

export const ThroughputOverTimeMiniWeb = ({ pipelines, onViewAll, className }: { pipelines: any[], onViewAll: () => void, className?: string }) => {
  const { getPipelineThroughput } = useAnalytics();
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [periodOpt, setPeriodOpt] = useState({ label: '8W', type: 'week', n: 8 });
  const [throughput, setThroughput] = useState<ThroughputPeriod[]>([]);
  const [loading, setLoading] = useState(false);

  const PERIOD_OPTS = [
    { label: '4W', type: 'week', n: 4 },
    { label: '8W', type: 'week', n: 8 },
    { label: '6M', type: 'month', n: 6 },
  ];

  useEffect(() => {
    if (pipelines.length > 0 && !pipelineId) {
      setPipelineId(pipelines[0].id);
    }
  }, [pipelines]);

  const load = useCallback(async () => {
    if (!pipelineId) return;
    setLoading(true);
    try {
      const t = await getPipelineThroughput(pipelineId, periodOpt.type as any, periodOpt.n);
      setThroughput(t || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [pipelineId, periodOpt]);

  useEffect(() => {
    load();
  }, [load]);

  const chartData = throughput.map(t => ({
    label: t.period_label,
    succeeded: t.tasks_succeeded,
    failed: t.tasks_failed,
    success_rate: t.success_rate ?? 0,
  }));

  const tooltipStyle = {
    backgroundColor: 'var(--color-card)',
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    fontSize: 10,
    color: 'var(--color-text-main)',
  };

  return (
    <View className={`bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow mb-4 ${className || ''}`}>
      <View className="flex-row justify-between items-start mb-6">
        <View>
          <Text className="text-typography-main font-black text-xl tracking-tight">Throughput Over Time</Text>
          <Text className="text-typography-muted text-xs mt-1">Operational velocity and completion health</Text>
        </View>
        <TouchableOpacity onPress={onViewAll} className="bg-surface-overlay border border-surface-border px-5 py-2 rounded-xl active:scale-95 transition-all">
          <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">View All</Text>
        </TouchableOpacity>
      </View>

      <View className="flex-row justify-between items-center mb-8">
        <View className="flex-row gap-2">
          <View className="flex-row bg-surface-background border border-surface-border rounded-lg p-0.5">
            {pipelines.slice(0, 3).map(p => (
              <TouchableOpacity
                key={p.id}
                onPress={() => setPipelineId(p.id)}
                className={`px-3 py-1.5 rounded-md transition-all ${pipelineId === p.id ? 'bg-brand-primary premium-shadow' : ''}`}
              >
                <Text className={`text-[9px] font-black uppercase ${pipelineId === p.id ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View className="flex-row bg-surface-background border border-surface-border rounded-lg p-0.5">
            {PERIOD_OPTS.map(opt => (
              <TouchableOpacity
                key={opt.label}
                onPress={() => setPeriodOpt(opt)}
                className={`px-3 py-1.5 rounded-md transition-all ${periodOpt.label === opt.label ? 'bg-brand-primary premium-shadow' : ''}`}
              >
                <Text className={`text-[9px] font-black uppercase ${periodOpt.label === opt.label ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View className="flex-row gap-4 items-center">
          <View className="flex-row items-center gap-1.5">
            <View className="w-2.5 h-2.5 rounded bg-state-success" />
            <Text className="text-typography-muted text-[9px] font-bold uppercase">Success</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="w-2.5 h-2.5 rounded bg-state-danger" />
            <Text className="text-typography-muted text-[9px] font-bold uppercase">Failed</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="w-6 h-0.5 bg-brand-primary rounded-full" />
            <Text className="text-typography-muted text-[9px] font-bold uppercase">Rate %</Text>
          </View>
        </View>
      </View>

      <View style={{ height: 220 }}>
        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="small" color="var(--color-primary)" />
          </View>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-border)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'var(--color-text-dim)' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fontSize: 9, fill: 'var(--color-text-dim)' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 9, fill: 'var(--color-text-dim)' }} axisLine={false} tickLine={false} unit="%" />
              <RechartTooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--color-surface-overlay)', opacity: 0.05 }} />
              <Bar yAxisId="l" dataKey="succeeded" fill="var(--color-success)" name="Success" radius={[3, 3, 0, 0]} maxBarSize={30} />
              <Bar yAxisId="l" dataKey="failed"    fill="var(--color-danger)" name="Failed"  radius={[3, 3, 0, 0]} maxBarSize={30} />
              <Line yAxisId="r" type="monotone" dataKey="success_rate" stroke="var(--color-primary)" strokeWidth={2} dot={{ r: 3, fill: 'var(--color-primary)' }} name="Rate" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
            <View className="flex-1 items-center justify-center opacity-50">
              <FontAwesome name="bar-chart" size={24} color="var(--color-text-dim)" />
              <Text className="text-typography-muted text-xs mt-2">No throughput data recorded</Text>
            </View>
        )}
      </View>
    </View>
  );
};

export const TargetsMiniWeb = ({ onViewAll, className }: { onViewAll: () => void, className?: string }) => {
  const { getTargetsStatus } = useAnalytics();
  const [targets, setTargets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await getTargetsStatus();
        const filtered = data.filter(t => t.status === 'hit' || t.status === 'expired');
        setTargets(filtered);
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [getTargetsStatus]);

  if (loading || targets.length === 0) return null;

  const hitCount = targets.filter(t => t.status === 'hit').length;
  const expiredCount = targets.filter(t => t.status === 'expired').length;

  return (
    <View className={`bg-surface-card p-6 rounded-2xl border border-surface-border flex-row items-center justify-between mb-4 ${className || ''}`}>
      <View className="flex-row items-center gap-4">
        <View className={`w-10 h-10 rounded-full items-center justify-center ${expiredCount > 0 ? 'bg-state-danger-dim' : 'bg-state-success-dim'}`}>
          <FontAwesome name="bullseye" size={16} color={expiredCount > 0 ? 'var(--color-danger)' : 'var(--color-success)'} />
        </View>
        <View>
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Active Targets</Text>
          <View className="flex-row items-center gap-2">
            <Text className="text-typography-main font-bold text-base">
              {hitCount > 0 && `${hitCount} Hit`}
              {hitCount > 0 && expiredCount > 0 && ' • '}
              {expiredCount > 0 && `${expiredCount} Expired`}
            </Text>
          </View>
        </View>
      </View>
      <TouchableOpacity onPress={onViewAll} className="bg-surface-overlay border border-surface-border px-4 py-2 rounded-xl active:scale-95 transition-all">
        <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">View All</Text>
      </TouchableOpacity>
    </View>
  );
};

export const StageDwellChartWeb = ({ data, onViewDetails, className }: { data: StageDwell[], onViewDetails?: () => void, className?: string }) => {
  if (!data || data.length === 0) {
    return (
      <View className={`bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow py-20 items-center justify-center ${className || ''}`}>
        <View className="flex-row items-center justify-between w-full absolute top-8 px-8">
          <View>
            <Text className="text-typography-main font-black text-xl tracking-tight mb-1">Stage Dwell Time</Text>
            <Text className="text-typography-muted text-xs">Avg time tasks spend at each stage</Text>
          </View>
          {onViewDetails && (
            <TouchableOpacity 
              onPress={onViewDetails}
              className="flex-row items-center gap-2 bg-surface-overlay border border-surface-border px-4 py-2 rounded-xl active:scale-95 transition-all"
            >
              <Text className="text-brand-primary font-black text-[10px] uppercase tracking-wider">Details</Text>
              <FontAwesome name="external-link" size={10} color="var(--color-primary)" />
            </TouchableOpacity>
          )}
        </View>
        <FontAwesome name="hourglass-o" size={24} color="var(--color-text-dim)" style={{ marginBottom: 16, opacity: 0.2 }} />
        <Text className="text-typography-muted text-sm font-bold">No stage activity in this period</Text>
      </View>
    );
  }

  const chartData = [...data]
    .sort((a, b) => a.stage_position - b.stage_position)
    .map(d => ({
      ...d,
      avg_minutes: parseFloat((d.avg_seconds / 60).toFixed(1)),
      fill: d.is_bottleneck ? 'var(--color-warning)'
          : (d.is_terminal && d.terminal_type === 'success') ? 'var(--color-success)'
          : d.is_terminal ? 'var(--color-danger)'
          : 'var(--color-primary)',
    }));

  return (
    <View className={`bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow ${className}`}>
      <View className="flex-row items-center justify-between mb-6">
        <View>
          <Text className="text-typography-main font-black text-xl tracking-tight mb-1">Stage Dwell Time</Text>
          <Text className="text-typography-muted text-xs">Avg time tasks spend at each stage</Text>
        </View>
        
        {onViewDetails && (
          <TouchableOpacity 
            onPress={onViewDetails}
            className="flex-row items-center gap-2 bg-surface-overlay border border-surface-border px-4 py-2 rounded-xl active:scale-95 transition-all"
          >
            <Text className="text-brand-primary font-black text-[10px] uppercase tracking-wider">Details</Text>
            <FontAwesome name="external-link" size={10} color="var(--color-primary)" />
          </TouchableOpacity>
        )}
      </View>

      <View className="flex-row items-center gap-4 mb-8">
        <View className="flex-row items-center gap-1.5">
          <View className="w-2.5 h-2.5 rounded-sm bg-state-warning" />
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">Bottleneck</Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <View className="w-2.5 h-2.5 rounded-sm bg-state-success" />
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">Success</Text>
        </View>
        <View className="flex-row items-center gap-1.5">
          <View className="w-2.5 h-2.5 rounded-sm bg-state-danger" />
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">Failure</Text>
        </View>
      </View>

      <View style={{ height: 260, width: '100%' }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-surface-border)" horizontal={false} opacity={0.3} />
            <XAxis
              type="number"
              dataKey="avg_minutes"
              tick={{ fill: 'var(--color-text-dim)', fontSize: 10, fontWeight: '700' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={v => `${v}m`}
            />
            <YAxis
              type="category"
              dataKey="stage_name"
              width={120}
              tick={{ fill: 'var(--color-text-dim)', fontSize: 10, fontWeight: '700' }}
              axisLine={false}
              tickLine={false}
            />
            <RechartTooltip content={<DwellTooltip />} cursor={{ fill: 'var(--color-surface-overlay)', opacity: 0.1 }} />
            <Bar dataKey="avg_minutes" radius={[0, 6, 6, 0]} maxBarSize={28}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </View>
    </View>
  );
};
