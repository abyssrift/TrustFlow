import { QualityLeaderboardWeb, SLARiskAlertWeb, StageDwellChartWeb, TrendComparisonCardsWeb, WorkDistributionChartWeb } from '@/components/intelligence/RadarWidgets';
import { DateRangeControls, useDateRange, useGranularity } from '@/components/intelligence/DateRangeFilter';
import { CollapsibleHeaderProvider, useCollapsibleHeaderScroll } from '@/hooks/useCollapsibleHeader';
import IntelligencePageHeader from '@/components/intelligence/IntelligencePageHeader';
import { PointsBucket, StageDwell, ThroughputBucket, useAnalytics } from '@/contexts/AnalyticsContext';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { bucketLabel } from '@/lib/chartBuckets';
import { supabase } from '@/lib/supabase';
import { summarizeAnalyticsSeries, type AnalyticsSeriesKey } from '@/lib/analyticsSeriesState';
import { FontAwesome } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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

export default function IntelligenceGraphs() {
  const colors = useThemeColors();
  const { hasPermission, permissionsLoaded } = useAuth();

  if (!permissionsLoaded) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!hasPermission('analytics.view')) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-6">
        <Text className="text-typography-main text-xl font-black">Access Restricted</Text>
        <Text className="text-typography-muted text-center mt-2">
          You need the <Text className="font-black">analytics.view</Text> permission to access Performance.
        </Text>
      </View>
    );
  }

  return (
    <CollapsibleHeaderProvider>
      <IntelligenceGraphsInner />
    </CollapsibleHeaderProvider>
  );
}

