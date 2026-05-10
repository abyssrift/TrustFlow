import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, ActivityIndicator, TextInput, Platform, Image,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  ComposedChart, Line, Legend, Cell,
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useAnalytics, StageDwell, ThroughputPeriod, PersonnelRow } from '@/contexts/AnalyticsContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack } from 'expo-router';
import { ConversionFunnelChartWeb, StageDwellChartWeb } from '@/components/intelligence/RadarWidgets';
import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';
import { useRef } from 'react';
import { useTheme } from '@/contexts/ThemeContext';
import { getPrimaryColor, getMutedColor } from '@/lib/themeColors';

type AdminTab = 'pipeline' | 'personnel';
function fmtPct(v: number | null): string {
  return v !== null ? `${v.toFixed(1)}%` : '—';
}

function fmtUSD(v: number | null): string {
  if (v === null) return '—';
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Throughput Chart ─────────────────────────────────────────────────────────

const ThroughputTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <View className="bg-surface-overlay border border-surface-border rounded-xl p-3 gap-1">
      <Text className="text-typography-dim text-[10px] mb-0.5">{label}</Text>
      {payload.map((p: any) => (
        <Text key={p.dataKey} className="text-typography-main text-xs font-bold" style={{ color: p.color }}>
          {p.name}: {p.value}
        </Text>
      ))}
    </View>
  );
};

