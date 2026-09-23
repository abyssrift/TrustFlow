import { BackButton } from '@/components/common/BackButton';
import SearchableMultiSelect from '@/components/common/SearchableMultiSelect';
import UserLink from '@/components/common/UserLink';
import { ConversionFunnelDetails, PipelineLoadDetails } from '@/components/intelligence/AdaptivePipelineDetails';
import { DateRangeControls, useGranularity } from '@/components/intelligence/DateRangeFilter';
import PortfolioFlowTab from '@/components/intelligence/PortfolioFlowTab';
import { PersonnelRow, StageDwell, ThroughputBucket, useAnalytics } from '@/contexts/AnalyticsContext';
import type { OrganizationalAudit } from '@/lib/analyticsMetrics';
import { summarizeAnalyticsSeries, type AnalyticsSeriesSnapshot } from '@/lib/analyticsSeriesState';
import { bucketLabel } from '@/lib/chartBuckets';
import { localIsoDay } from '@/lib/time';
import { useAuth } from '@/contexts/AuthContext';
import { useBillingPlan } from '@/hooks/useBillingPlan';
import { AnalyticsLimits, getAnalyticsLimits } from '@/lib/planLimits';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useThemeColors } from '@/hooks/useThemeColors';
import { formatDuration as fmtSeconds } from '@/lib/duration';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

type AdminTab = 'pipeline' | 'personnel' | 'portfolio';

// ─── Throughput SVG Bar Chart ─────────────────────────────────────────────────

