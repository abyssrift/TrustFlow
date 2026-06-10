import { PipelinePointsPeriod, StageDwell, ThroughputPeriod, useAnalytics } from '@/contexts/AnalyticsContext';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { useThemeColors } from '@/lib/themeColors';
import { ActivityIndicator, Image, ScrollView, Text, TouchableOpacity, View } from 'react-native';

const PERIOD_OPTS = [
  { label: '4W',  type: 'week',  n: 4  },
  { label: '8W',  type: 'week',  n: 8  },
  { label: '6M',  type: 'month', n: 6  },
  { label: '12M', type: 'month', n: 12 },
];

const fmtSec = (s: number) => {
  if (s <= 0) return '0m';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
};

// ─── SLA Risk Section ─────────────────────────────────────────────────────────

function SLARiskSection({ data }: { data: any }) {
  const colors = useThemeColors();
  const router = useRouter();
  if (!data?.sla_risks || data.sla_risks.length === 0) return null;
  return (
    <View className="bg-state-danger/5 border border-state-danger/20 p-5 rounded-2xl mb-4">
      <View className="flex-row items-center mb-4 gap-2">
        <FontAwesome name="warning" size={14} color="var(--color-danger)" />
        <Text className="text-state-danger font-black text-sm">SLA Breach Risks</Text>
        <View className="ml-auto bg-state-danger px-2 py-0.5 rounded-full">
          <Text className="text-white text-[9px] font-black">{data.sla_risks.length}</Text>
        </View>
      </View>
      {data.sla_risks.slice(0, 4).map((r: any, i: number) => (
        <TouchableOpacity
          key={i}
          onPress={() => router.push(`/task/${r.id}`)}
          className="flex-row justify-between items-center py-2.5 border-b border-state-danger/10 last:border-b-0"
        >
          <View className="flex-1">
            <Text className="text-typography-main text-xs font-bold">{r.task_number || `TASK-${r.id?.substring(0, 4)}`}</Text>
            <Text className="text-typography-muted text-[9px] uppercase">{r.stage_name}</Text>
          </View>
          <Text className="text-state-danger text-sm font-black">{r.risk_percent}%</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ─── Points Over Time Section ─────────────────────────────────────────────────

function PointsSection({ data }: { data: PipelinePointsPeriod[] }) {
  const colors = useThemeColors();
  const totalPts = data.reduce((s, d) => s + (d.weight_points || 0), 0);
  const maxPts = Math.max(1, ...data.map(d => d.weight_points || 0));

  return (
    <View className="bg-surface-card border border-surface-border rounded-2xl p-5 mb-4">
      <View className="flex-row justify-between items-start mb-4">
        <View>
          <Text className="text-typography-main font-black text-base">Points Over Time</Text>
          <Text className="text-typography-muted text-[10px] mt-0.5">Weight points from completed tasks per period</Text>
        </View>
        <View className="flex-row items-center gap-1.5 bg-surface-background border border-surface-border rounded-xl px-3 py-1.5">
          <View className="w-2 h-2 rounded-full bg-brand-primary" />
          <Text className="text-typography-main text-xs font-black">{totalPts.toLocaleString()} pts</Text>
        </View>
      </View>
      {data.length === 0 || !data.some(d => d.weight_points > 0) ? (
        <Text className="text-typography-muted text-sm">No points data for this period.</Text>
      ) : (
        [...data].reverse().slice(0, 8).map((d, i, arr) => {
          const pct = (d.weight_points / maxPts) * 100;
          return (
            <View key={i} className={`py-2.5 ${i < arr.length - 1 ? 'border-b border-surface-border/50' : ''}`}>
              <View className="flex-row justify-between items-center mb-1.5">
                <Text className="text-typography-muted text-xs">{d.period_label}</Text>
                <Text className="text-brand-primary text-xs font-black">{(d.weight_points || 0).toLocaleString()} pts</Text>
              </View>
              <View className="h-1.5 bg-surface-overlay rounded-full overflow-hidden">
                <View className="h-full bg-brand-primary rounded-full" style={{ width: `${pct}%` }} />
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

// ─── Performance Trends Section ───────────────────────────────────────────────

function TrendsSection({ data }: { data: any }) {
  const colors = useThemeColors();
  if (!data?.current || !data?.comparison) return null;
  const metrics = [
    { label: 'Throughput Delta',  val: data.current.throughput,              prev: data.comparison.throughput,              suffix: ' units', hBetter: true  },
    { label: 'Success Variance',  val: data.current.success_rate,            prev: data.comparison.success_rate,            suffix: '%',      hBetter: true  },
    { label: 'Latency Drift',     val: data.current.avg_lead_time_minutes,   prev: data.comparison.avg_lead_time_minutes,   suffix: 'm',      hBetter: false },
    { label: 'Integrity Shift',   val: data.current.revision_rate,           prev: data.comparison.revision_rate,           suffix: '%',      hBetter: false },
  ];
  return (
    <View className="mb-4">
      <Text className="text-typography-main font-black text-base mb-3">Performance Trends</Text>
      <View className="flex-row flex-wrap gap-3">
        {metrics.map((m, idx) => {
          const change = (m.val || 0) - (m.prev || 0);
          const isPositive = m.hBetter ? change >= 0 : change <= 0;
          return (
            <View key={idx} className="flex-1 min-w-[44%] bg-surface-card border border-surface-border rounded-2xl p-4">
              <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-2">{m.label}</Text>
              <Text className="text-typography-main text-xl font-black">{Math.round(m.val || 0)}{m.suffix}</Text>
              <View className={`mt-2 self-start px-2 py-0.5 rounded-full flex-row items-center gap-1 ${isPositive ? 'bg-state-success/10' : 'bg-state-danger/10'}`}>
                <FontAwesome
                  name={change >= 0 ? 'caret-up' : 'caret-down'}
                  size={10}
                  color={isPositive ? 'var(--color-success)' : 'var(--color-danger)'}
                />
                <Text className={`text-[9px] font-black ${isPositive ? 'text-state-success' : 'text-state-danger'}`}>
                  {Math.abs(Math.round(change))}{m.suffix}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Work Distribution Section ────────────────────────────────────────────────

function WorkDistributionSection({ data }: { data: any }) {
  const colors = useThemeColors();
  if (!data?.worker_engagement || data.worker_engagement.length === 0) return null;
  const workers = [...data.worker_engagement].sort((a: any, b: any) => b.action_count - a.action_count).slice(0, 6);
  const maxCount = Math.max(1, ...workers.map((w: any) => w.action_count));
  return (
    <View className="bg-surface-card border border-surface-border rounded-2xl p-5 mb-4">
      <Text className="text-typography-main font-black text-base mb-4">Team Workload</Text>
      {workers.map((w: any, idx: number) => {
        const pct = (w.action_count / maxCount) * 100;
        const overloaded = pct > 85;
        return (
          <View key={idx} className="mb-4">
            <View className="flex-row items-center mb-1.5 gap-2">
              <View className="w-7 h-7 rounded-full bg-surface-background border border-surface-border overflow-hidden items-center justify-center">
                {w.avatar_url ? (
                  <Image source={{ uri: w.avatar_url }} className="w-full h-full" />
                ) : (
                  <Text className="text-brand-primary font-black text-[9px]">
                    {(w.full_name || 'A')[0].toUpperCase()}
                  </Text>
                )}
              </View>
              <Text className="text-typography-main text-xs font-bold flex-1" numberOfLines={1}>{w.full_name || 'Agent'}</Text>
              <Text className={`text-xs font-black ${overloaded ? 'text-state-danger' : 'text-brand-primary'}`}>{w.action_count} OPS</Text>
            </View>
            <View className="h-1.5 bg-surface-overlay rounded-full overflow-hidden">
              <View
                className={`h-full rounded-full ${overloaded ? 'bg-state-danger' : 'bg-brand-primary'}`}
                style={{ width: `${pct}%` }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── Quality Integrity Section ────────────────────────────────────────────────

function QualitySection({ data }: { data: any }) {
  const colors = useThemeColors();
  if (!data?.quality_by_worker || data.quality_by_worker.length === 0) return null;
  const MIN_TASKS = 3;
  const workers = data.quality_by_worker
    .map((w: any) => ({ ...w, score: Math.max(0, 100 - (w.revision_rate || 0)) }))
    .filter((w: any) => w.total_tasks >= MIN_TASKS)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, 5);

  if (workers.length === 0) return null;

  return (
    <View className="bg-surface-card border border-surface-border rounded-2xl p-5 mb-4">
      <Text className="text-typography-main font-black text-base mb-4">Quality Integrity</Text>
      {workers.map((w: any, idx: number) => {
        const score = w.score;
        const stars = score === 100 ? 5 : score >= 90 ? 4 : score >= 75 ? 3 : score >= 60 ? 2 : 1;
        const textColor = score === 100 ? 'text-state-success' : score >= 75 ? 'text-state-warning' : 'text-state-danger';
        const barColor = score === 100 ? 'bg-state-success' : score >= 75 ? 'bg-state-warning' : 'bg-state-danger';
        return (
          <View key={idx} className={`py-3 ${idx < workers.length - 1 ? 'border-b border-surface-border/50' : ''}`}>
            <View className="flex-row items-center gap-2 mb-2">
              <View className="w-7 h-7 rounded-full bg-surface-background border border-surface-border overflow-hidden items-center justify-center">
                {w.avatar_url ? (
                  <Image source={{ uri: w.avatar_url }} className="w-full h-full" />
                ) : (
                  <Text className="text-brand-primary font-black text-[9px]">
                    {(w.full_name || 'A')[0].toUpperCase()}
                  </Text>
                )}
              </View>
              <Text className="text-typography-main text-xs font-bold flex-1" numberOfLines={1}>{w.full_name || 'Agent'}</Text>
              <View className="flex-row gap-0.5">
                {[1, 2, 3, 4, 5].map(s => (
                  <FontAwesome key={s} name={s <= stars ? 'star' : 'star-o'} size={10} color={s <= stars ? 'var(--color-warning)' : 'var(--color-text-dim)'} />
                ))}
              </View>
              <Text className={`text-sm font-black ${textColor} ml-1`}>{score.toFixed(0)}%</Text>
            </View>
            <View className="h-1.5 bg-surface-overlay rounded-full overflow-hidden">
              <View className={`h-full rounded-full ${barColor}`} style={{ width: `${score}%` }} />
            </View>
            <Text className="text-typography-dim text-[9px] mt-1">{(w.revision_rate || 0).toFixed(1)}% rework · {w.total_tasks} tasks</Text>
          </View>
        );
      })}
    </View>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function IntelligenceGraphsNative() {
  const colors = useThemeColors();
  const { getPipelineStageDwell, getPipelineThroughput, getPipelinePointsSeries } = useAnalytics();

  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [pipelines, setPipelines]   = useState<any[]>([]);
  const [periodOpt, setPeriodOpt]   = useState(PERIOD_OPTS[1]);
  const [dwell, setDwell]           = useState<StageDwell[]>([]);
  const [throughput, setThroughput] = useState<ThroughputPeriod[]>([]);
  const [pointsData, setPointsData] = useState<PipelinePointsPeriod[]>([]);
  const [auditData, setAuditData]   = useState<any>(null);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    supabase.from('pipelines').select('id, name').is('deleted_at', null)
      .then(({ data }) => { if (data?.length) { setPipelines(data); setPipelineId(data[0].id); } });
  }, []);

  const load = useCallback(async () => {
    if (!pipelineId) return;
    setLoading(true);
    try {
      const today  = new Date();
      const nDays  = periodOpt.type === 'week' ? periodOpt.n * 7 : periodOpt.n * 30;
      const from   = new Date(today.getTime() - nDays * 86400000).toISOString().split('T')[0];
      const to     = today.toISOString().split('T')[0];
      const [d, t, pts, a] = await Promise.all([
        getPipelineStageDwell(pipelineId, from, to),
        getPipelineThroughput(pipelineId, periodOpt.type, periodOpt.n),
        getPipelinePointsSeries(pipelineId, periodOpt.type, periodOpt.n).catch(() => []),
        supabase.rpc('rpc_get_organizational_audit', { p_pipeline_id: pipelineId, p_days: nDays }),
      ]);
      setDwell(d || []);
      setThroughput(t || []);
      setPointsData(pts || []);
      setAuditData(a.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [pipelineId, periodOpt]);

  useEffect(() => { load(); }, [load]);

  const maxDwellSec = Math.max(1, ...dwell.map(d => d.avg_seconds));

  return (
    <View className="flex-1 bg-surface-background">
      <View className="px-6 pt-14 pb-4">
        <Text className="text-brand-primary font-black uppercase tracking-[4px] text-[10px] mb-1">Intelligence Hub</Text>
        <Text className="text-typography-main text-3xl font-black">Performance</Text>
      </View>

      {/* Controls */}
      <View className="px-6 mb-4 gap-3">
        {pipelines.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row bg-surface-card border border-surface-border rounded-xl p-1 gap-0.5">
              {pipelines.map(p => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setPipelineId(p.id)}
                  className={`px-4 py-2 rounded-lg ${pipelineId === p.id ? 'bg-brand-primary' : ''}`}
                >
                  <Text className={`text-[11px] font-black ${pipelineId === p.id ? 'text-white' : 'text-typography-muted'}`}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        )}
        <View className="flex-row flex-wrap bg-surface-card border border-surface-border rounded-xl p-1 gap-0.5 self-start">
          {PERIOD_OPTS.map(opt => (
            <TouchableOpacity
              key={opt.label}
              onPress={() => setPeriodOpt(opt)}
              className={`px-4 py-2 rounded-lg ${periodOpt.label === opt.label ? 'bg-brand-primary' : ''}`}
            >
              <Text className={`text-[11px] font-black ${periodOpt.label === opt.label ? 'text-white' : 'text-typography-muted'}`}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>

          {/* SLA Risks */}
          <SLARiskSection data={auditData} />

          {/* Stage Dwell */}
          <View className="bg-surface-card border border-surface-border rounded-2xl p-5 mb-4">
            <Text className="text-typography-main font-black text-base mb-1">Stage Dwell Times</Text>
            <Text className="text-typography-muted text-[10px] mb-4">Avg time tasks spend per stage</Text>
            {dwell.length === 0 ? (
              <Text className="text-typography-muted text-sm">No stage history in this period.</Text>
            ) : (
              dwell.slice().sort((a, b) => a.stage_position - b.stage_position).map(s => {
                const pct   = (s.avg_seconds / maxDwellSec) * 100;
                const color = s.is_bottleneck ? '#F59E0B'
                  : (s.is_terminal && s.terminal_type === 'success') ? '#10B981'
                  : s.is_terminal ? '#EF4444'
                  : colors.primary;
                return (
                  <View key={s.stage_id} className="mb-3">
                    <View className="flex-row flex-wrap justify-between items-end mb-1 gap-x-2">
                      <Text className="text-typography-main text-xs font-bold flex-1 mr-2" numberOfLines={1}>
                        {s.stage_name}{s.is_bottleneck ? ' ⚠' : ''}
                      </Text>
                      <Text className="text-typography-muted text-xs">{fmtSec(s.avg_seconds)}</Text>
                    </View>
                    <View className="h-2 bg-surface-overlay rounded-full overflow-hidden">
                      <View style={{ width: `${pct}%`, backgroundColor: color }} className="h-full rounded-full" />
                    </View>
                    <Text className="text-typography-dim text-[9px] mt-0.5">{s.sample_count} samples · {s.reversal_count} reversals</Text>
                  </View>
                );
              })
            )}
          </View>

          {/* Throughput */}
          <View className="bg-surface-card border border-surface-border rounded-2xl p-5 mb-4">
            <Text className="text-typography-main font-black text-base mb-1">Throughput</Text>
            <Text className="text-typography-muted text-[10px] mb-4">Tasks completed vs failed per period</Text>
            {throughput.length === 0 ? (
              <Text className="text-typography-muted text-sm">No throughput data for this period.</Text>
            ) : (
              [...throughput].reverse().slice(0, 8).map((t, i, arr) => {
                const total = t.tasks_succeeded + t.tasks_failed;
                const successPct = total > 0 ? (t.tasks_succeeded / total) * 100 : 0;
                return (
                  <View key={i} className={`py-3 ${i < arr.length - 1 ? 'border-b border-surface-border/50' : ''}`}>
                    <View className="flex-row flex-wrap justify-between items-end mb-1.5 gap-x-2">
                      <Text className="text-typography-muted text-xs">{t.period_label}</Text>
                      <View className="flex-row flex-wrap gap-3">
                        <Text className="text-state-success text-xs font-bold">↑ {t.tasks_succeeded}</Text>
                        <Text className="text-state-danger text-xs font-bold">↓ {t.tasks_failed}</Text>
                        {t.success_rate !== null && (
                          <Text className="text-typography-dim text-xs">{t.success_rate.toFixed(0)}%</Text>
                        )}
                      </View>
                    </View>
                    <View className="h-1.5 bg-surface-overlay rounded-full overflow-hidden flex-row">
                      <View style={{ width: `${successPct}%` }} className="h-full bg-state-success rounded-l-full" />
                      <View style={{ width: `${100 - successPct}%` }} className="h-full bg-state-danger rounded-r-full opacity-60" />
                    </View>
                  </View>
                );
              })
            )}
          </View>

          {/* Points Over Time */}
          <PointsSection data={pointsData} />

          {/* Performance Trends */}
          <TrendsSection data={auditData} />

          {/* Work Distribution */}
          <WorkDistributionSection data={auditData} />

          {/* Quality Integrity */}
          <QualitySection data={auditData} />

          <View className="h-10" />
        </ScrollView>
      )}
    </View>
  );
}