function ThroughputChart({ data }: { data: ThroughputPeriod[] }) {
  if (!data.length) {
    return (
      <View className="h-40 items-center justify-center">
        <Text className="text-typography-muted text-sm">No throughput data in this period.</Text>
      </View>
    );
  }

  const chartData = [...data].reverse();

  return (
    <View style={{ height: 280, width: '100%' }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={chartData} margin={{ top: 5, right: 30, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} opacity={0.4} />
          <XAxis
            dataKey="period_label"
            tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="tasks"
            tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="rate"
            orientation="right"
            domain={[0, 100]}
            tick={{ fill: 'var(--color-text-dim)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={v => `${v}%`}
          />
          <Tooltip content={<ThroughputTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-text-dim)' }} />
          <Bar yAxisId="tasks" dataKey="tasks_succeeded" name="Succeeded" fill="var(--color-success)" radius={[4, 4, 0, 0]} maxBarSize={32} />
          <Bar yAxisId="tasks" dataKey="tasks_failed" name="Failed" fill="var(--color-danger)" radius={[4, 4, 0, 0]} maxBarSize={32} />
          <Line
            yAxisId="rate"
            type="monotone"
            dataKey="success_rate"
            name="Success Rate %"
            stroke="var(--color-primary)"
            strokeWidth={2}
            dot={{ r: 3, fill: 'var(--color-primary)', strokeWidth: 0 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </View>
  );
}

// ─── Pipeline Analytics Tab ───────────────────────────────────────────────────

function PipelineTab() {
  const { getPipelineStageDwell, getPipelineThroughput } = useAnalytics();
  const { theme: activeTheme } = useTheme();
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [selectedPipeline, setSelectedPipeline] = useState<string | null>(null);
  const [period, setPeriod] = useState('month');


  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(today.getDate() - 30);

  const [from, setFrom] = useState(defaultFrom.toISOString().split('T')[0]);
  const [to, setTo]     = useState(today.toISOString().split('T')[0]);

  const [dwell, setDwell]         = useState<StageDwell[]>([]);
  const [throughput, setThroughput] = useState<ThroughputPeriod[]>([]);
  const [auditData, setAuditData]   = useState<any>(null);
  const [loading, setLoading]     = useState(false);

  // Calendar State
  const [showFromCalendar, setShowFromCalendar] = useState(false);
  const [showToCalendar, setShowToCalendar] = useState(false);
  const fromRef = useRef<any>(null);
  const toRef = useRef<any>(null);
  const [fromPos, setFromPos] = useState({ top: 0, left: 0 });
  const [toPos, setToPos] = useState({ top: 0, left: 0 });

  const openOverlay = (
    ref: React.RefObject<any>,
    setPos: (p: { top: number; left: number }) => void,
    setShow: (v: boolean) => void
  ) => {
    if (ref.current?.getBoundingClientRect) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left });
    }
    setShow(true);
  };

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
      const nDays = Math.max(7, Math.ceil((new Date(to).getTime() - new Date(from).getTime()) / 86400000));
      const [d, t, a] = await Promise.all([
        getPipelineStageDwell(selectedPipeline, from, to),
        getPipelineThroughput(selectedPipeline, period, 12),
        supabase.rpc('rpc_get_organizational_audit', { p_pipeline_id: selectedPipeline, p_days: nDays }),
      ]);
      setDwell(d);
      setThroughput(t);
      setAuditData(a.data);
    } finally {
      setLoading(false);
    }
  }, [selectedPipeline, from, to, period]);



  useEffect(() => { load(); }, [load]);


  return (
    <View className="gap-8">
      {/* Controls */}
      <View className="flex-row gap-4 flex-wrap">
        {/* Pipeline selector */}
        <View className="flex-1 min-w-[200px]">
          <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest mb-2">Pipeline</Text>
          <View className="flex-row flex-wrap gap-2">
            {pipelines.map(p => (
              <TouchableOpacity
                key={p.id}
                onPress={() => setSelectedPipeline(p.id)}
                className={`px-4 py-2 rounded-xl border transition-all ${
                  selectedPipeline === p.id
                    ? 'bg-brand-primary border-brand-primary'
                    : 'bg-surface-card border-surface-border hover:bg-surface-overlay'
                }`}
              >
                <Text className={`text-xs font-bold ${selectedPipeline === p.id ? 'text-white' : 'text-typography-main'}`}>
                  {p.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Date range */}
        <View className="gap-2">
          <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Date Range</Text>
          <View className="flex-row gap-3 items-center">
            <TouchableOpacity
              ref={fromRef}
              onPress={() => openOverlay(fromRef, setFromPos, setShowFromCalendar)}
              className="bg-surface-card border border-surface-border rounded-xl px-4 py-2 flex-row items-center w-40"
            >
              <FontAwesome name="calendar" size={12} color={getMutedColor(activeTheme)} className="mr-3" />
              <Text className="text-typography-main text-sm flex-1">
                {from ? new Date(from).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Start Date'}
              </Text>
            </TouchableOpacity>
            <Text className="text-typography-dim text-sm">→</Text>
            <TouchableOpacity
              ref={toRef}
              onPress={() => openOverlay(toRef, setToPos, setShowToCalendar)}
              className="bg-surface-card border border-surface-border rounded-xl px-4 py-2 flex-row items-center w-40"
            >
              <FontAwesome name="calendar" size={12} color={getMutedColor(activeTheme)} className="mr-3" />
              <Text className="text-typography-main text-sm flex-1">
                {to ? new Date(to).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'End Date'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Period toggle for throughput */}
        <View className="gap-2">
          <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Throughput Granularity</Text>
          <View className="flex-row gap-2">
            {['week', 'month', 'year'].map(p => (
              <TouchableOpacity
                key={p}
                onPress={() => setPeriod(p)}
                className={`px-4 py-2 rounded-xl border ${period === p ? 'bg-brand-primary border-brand-primary' : 'bg-surface-card border-surface-border'}`}
              >
                <Text className={`text-xs font-black uppercase ${period === p ? 'text-white' : 'text-typography-muted'}`}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      {loading ? (
        <View className="py-16 items-center">
          <ActivityIndicator size="large" color={getPrimaryColor(activeTheme)} />
        </View>
      ) : pipelines.length === 0 ? (
        <View className="bg-surface-card border border-surface-border rounded-2xl p-10 items-center gap-3">
          <Text className="text-typography-main font-black text-lg">No Pipelines Found</Text>
          <Text className="text-typography-muted text-sm">Create a pipeline to see analytics.</Text>
        </View>
      ) : (
        <View className="gap-8">
          {/* Stage Dwell */}
          <StageDwellChartWeb data={dwell} />

          {/* Throughput */}
          <View className="bg-surface-card border border-surface-border rounded-2xl p-6">
            <View className="flex-row items-center justify-between mb-6">
              <Text className="text-typography-main font-black text-lg">Throughput Trend</Text>
              <View className="px-3 py-1 bg-surface-background border border-surface-border rounded-lg">
                <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">Pipeline-Specific Analytics</Text>
              </View>
            </View>
            <ThroughputChart data={throughput} />
          </View>



          {/* Conversion Funnel */}
          <ConversionFunnelChartWeb data={auditData} />
        </View>
      )}

      {/* Calendar Overlays */}
      {showFromCalendar && (
        <>
          <TouchableOpacity 
            activeOpacity={1} 
            className="fixed inset-0 z-[998]" 
            onPress={() => setShowFromCalendar(false)} 
          />
          <View style={{ 
            position: 'fixed', 
            top: fromPos.top, 
            zIndex: 999, 
            width: 820,
            ...( (fromPos.left + 840) > window.innerWidth ? { right: 20 } : { left: Math.max(20, fromPos.left) } )
          } as any}>
            <PremiumCalendarPicker
              selectedDate={from}
              onSelect={date => { setFrom(date); setShowFromCalendar(false); }}
            />
          </View>
        </>
      )}

      {showToCalendar && (
        <>
          <TouchableOpacity 
            activeOpacity={1} 
            className="fixed inset-0 z-[998]" 
            onPress={() => setShowToCalendar(false)} 
          />
          <View style={{ 
            position: 'fixed', 
            top: toPos.top, 
            zIndex: 999, 
            width: 820,
            ...( (toPos.left + 840) > window.innerWidth ? { right: 20 } : { left: Math.max(20, toPos.left) } )
          } as any}>
            <PremiumCalendarPicker
              selectedDate={to}
              onSelect={date => { setTo(date); setShowToCalendar(false); }}
            />
          </View>
        </>
      )}
    </View>
  );
}


// ─── Personnel Comparison Tab ─────────────────────────────────────────────────

type SortDir = 'asc' | 'desc';

function PersonnelTab() {
  const { comparePersonnel } = useAnalytics();
  const { theme: activeTheme } = useTheme();
  const [users, setUsers] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [salaries, setSalaries] = useState<Record<string, string>>({});
  const [bulkRate, setBulkRate] = useState('');
  const [search, setSearch] = useState('');

  const today = new Date();
  const defaultFrom = new Date(today);
  defaultFrom.setDate(today.getDate() - 30);

  const [from, setFrom] = useState(defaultFrom.toISOString().split('T')[0]);
  const [to, setTo]     = useState(today.toISOString().split('T')[0]);

  // Calendar State
  const [showFromCalendar, setShowFromCalendar] = useState(false);
  const [showToCalendar, setShowToCalendar] = useState(false);
  const fromRef = useRef<any>(null);
  const toRef = useRef<any>(null);
  const [fromPos, setFromPos] = useState({ top: 0, left: 0 });
  const [toPos, setToPos] = useState({ top: 0, left: 0 });

  const openOverlay = (
    ref: React.RefObject<any>,
    setPos: (p: { top: number; left: number }) => void,
    setShow: (v: boolean) => void
  ) => {
    if (ref.current?.getBoundingClientRect) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 6, left: rect.left });
    }
    setShow(true);
  };

  const [results, setResults]   = useState<PersonnelRow[]>([]);
  const [loading, setLoading]   = useState(false);
  const [ran, setRan]           = useState(false);
  const [sortField, setSortField] = useState<keyof PersonnelRow>('weight_points');
  const [sortDir, setSortDir]   = useState<SortDir>('desc');

  const STORAGE_KEYS = {
    SALARIES: 'trustflow_personnel_salaries',
    SELECTED: 'trustflow_personnel_selected',
  };

  useEffect(() => {
    supabase
      .from('users')
      .select('id, full_name, avatar_url')
      .is('deleted_at', null)
      .order('full_name')
      .then(({ data }) => setUsers(data ?? []));

    const loadPersisted = async () => {
      try {
        const [savedSalaries, savedSelected] = await Promise.all([
          AsyncStorage.getItem(STORAGE_KEYS.SALARIES),
          AsyncStorage.getItem(STORAGE_KEYS.SELECTED),
        ]);
        if (savedSalaries) setSalaries(JSON.parse(savedSalaries));
        if (savedSelected) setSelected(JSON.parse(savedSelected));
      } catch (e) {
        console.error('Failed to load persisted comparison data', e);
      }
    };
    loadPersisted();
  }, []);

  useEffect(() => {
    if (Object.keys(salaries).length > 0) {
      AsyncStorage.setItem(STORAGE_KEYS.SALARIES, JSON.stringify(salaries));
    }
  }, [salaries]);

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEYS.SELECTED, JSON.stringify(selected));
  }, [selected]);

  const toggleUser = (id: string) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const selectAll = () => setSelected(users.map(u => u.id));
  const clearAll = () => setSelected([]);

  const applyBulkRate = () => {
    if (!bulkRate || selected.length === 0) return;
    const newSalaries = { ...salaries };
    selected.forEach(id => {
      newSalaries[id] = bulkRate;
    });
    setSalaries(newSalaries);
    setBulkRate('');
  };

  const exportCSV = () => {
    if (!results.length) return;
    const headers = ['Name', 'Results (Pts)', 'Effort (OPS)', 'Hours', 'Completed', 'On-Time', 'Timer Eff.', 'Monthly Rate', 'Total Cost', 'Cost/Pt', 'Pts/Hr'];
    const rows = sorted.map(r => [
      r.full_name,
      r.weight_points,
      r.activity_count,
      r.active_hours.toFixed(2),
      r.completed_tasks,
      fmtPct(r.on_time_rate),
      fmtPct(r.timer_efficiency),
      (r.daily_rate_usd * 30).toFixed(2),
      r.total_cost_usd,
      r.cost_per_point?.toFixed(2) ?? '',
      r.points_per_hour?.toFixed(2) ?? '',
    ]);

    const csvContent = [headers, ...rows].map(e => e.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `personnel_comparison_${from}_to_${to}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleRun = async () => {
    if (selected.length < 2) return;
    setLoading(true);
    setRan(false);
    try {
      const salaryMap: Record<string, number> = {};
      for (const [uid, v] of Object.entries(salaries)) {
        const val = String(v || '0');
        const n = parseFloat(val);
        if (!isNaN(n) && n > 0) salaryMap[uid] = n / 30; // Monthly to Daily
      }
      const data = await comparePersonnel(selected, from, to, salaryMap);
      setResults(data);
      setRan(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSort = (field: keyof PersonnelRow) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sorted = [...results].sort((a, b) => {
    const av = a[sortField] as number ?? -1;
    const bv = b[sortField] as number ?? -1;
    return sortDir === 'asc' ? av - bv : bv - av;
  });

  const numericBest = (field: keyof PersonnelRow, higherIsBetter: boolean) => {
    const vals = results.map(r => r[field] as number).filter(v => v !== null);
    if (!vals.length) return { best: null, worst: null };
    return higherIsBetter
      ? { best: Math.max(...vals), worst: Math.min(...vals) }
      : { best: Math.min(...vals), worst: Math.max(...vals) };
  };

  const bests: Record<string, { best: number | null; worst: number | null }> = {
    weight_points:   numericBest('weight_points', true),
    activity_count:  numericBest('activity_count', true),
    active_hours:    numericBest('active_hours', true),
    completed_tasks: numericBest('completed_tasks', true),
    on_time_rate:    numericBest('on_time_rate', true),
    timer_efficiency:numericBest('timer_efficiency', false),
    cost_per_point:  numericBest('cost_per_point', false),
    points_per_hour: numericBest('points_per_hour', true),
  };

  const cellBadge = (field: string, val: number | null) => {
    const b = bests[field];
    if (!b || val === null) return undefined;
    if (val === b.best && b.best !== b.worst) return 'best';
    if (val === b.worst && b.best !== b.worst) return 'worst';
    return undefined;
  };

  const filteredUsers = users.filter(u =>
    u.full_name.toLowerCase().includes(search.toLowerCase())
  );

  const SortHeader = ({ field, label }: { field: keyof PersonnelRow; label: string }) => (
    <TouchableOpacity
      onPress={() => handleSort(field)}
      className="flex-row items-center gap-1.5"
    >
      <Text className={`text-[10px] font-black uppercase tracking-widest ${sortField === field ? 'text-brand-primary' : 'text-typography-muted'}`}>
        {label}
      </Text>
      {sortField === field && (
        <FontAwesome
          name={sortDir === 'asc' ? 'chevron-up' : 'chevron-down'}
          size={8}
          color={getPrimaryColor(activeTheme)}
        />
      )}
    </TouchableOpacity>
  );

  const CellBadgeText = ({ badge, children }: { badge: string | undefined; children: React.ReactNode }) => (
    <View className={`flex-row items-center gap-1.5 ${badge === 'best' ? 'opacity-100' : badge === 'worst' ? 'opacity-80' : ''}`}>
      {badge === 'best'  && <View className="w-1.5 h-1.5 rounded-full bg-state-success" />}
      {badge === 'worst' && <View className="w-1.5 h-1.5 rounded-full bg-state-warning" />}
      <Text className={`text-sm font-bold ${badge === 'best' ? 'text-state-success' : badge === 'worst' ? 'text-state-warning' : 'text-typography-main'}`}>
        {children}
      </Text>
    </View>
  );

  // --- QOL: Live Insights Component ---
  const ComparisonInsights = () => {
    if (selected.length === 0) {
      return (
        <View className="flex-1 items-center justify-center p-8 bg-surface-overlay/20 rounded-[32px] border border-dashed border-surface-border">
          <View className="w-16 h-16 rounded-full bg-surface-card items-center justify-center mb-4 border border-surface-border">
            <FontAwesome name="users" size={24} color={getMutedColor(activeTheme)} />
          </View>
          <Text className="text-typography-main font-black text-lg mb-2">Ready to Compare</Text>
          <Text className="text-typography-muted text-xs text-center">Select personnel from the roster to begin live analysis.</Text>
        </View>
      );
    }

    if (selected.length < 2) {
      return (
        <View className="flex-1 items-center justify-center p-8 bg-surface-overlay/20 rounded-[32px] border border-dashed border-surface-border">
          <View className="w-16 h-16 rounded-full bg-brand-primary/10 items-center justify-center mb-4 border border-brand-primary/20">
            <FontAwesome name="plus" size={20} color={getPrimaryColor(activeTheme)} />
          </View>
          <Text className="text-typography-main font-black text-lg mb-2">Add One More</Text>
          <Text className="text-typography-muted text-xs text-center">Comparative intelligence requires at least two individuals.</Text>
        </View>
      );
    }

    const previewData = [
      { subject: 'Effort', A: 80, fullMark: 100 },
      { subject: 'Quality', A: 90, fullMark: 100 },
      { subject: 'Speed', A: 70, fullMark: 100 },
      { subject: 'Consistency', A: 85, fullMark: 100 },
      { subject: 'Impact', A: 65, fullMark: 100 },
    ];

    return (
      <View className="flex-1 bg-surface-card rounded-[32px] border border-surface-border shadow-sm p-6 overflow-hidden">
        <View className="flex-row items-center justify-between mb-4">
          <View>
            <Text className="text-typography-main font-black text-lg">Group Pulse</Text>
            <Text className="text-typography-muted text-[10px] uppercase font-bold tracking-widest">{selected.length} Personnel Linked</Text>
          </View>
          <View className="w-8 h-8 rounded-full bg-brand-primary/10 items-center justify-center">
            <FontAwesome name="bolt" size={14} color={getPrimaryColor(activeTheme)} />
          </View>
        </View>

        <View style={{ height: 240, width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%">
            <RadarChart cx="50%" cy="50%" outerRadius="80%" data={previewData}>
              <PolarGrid stroke="var(--color-surface-border)" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--color-text-dim)', fontSize: 10 }} />
              <Radar
                name="Group Mean"
                dataKey="A"
                stroke="var(--color-primary)"
                fill="var(--color-primary)"
                fillOpacity={0.3}
              />
            </RadarChart>
          </ResponsiveContainer>
        </View>

        <View className="mt-4 pt-4 border-t border-surface-border flex-row justify-between">
          <View className="items-center flex-1">
            <Text className="text-typography-main font-black text-base">{selected.length}</Text>
            <Text className="text-typography-muted text-[9px] uppercase font-bold">Roster Size</Text>
          </View>
          <View className="w-[1px] h-8 bg-surface-border mx-4" />
          <View className="items-center flex-1">
            <Text className="text-state-success font-black text-base">Active</Text>
            <Text className="text-typography-muted text-[9px] uppercase font-bold">Status</Text>
          </View>
        </View>
      </View>
    );
  };

  return (
    <View className="gap-8">
      {/* 3-Column Cockpit Header */}
      <View className="flex-row gap-6 flex-wrap">
        {/* Column 1: Cohort Selection */}
        <View className="bg-surface-card border border-surface-border rounded-[32px] p-6 shadow-sm" style={{ flex: 1, minWidth: 280 }}>
          <View className="flex-row items-center justify-between mb-6">
            <View>
              <Text className="text-typography-main font-black text-xl">Select Cohort</Text>
              <Text className="text-typography-muted text-xs font-medium">Choose personnel to benchmark</Text>
            </View>
            <View className="flex-row gap-2">
              <TouchableOpacity onPress={selectAll} className="bg-surface-background border border-surface-border px-3 py-1.5 rounded-lg">
                <Text className="text-typography-main text-[10px] font-black uppercase">All</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={clearAll} className="bg-surface-background border border-surface-border px-3 py-1.5 rounded-lg">
                <Text className="text-typography-main text-[10px] font-black uppercase">None</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View className="flex-row items-center bg-surface-background border border-surface-border rounded-xl px-4 py-2 mb-4">
            <FontAwesome name="search" size={12} color={getMutedColor(activeTheme)} className="mr-3" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search by name..."
              placeholderTextColor={getMutedColor(activeTheme)}
              className="flex-1 text-typography-main text-sm outline-none"
            />
          </View>

          <ScrollView className="max-h-[300px]" showsVerticalScrollIndicator={false}>
            <View className="flex-row flex-wrap gap-2">
              {filteredUsers.map(u => {
                const isSel = selected.includes(u.id);
                return (
                  <TouchableOpacity
                    key={u.id}
                    onPress={() => toggleUser(u.id)}
                    className={`flex-row items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
                      isSel ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border opacity-70'
                    }`}
                  >
                    {u.avatar_url ? (
                      <Image source={{ uri: u.avatar_url }} className="w-5 h-5 rounded-full" />
                    ) : (
                      <View className="w-5 h-5 rounded-full bg-surface-border items-center justify-center">
                        <Text className="text-[8px] font-black">{u.full_name[0]}</Text>
                      </View>
                    )}
                    <Text className={`text-[11px] font-bold ${isSel ? 'text-brand-primary' : 'text-typography-main'}`}>
                      {u.full_name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>
        </View>

        {/* Column 2: The Radar Chart (Insights) */}
        <View className="flex-col" style={{ flex: 1, minWidth: 280 }}>
          <ComparisonInsights />
        </View>

        {/* Column 3: Parameters */}
        <View className="gap-6" style={{ flex: 1, minWidth: 280 }}>
          <View className="bg-surface-card border border-surface-border rounded-[32px] p-6 shadow-sm">
            <View className="mb-6">
              <Text className="text-typography-main font-black text-xl">Parameters</Text>
              <Text className="text-typography-muted text-xs font-medium">Define time & financial scope</Text>
            </View>

            <View className="gap-5">
              <View className="gap-2">
                <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest ml-1">Time Window</Text>
                <View className="flex-row items-center gap-2">
                  <TouchableOpacity
                    ref={fromRef}
                    onPress={() => openOverlay(fromRef, setFromPos, setShowFromCalendar)}
                    className="flex-1 bg-surface-background border border-surface-border rounded-xl px-4 py-2 flex-row items-center"
                  >
                    <FontAwesome name="calendar" size={10} color={getMutedColor(activeTheme)} className="mr-2" />
                    <Text className="text-typography-main text-xs flex-1">
                      {from ? new Date(from).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'Start Date'}
                    </Text>
                  </TouchableOpacity>
                  <Text className="text-typography-muted font-bold">→</Text>
                  <TouchableOpacity
                    ref={toRef}
                    onPress={() => openOverlay(toRef, setToPos, setShowToCalendar)}
                    className="flex-1 bg-surface-background border border-surface-border rounded-xl px-4 py-2 flex-row items-center"
                  >
                    <FontAwesome name="calendar" size={10} color={getMutedColor(activeTheme)} className="mr-2" />
                    <Text className="text-typography-main text-xs flex-1">
                      {to ? new Date(to).toLocaleDateString(undefined, { dateStyle: 'medium' }) : 'End Date'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {selected.length > 0 && (
                <View className="pt-4 border-t border-surface-border/50">
                  <View className="flex-row items-center justify-between mb-3">
                    <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Salary Configuration</Text>
                    <TouchableOpacity onPress={() => setSalaries({})}>
                      <Text className="text-state-warning text-[10px] font-black uppercase">Clear Rates</Text>
                    </TouchableOpacity>
                  </View>

                  <View className="flex-row items-center gap-2 mb-4">
                    <View className="flex-1 flex-row items-center bg-surface-background border border-surface-border rounded-xl overflow-hidden">
                      <Text className="pl-3 text-typography-dim text-xs">$</Text>
                      <TextInput
                        value={bulkRate}
                        onChangeText={setBulkRate}
                        placeholder="Monthly salary..."
                        keyboardType="numeric"
                        className="py-2 px-2 text-typography-main text-xs flex-1 outline-none"
                      />
                    </View>
                    <TouchableOpacity 
                      onPress={applyBulkRate}
                      className="bg-brand-primary px-4 py-2.5 rounded-xl"
                    >
                      <Text className="text-white text-[10px] font-black uppercase">Apply</Text>
                    </TouchableOpacity>
                  </View>

                  <ScrollView className="max-h-[140px]" showsVerticalScrollIndicator={false}>
                    <View className="gap-2">
                      {selected.map(uid => {
                        const u = users.find(x => x.id === uid);
                        if (!u) return null;
                        return (
                          <View key={uid} className="flex-row items-center gap-3">
                            <Text className="text-typography-main text-[11px] w-24 font-bold" numberOfLines={1}>{u.full_name}</Text>
                            <View className="flex-row items-center bg-surface-background border border-surface-border rounded-lg flex-1">
                              <Text className="pl-2 text-typography-dim text-[10px]">$</Text>
                              <TextInput
                                value={salaries[uid] ?? ''}
                                onChangeText={v => setSalaries(prev => ({ ...prev, [uid]: v }))}
                                placeholder="Monthly"
                                keyboardType="numeric"
                                className="py-1 px-2 text-typography-main text-xs flex-1 outline-none"
                              />
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </ScrollView>
                </View>
              )}
            </View>

            <TouchableOpacity
              onPress={handleRun}
              disabled={selected.length < 2 || loading}
              className={`mt-6 py-4 rounded-2xl items-center shadow-lg transition-all active:scale-[0.98] ${
                selected.length < 2 ? 'bg-surface-border opacity-50' : 'bg-brand-primary shadow-brand-primary/20'
              }`}
            >
              {loading ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <View className="flex-row items-center gap-2">
                  <FontAwesome name="play" size={10} color="white" />
                  <Text className="text-white font-black uppercase tracking-widest text-[11px]">Generate Report</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Results table */}
      {ran && sorted.length > 0 && (
        <View>
          <View className="flex-row items-center justify-between mb-4 px-2">
            <Text className="text-typography-main font-black text-xl italic uppercase tracking-tighter">Strategic Benchmarking Results</Text>
            <TouchableOpacity 
              onPress={exportCSV}
              className="flex-row items-center gap-2 bg-surface-card border border-surface-border px-4 py-2 rounded-xl"
            >
              <FontAwesome name="download" size={14} color="var(--color-primary)" />
              <Text className="text-typography-main text-xs font-black uppercase">Export CSV</Text>
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View className="bg-surface-card border border-surface-border rounded-3xl overflow-hidden shadow-sm">
              <View className="flex-row px-4 py-4 bg-surface-background/50 border-b border-surface-border gap-4">
                <View style={{ width: 200 }}><Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest">Personnel</Text></View>
                {[
                  { field: 'weight_points',   label: 'Results (Pts)' },
                  { field: 'activity_count',  label: 'Effort (OPS)' },
                  { field: 'active_hours',    label: 'Hours' },
                  { field: 'completed_tasks', label: 'Completed' },
                  { field: 'on_time_rate',    label: 'On-Time' },
                  { field: 'timer_efficiency',label: 'Timer Eff.' },
                  { field: 'daily_rate_usd',  label: 'Monthly Rate' },
                  { field: 'total_cost_usd',  label: 'Total Cost' },
                  { field: 'cost_per_point',  label: 'Cost/Pt' },
                  { field: 'points_per_hour', label: 'Pts/Hr' },
                ].map(col => (
                  <View key={col.field} style={{ width: 110 }}>
                    <SortHeader field={col.field as keyof PersonnelRow} label={col.label} />
                  </View>
                ))}
              </View>

              {sorted.map((row, i) => (
                <View
                  key={row.user_id}
                  className={`flex-row px-4 py-3 gap-4 border-b border-surface-border ${
                    i % 2 === 0 ? 'bg-surface-card' : 'bg-surface-background'
                  }`}
                >
                  <View style={{ width: 200 }} className="flex-row items-center gap-3">
                    <View className="w-8 h-8 rounded-full bg-surface-card border border-surface-border overflow-hidden">
                      {row.avatar_url ? (
                        <Image source={{ uri: row.avatar_url }} className="w-full h-full" />
                      ) : (
                        <View className="w-full h-full items-center justify-center bg-brand-primary/5">
                          <Text className="text-brand-primary font-black text-[10px]">
                            {(row.full_name || 'A')[0].toUpperCase()}
                          </Text>
                        </View>
                      )}
                    </View>
                    <View className="flex-1">
                      <Text className="text-typography-main text-sm font-bold" numberOfLines={1}>{row.full_name}</Text>
                      <Text className="text-typography-dim text-[10px]">{row.working_days}d tracked</Text>
                    </View>
                  </View>
                  <View style={{ width: 110 }}>
                    <CellBadgeText badge={cellBadge('weight_points', row.weight_points)}>{row.weight_points}</CellBadgeText>
                  </View>
                  <View style={{ width: 110 }}>
                    <CellBadgeText badge={cellBadge('activity_count', row.activity_count)}>{row.activity_count}</CellBadgeText>
                  </View>
                  <View style={{ width: 110 }}>
                    <CellBadgeText badge={cellBadge('active_hours', row.active_hours)}>
                      {row.active_hours.toFixed(1)}h
                    </CellBadgeText>
                  </View>
                  <View style={{ width: 110 }}>
                    <CellBadgeText badge={cellBadge('completed_tasks', row.completed_tasks)}>{row.completed_tasks}</CellBadgeText>
                  </View>
                  <View style={{ width: 110 }}>
                    <CellBadgeText badge={cellBadge('on_time_rate', row.on_time_rate)}>
                      {fmtPct(row.on_time_rate)}
                    </CellBadgeText>
                  </View>
                  <View style={{ width: 110 }}>
                    <CellBadgeText badge={cellBadge('timer_efficiency', row.timer_efficiency)}>
                      {fmtPct(row.timer_efficiency)}
                    </CellBadgeText>
                  </View>
                  <View style={{ width: 110 }}>
                    <Text className="text-typography-main text-sm">{fmtUSD(row.daily_rate_usd * 30)}</Text>
                  </View>
                  <View style={{ width: 110 }}>
                    <CellBadgeText badge={cellBadge('total_cost_usd', row.total_cost_usd)}>
                      {fmtUSD(row.total_cost_usd)}
                    </CellBadgeText>
                  </View>
                  <View style={{ width: 110 }}>
                    <CellBadgeText badge={cellBadge('cost_per_point', row.cost_per_point)}>
                      {row.cost_per_point !== null ? `$${row.cost_per_point.toFixed(2)}/pt` : '-'}
                    </CellBadgeText>
                  </View>
                  <View style={{ width: 110 }}>
                    <CellBadgeText badge={cellBadge('points_per_hour', row.points_per_hour)}>
                      {row.points_per_hour !== null ? `${row.points_per_hour.toFixed(1)}/hr` : '-'}
                    </CellBadgeText>
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      )}

      {ran && sorted.length === 0 && (
        <View className="bg-surface-card border border-surface-border rounded-2xl p-10 items-center gap-3">
          <Text className="text-typography-main font-black">No data for selected users in this range.</Text>
        </View>
      )}
      {showFromCalendar && (
        <>
          <TouchableOpacity 
            activeOpacity={1} 
            className="fixed inset-0 z-[998]" 
            onPress={() => setShowFromCalendar(false)} 
          />
          <View style={{ 
            position: 'fixed', 
            top: fromPos.top, 
            zIndex: 999, 
            width: 820,
            ...( (fromPos.left + 840) > window.innerWidth ? { right: 20 } : { left: Math.max(20, fromPos.left) } )
          } as any}>
            <PremiumCalendarPicker
              selectedDate={from}
              onSelect={date => { setFrom(date); setShowFromCalendar(false); }}
            />
          </View>
        </>
      )}

      {showToCalendar && (
        <>
          <TouchableOpacity 
            activeOpacity={1} 
            className="fixed inset-0 z-[998]" 
            onPress={() => setShowToCalendar(false)} 
          />
          <View style={{ 
            position: 'fixed', 
            top: toPos.top, 
            zIndex: 999, 
            width: 820,
            ...( (toPos.left + 840) > window.innerWidth ? { right: 20 } : { left: Math.max(20, toPos.left) } )
          } as any}>
            <PremiumCalendarPicker
              selectedDate={to}
              onSelect={date => { setTo(date); setShowToCalendar(false); }}
            />
          </View>
        </>
      )}
    </View>
  );
}

// ─── Root Screen ──────────────────────────────────────────────────────────────

export default function AdminAnalyticsWeb() {
  const { hasPermission } = useAuth();
  const [activeTab, setActiveTab] = useState<AdminTab>('pipeline');

  if (!hasPermission('analytics.view')) {
    return (
      <View className="flex-1 bg-surface-background items-center justify-center p-10">
        <FontAwesome name="lock" size={40} color="var(--color-primary)" />
        <Text className="text-typography-main font-black text-xl mt-6 mb-2">Access Restricted</Text>
        <Text className="text-typography-muted text-center">
          You need the <Text className="font-black">analytics.view</Text> permission to access this dashboard.
        </Text>
      </View>
    );
  }

  const canCompare = hasPermission('analytics.compare');

  return (
    <View className="flex-1 bg-surface-background">
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="max-w-[1400px] mx-auto w-full px-8 py-10">

          {/* Header */}
          <View className="mb-10">
            <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[10px] mb-2">
              Operations Intelligence
            </Text>
            <Text className="text-typography-main text-5xl font-black tracking-tighter">Analytics Hub</Text>
            <Text className="text-typography-muted text-lg font-medium mt-2">
              Pipeline health, stage dwell times, and personnel benchmarking.
            </Text>
          </View>

          {/* Tabs */}
          <View className="flex-row gap-2 mb-10 border-b border-surface-border pb-0">
            <TouchableOpacity
              onPress={() => setActiveTab('pipeline')}
              className={`px-6 py-3 -mb-px border-b-2 transition-all ${
                activeTab === 'pipeline'
                  ? 'border-brand-primary'
                  : 'border-transparent hover:border-surface-border'
              }`}
            >
              <Text className={`font-black text-sm ${activeTab === 'pipeline' ? 'text-brand-primary' : 'text-typography-muted'}`}>
                Pipeline Analytics
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => canCompare && setActiveTab('personnel')}
              className={`px-6 py-3 -mb-px border-b-2 transition-all ${
                activeTab === 'personnel'
                  ? 'border-brand-primary'
                  : !canCompare
                  ? 'opacity-40 cursor-not-allowed border-transparent'
                  : 'border-transparent hover:border-surface-border'
              }`}
            >
              <View className="flex-row items-center gap-2">
                <Text className={`font-black text-sm ${activeTab === 'personnel' ? 'text-brand-primary' : 'text-typography-muted'}`}>
                  Personnel Comparison
                </Text>
                {!canCompare && (
                  <FontAwesome name="lock" size={10} color="rgb(100,116,139)" />
                )}
              </View>
            </TouchableOpacity>
          </View>

          {activeTab === 'pipeline' && <PipelineTab />}
          {activeTab === 'personnel' && canCompare && <PersonnelTab />}
          {activeTab === 'personnel' && !canCompare && (
            <View className="bg-surface-card border border-surface-border rounded-2xl p-10 items-center gap-3">
              <FontAwesome name="lock" size={32} color="var(--color-primary)" />
              <Text className="text-typography-main font-black text-lg">Permission Required</Text>
              <Text className="text-typography-muted text-sm text-center">
                You need <Text className="font-black">analytics.compare</Text> to access personnel benchmarking.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
