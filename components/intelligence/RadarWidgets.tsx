import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as RechartTooltip, XAxis, YAxis,
} from 'recharts';
import { useRouter } from 'expo-router';
import { useAnalytics, ThroughputPeriod } from '@/contexts/AnalyticsContext';
import { useState, useEffect, useCallback } from 'react';

export const SLARiskAlertWeb = ({ data }: any) => {
  const router = useRouter();
  if (!data?.sla_risks || data.sla_risks.length === 0) return null;

  return (
    <View className="mb-8 bg-surface-card border border-state-danger/30 p-8 rounded-[32px] premium-shadow">
      <View className="flex-row items-center mb-6">
        <View className="w-10 h-10 rounded-full bg-state-danger/10 items-center justify-center mr-4 border border-state-danger/20">
          <FontAwesome name="warning" size={16} color="var(--color-danger)" />
        </View>
        <View>
          <Text className="text-state-danger font-black text-lg tracking-tight">SLA Risks</Text>
          <Text className="text-typography-muted text-xs font-medium">{data.sla_risks.length} active tasks exceeding tolerance</Text>
        </View>
      </View>
      <View className="gap-3">
        {data.sla_risks.slice(0, 5).map((r: any, i: number) => (
          <View key={i} className="flex-row justify-between items-center bg-surface-background p-4 rounded-2xl border border-surface-border hover:border-state-danger/40 transition-all">
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
                <Text className="text-[9px] text-typography-dim uppercase font-black">Risk Probability</Text>
              </View>
              <TouchableOpacity 
                onPress={() => router.push(`/task/${r.id}`)}
                className="w-10 h-10 rounded-xl bg-state-danger items-center justify-center hover:opacity-90 active:scale-95 transition-all shadow-sm shadow-state-danger/20"
              >
                <FontAwesome name="chevron-right" size={12} color="white" />
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
                    <FontAwesome name="long-arrow-down" size={20} color="var(--color-text-dim)" />
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
                    <FontAwesome key={s} name={s <= stars ? 'star' : 'star-o'} size={14} color={s <= stars ? 'var(--color-warning)' : 'var(--color-text-muted)'} />
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
                  <FontAwesome name={change >= 0 ? 'caret-up' : 'caret-down'} size={12} color={isPositive ? 'var(--color-success)' : 'var(--color-danger)'} className="mr-2" />
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

export const SLARiskAlertMiniWeb = ({ data, onViewAll }: { data: any, onViewAll: () => void }) => {
  const count = data?.sla_risks?.length || 0;
  if (count === 0) return null;

  return (
    <View className="bg-state-danger/5 border border-state-danger/20 p-6 rounded-2xl flex-row items-center justify-between mb-4">
      <View className="flex-row items-center gap-4">
        <View className="w-10 h-10 rounded-full bg-state-danger/10 items-center justify-center">
          <FontAwesome name="warning" size={16} color="var(--color-danger)" />
        </View>
        <View>
          <Text className="text-state-danger font-black text-sm">SLA Risks</Text>
          <Text className="text-typography-main font-bold text-base">{count} active tasks in risk!</Text>
        </View>
      </View>
      <TouchableOpacity onPress={onViewAll} className="bg-state-danger px-4 py-2 rounded-xl">
        <Text className="text-white text-[10px] font-black uppercase tracking-widest">View All</Text>
      </TouchableOpacity>
    </View>
  );
};

export const StageDurationMiniWeb = ({ data, onViewAll }: { data: any, onViewAll: () => void }) => {
  const slowStages = data?.stage_duration_analysis?.filter((s: any) => s.avg_duration_days > 2.5).length || 0;
  
  return (
    <View className="bg-surface-card p-6 rounded-2xl border border-surface-border flex-row items-center justify-between mb-4">
      <View className="flex-row items-center gap-4">
        <View className="w-10 h-10 rounded-full bg-brand-primary/10 items-center justify-center">
          <FontAwesome name="clock-o" size={16} color="var(--color-primary)" />
        </View>
        <View>
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Stage Durations</Text>
          <Text className="text-typography-main font-bold text-base">
            {slowStages > 0 ? `${slowStages} stages exceeding target` : 'All stages within target'}
          </Text>
        </View>
      </View>
      <TouchableOpacity onPress={onViewAll} className="bg-surface-overlay border border-surface-border px-4 py-2 rounded-xl">
        <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">View All</Text>
      </TouchableOpacity>
    </View>
  );
};

export const ConversionFunnelMiniWeb = ({ data, onViewAll }: { data: any, onViewAll: () => void }) => {
  const stages = data?.conversion_by_stage || [];
  const overallRetention = stages.length > 0 ? (stages[stages.length - 1].completion_rate * 100).toFixed(0) : '0';
  
  return (
    <View className="bg-surface-card p-6 rounded-2xl border border-surface-border flex-row items-center justify-between mb-4">
      <View className="flex-row items-center gap-4">
        <View className="w-10 h-10 rounded-full bg-state-success/10 items-center justify-center">
          <FontAwesome name="filter" size={16} color="var(--color-success)" />
        </View>
        <View>
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Task Funnel</Text>
          <Text className="text-typography-main font-bold text-base">Overall Retention: {overallRetention}%</Text>
        </View>
      </View>
      <TouchableOpacity onPress={onViewAll} className="bg-surface-overlay border border-surface-border px-4 py-2 rounded-xl">
        <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">View All</Text>
      </TouchableOpacity>
    </View>
  );
};

export const TrendComparisonMiniWeb = ({ data, onViewAll }: { data: any, onViewAll: () => void }) => {
  const curThr = data?.current?.throughput || 0;
  const prevThr = data?.comparison?.throughput || 0;
  const change = curThr - prevThr;
  const isPositive = change >= 0;

  return (
    <View className="bg-surface-card p-6 rounded-2xl border border-surface-border flex-row items-center justify-between">
      <View className="flex-row items-center gap-4">
        <View className="w-10 h-10 rounded-full bg-brand-primary/10 items-center justify-center">
          <FontAwesome name="line-chart" size={16} color="var(--color-primary)" />
        </View>
        <View>
          <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Performance Trends</Text>
          <View className="flex-row items-center gap-2">
            <Text className="text-typography-main font-bold text-base">Throughput: {curThr} units</Text>
            <View className={`px-2 py-0.5 rounded-full ${isPositive ? 'bg-state-success/10' : 'bg-state-danger/10'}`}>
              <Text className={`text-[9px] font-black ${isPositive ? 'text-state-success' : 'text-state-danger'}`}>
                {isPositive ? '+' : ''}{change}
              </Text>
            </View>
          </View>
        </View>
      </View>
      <TouchableOpacity onPress={onViewAll} className="bg-surface-overlay border border-surface-border px-4 py-2 rounded-xl">
        <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">View All</Text>
      </TouchableOpacity>
    </View>
  );
};

export const ThroughputOverTimeMiniWeb = ({ pipelines, onViewAll }: { pipelines: any[], onViewAll: () => void }) => {
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
    backgroundColor: 'rgb(var(--surface-card))',
    border: '1px solid rgb(var(--surface-border))',
    borderRadius: 12,
    fontSize: 10,
    color: 'rgb(var(--text-main))',
  };

  return (
    <View className="bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow mb-4">
      {/* Header Row */}
      <View className="flex-row justify-between items-start mb-6">
        <View>
          <Text className="text-typography-main font-black text-xl tracking-tight">Throughput Over Time</Text>
          <Text className="text-typography-muted text-xs mt-1">Operational velocity and completion health</Text>
        </View>
        <TouchableOpacity onPress={onViewAll} className="bg-surface-overlay border border-surface-border px-5 py-2 rounded-xl">
          <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">View All</Text>
        </TouchableOpacity>
      </View>

      {/* Mini Selectors Row */}
      <View className="flex-row justify-between items-center mb-8">
        <View className="flex-row gap-2">
          {/* Pipeline Mini Buttons */}
          <View className="flex-row bg-surface-background border border-surface-border rounded-lg p-0.5">
            {pipelines.slice(0, 3).map(p => (
              <TouchableOpacity
                key={p.id}
                onPress={() => setPipelineId(p.id)}
                className={`px-3 py-1.5 rounded-md ${pipelineId === p.id ? 'bg-brand-primary' : ''}`}
              >
                <Text className={`text-[9px] font-black uppercase ${pipelineId === p.id ? 'text-white' : 'text-typography-muted'}`}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {/* Period Mini Buttons */}
          <View className="flex-row bg-surface-background border border-surface-border rounded-lg p-0.5">
            {PERIOD_OPTS.map(opt => (
              <TouchableOpacity
                key={opt.label}
                onPress={() => setPeriodOpt(opt)}
                className={`px-3 py-1.5 rounded-md ${periodOpt.label === opt.label ? 'bg-brand-primary' : ''}`}
              >
                <Text className={`text-[9px] font-black uppercase ${periodOpt.label === opt.label ? 'text-white' : 'text-typography-muted'}`}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Legend */}
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
            <View className="w-6 h-0.5 bg-brand-primary" />
            <Text className="text-typography-muted text-[9px] font-bold uppercase">Rate %</Text>
          </View>
        </View>
      </View>

      <View style={{ height: 220 }}>
        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="small" color="rgb(var(--brand-primary))" />
          </View>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.1)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: 'rgb(var(--text-muted))' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fontSize: 9, fill: 'rgb(var(--text-muted))' }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 9, fill: 'rgb(var(--text-muted))' }} axisLine={false} tickLine={false} unit="%" />
              <RechartTooltip contentStyle={tooltipStyle} cursor={{ fill: 'rgba(var(--brand-primary), 0.05)' }} />
              <Bar yAxisId="l" dataKey="succeeded" fill="#10B981" name="Success" radius={[3, 3, 0, 0]} maxBarSize={30} />
              <Bar yAxisId="l" dataKey="failed" fill="#EF4444" name="Failed" radius={[3, 3, 0, 0]} maxBarSize={30} />
              <Line yAxisId="r" type="monotone" dataKey="success_rate" stroke="rgb(var(--brand-primary))" strokeWidth={2} dot={{ r: 3, fill: 'rgb(var(--brand-primary))' }} name="Rate" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <View className="flex-1 items-center justify-center opacity-50">
            <FontAwesome name="bar-chart" size={24} color="rgb(var(--text-dim))" />
            <Text className="text-typography-muted text-xs mt-2">No throughput data recorded</Text>
          </View>
        )}
      </View>
    </View>
  );
};

export const TargetsMiniWeb = ({ onViewAll }: { onViewAll: () => void }) => {
  const { getTargetsStatus } = useAnalytics();
  const [targets, setTargets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const data = await getTargetsStatus();
        // Only show hit or expired
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
    <View className="bg-surface-card p-6 rounded-2xl border border-surface-border flex-row items-center justify-between mb-4">
      <View className="flex-row items-center gap-4">
        <View className={`w-10 h-10 rounded-full items-center justify-center ${expiredCount > 0 ? 'bg-state-danger/10' : 'bg-state-success/10'}`}>
          <FontAwesome name="bullseye" size={16} color={expiredCount > 0 ? 'rgb(var(--state-danger))' : 'rgb(var(--state-success))'} />
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
      <TouchableOpacity onPress={onViewAll} className="bg-surface-overlay border border-surface-border px-4 py-2 rounded-xl">
        <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">View All</Text>
      </TouchableOpacity>
    </View>
  );
};