function IntelligenceGraphsInner() {
  const colors = useThemeColors();
  const headerScroll = useCollapsibleHeaderScroll();
  const tooltipStyle = {
    backgroundColor: colors.card,
    border: `1px solid rgb(var(--surface-border))`,
    borderRadius: '8px',
    color: colors.textMain,
    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
  };
  const { getOrganizationalAudit, getPipelineStageDwell, getPipelineThroughputRange, getPipelinePointsRange } = useAnalytics();

  const [pipelineId, setPipelineId]     = useState<string | null>(null);
  const [pipelines, setPipelines]       = useState<any[]>([]);
  const { from, to, setFrom, setTo, nDays } = useDateRange(56);
  const granularity = useGranularity();
  const buckets = granularity.buckets;
  const [pipelinesLoaded, setPipelinesLoaded] = useState(false);
  const [snapshot, setSnapshot] = useState<{
    key: string;
    dwell: StageDwell[];
    throughput: ThroughputBucket[];
    points: PointsBucket[];
    audit: any;
  } | null>(null);
  const [requestState, setRequestState] = useState<'loading' | 'updating' | 'ready' | 'empty' | 'error'>('loading');
  const [requestStateKey, setRequestStateKey] = useState<string | null>(null);
  const [seriesErrors, setSeriesErrors] = useState<Record<AnalyticsSeriesKey, boolean>>({ dwell: false, throughput: false, points: false, audit: false });
  const currentKeyRef = useRef<string | null>(null);
  const acceptedKeyRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);

  const requestKey = JSON.stringify([pipelineId, from, to, buckets]);
  currentKeyRef.current = requestKey;

  useEffect(() => {
    supabase.from('pipelines').select('id, name').is('deleted_at', null)
      .then(({ data }) => { if (data?.length) { setPipelines(data); setPipelineId(data[0].id); } })
      .finally(() => setPipelinesLoaded(true));
  }, []);

  const load = useCallback(async () => {
    if (!pipelineId) return;
    const key = requestKey;
    const generation = ++requestGenerationRef.current;
    currentKeyRef.current = key;
    const hasAcceptedSnapshot = acceptedKeyRef.current === key;
    setRequestStateKey(key);
    setRequestState(hasAcceptedSnapshot ? 'updating' : 'loading');
    try {
      const [dResult, tResult, ptsResult, auditResult] = await Promise.allSettled([
        getPipelineStageDwell(pipelineId, from, to),
        getPipelineThroughputRange(pipelineId, from, to, buckets),
        getPipelinePointsRange(pipelineId, from, to, buckets),
        getOrganizationalAudit(pipelineId, nDays),
      ]);
      if (generation !== requestGenerationRef.current || currentKeyRef.current !== key) return;
      const d = dResult.status === 'fulfilled' ? dResult.value : [];
      const t = tResult.status === 'fulfilled' ? tResult.value : [];
      const pts = ptsResult.status === 'fulfilled' ? ptsResult.value : [];
      const audit = auditResult.status === 'fulfilled' ? auditResult.value : null;
      const summary = summarizeAnalyticsSeries([
        { key: 'dwell', status: dResult.status === 'fulfilled' ? 'ready' : 'error', data: d },
        { key: 'throughput', status: tResult.status === 'fulfilled' ? 'ready' : 'error', data: t },
        { key: 'points', status: ptsResult.status === 'fulfilled' ? 'ready' : 'error', data: pts },
        { key: 'audit', status: auditResult.status === 'fulfilled' ? 'ready' : 'error', data: audit },
      ]);
      const nextSnapshot = { key, dwell: d, throughput: t, points: pts, audit };
      setSeriesErrors({
        dwell: dResult.status === 'rejected',
        throughput: tResult.status === 'rejected',
        points: ptsResult.status === 'rejected',
        audit: auditResult.status === 'rejected',
      });
      if (summary.allFailed) {
        setSnapshot(null);
        acceptedKeyRef.current = null;
        setRequestStateKey(key);
        setRequestState('error');
        return;
      }
      setSnapshot(nextSnapshot);
      acceptedKeyRef.current = key;
      setRequestStateKey(key);
      setRequestState(summary.isEmpty ? 'empty' : 'ready');
    } catch (e) {
      if (generation !== requestGenerationRef.current || currentKeyRef.current !== key) return;
      setSnapshot(null);
      acceptedKeyRef.current = null;
      setRequestStateKey(key);
      setRequestState('error');
    }
  }, [getOrganizationalAudit, pipelineId, from, to, buckets, nDays, requestKey]);

  useEffect(() => { load(); }, [load]);

  const currentSnapshot = snapshot?.key === requestKey ? snapshot : null;
  const effectiveState = requestStateKey === requestKey ? requestState : 'loading';
  const showLoading = pipelinesLoaded && pipelines.length > 0 && !currentSnapshot && (effectiveState === 'loading' || effectiveState === 'updating');
  const showUpdating = Boolean(currentSnapshot) && effectiveState === 'updating';
  const showError = pipelinesLoaded && pipelines.length > 0 && effectiveState === 'error';
  const showEmpty = pipelinesLoaded && pipelines.length > 0 && effectiveState === 'empty';
  const dwell = currentSnapshot?.dwell ?? [];
  const throughput = currentSnapshot?.throughput ?? [];
  const pointsData = currentSnapshot?.points ?? [];
  const auditData = currentSnapshot?.audit ?? null;

  const throughputChartData = throughput.map(t => ({
    label:       bucketLabel(t.bucket_start, t.bucket_end),
    succeeded:   t.tasks_succeeded,
    failed:      t.tasks_failed,
    success_rate: t.success_rate,
  }));

  return (
    <View className="flex-1 bg-surface-background flex-col">

      {/* ── Header (shared collapsing component — #309) ── */}
      <IntelligencePageHeader
        eyebrow="Intelligence Hub"
        title="Performance"
        right={
          <>
            {/* Pipeline selector — wrapping row, needs a definite max so its
                own flex-wrap engages under the Animated ancestor on RNW */}
            {pipelines.length > 1 && (
              <View style={{ maxWidth: '100%', flexShrink: 1 }}>
                <View className="flex-row flex-wrap max-w-full bg-surface-card border border-surface-border rounded-xl p-1 gap-0.5">
                  {pipelines.slice(0, 4).map(p => (
                    <TouchableOpacity
                      key={p.id}
                      onPress={() => setPipelineId(p.id)}
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${p.name} pipeline`}
                      accessibilityState={{ selected: pipelineId === p.id }}
                      style={{ minHeight: 44 }}
                      className={`px-4 py-2 rounded-lg max-w-[180px] ${pipelineId === p.id ? 'bg-brand-primary' : ''}`}
                    >
                      <Text className={`text-[11px] font-black text-center ${pipelineId === p.id ? 'text-white' : 'text-typography-muted'}`} numberOfLines={1}>
                        {p.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
            {/* Calendar range filter + shared granularity */}
            <View style={{ maxWidth: '100%', flexShrink: 1 }}>
              <DateRangeControls from={from} to={to} setFrom={setFrom} setTo={setTo} granularity={granularity} />
            </View>
            <TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel="Refresh performance data" style={{ minHeight: 44, minWidth: 44 }} className="h-10 w-10 items-center justify-center bg-surface-card border border-surface-border rounded-xl">
              {showUpdating
                ? <ActivityIndicator size="small" color={colors.primary} />
                : <FontAwesome name="refresh" size={13} color={colors.primary} />}
            </TouchableOpacity>
          </>
        }
      />

      <View className="px-8 pt-3">
        <Text className="text-typography-muted text-xs">Charts use the dates above. Summary cards cover the same length of time through today.</Text>
      </View>

      {!pipelinesLoaded ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Loading pipelines" />
        </View>
      ) : pipelines.length === 0 ? (
        <View className="flex-1 items-center justify-center p-8">
          <Text className="text-typography-main font-black text-base">No Pipelines Found</Text>
          <Text className="text-typography-muted text-xs mt-2">Create a pipeline to see performance.</Text>
        </View>
      ) : showLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} accessibilityLabel="Loading analytics" />
        </View>
      ) : showError ? (
        <View className="flex-1 items-center justify-center p-8 gap-3">
          <Text accessibilityLiveRegion="polite" className="text-typography-main font-black text-base">Could not load analytics.</Text>
          <TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel="Retry" className="bg-brand-primary px-5 rounded-xl items-center justify-center" style={{ minHeight: 44, minWidth: 88 }}>
            <Text className="text-brand-on-primary text-xs font-bold">Retry</Text>
          </TouchableOpacity>
        </View>
      ) : showEmpty ? (
        <View className="flex-1 items-center justify-center p-8">
          <Text className="text-typography-main font-black text-base">No activity in this range.</Text>
          <Text className="text-typography-muted text-xs text-center mt-2">Try a longer date range or another pipeline.</Text>
        </View>
      ) : (
        <ScrollView className="flex-1" contentContainerStyle={{ paddingHorizontal: 32, paddingVertical: 40, paddingBottom: 60 }} showsVerticalScrollIndicator={false} {...headerScroll}>

          {showUpdating && (
            <View accessible accessibilityRole="progressbar" accessibilityLabel="Updating analytics" className="flex-row items-center gap-2 mb-4">
              <ActivityIndicator size="small" color={colors.primary} />
              <Text className="text-typography-muted text-xs">Updating analytics...</Text>
            </View>
          )}

          {seriesErrors.audit && (
            <View className="bg-surface-card border border-surface-border rounded-2xl p-4 gap-2 mb-6">
              <Text className="text-typography-main font-black text-sm">Summary data unavailable.</Text>
              <Text className="text-typography-muted text-xs">Retry to load summary cards for this range.</Text>
              <TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel="Retry summary data" style={{ minHeight: 44, minWidth: 88 }} className="bg-brand-primary px-4 rounded-xl items-center justify-center self-start">
                <Text className="text-brand-on-primary text-xs font-bold">Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* SLA Risks */}
          {!seriesErrors.audit && <View className="mb-6"><SLARiskAlertWeb data={auditData} /></View>}

          {/* ── Throughput Over Time ── */}
          {seriesErrors.throughput ? <View className="bg-surface-card border border-surface-border rounded-2xl p-4 gap-2 mb-6">
            <Text className="text-typography-main font-black text-sm">Completed tasks unavailable.</Text>
            <Text className="text-typography-muted text-xs">Retry to load completed task activity for this range.</Text>
            <TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel="Retry completed task activity" style={{ minHeight: 44, minWidth: 88 }} className="bg-brand-primary px-4 rounded-xl items-center justify-center self-start">
              <Text className="text-brand-on-primary text-xs font-bold">Retry</Text>
            </TouchableOpacity>
          </View> : <View className="bg-surface-card p-8 rounded-[32px] border border-surface-border premium-shadow mb-6">
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
          </View>}

          {/* ── Points Generated Over Time ── */}
          {(() => {
            const ptsChart = pointsData.map(d => ({ label: bucketLabel(d.bucket_start, d.bucket_end), points: d.weight_points }));
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
                  {seriesErrors.points ? (
                    <View className="flex-1 items-center justify-center gap-2">
                      <Text className="text-typography-muted text-sm">Points unavailable for this period.</Text>
                      <TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel="Retry points data" style={{ minHeight: 44, minWidth: 88 }} className="bg-brand-primary px-4 rounded-xl items-center justify-center">
                        <Text className="text-brand-on-primary text-xs font-bold">Retry</Text>
                      </TouchableOpacity>
                    </View>
                  ) : ptsChart.length > 0 && ptsChart.some(d => d.points > 0) ? (
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
          {!seriesErrors.audit && <View className="mb-6"><TrendComparisonCardsWeb data={auditData} /></View>}

          {/* ── Stage Dwell + Work Distribution ── */}
          <View className="flex-row gap-6 mb-6">
            <View className="flex-1">
              {seriesErrors.dwell ? <View className="bg-surface-card border border-surface-border rounded-2xl p-4 gap-2"><Text className="text-typography-main font-black text-sm">Stage dwell unavailable.</Text><TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel="Retry stage dwell" style={{ minHeight: 44, minWidth: 88 }} className="bg-brand-primary px-4 rounded-xl items-center justify-center self-start"><Text className="text-brand-on-primary text-xs font-bold">Retry</Text></TouchableOpacity></View> : <StageDwellChartWeb
                data={dwell}
                onViewDetails={() => router.push('/intelligence/analytics')}
                className="h-full"
              />}
            </View>
            <View className="flex-1">
              {!seriesErrors.audit && <WorkDistributionChartWeb data={auditData} />}
            </View>
          </View>

          {/* ── Quality Leaderboard ── */}
          {!seriesErrors.audit && <QualityLeaderboardWeb data={auditData} />}

        </ScrollView>
      )}
    </View>
  );
}
