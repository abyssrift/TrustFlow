import { WorkDistributionChartWeb, QualityLeaderboardWeb, SLARiskAlertWeb, StageDurationChartWeb, TrendComparisonCardsWeb } from '@/components/intelligence/RadarWidgets';
import { useAnalytics, StageDwell, ThroughputPeriod } from '@/contexts/AnalyticsContext';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart,
  Legend, Line, ResponsiveContainer, Tooltip as RechartTooltip, XAxis, YAxis,
} from 'recharts';

const PERIOD_OPTS = [
  { label: '4W',   type: 'week',  n: 4  },
  { label: '8W',   type: 'week',  n: 8  },
  { label: '6M',   type: 'month', n: 6  },
  { label: '12M',  type: 'month', n: 12 },
];

const fmtSec = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export default function IntelligenceGraphs() {
  const { getPipelineStageDwell, getPipelineThroughput } = useAnalytics();

  const [pipelineId, setPipelineId]     = useState<string | null>(null);
  const [pipelines, setPipelines]       = useState<any[]>([]);
  const [periodOpt, setPeriodOpt]       = useState(PERIOD_OPTS[1]);
  const [dwell, setDwell]               = useState<StageDwell[]>([]);
  const [throughput, setThroughput]     = useState<ThroughputPeriod[]>([]);
  const [auditData, setAuditData]       = useState<any>(null);
  const [loading, setLoading]           = useState(true);

  useEffect(() => {
    supabase.from('pipelines').select('id, name').is('deleted_at', null)
      .then(({ data }) => { if (data?.length) { setPipelines(data); setPipelineId(data[0].id); } });
  }, []);

  const load = useCallback(async () => {
    if (!pipelineId) return;
    setLoading(true);
    try {
      const today   = new Date();
      const nDays   = periodOpt.type === 'week' ? periodOpt.n * 7 : periodOpt.n * 30;
      const from    = new Date(today.getTime() - nDays * 86400000).toISOString().split('T')[0];
      const to      = today.toISOString().split('T')[0];
      const [d, t, a] = await Promise.all([
        getPipelineStageDwell(pipelineId, from, to),
        getPipelineThroughput(pipelineId, periodOpt.type, periodOpt.n),
        supabase.rpc('rpc_get_organizational_audit', { p_pipeline_id: pipelineId, p_days: nDays }),
      ]);
      setDwell(d || []);
      setThroughput(t || []);
      setAuditData(a.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [pipelineId, periodOpt]);

  useEffect(() => { load(); }, [load]);

  const throughputChartData = throughput.map(t => ({
    label:       t.period_label,
    succeeded:   t.tasks_succeeded,
    failed:      t.tasks_failed,
    success_rate: t.success_rate ?? 0,
  }));

  const dwellChartData = [...dwell]
    .sort((a, b) => a.stage_position - b.stage_position)
    .map(s => ({
      name:  s.stage_name,
      hours: parseFloat((s.avg_seconds / 3600).toFixed(2)),
      fill:  s.is_bottleneck ? '#F59E0B'
           : (s.is_terminal && s.terminal_type === 'success') ? '#10B981'
           : s.is_terminal ? '#EF4444'
           : 'rgb(var(--brand-primary))',
    }));

  const tooltipStyle = {
    backgroundColor: 'rgb(var(--surface-card))',
    border: '1px solid rgb(var(--surface-border))',
    borderRadius: 12,
    fontSize: 11,
  };

  return (
    <View className="flex-1 bg-surface-background flex-col">

      {/* ── Header ── */}
      <View className="px-10 pt-8 pb-5 flex-row items-center justify-between border-b border-surface-border flex-shrink-0">
        <View>
          <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[9px] mb-1">Intelligence Hub</Text>
          <Text className="text-typography-main text-4xl font-black tracking-tighter">Performance</Text>
        </View>
        <View className="flex-row items-center gap-3">
          {/* Pipeline selector */}
          {pipelines.length > 1 && (
            <View className="flex-row bg-surface-card border border-surface-border rounded-xl p-1 gap-0.5">
              {pipelines.slice(0, 4).map(p => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setPipelineId(p.id)}
                  className={`px-4 py-2 rounded-lg ${pipelineId === p.id ? 'bg-brand-primary' : ''}`}
                >
                  <Text className={`text-[11px] font-black ${pipelineId === p.id ? 'text-white' : 'text-typography-muted'}`}>
                    {p.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {/* Period selector */}
          <View className="flex-row bg-surface-card border border-surface-border rounded-xl p-1 gap-0.5">
            {PERIOD_OPTS.map(opt => (
              <TouchableOpacity
                key={opt.label}
                onPress={() => setPeriodOpt(opt)}
                className={`px-4 py-2 rounded-lg ${periodOpt.label === opt.label ? 'bg-brand-primary' : ''}`}
              >
                <Text className={`text-[11px] font-black ${periodOpt.label === opt.label ? 'text-white' : 'text-typography-muted'}`}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity onPress={load} className="h-10 w-10 items-center justify-center bg-surface-card border border-surface-border rounded-xl">
            <FontAwesome name="refresh" size={13} color="rgb(var(--brand-primary))" />
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ padding: 40, gap: 24 }} showsVerticalScrollIndicator={false}>

          {/* SLA Risks */}
          <SLARiskAlertWeb data={auditData} />

          {/* ── Throughput Over Time ── */}
          <View className="bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow">
            <View className="flex-row justify-between items-start mb-6">
              <View>
                <Text className="text-typography-main font-black text-xl tracking-tight">Throughput Over Time</Text>
                <Text className="text-typography-muted text-xs mt-1">Tasks completed and failed per period with success rate</Text>
              </View>
              <View className="flex-row gap-4 items-center">
                <View className="flex-row items-center gap-2">
                  <View className="w-3 h-3 rounded bg-state-success" /><Text className="text-typography-muted text-[10px]">Completed</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <View className="w-3 h-3 rounded bg-state-danger" /><Text className="text-typography-muted text-[10px]">Failed</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <View className="w-8 h-0.5 bg-brand-primary" /><Text className="text-typography-muted text-[10px]">Success %</Text>
                </View>
              </View>
            </View>
            <View style={{ height: 280 }}>
              {throughputChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={throughputChartData} barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'rgb(var(--text-muted))' }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="l" tick={{ fontSize: 10, fill: 'rgb(var(--text-muted))' }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 10, fill: 'rgb(var(--text-muted))' }} axisLine={false} tickLine={false} unit="%" />
                    <RechartTooltip contentStyle={tooltipStyle} />
                    <Bar yAxisId="l" dataKey="succeeded" fill="#10B981" name="Completed" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    <Bar yAxisId="l" dataKey="failed"    fill="#EF4444" name="Failed"    radius={[4, 4, 0, 0]} maxBarSize={40} />
                    <Line yAxisId="r" type="monotone" dataKey="success_rate" stroke="rgb(var(--brand-primary))" strokeWidth={2.5} dot={{ r: 4, fill: 'rgb(var(--brand-primary))' }} name="Success %" />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <View className="flex-1 items-center justify-center">
                  <FontAwesome name="bar-chart" size={32} color="rgb(var(--text-dim))" />
                  <Text className="text-typography-muted text-sm mt-3">No throughput data for this pipeline/period</Text>
                </View>
              )}
            </View>
          </View>

          {/* Stage Duration Chart */}
          <StageDurationChartWeb data={auditData} />

          {/* Performance Trends */}
          <TrendComparisonCardsWeb data={auditData} />

          {/* ── Stage Dwell + Work Distribution ── */}
          <View className="flex-row gap-6">
            {/* Stage Dwell */}
            <View className="flex-1 bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow">
              <Text className="text-typography-main font-black text-xl tracking-tight mb-1">Stage Dwell Time</Text>
              <Text className="text-typography-muted text-xs mb-6">Avg hours tasks spend at each stage</Text>
              <View className="flex-row items-center gap-4 mb-5">
                {[['#F59E0B','Bottleneck'],['#10B981','Terminal'],['#EF4444','Failed']].map(([c,l]) => (
                  <View key={l} className="flex-row items-center gap-1.5">
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: c }} />
                    <Text className="text-typography-muted text-[9px] font-bold uppercase">{l}</Text>
                  </View>
                ))}
              </View>
              <View style={{ height: 260 }}>
                {dwellChartData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={dwellChartData} margin={{ left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(128,128,128,0.15)" />
                      <XAxis type="number" tick={{ fontSize: 10, fill: 'rgb(var(--text-muted))' }} axisLine={false} tickLine={false} unit="h" />
                      <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10, fill: 'rgb(var(--text-muted))' }} axisLine={false} tickLine={false} />
                      <RechartTooltip contentStyle={tooltipStyle} formatter={(v: any) => [`${v}h`, 'Avg Dwell']} />
                      <Bar dataKey="hours" radius={[0, 4, 4, 0]} maxBarSize={22}>
                        {dwellChartData.map((e, i) => <Cell key={i} fill={e.fill} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <Text className="text-typography-muted text-sm">No stage history in this period</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Work Distribution */}
            <View className="flex-1">
              <WorkDistributionChartWeb data={auditData} />
            </View>
          </View>

          {/* ── Quality Leaderboard ── */}
          <QualityLeaderboardWeb data={auditData} />

        </ScrollView>
      )}
    </View>
  );
}
