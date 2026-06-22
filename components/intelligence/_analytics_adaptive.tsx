import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';
import DraggableSheet from '@/components/common/DraggableSheet';
import { BackButton } from '@/components/common/BackButton';
import { PersonnelRow, StageDwell, ThroughputPeriod, useAnalytics } from '@/contexts/AnalyticsContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Stack } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { useThemeColors } from '@/hooks/useThemeColors';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

type AdminTab = 'pipeline' | 'personnel';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtSeconds(s: number): string {
  if (s <= 0) return '0m';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const PRESETS = [
  { label: '7D',  days: 7  },
  { label: '30D', days: 30 },
  { label: '90D', days: 90 },
];

// ─── Calendar Modal ───────────────────────────────────────────────────────────

function CalendarModal({ visible, title, value, onSelect, onClose }: {
  visible: boolean; title: string; value: string; onSelect: (d: string) => void; onClose: () => void;
}) {
  const colors = useThemeColors();
  return (
    <DraggableSheet
      visible={visible}
      onClose={onClose}
      dimBackdrop
      containerClassName="bg-surface-card border-t border-surface-border rounded-t-[32px] overflow-hidden"
    >
          <View className="px-6 pt-2 pb-4 flex-row justify-between items-center border-b border-surface-border">
            <Text className="text-typography-main font-black text-lg">{title}</Text>
            <TouchableOpacity onPress={onClose} className="w-8 h-8 rounded-full bg-surface-background border border-surface-border items-center justify-center">
              <FontAwesome name="times" size={12} color={colors.textDim} />
            </TouchableOpacity>
          </View>
          <PremiumCalendarPicker
            selectedDate={value}
            onSelect={d => { onSelect(d); onClose(); }}
            compact
          />
    </DraggableSheet>
  );
}

// ─── Date Range Controls ──────────────────────────────────────────────────────

function DateRangeControls({ from, to, setFrom, setTo }: {
  from: string; to: string; setFrom: (d: string) => void; setTo: (d: string) => void;
}) {
  const colors = useThemeColors();
  const [activePreset, setActivePreset] = useState<number | null>(30);
  const [showFrom, setShowFrom] = useState(false);
  const [showTo, setShowTo] = useState(false);

  const applyPreset = (days: number) => {
    const today = new Date();
    const start = new Date(today.getTime() - days * 86400000);
    setFrom(start.toISOString().split('T')[0]);
    setTo(today.toISOString().split('T')[0]);
    setActivePreset(days);
  };

  return (
    <View className="gap-3">
      {/* Quick presets */}
      <View className="flex-row gap-2">
        {PRESETS.map(p => (
          <TouchableOpacity
            key={p.label}
            onPress={() => applyPreset(p.days)}
            className={`px-4 py-2 rounded-xl border ${activePreset === p.days ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
          >
            <Text className={`text-xs font-black ${activePreset === p.days ? 'text-white' : 'text-typography-muted'}`}>{p.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          onPress={() => { setActivePreset(null); setShowFrom(true); }}
          className={`px-4 py-2 rounded-xl border flex-row items-center gap-2 ${activePreset === null ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
        >
          <FontAwesome name="calendar" size={11} color={activePreset === null ? '#fff' : colors.textMuted} />
          <Text className={`text-xs font-black ${activePreset === null ? 'text-white' : 'text-typography-muted'}`}>Custom</Text>
        </TouchableOpacity>
      </View>

      {/* Date buttons — visible when custom is active */}
      {activePreset === null && (
        <View className="flex-row gap-2 items-center">
          <TouchableOpacity
            onPress={() => setShowFrom(true)}
            className="flex-1 bg-surface-card border border-surface-border rounded-xl px-4 py-2.5 flex-row items-center gap-2"
          >
            <FontAwesome name="calendar-o" size={12} color={colors.textMuted} />
            <Text className="text-typography-main text-sm">{fmtDate(from)}</Text>
          </TouchableOpacity>
          <Text className="text-typography-dim font-bold">→</Text>
          <TouchableOpacity
            onPress={() => setShowTo(true)}
            className="flex-1 bg-surface-card border border-surface-border rounded-xl px-4 py-2.5 flex-row items-center gap-2"
          >
            <FontAwesome name="calendar-o" size={12} color={colors.textMuted} />
            <Text className="text-typography-main text-sm">{fmtDate(to)}</Text>
          </TouchableOpacity>
        </View>
      )}

      <CalendarModal visible={showFrom} title="Start Date" value={from} onSelect={v => { setFrom(v); setActivePreset(null); }} onClose={() => setShowFrom(false)} />
      <CalendarModal visible={showTo}   title="End Date"   value={to}   onSelect={v => { setTo(v);   setActivePreset(null); }} onClose={() => setShowTo(false)} />
    </View>
  );
}

// ─── Throughput SVG Bar Chart ─────────────────────────────────────────────────

function ThroughputChart({ data }: { data: ThroughputPeriod[] }) {
  const colors = useThemeColors();
  const [width, setWidth] = useState(0);
  const chartData = [...data].reverse().slice(0, 10);
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
                <Stop offset="0" stopColor="rgb(34,197,94)"  stopOpacity="1" />
                <Stop offset="1" stopColor="rgb(34,197,94)"  stopOpacity="0.5" />
              </LinearGradient>
              <LinearGradient id="thrFail" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="rgb(239,68,68)" stopOpacity="1" />
                <Stop offset="1" stopColor="rgb(239,68,68)" stopOpacity="0.5" />
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
            <View className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgb(34,197,94)' }} />
            <Text className="text-typography-dim text-[9px] font-bold uppercase">Success</Text>
          </View>
          <View className="flex-row items-center gap-1.5">
            <View className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgb(239,68,68)' }} />
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
          s.is_bottleneck ? 'rgb(245,158,11)' :
          (s.is_terminal && s.terminal_type === 'success') ? 'rgb(34,197,94)' :
          s.is_terminal ? 'rgb(239,68,68)' :
          colors.primary;
        const colorFaded = color.replace('rgb', 'rgba').replace(')', ', 0.45)');

        return (
          <View key={s.stage_id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
            <Text style={{ width: labelW, fontSize: 9, fontWeight: '700', color: colors.textMuted }} numberOfLines={1}>
              {s.stage_name}{s.is_bottleneck ? ' ⚠' : ''}
            </Text>
            <Svg height={rowH} width={barAreaW}>
              <Defs>
                <LinearGradient id={`dg${i}`} x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={color}      stopOpacity="1" />
                  <Stop offset="1" stopColor={colorFaded} stopOpacity="1" />
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
          { color: 'rgb(245,158,11)', label: 'Bottleneck' },
          { color: 'rgb(34,197,94)',  label: 'Success' },
          { color: 'rgb(239,68,68)', label: 'Failure' },
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

function PipelineTab() {
  const colors = useThemeColors();
  const { getPipelineStageDwell, getPipelineThroughput } = useAnalytics();
  const [pipelines, setPipelines]       = useState<any[]>([]);
  const [selectedPipeline, setSelected] = useState<string | null>(null);
  const [period, setPeriod]             = useState<'week' | 'month'>('month');

  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 30 * 86400000);
  const [from, setFrom] = useState(defaultFrom.toISOString().split('T')[0]);
  const [to, setTo]     = useState(today.toISOString().split('T')[0]);

  const [dwell, setDwell]           = useState<StageDwell[]>([]);
  const [throughput, setThroughput] = useState<ThroughputPeriod[]>([]);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    supabase.from('pipelines').select('id, name').is('deleted_at', null).order('name')
      .then(({ data }) => { if (data?.length) { setPipelines(data); setSelected(data[0].id); } });
  }, []);

  const load = useCallback(async () => {
    if (!selectedPipeline) return;
    setLoading(true);
    try {
      const nPeriods = period === 'week' ? 12 : 8;
      const [d, t] = await Promise.all([
        getPipelineStageDwell(selectedPipeline, from, to),
        getPipelineThroughput(selectedPipeline, period, nPeriods),
      ]);
      setDwell(d);
      setThroughput(t);
    } finally { setLoading(false); }
  }, [selectedPipeline, from, to, period]);

  useEffect(() => { load(); }, [load]);

  return (
    <View className="gap-6">
      {/* Date Range */}
      <View className="gap-2">
        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Time Frame</Text>
        <DateRangeControls from={from} to={to} setFrom={setFrom} setTo={setTo} />
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
                  className={`px-4 py-2 rounded-xl border ${selectedPipeline === p.id ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
                >
                  <Text className={`text-xs font-bold ${selectedPipeline === p.id ? 'text-white' : 'text-typography-main'}`}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      {/* Throughput granularity */}
      <View className="gap-2">
        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Throughput Granularity</Text>
        <View className="flex-row gap-2">
          {(['week', 'month'] as const).map(p => (
            <TouchableOpacity
              key={p}
              onPress={() => setPeriod(p)}
              className={`px-5 py-2 rounded-xl border ${period === p ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
            >
              <Text className={`text-xs font-black uppercase ${period === p ? 'text-white' : 'text-typography-muted'}`}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {loading ? (
        <View className="py-16 items-center"><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <>
          {/* Throughput chart */}
          <View className="bg-surface-card border border-surface-border rounded-2xl p-5">
            <Text className="text-typography-main font-black text-base mb-1">Throughput Over Time</Text>
            <Text className="text-typography-muted text-[10px] mb-5">Tasks completed vs failed per period</Text>
            <ThroughputChart data={throughput} />
          </View>

          {/* Stage dwell chart */}
          <View className="bg-surface-card border border-surface-border rounded-2xl p-5">
            <Text className="text-typography-main font-black text-base mb-1">Stage Dwell Times</Text>
            <Text className="text-typography-muted text-[10px] mb-5">Avg time tasks spend per stage</Text>
            <DwellChart data={dwell} />
          </View>
        </>
      )}
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
  const [search, setSearch]     = useState('');

  const STORAGE_KEY = 'trustflow_personnel_salaries';

  const today = new Date();
  const defaultFrom = new Date(today.getTime() - 30 * 86400000);
  const [from, setFrom] = useState(defaultFrom.toISOString().split('T')[0]);
  const [to, setTo]     = useState(today.toISOString().split('T')[0]);

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

  const filteredUsers = users.filter(u => u.full_name?.toLowerCase().includes(search.toLowerCase()));

  return (
    <View className="gap-6">
      {/* Date Range */}
      <View className="gap-2">
        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Time Frame</Text>
        <DateRangeControls from={from} to={to} setFrom={setFrom} setTo={setTo} />
      </View>

      {/* User selector */}
      <View className="gap-3">
        <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Select Personnel (min 2)</Text>
        <View className="bg-surface-card border border-surface-border rounded-xl px-3 flex-row items-center">
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
          {filteredUsers.map(u => {
            const isSel = selected.includes(u.id);
            return (
              <TouchableOpacity
                key={u.id}
                onPress={() => toggleUser(u.id)}
                className={`flex-row items-center gap-2 px-3 py-2 rounded-xl border ${isSel ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
              >
                {u.avatar_url
                  ? <Image source={{ uri: u.avatar_url }} className="w-5 h-5 rounded-full" />
                  : <View className="w-5 h-5 rounded-full bg-surface-background border border-surface-border items-center justify-center">
                      <Text className="text-[8px] font-black text-brand-primary">{(u.full_name || 'A')[0]}</Text>
                    </View>
                }
                <Text className={`text-xs font-bold ${isSel ? 'text-white' : 'text-typography-main'}`}>{u.full_name}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Salary inputs */}
      {selected.length > 0 && (
        <View className="gap-3">
          <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Daily Rates (USD) — Persisted Locally</Text>
          {selected.map(uid => {
            const u = users.find(x => x.id === uid);
            if (!u) return null;
            return (
              <View key={uid} className="flex-row items-center gap-3">
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
        className={`py-3.5 rounded-2xl items-center ${selected.length < 2 ? 'bg-surface-border' : 'bg-brand-primary'}`}
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
                { label: 'Effort (OPS)',   value: `${row.activity_count}` },
                { label: 'Active Hours',   value: `${row.active_hours.toFixed(1)}h` },
                { label: 'Completed',      value: `${row.completed_tasks}` },
                { label: 'On-Time Rate',   value: row.on_time_rate !== null ? `${row.on_time_rate.toFixed(1)}%` : '—' },
                { label: 'Timer Eff.',     value: row.timer_efficiency !== null ? `${row.timer_efficiency.toFixed(1)}%` : '—' },
                { label: 'Cost/Point',     value: row.cost_per_point !== null ? `$${row.cost_per_point.toFixed(2)}/pt` : '—' },
                { label: 'Points/Hour',    value: row.points_per_hour !== null ? `${row.points_per_hour.toFixed(1)}/hr` : '—' },
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
  const [activeTab, setActiveTab] = useState<AdminTab>('pipeline');

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
          <BackButton label="" />
        </View>
      </View>

      {/* Tab switcher */}
      <View className="flex-row bg-surface-card border border-surface-border rounded-2xl p-1 mx-6 mb-6">
        <TouchableOpacity
          onPress={() => setActiveTab('pipeline')}
          className={`flex-1 py-2.5 rounded-xl items-center ${activeTab === 'pipeline' ? 'bg-brand-primary' : ''}`}
        >
          <Text className={`text-xs font-black uppercase tracking-widest ${activeTab === 'pipeline' ? 'text-white' : 'text-typography-muted'}`}>
            Pipeline
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => canCompare && setActiveTab('personnel')}
          disabled={!canCompare}
          className={`flex-1 py-2.5 rounded-xl items-center ${activeTab === 'personnel' ? 'bg-brand-primary' : ''} ${!canCompare ? 'opacity-40' : ''}`}
        >
          <Text className={`text-xs font-black uppercase tracking-widest ${activeTab === 'personnel' ? 'text-white' : 'text-typography-muted'}`}>
            Personnel
          </Text>
        </TouchableOpacity>
      </View>

      <View className="px-6">
        {activeTab === 'pipeline' && <PipelineTab />}
        {activeTab === 'personnel' && canCompare && <PersonnelTab />}
        {activeTab === 'personnel' && !canCompare && (
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
