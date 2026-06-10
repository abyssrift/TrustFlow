import { PipelinePointsPeriod, StageDwell, ThroughputPeriod, useAnalytics } from '@/contexts/AnalyticsContext';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Text, TouchableOpacity, View } from 'react-native';
import {
    Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line,
    Tooltip as RechartTooltip,
    ResponsiveContainer,
    XAxis, YAxis,
} from 'recharts';
import { useThemeColors } from '@/hooks/useThemeColors';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDwell(s: number): string {
  if (s <= 0) return '0s';
  if (s < 60) return `${Math.round(s)}s`;
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

const DwellTooltip = ({ active, payload, mode }: any) => {
  const colors = useThemeColors();
  if (!active || !payload?.length) return null;
  const d: StageDwell = payload[0]?.payload;
  const totalSeconds   = (d.avg_seconds || 0) * (d.sample_count || 0);
  const observations   = Math.max(d.sample_count || 0, Math.ceil(totalSeconds / 3600));
  return (
    <View className="bg-surface-card border border-surface-border rounded-xl p-3 gap-1 shadow-xl">
      <Text className="text-typography-main font-black text-sm">{d.stage_name}</Text>
      <div className="h-px bg-surface-border my-1" />
      {mode === 'snapshot' ? (
        <>
          <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Accumulated Load</Text>
          <Text className="text-typography-main text-xs font-black">Total: <Text className="text-brand-primary">{fmtDwell(totalSeconds)}</Text></Text>
          <Text className="text-typography-muted text-[10px]">Avg per task: {fmtDwell(d.avg_seconds)}</Text>
          <View className="flex-row items-center gap-2 mt-1">
            <Text className="text-typography-muted text-[9px] font-bold">{observations} task-hrs</Text>
            <View className="w-1 h-1 rounded-full bg-surface-border" />
            <Text className="text-typography-muted text-[9px] font-bold">{d.sample_count} tasks</Text>
          </View>
        </>
      ) : (
        <>
          <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest">Performance Metrics</Text>
          <Text className="text-typography-main text-xs font-black">Avg: <Text className="text-brand-primary">{fmtDwell(d.avg_seconds)}</Text></Text>
          <Text className="text-typography-muted text-[10px]">Median: {fmtDwell(d.median_seconds)}</Text>
          <Text className="text-typography-muted text-[10px]">P75: {fmtDwell(d.p75_seconds)}</Text>
          <View className="flex-row items-center gap-2 mt-1">
            <Text className="text-typography-muted text-[9px] font-bold">{d.sample_count} samples</Text>
            <View className="w-1 h-1 rounded-full bg-surface-border" />
            <Text className="text-typography-muted text-[9px] font-bold">{d.reversal_count} reversals</Text>
          </View>
        </>
      )}
      {d.is_bottleneck && (
        <View className="mt-2 bg-state-warning-dim border border-state-warning/20 px-2 py-1 rounded-md">
          <Text className="text-state-warning text-[9px] font-black uppercase">⚠ Bottleneck Detected</Text>
        </View>
      )}
    </View>
  );
};


export const SLARiskAlertWeb = ({ data, className }: { data: any, className?: string }) => {
  const colors = useThemeColors();
  const router = useRouter();
  const [showInfo, setShowInfo] = useState(false);
  if (!data?.sla_risks || data.sla_risks.length === 0) return null;

  const stageBaselines: { name: string; avg: number }[] = Object.values(
    (data.sla_risks as any[]).reduce((acc: Record<string, { name: string; avg: number }>, r: any) => {
      if (!acc[r.stage_name] && r.avg_seconds > 0) acc[r.stage_name] = { name: r.stage_name, avg: r.avg_seconds };
      return acc;
    }, {})
  );

  return (
    <View className={`mb-8 bg-surface-card border border-state-danger/30 p-8 rounded-[32px] premium-shadow ${className || ''}`}>
      <View className="flex-row items-center mb-6">
        <View className="w-10 h-10 rounded-full bg-state-danger-dim items-center justify-center mr-4 border border-state-danger/20">
          <FontAwesome name="warning" size={16} color={colors.danger} />
        </View>
        <View className="flex-1 flex-row items-center justify-between">
          <View>
            <Text className="text-state-danger font-black text-lg tracking-tight">SLA Risks</Text>
            <Text className="text-typography-muted text-xs font-medium">{data.sla_risks.length} active tasks exceeding tolerance</Text>
          </View>
          <TouchableOpacity
            onPress={() => setShowInfo(v => !v)}
            className={`w-8 h-8 rounded-full items-center justify-center border transition-all ${showInfo ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
          >
            <FontAwesome name="question" size={12} color={showInfo ? 'var(--color-on-primary)' : colors.textDim} />
          </TouchableOpacity>
        </View>
      </View>

      {showInfo && (
        <View className="mb-6 bg-surface-background border border-surface-border rounded-2xl p-5 gap-3">
          <Text className="text-typography-main font-black text-sm">What is SLA Risk?</Text>
          <Text className="text-typography-muted text-xs leading-relaxed">
            Each pipeline stage has a learned baseline from historical data. A task becomes at risk when it has been in its current stage for more than{' '}
            <Text className="text-state-danger font-bold">1.5× the stage average</Text>.
            Risk % shows how far past that threshold the task is, capped at 99%.
          </Text>
          {stageBaselines.length > 0 && (
            <>
              <View className="h-px bg-surface-border" />
              <Text className="text-typography-muted text-[10px] font-black uppercase tracking-widest">Stage Baselines (Affected)</Text>
              <View className="gap-2">
                {stageBaselines.map((s, i) => (
                  <View key={i} className="flex-row justify-between items-center">
                    <Text className="text-typography-main text-xs font-bold">{s.name}</Text>
                    <View className="flex-row items-center gap-3">
                      <View className="flex-row items-center gap-1">
                        <Text className="text-typography-muted text-[10px]">avg</Text>
                        <Text className="text-brand-primary font-black text-xs">{fmtDwell(s.avg)}</Text>
                      </View>
                      <View className="w-px h-3 bg-surface-border" />
                      <View className="flex-row items-center gap-1">
                        <Text className="text-typography-muted text-[10px]">threshold</Text>
                        <Text className="text-state-danger font-black text-xs">{fmtDwell(s.avg * 1.5)}</Text>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
        </View>
      )}

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

export const ConversionFunnelChartWeb = ({ data, className }: { data: any, className?: string }) => {
  const colors = useThemeColors();
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
                  <FontAwesome name="long-arrow-down" size={20} color={colors.textDim} />
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
  const colors = useThemeColors();
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
  const colors = useThemeColors();
  if (!data?.quality_by_worker) return null;

  const MIN_TASKS = 3;

  const allWorkers = data.quality_by_worker
    .map((w: any) => ({
      ...w,
      integrityScore: Math.max(0, 100 - (w.revision_rate || 0)),
    }))
    // Primary: integrity score desc. Tiebreaker: task volume desc.
    .sort((a: any, b: any) => b.integrityScore - a.integrityScore || b.total_tasks - a.total_tasks);

  const qualified = allWorkers.filter((w: any) => w.total_tasks >= MIN_TASKS);
  const workers = qualified.slice(0, 6);
  const filteredOutCount = allWorkers.length - qualified.length;
  const allPerfect = workers.length > 0 && workers.every((w: any) => w.integrityScore === 100);
  const maxTasks = allPerfect ? Math.max(...workers.map((w: any) => w.total_tasks)) : 0;

  return (
    <View className={`bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow ${className || ''}`}>
      {/* Header */}
      <View className="flex-row justify-between items-start mb-6">
        <View className="flex-1 mr-4">
          <Text className="text-typography-muted text-xs font-bold tracking-widest uppercase mb-1">Performance Matrix</Text>
          <Text className="text-typography-main text-3xl font-black">Quality Integrity</Text>
          <Text className="text-typography-muted text-[11px] mt-2 leading-relaxed max-w-[480px]">
            Integrity measures first-pass accuracy. It is calculated as{' '}
            <Text className="text-brand-primary font-bold">100% minus the Rework Rate</Text>.{' '}
            {allPerfect && workers.length > 0
              ? 'All contributors are tied — ranked by task volume.'
              : 'A higher score indicates tasks completed without requiring revisions.'}
          </Text>
        </View>
        <View className="items-end gap-2">
          <View className="bg-brand-primary-dim px-4 py-2 rounded-xl border border-brand-primary/20">
            <Text className="text-brand-primary font-bold text-sm">Top Contributors</Text>
          </View>
          {filteredOutCount > 0 && (
            <View className="flex-row items-center gap-1.5 px-3 py-1.5 bg-surface-background border border-surface-border rounded-xl">
              <FontAwesome name="filter" size={9} color={colors.textDim} />
              <Text className="text-typography-dim text-[9px] font-black uppercase tracking-widest">
                {filteredOutCount} below threshold
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Perfect integrity banner */}
      {allPerfect && (
        <View className="flex-row items-center justify-between bg-state-success-dim border border-state-success/20 px-5 py-3 rounded-2xl mb-6">
          <View className="flex-row items-center gap-3">
            <FontAwesome name="trophy" size={14} color={colors.success} />
            <Text className="text-state-success font-black text-sm">
              Perfect Integrity — Zero rework detected this period.
            </Text>
          </View>
          <Text className="text-state-success/60 text-[10px] font-bold uppercase tracking-widest">
            Ranked by volume
          </Text>
        </View>
      )}

      {/* Empty state */}
      {workers.length === 0 ? (
        <View className="py-12 items-center gap-3">
          <View className="w-14 h-14 rounded-full bg-surface-background border border-surface-border items-center justify-center">
            <FontAwesome name="bar-chart" size={20} color={colors.textDim} />
          </View>
          <Text className="text-typography-main font-black text-base">Insufficient Data</Text>
          <Text className="text-typography-muted text-xs text-center max-w-[320px]">
            No workers have completed at least {MIN_TASKS} tasks in this period. Integrity scores require a minimum sample to be meaningful.
          </Text>
        </View>
      ) : (
        <View className="flex-row flex-wrap gap-6">
          {workers.map((worker: any, idx: number) => {
            const score = worker.integrityScore;
            const stars = score === 100 ? 5 : score >= 90 ? 4 : score >= 75 ? 3 : score >= 60 ? 2 : 1;
            const isVolumeLeader = allPerfect && worker.total_tasks === maxTasks;

            const colorClass = score === 100 ? 'bg-state-success' : score >= 75 ? 'bg-state-warning' : 'bg-state-danger';
            const bgDimClass = score === 100 ? 'bg-state-success-dim' : score >= 75 ? 'bg-state-warning-dim' : 'bg-state-danger-dim';
            const textClass = score === 100 ? 'text-state-success' : score >= 75 ? 'text-state-warning' : 'text-state-danger';
            const borderClass = score === 100 ? 'border-state-success/20' : score >= 75 ? 'border-state-warning/20' : 'border-state-danger/20';

            // When all are tied, show task volume bar instead of flat 100% bar
            const barWidth = allPerfect ? (worker.total_tasks / (maxTasks || 1)) * 100 : score;

            return (
              <View
                key={idx}
                className={`flex-1 min-w-[300px] bg-surface-background p-6 rounded-2xl border transition-all duration-300 ${
                  isVolumeLeader
                    ? 'border-state-success/40 hover:border-state-success/60'
                    : 'border-surface-border/50 hover:border-brand-primary/30'
                }`}
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
                    <View className="flex-1">
                      <Text className="text-typography-main font-black text-base" numberOfLines={1}>
                        {worker.full_name || 'Anonymous User'}
                      </Text>
                      {isVolumeLeader && (
                        <Text className="text-state-success text-[9px] font-black uppercase tracking-widest">
                          Volume Leader
                        </Text>
                      )}
                    </View>
                  </View>

                  <View className="flex-row gap-1">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <FontAwesome
                        key={s}
                        name={s <= stars ? 'star' : 'star-o'}
                        size={14}
                        color={s <= stars ? colors.warning : colors.textDim}
                      />
                    ))}
                  </View>
                </View>

                <View className="gap-3">
                  <View className="flex-row justify-between items-end">
                    <Text className="text-typography-muted text-xs font-bold uppercase">
                      {allPerfect ? 'Task Volume' : 'Integrity Score'}
                    </Text>
                    <Text className={`${textClass} text-xl font-black`}>
                      {allPerfect ? `${worker.total_tasks} tasks` : `${score.toFixed(1)}%`}
                    </Text>
                  </View>

                  <View className="h-2 bg-surface-card rounded-full overflow-hidden">
                    <View
                      className={`h-full ${colorClass}`}
                      style={{ width: `${barWidth}%` }}
                    />
                  </View>

                  <View className="flex-row justify-between items-center pt-2">
                    <View className="flex-row items-center gap-1.5">
                      <FontAwesome name="wrench" size={10} color={colors.textDim} />
                      <Text className="text-typography-muted text-[10px] font-bold uppercase">
                        {(worker.revision_rate || 0).toFixed(1)}% Rework
                      </Text>
                    </View>
                    <View className="flex-row items-center gap-1.5">
                      <FontAwesome name="check-circle" size={10} color={colors.textDim} />
                      <Text className="text-typography-muted text-[10px] font-bold uppercase">
                        {allPerfect ? `${score.toFixed(0)}% integrity` : `${worker.total_tasks || 0} Tasks`}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
};

export const TrendComparisonCardsWeb = ({ data, className }: { data: any, className?: string }) => {
  const colors = useThemeColors();
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
                  <FontAwesome name={change >= 0 ? 'caret-up' : 'caret-down'} size={12} color={isPositive ? colors.success : colors.danger} style={{ marginRight: 8 }} />
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
  const colors = useThemeColors();
  const count = data?.sla_risks?.length || 0;
  if (count === 0) return null;

  return (
    <View className={`bg-state-danger-dim border border-state-danger/20 p-6 rounded-2xl flex-row items-center justify-between mb-4 ${className || ''}`}>
      <View className="flex-row items-center gap-4">
        <View className="w-10 h-10 rounded-full bg-state-danger-dim items-center justify-center border border-state-danger/10">
          <FontAwesome name="warning" size={16} color={colors.danger} />
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
  const colors = useThemeColors();
  const slowStages = data?.stage_duration_analysis?.filter((s: any) => s.avg_duration_days > 2.5).length || 0;
  
  return (
    <View className={`bg-surface-card p-6 rounded-2xl border border-surface-border flex-row items-center justify-between mb-4 ${className || ''}`}>
      <View className="flex-row items-center gap-4">
        <View className="w-10 h-10 rounded-full bg-brand-primary-dim items-center justify-center">
          <FontAwesome name="clock-o" size={16} color={colors.primary} />
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
  const colors = useThemeColors();
  const stages = data?.conversion_by_stage || [];
  const overallRetention = stages.length > 0 ? (stages[stages.length - 1].completion_rate * 100).toFixed(0) : '0';
  
  return (
    <View className={`bg-surface-card p-6 rounded-2xl border border-surface-border flex-row items-center justify-between mb-4 ${className || ''}`}>
      <View className="flex-row items-center gap-4">
        <View className="w-10 h-10 rounded-full bg-state-success-dim items-center justify-center">
          <FontAwesome name="filter" size={16} color={colors.success} />
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
  const colors = useThemeColors();
  const curThr = data?.current?.throughput || 0;
  const prevThr = data?.comparison?.throughput || 0;
  const change = curThr - prevThr;
  const isPositive = change >= 0;

  return (
    <View className={`bg-surface-card p-6 rounded-2xl border border-surface-border flex-row items-center justify-between ${className || ''}`}>
      <View className="flex-row items-center gap-4">
        <View className="w-10 h-10 rounded-full bg-brand-primary-dim items-center justify-center">
          <FontAwesome name="line-chart" size={16} color={colors.primary} />
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

export const ThroughputOverTimeMiniWeb = ({ pipelines, days, onViewAll, className }: { pipelines: any[], days: number, onViewAll: () => void, className?: string }) => {
  const colors = useThemeColors();
  const { getPipelineThroughput } = useAnalytics();
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [throughput, setThroughput] = useState<ThroughputPeriod[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (pipelines.length > 0 && !pipelineId) {
      setPipelineId(pipelines[0].id);
    }
  }, [pipelines]);

  const load = useCallback(async () => {
    if (!pipelineId) return;
    setLoading(true);
    try {
      const { periodType, nPeriods } = daysToParams(days);
      const t = await getPipelineThroughput(pipelineId, periodType, nPeriods);
      setThroughput(t || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [pipelineId, days]);

  useEffect(() => {
    load();
  }, [load]);

  const chartData = [...throughput].reverse().map(t => ({
    label: t.period_label,
    succeeded: t.tasks_succeeded,
    failed: t.tasks_failed,
    success_rate: t.success_rate ?? 0,
  }));

  const tooltipStyle = {
    backgroundColor: colors.card,
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    fontSize: 10,
    color: colors.textMain,
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
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} barGap={4}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: colors.textDim }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="l" tick={{ fontSize: 9, fill: colors.textDim }} axisLine={false} tickLine={false} />
              <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 9, fill: colors.textDim }} axisLine={false} tickLine={false} unit="%" />
              <RechartTooltip contentStyle={tooltipStyle} cursor={{ fill: colors.card, opacity: 0.05 }} />
              <Bar yAxisId="l" dataKey="succeeded" fill={colors.success} name="Success" radius={[3, 3, 0, 0]} maxBarSize={30} />
              <Bar yAxisId="l" dataKey="failed"    fill={colors.danger} name="Failed"  radius={[3, 3, 0, 0]} maxBarSize={30} />
              <Line yAxisId="r" type="monotone" dataKey="success_rate" stroke={colors.primary} strokeWidth={2} dot={{ r: 3, fill: colors.primary }} name="Rate" />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
            <View className="flex-1 items-center justify-center opacity-50">
              <FontAwesome name="bar-chart" size={24} color={colors.textDim} />
              <Text className="text-typography-muted text-xs mt-2">No throughput data recorded</Text>
            </View>
        )}
      </View>
    </View>
  );
};

export const TargetsMiniWeb = ({ onViewAll, className }: { onViewAll: () => void, className?: string }) => {
  const colors = useThemeColors();
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
          <FontAwesome name="bullseye" size={16} color={expiredCount > 0 ? colors.danger : colors.success} />
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
  const colors = useThemeColors();
  const [mode, setMode] = useState<'avg' | 'snapshot'>('avg');

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
              <FontAwesome name="external-link" size={10} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>
        <FontAwesome name="hourglass-o" size={24} color={colors.textDim} style={{ marginBottom: 16, opacity: 0.2 }} />
        <Text className="text-typography-muted text-sm font-bold">No stage activity in this period</Text>
      </View>
    );
  }

  const chartData = [...data]
    .sort((a, b) => a.stage_position - b.stage_position)
    .map(d => ({
      ...d,
      avg_minutes:   parseFloat((d.avg_seconds / 60).toFixed(1)),
      total_hours:   parseFloat(((d.avg_seconds * d.sample_count) / 3600).toFixed(2)),
      fill: d.is_bottleneck ? colors.warning
          : (d.is_terminal && d.terminal_type === 'success') ? colors.success
          : d.is_terminal ? colors.danger
          : colors.primary,
    }));

  const isSnapshot  = mode === 'snapshot';
  const barKey      = isSnapshot ? 'total_hours'  : 'avg_minutes';
  const axisFormatter = isSnapshot
    ? (v: number) => fmtDwell(v * 3600)
    : (v: number) => fmtDwell(v * 60);

  return (
    <View className={`bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow ${className}`}>
      <View className="flex-row items-center justify-between mb-6">
        <View>
          <Text className="text-typography-main font-black text-xl tracking-tight mb-1">Stage Dwell Time</Text>
          <Text className="text-typography-muted text-xs">
            {isSnapshot ? 'Total accumulated task-time per stage' : 'Avg time tasks spend at each stage'}
          </Text>
        </View>

        <View className="flex-row items-center gap-2">
          <View className="flex-row bg-surface-overlay border border-surface-border rounded-xl overflow-hidden">
            <TouchableOpacity
              onPress={() => setMode('avg')}
              className={`px-3 py-1.5 transition-all ${!isSnapshot ? 'bg-brand-primary' : ''}`}
            >
              <Text className={`text-[9px] font-black uppercase tracking-wider ${!isSnapshot ? 'text-white' : 'text-typography-muted'}`}>Avg</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setMode('snapshot')}
              className={`px-3 py-1.5 transition-all ${isSnapshot ? 'bg-brand-primary' : ''}`}
            >
              <Text className={`text-[9px] font-black uppercase tracking-wider ${isSnapshot ? 'text-white' : 'text-typography-muted'}`}>Snapshot</Text>
            </TouchableOpacity>
          </View>
          {onViewDetails && (
            <TouchableOpacity
              onPress={onViewDetails}
              className="flex-row items-center gap-2 bg-surface-overlay border border-surface-border px-4 py-2 rounded-xl active:scale-95 transition-all"
            >
              <Text className="text-brand-primary font-black text-[10px] uppercase tracking-wider">Details</Text>
              <FontAwesome name="external-link" size={10} color={colors.primary} />
            </TouchableOpacity>
          )}
        </View>
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
            <CartesianGrid strokeDasharray="3 3" stroke={colors.border} horizontal={false} opacity={0.3} />
            <XAxis
              type="number"
              dataKey={barKey}
              tick={{ fill: colors.textDim, fontSize: 10, fontWeight: '700' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={axisFormatter}
            />
            <YAxis
              type="category"
              dataKey="stage_name"
              width={120}
              tick={{ fill: colors.textDim, fontSize: 10, fontWeight: '700' }}
              axisLine={false}
              tickLine={false}
            />
            <RechartTooltip content={(props) => <DwellTooltip {...props} mode={mode} />} cursor={{ fill: colors.card, opacity: 0.1 }} />
            <Bar dataKey={barKey} radius={[0, 6, 6, 0]} maxBarSize={28}>
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

// ─── Pipeline Points Over Time Mini Widget ────────────────────────────────────

function daysToParams(days: number): { periodType: string; nPeriods: number } {
  if (days <= 7)  return { periodType: 'week',  nPeriods: 2 };
  if (days <= 30) return { periodType: 'week',  nPeriods: 5 };
  if (days <= 60) return { periodType: 'week',  nPeriods: 9 };
  return           { periodType: 'month', nPeriods: 3 };
}

export const PipelinePointsMiniWeb = ({
  pipelines,
  days,
  onViewAll,
  className,
}: {
  pipelines: any[];
  days: number;
  onViewAll: () => void;
  className?: string;
}) => {
  const { getPipelinePointsSeries } = useAnalytics();
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [data, setData]             = useState<PipelinePointsPeriod[]>([]);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    if (pipelines.length > 0 && !pipelineId) setPipelineId(pipelines[0].id);
  }, [pipelines]);

  const load = useCallback(async () => {
    if (!pipelineId) return;
    setLoading(true);
    try {
      const { periodType, nPeriods } = daysToParams(days);
      const result = await getPipelinePointsSeries(pipelineId, periodType, nPeriods);
      setData(result || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [pipelineId, days]);

  useEffect(() => { load(); }, [load]);

  const chartData   = [...data].reverse().map(d => ({ label: d.period_label, points: d.weight_points }));
  const totalPoints = data.reduce((sum, d) => sum + (d.weight_points || 0), 0);

  const tooltipStyle = {
    backgroundColor: colors.card,
    border: '1px solid var(--color-border)',
    borderRadius: 12,
    fontSize: 10,
    color: colors.textMain,
  };

  return (
    <View className={`bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow mb-4 ${className || ''}`}>
      <View className="flex-row justify-between items-start mb-6">
        <View>
          <Text className="text-typography-main font-black text-xl tracking-tight">Points Generated</Text>
          <Text className="text-typography-muted text-xs mt-1">Weight points earned by pipeline completions</Text>
        </View>
        <TouchableOpacity onPress={onViewAll} className="bg-surface-overlay border border-surface-border px-5 py-2 rounded-xl active:scale-95 transition-all">
          <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">View All</Text>
        </TouchableOpacity>
      </View>

      <View className="flex-row justify-between items-center mb-6">
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

        <View className="flex-row items-center gap-2 bg-surface-background border border-surface-border rounded-xl px-4 py-2">
          <View className="w-2 h-2 rounded-full bg-brand-primary" />
          <Text className="text-typography-muted text-[9px] font-bold uppercase">Total</Text>
          <Text className="text-typography-main text-[11px] font-black">{totalPoints.toLocaleString()} pts</Text>
        </View>
      </View>

      <View style={{ height: 200 }}>
        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : chartData.length > 0 && chartData.some(d => d.points > 0) ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="pointsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={colors.primary} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={colors.primary} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 9, fill: colors.textDim }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: colors.textDim }} axisLine={false} tickLine={false} />
              <RechartTooltip contentStyle={tooltipStyle} cursor={{ fill: colors.card, opacity: 0.05 }} formatter={(v: any) => [`${v} pts`, 'Points']} />
              <Area type="monotone" dataKey="points" stroke={colors.primary} strokeWidth={2} fill="url(#pointsGrad)" dot={{ r: 3, fill: colors.primary }} name="Points" />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <View className="flex-1 items-center justify-center opacity-50">
            <FontAwesome name="star-o" size={24} color={colors.textDim} />
            <Text className="text-typography-muted text-xs mt-2">No points data for this period</Text>
          </View>
        )}
      </View>
    </View>
  );
};
