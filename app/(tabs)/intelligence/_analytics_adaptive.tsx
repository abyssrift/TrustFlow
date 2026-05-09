import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAnalytics, StageDwell, ThroughputPeriod, PersonnelRow } from '@/contexts/AnalyticsContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';

type AdminTab = 'pipeline' | 'personnel';

function fmtSeconds(s: number): string {
  if (s <= 0) return '0m';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─── Simple horizontal bar ────────────────────────────────────────────────────

function DwellBar({ stage, maxSeconds }: { stage: StageDwell; maxSeconds: number }) {
  const pct = maxSeconds > 0 ? (stage.avg_seconds / maxSeconds) * 100 : 0;
  const color =
    stage.is_bottleneck ? '#f59e0b' :
    stage.is_terminal && stage.terminal_type === 'success' ? '#22c55e' :
    stage.is_terminal && stage.terminal_type === 'failure' ? '#ef4444' :
    'rgb(99,102,241)';

  return (
    <View className="mb-4">
      <View className="flex-row justify-between mb-1">
        <Text className="text-typography-main text-xs font-bold flex-1 mr-4" numberOfLines={1}>
          {stage.stage_name}
          {stage.is_bottleneck ? ' ⚠' : ''}
        </Text>
        <Text className="text-typography-muted text-xs">{fmtSeconds(stage.avg_seconds)}</Text>
      </View>
      <View className="h-2 bg-surface-overlay rounded-full overflow-hidden">
        <View style={{ width: `${pct}%`, backgroundColor: color }} className="h-full rounded-full" />
      </View>
      <Text className="text-typography-dim text-[10px] mt-0.5">
        {stage.sample_count} samples · {stage.reversal_count} reversals
      </Text>
    </View>
  );
}

// ─── Pipeline Tab ─────────────────────────────────────────────────────────────

function PipelineTab() {
  const { getPipelineStageDwell, getPipelineThroughput } = useAnalytics();
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string | null>(null);
  const [period, setPeriod] = useState('month');

  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(today.getDate() - 30);
  const [from, setFrom] = useState(defaultFrom.toISOString().split('T')[0]);
  const [to, setTo]     = useState(today.toISOString().split('T')[0]);

  const [dwell, setDwell]           = useState<StageDwell[]>([]);
  const [throughput, setThroughput] = useState<ThroughputPeriod[]>([]);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    supabase
      .from('pipelines')
      .select('id, name')
      .is('deleted_at', null)
      .order('name')
      .then(({ data }) => {
        if (data?.length) {
          setPipelines(data);
          setSelectedPipeline(data[0].id);
        }
      });
  }, []);

  const load = useCallback(async () => {
    if (!selectedPipeline) return;
    setLoading(true);
    try {
      const [d, t] = await Promise.all([
        getPipelineStageDwell(selectedPipeline, from, to),
        getPipelineThroughput(selectedPipeline, period, 8),
      ]);
      setDwell(d);
      setThroughput(t);
    } finally {
      setLoading(false);
    }
  }, [selectedPipeline, from, to, period]);

  useEffect(() => { load(); }, [load]);

  const maxDwellSeconds = Math.max(1, ...dwell.map(d => d.avg_seconds));

  return (
    <View className="gap-6">
      {/* Pipeline selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View className="flex-row gap-2 pb-2">
          {pipelines.map(p => (
            <TouchableOpacity
              key={p.id}
              onPress={() => setSelectedPipeline(p.id)}
              className={`px-4 py-2 rounded-xl border ${
                selectedPipeline === p.id ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'
              }`}
            >
              <Text className={`text-xs font-bold ${selectedPipeline === p.id ? 'text-white' : 'text-typography-main'}`}>
                {p.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Date range */}
      <View className="gap-2">
        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Date Range</Text>
        <View className="flex-row flex-wrap gap-3 items-center">
          <TextInput
            value={from}
            onChangeText={setFrom}
            placeholder="YYYY-MM-DD"
            className="flex-1 bg-surface-card border border-surface-border rounded-xl px-4 py-2 text-typography-main text-sm"
          />
          <Text className="text-typography-dim">→</Text>
          <TextInput
            value={to}
            onChangeText={setTo}
            placeholder="YYYY-MM-DD"
            className="flex-1 bg-surface-card border border-surface-border rounded-xl px-4 py-2 text-typography-main text-sm"
          />
        </View>
      </View>

      {loading ? (
        <View className="py-16 items-center">
          <ActivityIndicator color="var(--color-primary)" />
        </View>
      ) : (
        <>
          {/* Stage dwell */}
          <View className="bg-surface-card border border-surface-border rounded-2xl p-5">
            <Text className="text-typography-main font-black text-base mb-5">Stage Dwell Times</Text>
            {dwell.length === 0 ? (
              <Text className="text-typography-muted text-sm">No activity in this period.</Text>
            ) : (
              dwell
                .slice()
                .sort((a, b) => a.stage_position - b.stage_position)
                .map(s => <DwellBar key={s.stage_id} stage={s} maxSeconds={maxDwellSeconds} />)
            )}
          </View>

          {/* Throughput summary */}
          <View className="bg-surface-card border border-surface-border rounded-2xl p-5">
            <Text className="text-typography-main font-black text-base mb-4">Recent Throughput</Text>
            {throughput.length === 0 ? (
              <Text className="text-typography-muted text-sm">No throughput data.</Text>
            ) : (
              [...throughput].reverse().slice(0, 6).map((t, i) => (
                <View
                  key={i}
                  className={`flex-row justify-between items-center py-3 ${i < Math.min(throughput.length, 6) - 1 ? 'border-b border-surface-border/50' : ''}`}
                >
                  <Text className="text-typography-muted text-xs">{t.period_label}</Text>
                  <View className="flex-row flex-wrap justify-end gap-4 flex-1">
                    <Text className="text-[var(--color-success)] text-xs font-bold">↑ {t.tasks_succeeded}</Text>
                    <Text className="text-[var(--color-danger)] text-xs font-bold">↓ {t.tasks_failed}</Text>
                    {t.success_rate !== null && (
                      <Text className="text-typography-dim text-xs">{t.success_rate.toFixed(0)}%</Text>
                    )}
                  </View>
                </View>
              ))
            )}
          </View>
        </>
      )}
    </View>
  );
}

