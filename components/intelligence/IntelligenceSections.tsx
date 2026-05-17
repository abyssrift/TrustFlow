import { StageDwell, ThroughputPeriod, useAnalytics } from '@/contexts/AnalyticsContext';
import { FontAwesome } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ComposedChart,
    Legend,
    Line,
    Tooltip as RechartTooltip, ResponsiveContainer,
    XAxis, YAxis,
} from 'recharts';
import { CircularTargetCard, KPIBoxWeb } from './IntelligenceCommon';
import {
    ConversionFunnelChartWeb,
    QualityLeaderboardWeb,
    SLARiskAlertWeb,
    TrendComparisonCardsWeb,
    WorkDistributionChartWeb
} from './RadarWidgets';

export const RadarSectionWeb = ({ data, activeWidgets, onEditWidgets }: any) => {
  if (!data) return null;
  const curThr = data.current?.throughput || 0;
  const prevThr = data.comparison?.throughput || 0;
  const adv = data.radar_advanced || {};
  const curr = data.current || {};
  const renderWidget = (key: string, idx: number) => {
    switch (key) {
      case 'throughput': return <KPIBoxWeb key={idx} label="Throughput" val={curThr} delta={curThr - prevThr} />;
      case 'efficiency': return <KPIBoxWeb key={idx} label="Efficiency" val={`${Math.round(curr.success_rate || 0)}%`} delta={undefined} />;
      case 'flow_ratio': return <KPIBoxWeb key={idx} label="Flow Ratio" val={adv.flow_ratio || 'N/A'} delta={undefined} />;
      case 'first_pass_yield': return <KPIBoxWeb key={idx} label="First-Pass Integrity" val={`${adv.first_pass_yield || 0}%`} delta={undefined} />;
      case 'automation_offload': return <KPIBoxWeb key={idx} label="Automation Score" val={`${adv.automation_offload_rate || 0}%`} delta={undefined} />;
      default: return null;
    }
  };
  return (
    <View className="flex-row flex-wrap gap-8">
      <View className="w-full">
        <View className="flex-row justify-between items-center mb-6">
          <Text className="text-typography-main font-black text-2xl tracking-tight">Performance Metrics</Text>
          <TouchableOpacity onPress={onEditWidgets} className="bg-surface-card px-4 py-2 rounded-xl border border-surface-border">
            <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">Configure Dashboard</Text>
          </TouchableOpacity>
        </View>
        <View className="flex-row flex-wrap gap-6">
          {activeWidgets.map((w: string, i: number) => renderWidget(w, i))}
        </View>
      </View>
      <View className="w-full flex-row gap-8">
        <View className="flex-1">
          <SLARiskAlertWeb data={data} />
        </View>
        <View className="flex-1">
          <ConversionFunnelChartWeb data={data} />
        </View>
      </View>
      <View className="w-full flex-row gap-8">
        <View className="flex-1">
          <WorkDistributionChartWeb data={data} />
        </View>
        <View className="flex-1">
          <QualityLeaderboardWeb data={data} />
        </View>
      </View>
      <View className="w-full">
        <TrendComparisonCardsWeb data={data} />
      </View>
    </View>
  );
};

export const TargetsSectionWeb = ({ targets, onUpdate, onNew }: any) => {
  const handleEditTarget = (target: any) => {
    const newVal = window.prompt('Enter new target value:', target.target_type === 'volume' ? target.target_quantity : target.target_active_seconds);
    if (newVal) onUpdate(target.id, target.target_type === 'volume' ? 'target_quantity' : 'target_active_seconds', newVal);
  };

  return (
    <View>
      <View className="flex-row justify-between items-center mb-10">
        <Text className="text-typography-main font-black text-3xl tracking-tight">Active Objectives</Text>
        <TouchableOpacity
          onPress={onNew}
          className="bg-brand-primary px-8 py-4 rounded-2xl premium-shadow flex-row items-center"
        >
          <View className="mr-3">
            <FontAwesome name="plus" size={14} className="text-brand-on-primary" />
          </View>
          <Text className="text-brand-on-primary font-black uppercase tracking-widest text-xs">New Benchmark</Text>
        </TouchableOpacity>
      </View>
      <View className="flex-row flex-wrap gap-8">
        {targets.map((t: any, i: number) => (
          <View key={i}>
            <CircularTargetCard target={t} onEdit={() => handleEditTarget(t)} />
          </View>
        ))}
      </View>
    </View>
  );
};