function ThroughputChart({ data }: { data: ThroughputBucket[] }) {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  const chartData = data.map(d => ({ ...d, period_label: bucketLabel(d.bucket_start, d.bucket_end) }));
  const chartH = 180;
  if (!chartData.length) return (
    <View className="h-32 items-center justify-center">
      <Text className="text-typography-muted text-sm">No throughput data in this period.</Text>
    </View>
  );

  const maxVal = Math.max(1, ...chartData.map(d => d.tasks_succeeded + d.tasks_failed));
  const colW = width > 0 ? width / chartData.length : 0;
  const barW = colW * 0.3;

  return (
    <View onStartShouldSetResponder={() => true}>
      <View style={{ height: chartH }} onLayout={e => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 && (
          <Svg height={chartH} width={width}>
            <Defs>
              <LinearGradient id="thrSuccess" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.success} stopOpacity="1" />
                <Stop offset="1" stopColor={colors.success} stopOpacity="0.5" />
              </LinearGradient>
              <LinearGradient id="thrFail" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={colors.danger} stopOpacity="1" />
                <Stop offset="1" stopColor={colors.danger} stopOpacity="0.5" />
              </LinearGradient>
            </Defs>
            {chartData.map((d, i) => {
              const cx = i * colW + colW / 2;
              const sH = Math.max(d.tasks_succeeded > 0 ? 2 : 0, (d.tasks_succeeded / maxVal) * (chartH - 20) * 0.9);
              const fH = Math.max(d.tasks_failed    > 0 ? 2 : 0, (d.tasks_failed    / maxVal) * (chartH - 20) * 0.9);
              return (
                <React.Fragment key={i}>
                  {d.tasks_succeeded > 0 && (
                    <Rect x={cx - barW - 1} y={chartH - 20 - sH} width={barW} height={sH} fill="url(#thrSuccess)" rx={3} />
                  )}
                  {d.tasks_failed > 0 && (
                    <Rect x={cx + 1}        y={chartH - 20 - fH} width={barW} height={fH} fill="url(#thrFail)"    rx={3} />
                  )}
                </React.Fragment>
              );
            })}
          </Svg>
        )}
      </View>

      {/* X-axis labels */}
      <View className="flex-row" style={{ width }}>
        {chartData.map((d, i) => (
          <View key={i} style={{ width: colW }} className="items-center">
            <Text className="text-typography-dim text-[8px] font-bold" numberOfLines={1}>{d.period_label}</Text>
          </View>
        ))}
      </View>

      {/* Legend + summary row */}
      <View className="flex-row justify-between items-center mt-3">
        <View className="flex-row gap-4">
          <View className="flex-row items-center gap-1.5">
            <View className="w-3 h-3 rounded-sm" style={{ backgroundColor: colors.success }} />
            <Text className="text-typography-dim text-[9px] font-bold uppercase">Success</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="w-3 h-3 rounded-sm" style={{ backgroundColor: colors.danger }} />
            <Text className="text-typography-dim text-[9px] font-bold uppercase">Failed</Text>
          </View>
        </View>
        <View className="flex-row gap-3">
          {chartData.slice(-3).reverse().map((d, i) => {
            if (d.success_rate === null) return null;
            const good = d.success_rate >= 75;
            return (
              <View key={i} className={`px-2.5 py-1 rounded-xl ${good ? 'bg-state-success/10' : 'bg-state-danger/10'}`}>
                <Text className="text-typography-dim text-[8px] font-bold uppercase">{d.period_label}</Text>
                <Text className={`font-black text-sm ${good ? 'text-state-success' : 'text-state-danger'}`}>{d.success_rate.toFixed(0)}%</Text>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}

// ─── Stage Dwell Horizontal Bar Chart ────────────────────────────────────────

function DwellChart({ data }: { data: StageDwell[] }) {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  const sorted = [...data].sort((a, b) => a.stage_position - b.stage_position);
  const maxSec = Math.max(1, ...sorted.map(s => s.avg_seconds));
  const rowH = 22;
  const labelW = 90;
  const timeW  = 52;
  const gap    = 8;    // total horizontal gaps between the 3 columns
  const barAreaW = Math.max(4, width - labelW - timeW - gap);

  if (!sorted.length) return (
    <View className="h-20 items-center justify-center">
      <Text className="text-typography-muted text-sm">No stage history in this period.</Text>
    </View>
  );

  return (
    // onStartShouldSetResponder absorbs taps so they don't leak to the tab navigator
    <View onLayout={e => setWidth(e.nativeEvent.layout.width)} onStartShouldSetResponder={() => true}>
      {width > 0 && sorted.map((s, i) => {
        const pct = s.avg_seconds / maxSec;
        const barW = Math.max(4, pct * barAreaW);
        const color =
          s.is_bottleneck ? colors.warning :
          (s.is_terminal && s.terminal_type === 'success') ? colors.success :
          s.is_terminal ? colors.danger :
          colors.primary;

        return (
          <View key={s.stage_id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ width: labelW, fontSize: 9, fontWeight: '700', color: colors.textMuted }} numberOfLines={1}>
              {s.stage_name}{s.is_bottleneck ? ' ⚠' : ''}
            </Text>
            <Svg height={rowH} width={barAreaW}>
              <Defs>
                <LinearGradient id={`dg${i}`} x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={color}      stopOpacity="1" />
                  <Stop offset="1" stopColor={color} stopOpacity="0.45" />
                </LinearGradient>
              </Defs>
              <Rect x={0} y={4} width={barW} height={rowH - 8} fill={`url(#dg${i})`} rx={4} />
            </Svg>
            <Text style={{ width: timeW, fontSize: 9, fontWeight: '900', textAlign: 'right', color: colors.textMain }} numberOfLines={1}>
              {fmtSeconds(s.avg_seconds)}
            </Text>
          </View>
        );
      })}
      {/* Legend */}
      <View className="flex-row gap-3 flex-wrap mt-1">
        {[
          { color: colors.warning, label: 'Bottleneck' },
          { color: colors.success,  label: 'Success' },
          { color: colors.danger, label: 'Failure' },
          { color: colors.primary, label: 'Normal' },
        ].map(l => (
          <View key={l.label} className="flex-row items-center gap-1">
            <View className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
            <Text className="text-typography-dim text-[8px] font-bold uppercase">{l.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ─── Pipeline Tab ─────────────────────────────────────────────────────────────

function PipelineTab({ limits, billingReady }: { limits: AnalyticsLimits; billingReady: boolean }) {
  const colors = useThemeColors();
  const { getOrganizationalAudit, getPipelineStageDwell, getPipelineThroughputRange } = useAnalytics();
  const [pipelines, setPipelines]       = useState<any[]>([]);
  const [selectedPipeline, setSelected] = useState<string | null>(null);
  const granularity = useGranularity();
  const buckets = granularity.buckets;

  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 30 * 86400000);
  const [from, setFrom] = useState(localIsoDay(defaultFrom));
  const [to, setTo]     = useState(localIsoDay(today));

  type PipelineState = 'loading' | 'updating' | 'ready' | 'empty' | 'error';
  type SeriesState = 'loading' | 'ready' | 'error';
  type PipelineSeries = {
    dwell: SeriesState;
    throughput: SeriesState;
    audit: SeriesState;
  };
  type PipelineSnapshot = {
    key: string;
    dwell: StageDwell[];
    throughput: ThroughputBucket[];
    auditData: OrganizationalAudit | null;
    series: PipelineSeries;
  };

  const requestKey = JSON.stringify([selectedPipeline, from, to, buckets]);
  const currentKeyRef = useRef(requestKey);
  const requestGenerationRef = useRef(0);
  const snapshotKeyRef = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<PipelineSnapshot | null>(null);
  const [pipelinesLoaded, setPipelinesLoaded] = useState(false);
  currentKeyRef.current = requestKey;

  useEffect(() => {
    supabase.from('pipelines').select('id, name').is('deleted_at', null).order('name')
      .then(({ data }) => { if (data?.length) { setPipelines(data); setSelected(data[0].id); } })
      .finally(() => setPipelinesLoaded(true));
  }, []);

  const load = useCallback(async () => {
    if (!selectedPipeline) return;
    const key = requestKey;
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    const nextSnapshot: PipelineSnapshot = {
      key,
      dwell: [],
      throughput: [],
      auditData: null,
      series: { dwell: 'loading', throughput: 'loading', audit: 'loading' },
    };
    setSnapshot(nextSnapshot);
    const commit = <K extends keyof PipelineSnapshot>(field: K, value: PipelineSnapshot[K], series: keyof PipelineSeries, status: SeriesState) => {
      if (currentKeyRef.current !== key || requestGenerationRef.current !== generation) return;
      snapshotKeyRef.current = key;
      setSnapshot(previous => previous?.key === key ? {
        ...previous,
        [field]: value,
        series: { ...previous.series, [series]: status },
      } as PipelineSnapshot : previous);
    };
    const nDays = Math.max(7, Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000));
    void getPipelineStageDwell(selectedPipeline, from, to)
      .then(data => commit('dwell', data ?? [], 'dwell', 'ready'))
      .catch(() => commit('dwell', [], 'dwell', 'error'));
    void getPipelineThroughputRange(selectedPipeline, from, to, buckets)
      .then(data => commit('throughput', data ?? [], 'throughput', 'ready'))
      .catch(() => commit('throughput', [], 'throughput', 'error'));
    void getOrganizationalAudit(selectedPipeline, nDays)
      .then(data => commit('auditData', data, 'audit', 'ready'))
      .catch(() => commit('auditData', null, 'audit', 'error'));
  }, [buckets, from, getOrganizationalAudit, getPipelineStageDwell, getPipelineThroughputRange, requestKey, selectedPipeline, to]);

  useEffect(() => { load(); }, [load]);

  const currentSnapshot = snapshot?.key === requestKey ? snapshot : null;
  const seriesSummary = currentSnapshot
    ? summarizeAnalyticsSeries(([
      ['dwell', currentSnapshot.dwell, currentSnapshot.series.dwell],
      ['throughput', currentSnapshot.throughput, currentSnapshot.series.throughput],
      ['audit', currentSnapshot.auditData, currentSnapshot.series.audit],
    ] as const)
      .filter(([, , status]) => status !== 'loading')
      .map(([key, data, status]) => ({ key, data, status })) as AnalyticsSeriesSnapshot[])
    : null;
  const hasPendingSeries = currentSnapshot !== null && Object.values(currentSnapshot.series).some(status => status === 'loading');
  const effectiveState: PipelineState = currentSnapshot === null || hasPendingSeries
    ? (currentSnapshot ? 'updating' : 'loading')
    : seriesSummary?.allFailed ? 'error'
      : seriesSummary?.isEmpty ? 'empty'
        : 'ready';
  const showCharts = currentSnapshot !== null && (effectiveState === 'ready' || effectiveState === 'updating');

  return (
    <View className="gap-6">
      {/* Date Range */}
      <View className="gap-2">
        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Time Frame</Text>
        <DateRangeControls from={from} to={to} setFrom={setFrom} setTo={setTo} maxDays={limits.maxDays} granularity={granularity} />
      </View>

      {/* Pipeline selector */}
      {pipelines.length > 1 && (
        <View className="gap-2">
          <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Pipeline</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="flex-row gap-2">
              {pipelines.map(p => (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setSelected(p.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Select pipeline ${p.name}`}
                  accessibilityState={{ selected: selectedPipeline === p.id }}
                  className={`min-h-[44px] px-4 py-2 rounded-xl border ${selectedPipeline === p.id ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                >
                  <Text className={`text-xs font-bold ${selectedPipeline === p.id ? 'text-brand-on-primary' : 'text-typography-main'}`}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      {!pipelinesLoaded ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading analytics" className="py-16 items-center"><ActivityIndicator color={colors.primary} /></View>
      ) : pipelines.length === 0 ? (
        <View className="bg-surface-card border border-surface-border rounded-2xl p-6 items-center gap-2">
          <Text className="text-typography-main font-black text-base">No Pipelines Found</Text>
          <Text className="text-typography-muted text-xs">Create a pipeline to see analytics.</Text>
        </View>
      ) : effectiveState === 'loading' ? (
        <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading analytics" className="py-16 items-center"><ActivityIndicator color={colors.primary} /></View>
      ) : effectiveState === 'error' ? (
        <View accessible accessibilityRole="alert" className="bg-surface-card border border-surface-border rounded-2xl p-6 items-center gap-3">
          <Text className="text-typography-main font-black text-base">Could not load analytics.</Text>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Retry"
            onPress={load}
            className="min-h-[44px] min-w-[44px] px-4 rounded-xl bg-brand-primary items-center justify-center"
          >
            <Text className="text-brand-on-primary font-black">Retry</Text>
          </TouchableOpacity>
        </View>
      ) : effectiveState === 'empty' ? (
        <View className="bg-surface-card border border-surface-border rounded-2xl p-6 items-center gap-2">
          <Text className="text-typography-main font-black text-base">No stage movement in this range.</Text>
          <Text className="text-typography-muted text-xs text-center">Try a longer date range or another pipeline.</Text>
        </View>
      ) : showCharts ? (
        <>
          {hasPendingSeries && (
            <View accessible accessibilityRole="progressbar" accessibilityLabel="Updating analytics" className="flex-row items-center gap-2">
              <ActivityIndicator size="small" color={colors.primary} />
              <Text className="text-typography-muted text-xs">Updating analytics</Text>
            </View>
          )}
          {/* Throughput chart */}
          {billingReady && limits.throughput && (
            <View className="bg-surface-card border border-surface-border rounded-2xl p-5">
              <Text className="text-typography-main font-black text-base mb-1">Completed tasks over time</Text>
              <Text className="text-typography-muted text-[10px] mb-5">Tasks completed vs failed per period</Text>
              {currentSnapshot.series.throughput === 'error' ? (
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="text-typography-muted text-sm flex-1">Completed task data is unavailable.</Text>
                  <TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel="Retry completed task data" className="min-h-[44px] px-3 rounded-xl bg-brand-primary items-center justify-center">
                    <Text className="text-brand-on-primary text-xs font-black">Retry</Text>
                  </TouchableOpacity>
                </View>
              ) : currentSnapshot.series.throughput === 'loading' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : <ThroughputChart data={currentSnapshot.throughput} />}
            </View>
          )}

          {/* Stage dwell chart */}
          <View className="bg-surface-card border border-surface-border rounded-2xl p-5">
            <Text className="text-typography-main font-black text-base mb-1">Stage dwell times</Text>
            <Text className="text-typography-muted text-[10px] mb-5">Avg time tasks spend per stage</Text>
            {currentSnapshot.series.dwell === 'error' ? (
              <View className="flex-row items-center justify-between gap-3">
                <Text className="text-typography-muted text-sm flex-1">Stage dwell data is unavailable.</Text>
                <TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel="Retry stage dwell data" className="min-h-[44px] px-3 rounded-xl bg-brand-primary items-center justify-center">
                  <Text className="text-brand-on-primary text-xs font-black">Retry</Text>
                </TouchableOpacity>
              </View>
            ) : currentSnapshot.series.dwell === 'loading' ? (
              <ActivityIndicator size="small" color={colors.primary} />
            ) : <DwellChart data={currentSnapshot.dwell} />}
          </View>

          {currentSnapshot.series.audit === 'error' ? (
            <View accessible accessibilityRole="alert" className="bg-surface-card border border-surface-border rounded-2xl p-4 flex-row items-center justify-between gap-3">
              <Text className="text-typography-muted text-sm flex-1">Summary data is unavailable for this range.</Text>
              <TouchableOpacity onPress={load} accessibilityRole="button" accessibilityLabel="Retry summary data" className="min-h-[44px] px-3 rounded-xl bg-brand-primary items-center justify-center">
                <Text className="text-brand-on-primary text-xs font-black">Retry</Text>
              </TouchableOpacity>
            </View>
          ) : currentSnapshot.auditData && <PipelineLoadDetails audit={currentSnapshot.auditData} />}
          {currentSnapshot.auditData && currentSnapshot.series.audit !== 'error' && billingReady && limits.funnel && <ConversionFunnelDetails audit={currentSnapshot.auditData} />}
        </>
      ) : null}
    </View>
  );
}

// ─── Personnel Tab ────────────────────────────────────────────────────────────

function PersonnelTab() {
  const colors = useThemeColors();
  const { comparePersonnel } = useAnalytics();
  const [users, setUsers]       = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [salaries, setSalaries] = useState<Record<string, string>>({});
  const [results, setResults]   = useState<PersonnelRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [ran, setRan]           = useState(false);

  const STORAGE_KEY = 'trustflow_personnel_salaries';

  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 30 * 86400000);
  const [from, setFrom] = useState(localIsoDay(defaultFrom));
  const [to, setTo]     = useState(localIsoDay(today));

  useEffect(() => {
    supabase.from('users').select('id, full_name, avatar_url').is('deleted_at', null).order('full_name')
      .then(({ data }) => setUsers(data ?? []));
    AsyncStorage.getItem(STORAGE_KEY).then(s => { if (s) setSalaries(JSON.parse(s)); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (Object.keys(salaries).length > 0) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(salaries)).catch(() => {});
  }, [salaries]);

  const toggleUser = (id: string) =>
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const handleRun = async () => {
    if (selected.length < 2) return;
    setLoading(true);
    setRan(false);
    try {
      const salaryMap: Record<string, number> = {};
      for (const [uid, v] of Object.entries(salaries)) {
        const n = parseFloat(v);
        if (!isNaN(n) && n > 0) salaryMap[uid] = n;
      }
      const data = await comparePersonnel(selected, from, to, salaryMap);
      setResults(data);
      setRan(true);
    } finally { setLoading(false); }
  };

  const personnelItems = users.map(u => ({
    id: u.id,
    label: u.full_name || 'Unnamed person',
    avatarUrl: u.avatar_url,
  }));

  return (
    <View className="gap-6">
      {/* Date Range */}
      <View className="gap-2">
        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Time Frame</Text>
        <DateRangeControls from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </View>

      {/* User selector */}
      <View className="gap-3">
        <SearchableMultiSelect
          title="Select personnel (minimum 2)"
          items={personnelItems}
          selectedIds={selected}
          onToggle={toggleUser}
          onClearSelection={() => setSelected([])}
          searchPlaceholder="Search personnel..."
          emptyText="No personnel match that search."
          flat
        />
      </View>

      {/* Salary inputs */}
      {selected.length > 0 && (
        <View className="gap-3">
          <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Daily rates (USD) - saved locally</Text>
          {selected.map(uid => {
            const u = users.find(x => x.id === uid);
            if (!u) return null;
            return (
              <View key={uid} className="flex-row items-center gap-3">
                <UserLink userId={uid} name={u.full_name} className="text-typography-main text-sm font-bold flex-1" numberOfLines={1} />
                <View className="flex-row items-center border border-surface-border bg-surface-card rounded-xl overflow-hidden">
                  <Text className="px-3 text-typography-dim text-sm">$</Text>
                  <TextInput
                    value={salaries[uid] ?? ''}
                    onChangeText={v => setSalaries(prev => ({ ...prev, [uid]: v }))}
                    placeholder="0.00"
                    keyboardType="numeric"
                    className="py-2 pr-3 text-typography-main text-sm w-24"
                  />
                </View>
              </View>
            );
          })}
        </View>
      )}

      <TouchableOpacity
        onPress={handleRun}
        disabled={selected.length < 2 || loading}
        className={`py-3.5 rounded-2xl items-center ${selected.length < 2 ? 'bg-surface-border' : 'bg-brand-primary'}`}
      >
        {loading
          ? <ActivityIndicator size="small" color="white" />
          : <Text className="text-brand-on-primary font-black uppercase tracking-widest text-xs">Run Comparison</Text>
        }
      </TouchableOpacity>

      {ran && results.length > 0 && (
        <View className="gap-4">
          {results.map(row => (
            <View key={row.user_id} className="bg-surface-card border border-surface-border rounded-2xl p-5">
              <UserLink userId={row.user_id} name={row.full_name} className="text-typography-main font-black text-base mb-4" />
              {[
                { label: 'Results (Pts)',  value: `${row.weight_points}` },
                { label: 'Effort (OPS)',   value: `${row.activity_count}` },
                { label: 'Active Hours',   value: `${row.active_hours.toFixed(1)}h` },
                { label: 'Completed',      value: `${row.completed_tasks}` },
                { label: 'On-time rate',   value: row.on_time_rate !== null ? `${row.on_time_rate.toFixed(1)}%` : '-' },
                { label: 'Timer efficiency', value: row.timer_efficiency !== null ? `${row.timer_efficiency.toFixed(1)}%` : '-' },
                { label: 'Cost per point', value: row.cost_per_point !== null ? `$${row.cost_per_point.toFixed(2)}/pt` : '-' },
                { label: 'Points per hour', value: row.points_per_hour !== null ? `${row.points_per_hour.toFixed(1)}/hr` : '-' },
              ].map((item, i, arr) => (
                <View key={item.label} className={`flex-row justify-between py-2 ${i < arr.length - 1 ? 'border-b border-surface-border/50' : ''}`}>
                  <Text className="text-typography-muted text-sm">{item.label}</Text>
                  <Text className="text-typography-main font-bold text-sm">{item.value}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ─── Root Screen ──────────────────────────────────────────────────────────────

export default function AdminAnalyticsNative() {
  const colors = useThemeColors();
  const { hasPermission, permissionsLoaded } = useAuth();
  // Rules-of-Hooks fix: useBillingPlan() used to be called AFTER the two
  // early returns below, so the first render (permissionsLoaded still
  // false) called 3 hooks and a later render called 3 + useBillingPlan's 8
  // -- "Rendered more hooks than during the previous render", reproduced by
  // simply loading this screen at native/narrow-web width. The desktop
  // sibling (_analytics_desktop.tsx) already calls it unconditionally
  // before its own early returns; this just matches that.
  const { limits: planLimits, loading: planLoading, error: planError, ready: billingReady } = useBillingPlan();
  const limits = getAnalyticsLimits(planLimits);
  const [activeTab, setActiveTab] = useState<AdminTab>('pipeline');

  useEffect(() => {
    if (billingReady && !limits.personnel && activeTab === 'personnel') {
      setActiveTab('pipeline');
    }
  }, [activeTab, billingReady, limits.personnel]);

  if (!permissionsLoaded) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <Stack.Screen options={{ title: 'Analytics' }} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!hasPermission('analytics.view')) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-10">
        <Stack.Screen options={{ title: 'Analytics' }} />
        <FontAwesome name="lock" size={40} color={colors.primary} />
        <Text className="text-typography-main font-black text-xl mt-6 mb-2 text-center">Access Restricted</Text>
        <Text className="text-typography-muted text-center">
          You need the analytics.view permission to access this screen.
        </Text>
      </View>
    );
  }

  if (planLoading) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center">
        <Stack.Screen options={{ title: 'Analytics' }} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (planError || !billingReady) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center px-6">
        <Stack.Screen options={{ title: 'Analytics' }} />
        <Text className="text-typography-muted text-sm text-center">Plan information unavailable.</Text>
      </View>
    );
  }

  const canCompare = hasPermission('analytics.compare');

  return (
    <ScrollView className="flex-1 bg-surface-background" contentContainerStyle={{ paddingBottom: 40 }}>
      <Stack.Screen options={{ title: 'Analytics Hub' }} />

      {/* Header */}
      <View className="px-6 pt-14 pb-6">
        <View className="flex-row items-start justify-between mb-4">
          <View className="flex-1">
            <Text className="text-brand-primary font-black uppercase tracking-[4px] text-[10px] mb-1">Operations Intelligence</Text>
            <Text className="text-typography-main text-3xl font-black tracking-tighter">Analytics Hub</Text>
          </View>
          <BackButton label="" fallbackHref="/intelligence" />
        </View>
      </View>

      {/* Tab switcher */}
      <View accessibilityRole="tablist" className="flex-row bg-surface-card border border-surface-border rounded-2xl p-1 mx-6 mb-6">
        <TouchableOpacity
          onPress={() => setActiveTab('pipeline')}
          accessibilityRole="tab"
          accessibilityLabel="Pipeline analytics tab"
          accessibilityState={{ selected: activeTab === 'pipeline' }}
          className={`flex-1 min-h-[44px] py-2.5 rounded-xl items-center justify-center ${activeTab === 'pipeline' ? 'bg-brand-primary' : ''}`}
        >
          <Text className={`text-xs font-black uppercase tracking-widest ${activeTab === 'pipeline' ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
            Pipeline
          </Text>
        </TouchableOpacity>
        {billingReady && limits.personnel && (
          <TouchableOpacity
            onPress={() => canCompare && setActiveTab('personnel')}
            disabled={!canCompare}
            accessibilityRole="tab"
            accessibilityLabel="Personnel comparison tab"
            accessibilityState={{ selected: activeTab === 'personnel', disabled: !canCompare }}
            className={`flex-1 min-h-[44px] py-2.5 rounded-xl items-center justify-center ${activeTab === 'personnel' ? 'bg-brand-primary' : ''} ${!canCompare ? 'opacity-40' : ''}`}
          >
            <Text className={`text-xs font-black uppercase tracking-widest ${activeTab === 'personnel' ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
              Personnel
            </Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => setActiveTab('portfolio')}
          accessibilityRole="tab"
          accessibilityLabel="Portfolio analytics tab"
          accessibilityState={{ selected: activeTab === 'portfolio' }}
          className={`flex-1 min-h-[44px] py-2.5 rounded-xl items-center justify-center ${activeTab === 'portfolio' ? 'bg-brand-primary' : ''}`}
        >
          <Text className={`text-xs font-black uppercase tracking-widest ${activeTab === 'portfolio' ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
            Portfolio
          </Text>
        </TouchableOpacity>
      </View>

      <View className="px-6">
        {activeTab === 'pipeline' && <PipelineTab limits={limits} billingReady={billingReady} />}
        {activeTab === 'portfolio' && <PortfolioFlowTab />}
        {activeTab === 'personnel' && canCompare && billingReady && limits.personnel && <PersonnelTab />}
        {activeTab === 'personnel' && billingReady && limits.personnel && !canCompare && (
          <View className="bg-surface-card border border-surface-border rounded-2xl p-10 items-center gap-3">
            <FontAwesome name="lock" size={28} color={colors.primary} />
            <Text className="text-typography-main font-black">Permission Required</Text>
            <Text className="text-typography-muted text-sm text-center">
              You need analytics.compare to access personnel benchmarking.
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}