// ─── Personnel Tab ────────────────────────────────────────────────────────────

function PersonnelTab() {
  const { comparePersonnel } = useAnalytics();
  const [users, setUsers]       = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [salaries, setSalaries] = useState<Record<string, string>>({});
  const [results, setResults]   = useState<PersonnelRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [ran, setRan]           = useState(false);
  const [search, setSearch]     = useState('');

  const STORAGE_KEY = 'trustflow_personnel_salaries';

  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(today.getDate() - 30);
  const [from, setFrom] = useState(defaultFrom.toISOString().split('T')[0]);
  const [to, setTo]     = useState(today.toISOString().split('T')[0]);

  useEffect(() => {
    supabase
      .from('users')
      .select('id, full_name')
      .is('deleted_at', null)
      .order('full_name')
      .then(({ data }) => setUsers(data ?? []));

    // Load persisted salaries
    const loadSalaries = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) setSalaries(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load salaries', e);
      }
    };
    loadSalaries();
  }, []);

  // Persist salaries
  useEffect(() => {
    if (Object.keys(salaries).length > 0) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(salaries));
    }
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
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="gap-6">
      {/* User selector */}
      <View className="gap-3">
        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">
        </Text>
        
        {/* Search */}
        <View className="mb-2 bg-surface-card border border-surface-border rounded-xl px-3 flex-row items-center">
          <FontAwesome name="search" size={12} color="rgb(100,116,139)" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search personnel..."
            placeholderTextColor="rgba(100,116,139,0.5)"
            className="flex-1 ml-2 py-2 text-typography-main text-xs"
          />
        </View>

        <View className="flex-row flex-wrap gap-2">
          {users
            .filter(u => u.full_name.toLowerCase().includes(search.toLowerCase()))
            .map(u => {
              const isSelected = selected.includes(u.id);
              return (
                <TouchableOpacity
                  key={u.id}
                  onPress={() => toggleUser(u.id)}
                  className={`px-3 py-2 rounded-xl border ${
                    isSelected ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'
                  }`}
                >
                  <Text className={`text-xs font-bold ${isSelected ? 'text-white' : 'text-typography-main'}`}>
                    {u.full_name}
                  </Text>
                </TouchableOpacity>
              );
            })}
        </View>
      </View>

      {/* Date range */}
      <View className="gap-2">
        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Date Range</Text>
        <View className="flex-row flex-wrap gap-3 items-center">
          <TextInput
            value={from}
            onChangeText={setFrom}
            className="flex-1 bg-surface-card border border-surface-border rounded-xl px-4 py-2 text-typography-main text-sm"
          />
          <Text className="text-typography-dim">→</Text>
          <TextInput
            value={to}
            onChangeText={setTo}
            className="flex-1 bg-surface-card border border-surface-border rounded-xl px-4 py-2 text-typography-main text-sm"
          />
        </View>
      </View>

      {/* Salary inputs */}
      {selected.length > 0 && (
        <View className="gap-3">
          <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">
            Daily Rates (USD) — Persisted Locally
          </Text>
          {selected.map(uid => {
            const u = users.find(x => x.id === uid);
            if (!u) return null;
            return (
              <View key={uid} className="flex-row flex-wrap items-center gap-3">
                <Text className="text-typography-main text-sm font-bold flex-1" numberOfLines={1}>{u.full_name}</Text>
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
        className={`py-3 rounded-2xl items-center ${selected.length < 2 ? 'bg-surface-border' : 'bg-brand-primary'}`}
      >
        {loading
          ? <ActivityIndicator size="small" color="white" />
          : <Text className="text-white font-black uppercase tracking-widest text-xs">Run Comparison</Text>
        }
      </TouchableOpacity>

      {ran && results.length > 0 && (
        <View className="gap-4">
          {results.map(row => (
            <View key={row.user_id} className="bg-surface-card border border-surface-border rounded-2xl p-5">
              <Text className="text-typography-main font-black text-base mb-4">{row.full_name}</Text>
              {[
                { label: 'Results (Pts)',  value: `${row.weight_points}` },
                { label: 'Effort (OPS)',    value: `${row.activity_count}` },
                { label: 'Active Hours',   value: `${row.active_hours.toFixed(1)}h` },
                { label: 'Completed',      value: `${row.completed_tasks}` },
                { label: 'On-Time Rate',   value: row.on_time_rate !== null ? `${row.on_time_rate.toFixed(1)}%` : '—' },
                { label: 'Timer Eff.',     value: row.timer_efficiency !== null ? `${row.timer_efficiency.toFixed(1)}%` : '—' },
                { label: 'Cost/Point',     value: row.cost_per_point !== null ? `$${row.cost_per_point.toFixed(2)}/pt` : '—' },
                { label: 'Points/Hour',    value: row.points_per_hour !== null ? `${row.points_per_hour.toFixed(1)}/hr` : '—' },
              ].map((item, i, arr) => (
                <View
                  key={item.label}
                  className={`flex-row justify-between py-2 ${i < arr.length - 1 ? 'border-b border-surface-border/50' : ''}`}
                >
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
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('pipeline');

  if (!hasPermission('analytics.view')) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-10">
        <Stack.Screen options={{ title: 'Analytics' }} />
        <FontAwesome name="lock" size={40} color="var(--color-primary)" />
        <Text className="text-typography-main font-black text-xl mt-6 mb-2 text-center">Access Restricted</Text>
        <Text className="text-typography-muted text-center">
          You need the analytics.view permission to access this screen.
        </Text>
      </View>
    );
  }

  const canCompare = hasPermission('analytics.compare');

  return (
    <ScrollView className="flex-1 bg-surface-background">
      <Stack.Screen options={{ title: 'Analytics Hub' }} />
      <View className="p-6">
        {/* Header */}
        <View className="mb-6">
          <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[10px] mb-1">
            Operations Intelligence
          </Text>
          <Text className="text-typography-main text-3xl font-black tracking-tighter">Analytics Hub</Text>
        </View>

        {/* Tab switcher */}
        <View className="flex-row bg-surface-card border border-surface-border rounded-2xl p-1 mb-8">
          <TouchableOpacity
            onPress={() => setActiveTab('pipeline')}
            className={`flex-1 py-2.5 rounded-xl items-center ${activeTab === 'pipeline' ? 'bg-brand-primary' : 'bg-transparent'}`}
          >
            <Text className={`text-xs font-black uppercase tracking-widest ${activeTab === 'pipeline' ? 'text-white' : 'text-typography-muted'}`}>
              Pipeline
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => canCompare && setActiveTab('personnel')}
            disabled={!canCompare}
            className={`flex-1 py-2.5 rounded-xl items-center ${activeTab === 'personnel' ? 'bg-brand-primary' : 'bg-transparent'} ${!canCompare ? 'opacity-40' : ''}`}
          >
            <Text className={`text-xs font-black uppercase tracking-widest ${activeTab === 'personnel' ? 'text-white' : 'text-typography-muted'}`}>
              Personnel
            </Text>
          </TouchableOpacity>
        </View>

        {activeTab === 'pipeline' && <PipelineTab />}
        {activeTab === 'personnel' && canCompare && <PersonnelTab />}
        {activeTab === 'personnel' && !canCompare && (
          <View className="bg-surface-card border border-surface-border rounded-2xl p-10 items-center gap-3">
            <FontAwesome name="lock" size={28} color="var(--color-primary)" />
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
