import { useAnalytics, StageDwell, ThroughputPeriod } from '@/contexts/AnalyticsContext';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

const PERIOD_OPTS = [
  { label: '4W',  type: 'week',  n: 4  },
  { label: '8W',  type: 'week',  n: 8  },
  { label: '6M',  type: 'month', n: 6  },
  { label: '12M', type: 'month', n: 12 },
];

const fmtSec = (s: number) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

export default function IntelligenceGraphsNative() {
  const { getPipelineStageDwell, getPipelineThroughput } = useAnalytics();

  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [pipelines, setPipelines]   = useState<any[]>([]);
  const [periodOpt, setPeriodOpt]   = useState(PERIOD_OPTS[1]);
  const [dwell, setDwell]           = useState<StageDwell[]>([]);
  const [throughput, setThroughput] = useState<ThroughputPeriod[]>([]);
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
      const [d, t] = await Promise.all([
        getPipelineStageDwell(pipelineId, from, to),
        getPipelineThroughput(pipelineId, periodOpt.type, periodOpt.n),
      ]);
      setDwell(d || []);
      setThroughput(t || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [pipelineId, periodOpt]);

  useEffect(() => { load(); }, [load]);

  const maxDwellSec = Math.max(1, ...dwell.map(d => d.avg_seconds));
  const maxThroughput = Math.max(1, ...throughput.map(t => t.tasks_succeeded + t.tasks_failed));

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
        <View className="flex-row bg-surface-card border border-surface-border rounded-xl p-1 gap-0.5 self-start">
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
          <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
        </View>
      ) : (
        <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>

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
                  : 'rgb(var(--brand-primary))';
                return (
                  <View key={s.stage_id} className="mb-3">
                    <View className="flex-row justify-between mb-1">
                      <Text className="text-typography-main text-xs font-bold flex-1 mr-2" numberOfLines={1}>
                        {s.stage_name}{s.is_bottleneck ? ' ⚠' : ''}
                      </Text>
                      <Text className="text-typography-muted text-xs">{fmtSec(s.avg_seconds)}</Text>
                    </View>
                    <View className="h-2 bg-surface-overlay rounded-full overflow-hidden">
                      <View style={{ width: `${pct}%`, backgroundColor: color }} className="h-full rounded-full" />
                    </View>
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
                    <View className="flex-row justify-between mb-1.5">
                      <Text className="text-typography-muted text-xs">{t.period_label}</Text>
                      <View className="flex-row gap-3">
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

          <View className="h-10" />
        </ScrollView>
      )}
    </View>
  );
}