export const ArchivesSectionWeb = ({ reports, archives, search, activeSchema, onSearch, onDownload, onNew, onRefresh, onRestore, onViewSnapshot, hasPermission }: any) => {
  const [subSection, setSubSection] = useState<'reports' | 'cold_storage'>('reports');

  useEffect(() => {
    if (subSection === 'cold_storage' && !hasPermission('archive.view')) {
      setSubSection('reports');
    }
  }, [subSection, hasPermission]);

  return (
    <View>
      <View className="flex-row flex-wrap gap-2 bg-surface-card rounded-2xl p-1.5 border border-surface-border mb-10 w-full max-w-full">
        {['reports', 'cold_storage'].map((s) => (
          <TouchableOpacity
            key={s}
            onPress={() => setSubSection(s as any)}
            className={`px-5 py-3 rounded-xl items-center flex-row justify-center flex-1 min-w-[140px] ${subSection === s ? 'bg-brand-primary premium-shadow' : 'hover:bg-surface-background'}`}
          >
            <Text className={`font-black text-[10px] uppercase tracking-widest text-center ${subSection === s ? 'text-brand-on-primary' : 'text-typography-muted'}`} numberOfLines={1}>
              {s.replace('_', ' ')}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {subSection === 'reports' ? (
        <View>
          <View className="flex-row justify-between items-center mb-10">
            <Text className="text-typography-main font-black text-3xl tracking-tight">Audit Repositories</Text>
            <TouchableOpacity onPress={onNew} className="bg-brand-primary px-8 py-4 rounded-2xl premium-shadow flex-row items-center">
              <View className="mr-3">
                <FontAwesome name="plus" size={14} className="text-brand-on-primary" />
              </View>
              <Text className="text-brand-on-primary font-black uppercase tracking-widest text-xs">New Report Request</Text>
            </TouchableOpacity>
          </View>
          <View className="flex-row flex-wrap gap-6">
            {reports.map((r: any, i: number) => (
              <TouchableOpacity key={i} onPress={() => r.file_url && onDownload(r.file_url)} className="w-full md:w-[calc(50%-12px)] lg:w-[calc(33.33%-16px)] xl:w-[calc(20%-20px)] bg-surface-card p-5 rounded-2xl border border-surface-border premium-shadow hover:border-brand-primary transition-all">
                <View className={`w-10 h-10 rounded-xl items-center justify-center mb-4 ${r.status === 'completed' ? 'bg-state-success/10' : 'bg-state-info/10'}`}>
                  <FontAwesome name="file-pdf-o" size={16} color={r.status === 'completed' ? 'var(--color-success)' : 'var(--color-primary)'} />
                </View>
                <Text className="text-typography-main font-black text-sm mb-1" numberOfLines={1}>Audit Report #{r.id.substring(0, 8).toUpperCase()}</Text>
                <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-surface-border/50">
                  <Text className="text-typography-muted text-[8px] font-bold uppercase tracking-widest">{new Date(r.created_at).toLocaleDateString()}</Text>
                  <View className={`px-2 py-0.5 rounded-full ${r.status === 'completed' ? 'bg-state-success/10' : 'bg-brand-primary/10'}`}>
                    <Text className={`text-[8px] font-black uppercase ${r.status === 'completed' ? 'text-state-success' : 'text-brand-primary'}`}>{r.status}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ) : (
        <View>
          <View className="flex-row justify-between items-center mb-10">
            <View className="flex-1 max-w-xl">
              <Text className="text-typography-main font-black text-3xl tracking-tight mb-4">Cold Storage Browser</Text>
              <View className="flex-row bg-surface-card rounded-2xl border border-surface-border px-6 py-4 items-center focus-within:border-brand-primary transition-all">
                <View className="mr-4">
                  <FontAwesome name="search" size={16} color="var(--color-text-dim)" />
                </View>
                <TextInput value={search} onChangeText={onSearch} placeholder="Search snapshots by ID, metadata, or title..." className="flex-1 text-typography-main font-bold outline-none" placeholderTextColor="var(--color-text-muted)" />
              </View>
            </View>
            <TouchableOpacity onPress={onRefresh} className="h-14 w-14 items-center justify-center bg-surface-card border border-surface-border rounded-2xl premium-shadow hover:border-brand-primary">
              <FontAwesome name="refresh" size={16} color="var(--color-primary)" />
            </TouchableOpacity>
          </View>
          <View className="flex-row flex-wrap gap-4">
            {archives.map((archive: any) => {
              const pipelineId = archive.metadata?.pipeline_id;
              const hasIntegrityIssue = pipelineId && !activeSchema.pipelines.has(pipelineId);
              return (
                <View key={archive.id} className="w-full md:w-[calc(50%-8px)] lg:w-[calc(33.33%-11px)] xl:w-[calc(16.66%-14px)] bg-surface-card p-4 rounded-2xl border border-surface-border premium-shadow">
                  <View className="flex-row justify-between mb-3">
                    <View className={`w-9 h-9 rounded-lg items-center justify-center ${archive.restored_at ? 'bg-state-success/10' : 'bg-surface-background'}`}>
                      <FontAwesome name={archive.entity_type === 'project' ? 'briefcase' : 'tasks'} size={14} color={archive.restored_at ? 'var(--color-success)' : 'var(--color-primary)'} />
                    </View>
                    <View className="flex-row gap-1">
                       {hasIntegrityIssue && (
                         <View className="bg-state-danger/10 px-1.5 py-0.5 rounded-md">
                           <FontAwesome name="warning" size={8} color="var(--color-danger)" />
                         </View>
                       )}
                       <View className="bg-surface-background px-2 py-0.5 rounded-md border border-surface-border">
                          <Text className="text-typography-muted text-[8px] font-black uppercase tracking-widest">{archive.entity_type}</Text>
                       </View>
                    </View>
                  </View>
                  <Text className="text-typography-main font-black text-xs mb-3 h-8" numberOfLines={2}>
                    {archive.metadata?.title || archive.metadata?.name || 'Untitled Snapshot'}
                  </Text>
                  <View className="space-y-2 mb-4">
                    <View className="flex-row justify-between">
                       <Text className="text-typography-muted text-[8px] font-bold">Date</Text>
                       <Text className="text-typography-main text-[8px] font-black">{new Date(archive.archived_at).toLocaleDateString()}</Text>
                    </View>
                    <View className="flex-row justify-between">
                       <Text className="text-typography-muted text-[8px] font-bold">Status</Text>
                       <Text className={`text-[8px] font-black ${hasIntegrityIssue ? 'text-state-danger' : 'text-state-success'}`}>{hasIntegrityIssue ? 'FAIL' : 'OK'}</Text>
                    </View>
                  </View>
                  <View className="flex-row gap-2 pt-4 border-t border-surface-border/50">
                    <TouchableOpacity onPress={() => onViewSnapshot(archive)} className="flex-1 py-2 rounded-lg bg-surface-background border border-surface-border items-center">
                       <Text className="text-typography-muted font-black uppercase tracking-widest text-[8px]">Inspect</Text>
                    </TouchableOpacity>
                    {!archive.restored_at && !hasIntegrityIssue && hasPermission('archive.restore') && (
                      <TouchableOpacity onPress={() => onRestore(archive)} className="flex-1 py-2 rounded-lg bg-brand-primary items-center">
                         <Text className="text-brand-on-primary font-black uppercase tracking-widest text-[8px]">Restore</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </View>
  );
};

// ─── Analytics Section ────────────────────────────────────────────────────────

function fmtSec(s: number): string {
  if (s <= 0) return '0m';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const DwellTip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d: StageDwell = payload[0]?.payload;
  return (
    <View className="bg-surface-overlay border border-surface-border rounded-xl p-3">
      <Text className="text-typography-main font-black text-xs mb-1">{d.stage_name}</Text>
      <Text className="text-typography-muted text-[10px]">Avg: {fmtSec(d.avg_seconds)} · Median: {fmtSec(d.median_seconds)}</Text>
      <Text className="text-typography-muted text-[10px]">{d.sample_count} samples · {d.reversal_count} reversals</Text>
      {d.is_bottleneck && <Text className="text-state-warning text-[10px] font-black mt-1">Bottleneck</Text>}
    </View>
  );
};

const ThroughputTip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <View className="bg-surface-overlay border border-surface-border rounded-xl p-3">
      <Text className="text-typography-dim text-[10px] mb-1">{label}</Text>
      {payload.map((p: any) => (
        <Text key={p.dataKey} className="text-xs font-bold" style={{ color: p.color }}>{p.name}: {p.value}</Text>
      ))}
    </View>
  );
};

export const AnalyticsSectionWeb = ({ pipelines }: { pipelines: any[] }) => {
  const { getPipelineStageDwell, getPipelineThroughput } = useAnalytics();

  const today   = new Date();
  const defFrom = new Date(today);
  defFrom.setDate(today.getDate() - 30);

  const [pipelineId, setPipelineId] = useState<string | null>(pipelines[0]?.id ?? null);
  const [period, setPeriod]         = useState('month');
  const [from, setFrom]             = useState(defFrom.toISOString().split('T')[0]);
  const [to, setTo]                 = useState(today.toISOString().split('T')[0]);
  const [dwell, setDwell]           = useState<StageDwell[]>([]);
  const [throughput, setThroughput] = useState<ThroughputPeriod[]>([]);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    if (pipelines.length && !pipelineId) setPipelineId(pipelines[0].id);
  }, [pipelines]);

  const load = useCallback(async () => {
    if (!pipelineId) return;
    setLoading(true);
    try {
      const [d, t] = await Promise.all([
        getPipelineStageDwell(pipelineId, from, to),
        getPipelineThroughput(pipelineId, period, 12),
      ]);
      setDwell(d);
      setThroughput(t);
    } finally {
      setLoading(false);
    }
  }, [pipelineId, from, to, period]);

  useEffect(() => { load(); }, [load]);

  const dwellData = [...dwell]
    .sort((a, b) => a.stage_position - b.stage_position)
    .map(d => ({ ...d, avg_min: parseFloat((d.avg_seconds / 60).toFixed(1)) }));

  const throughputData = [...throughput].reverse();

  const getDwellColor = (d: StageDwell) => {
    if (d.is_bottleneck) return 'var(--color-warning)';
    if (d.is_terminal && d.terminal_type === 'success') return 'var(--color-success)';
    if (d.is_terminal && d.terminal_type === 'failure') return 'var(--color-danger)';
    return 'var(--color-primary)';
  };

  return (
    <View className="gap-10">
      <View className="flex-row items-start justify-between">
        <View>
          <Text className="text-typography-main font-black text-3xl tracking-tight">Pipeline Analytics</Text>
          <Text className="text-typography-muted text-sm mt-1">
            Stage dwell times, throughput trends, and bottleneck detection.
          </Text>
        </View>
        <TouchableOpacity
          onPress={() => router.push('/intelligence/analytics' as any)}
          className="bg-brand-primary px-8 py-4 rounded-2xl flex-row items-center"
        >
          <FontAwesome name="bar-chart" size={14} className="text-brand-on-primary mr-2.5" />
          <Text className="text-brand-on-primary font-black uppercase tracking-widest text-xs">Full Analytics Hub</Text>
        </TouchableOpacity>
      </View>

      {/* Controls */}
      <View className="flex-row gap-6 flex-wrap items-end">
        <View className="flex-1 min-w-[200px]">
          <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest mb-2">Pipeline</Text>
          <View className="flex-row flex-wrap gap-2">
            {pipelines.map(p => (
              <TouchableOpacity
                key={p.id}
                onPress={() => setPipelineId(p.id)}
                className={`px-4 py-2 rounded-xl border ${pipelineId === p.id ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border hover:bg-surface-overlay'}`}
              >
                <Text className={`text-xs font-bold ${pipelineId === p.id ? 'text-brand-on-primary' : 'text-typography-main'}`}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Date Range</Text>
          <View className="flex-row gap-3 items-center">
            <TextInput value={from} onChangeText={setFrom} className="bg-surface-card border border-surface-border rounded-xl px-4 py-2 text-typography-main text-sm w-36" />
            <Text className="text-typography-dim">to</Text>
            <TextInput value={to} onChangeText={setTo} className="bg-surface-card border border-surface-border rounded-xl px-4 py-2 text-typography-main text-sm w-36" />
          </View>
        </View>

        <View className="gap-2">
          <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Throughput Period</Text>
          <View className="flex-row gap-2">
            {['week', 'month', 'year'].map(p => (
              <TouchableOpacity
                key={p}
                onPress={() => setPeriod(p)}
                className={`px-4 py-2 rounded-xl border ${period === p ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
              >
                <Text className={`text-xs font-black uppercase ${period === p ? 'text-brand-on-primary' : 'text-typography-muted'}`}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      {loading ? (
        <View className="py-20 items-center">
          <ActivityIndicator size="large" color="var(--color-primary)" />
        </View>
      ) : (
        <View className="gap-8">
          {/* Stage dwell chart */}
          <View className="bg-surface-card border border-surface-border rounded-[32px] p-8">
            <View className="flex-row items-center justify-between mb-6">
              <Text className="text-typography-main font-black text-xl">Stage Dwell Times</Text>
              <View className="flex-row gap-4">
                {[['var(--color-warning)','Bottleneck'],['var(--color-success)','Success'],['var(--color-danger)','Failure']].map(([c,l]) => (
                  <View key={l} className="flex-row items-center gap-1.5">
                    <View className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c }} />
                    <Text className="text-typography-dim text-[10px]">{l}</Text>
                  </View>
                ))}
              </View>
            </View>
            {dwellData.length === 0 ? (
              <Text className="text-typography-muted text-sm py-8 text-center">No stage activity in this period.</Text>
            ) : (
              <View style={{ height: 280, width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dwellData} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(51,65,85,0.4)" horizontal={false} />
                    <XAxis type="number" dataKey="avg_min" tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}m`} />
                    <YAxis type="category" dataKey="stage_name" width={130} tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <RechartTooltip content={<DwellTip />} />
                    <Bar dataKey="avg_min" radius={[0, 6, 6, 0]} maxBarSize={24}>
                      {dwellData.map((e, i) => <Cell key={i} fill={getDwellColor(e)} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </View>
            )}
          </View>

          {/* Throughput chart */}
          <View className="bg-surface-card border border-surface-border rounded-[32px] p-8">
            <Text className="text-typography-main font-black text-xl mb-6">Throughput Trend</Text>
            {throughputData.length === 0 ? (
              <Text className="text-typography-muted text-sm py-8 text-center">No throughput data in this period.</Text>
            ) : (
              <View style={{ height: 280, width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={throughputData} margin={{ top: 5, right: 30, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(51,65,85,0.4)" vertical={false} />
                    <XAxis dataKey="period_label" tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="tasks" tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="rate" orientation="right" domain={[0, 100]} tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `${v}%`} />
                    <RechartTooltip content={<ThroughputTip />} />
                    <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-text-dim)' }} />
                    <Bar yAxisId="tasks" dataKey="tasks_succeeded" name="Succeeded" fill="var(--color-success)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Bar yAxisId="tasks" dataKey="tasks_failed" name="Failed" fill="var(--color-danger)" radius={[4, 4, 0, 0]} maxBarSize={28} />
                    <Line yAxisId="rate" type="monotone" dataKey="success_rate" name="Success Rate %" stroke="var(--color-primary)" strokeWidth={2} dot={{ r: 3, fill: 'var(--color-primary)', strokeWidth: 0 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </View>
            )}
          </View>
        </View>
      )}
    </View>
  );
};
