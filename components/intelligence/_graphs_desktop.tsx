import { QualityLeaderboardWeb, SLARiskAlertWeb, StageDwellChartWeb, TrendComparisonCardsWeb, WorkDistributionChartWeb } from '@/components/intelligence/RadarWidgets';
import { PipelinePointsPeriod, StageDwell, ThroughputPeriod, useAnalytics } from '@/contexts/AnalyticsContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  Tooltip as RechartTooltip,
  ResponsiveContainer,
  XAxis, YAxis
} from 'recharts';

const PERIOD_OPTS = [
  { label: '4W',   type: 'week',  n: 4  },
  { label: '8W',   type: 'week',  n: 8  },
  { label: '6M',   type: 'month', n: 6  },
  { label: '12M',  type: 'month', n: 12 },
];

const fmtSec = (s: number) => {
  const colors = useThemeColors();
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const colors = useThemeColors();

const tooltipStyle = {
  backgroundColor: colors.card,
  border: '1px solid var(--color-border)',
  borderRadius: '8px',
  color: colors.textMain,
  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
};

export default function IntelligenceGraphs() {
  const colors = useThemeColors();
  const { getPipelineStageDwell, getPipelineThroughput, getPipelinePointsSeries } = useAnalytics();

  const [pipelineId, setPipelineId]     = useState<string | null>(null);
  const [pipelines, setPipelines]       = useState<any[]>([]);
  const [periodOpt, setPeriodOpt]       = useState(PERIOD_OPTS[1]);
  const [dwell, setDwell]               = useState<StageDwell[]>([]);
  const [throughput, setThroughput]     = useState<ThroughputPeriod[]>([]);
  const [pointsData, setPointsData]     = useState<PipelinePointsPeriod[]>([]);
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

  const throughputChartData = [...throughput].reverse().map(t => ({
    label:       t.period_label,
    succeeded:   t.tasks_succeeded,
    failed:      t.tasks_failed,
    success_rate: t.success_rate ?? 0,
  }));

  return (
    <View className="flex-1 bg-surface-background flex-col">

      {/* ── Header ── */}
      <View className="px-10 pt-8 pb-5 flex-row flex-wrap items-start justify-between gap-4 border-b border-surface-border flex-shrink-0">
        <View className="min-w-0">
          <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[9px] mb-1">Intelligence Hub</Text>
          <Text className="text-typography-main text-4xl font-black tracking-tighter">Performance</Text>
        </View>
        <View className="flex-row flex-wrap items-center justify-end gap-3 max-w-full">
          {/* Pipeline selector */}
          {pipelines.length > 1 && (
            <View className="flex-row flex-wrap max-w-full bg-surface-card border border-surface-border rounded-xl p-1 gap-0.5">
              {pipelines.slice(0, 4).map(p => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setPipelineId(p.id)}
                  className={`px-4 py-2 rounded-lg max-w-[180px] ${pipelineId === p.id ? 'bg-brand-primary' : ''}`}
                >
                  <Text className={`text-[11px] font-black text-center ${pipelineId === p.id ? 'text-white' : 'text-typography-muted'}`} numberOfLines={1}>
                    {p.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {/* Period selector */}
          <View className="flex-row bg-surface-card border border-surface-border rounded-xl p-1 gap-0.5 shrink-0">
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
            <FontAwesome name="refresh" size={13} color={colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 32, paddingVertical: 40, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>

          {/* SLA Risks */}
          <View className="mb-6">
            <SLARiskAlertWeb data={auditData} />
          </View>

          {/* ── Throughput Over Time ── */}
          <View className="bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow mb-6">
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
                    <XAxis dataKey="label" stroke={colors.textDim} fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="l" stroke={colors.textDim} fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="r" orientation="right" domain={[0, 100]} stroke={colors.textDim} fontSize={12} tickLine={false} axisLine={false} unit="%" />
                    <RechartTooltip contentStyle={tooltipStyle} />
                    <Bar yAxisId="l" dataKey="succeeded" fill={colors.success} name="Completed" radius={[4, 4, 0, 0]} maxBarSize={40} />
                    <Bar yAxisId="l" dataKey="failed"    fill={colors.danger} name="Failed"    radius={[4, 4, 0, 0]} maxBarSize={40} />
                    <Line yAxisId="r" type="monotone" dataKey="success_rate" stroke={colors.primary} strokeWidth={2.5} dot={{ r: 4, fill: colors.primary }} name="Success %" />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <View className="flex-1 items-center justify-center">
                  <FontAwesome name="bar-chart" size={32} color={colors.textDim} />
                  <Text className="text-typography-muted text-sm mt-3">No throughput data for this pipeline/period</Text>
                </View>
              )}
            </View>
          </View>

          {/* ── Points Generated Over Time ── */}
          {(() => {
            const ptsChart = [...pointsData].reverse().map(d => ({ label: d.period_label, points: d.weight_points }));
            const totalPts = pointsData.reduce((s, d) => s + (d.weight_points || 0), 0);
            return (
              <View className="bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow mb-6">
                <View className="flex-row justify-between items-start mb-6">
                  <View>
                    <Text className="text-typography-main font-black text-xl tracking-tight">Points Generated Over Time</Text>
                    <Text className="text-typography-muted text-xs mt-1">Weight points earned from completed tasks per period</Text>
                  </View>
                  <View className="flex-row items-center gap-2 bg-surface-background border border-surface-border rounded-xl px-4 py-2">
                    <View className="w-2.5 h-2.5 rounded-full bg-brand-primary" />
                    <Text className="text-typography-muted text-[10px] font-bold uppercase">Total</Text>
                    <Text className="text-typography-main text-sm font-black">{totalPts.toLocaleString()} pts</Text>
                  </View>
                </View>
                <View style={{ height: 280 }}>
                  {ptsChart.length > 0 && ptsChart.some(d => d.points > 0) ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={ptsChart}>
                        <defs>
                          <linearGradient id="pointsGradFull" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor={colors.primary} stopOpacity={0.3} />
                            <stop offset="95%" stopColor={colors.primary} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" vertical={false} />
                        <XAxis dataKey="label" stroke={colors.textDim} fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke={colors.textDim} fontSize={12} tickLine={false} axisLine={false} />
                        <RechartTooltip contentStyle={tooltipStyle} formatter={(v: any) => [`${v} pts`, 'Points']} />
                        <Area type="monotone" dataKey="points" stroke={colors.primary} strokeWidth={2.5} fill="url(#pointsGradFull)" dot={{ r: 4, fill: colors.primary }} name="Points" />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <View className="flex-1 items-center justify-center">
                      <FontAwesome name="star-o" size={32} color={colors.textDim} />
                      <Text className="text-typography-muted text-sm mt-3">No points data for this pipeline/period</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })()}

          {/* Performance Trends */}
          <View className="mb-6">
            <TrendComparisonCardsWeb data={auditData} />
          </View>

          {/* ── Stage Dwell + Work Distribution ── */}
          <View className="flex-row gap-6 mb-6">
            <View className="flex-1">
              <StageDwellChartWeb
                data={dwell}
                onViewDetails={() => router.push('/intelligence/analytics')}
                className="h-full"
              />
            </View>
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
