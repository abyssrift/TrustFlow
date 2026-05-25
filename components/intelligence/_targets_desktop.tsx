import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';
import { TargetCreationModal } from '@/components/intelligence/IntelligenceModals';
import { useAuth } from '@/contexts/AuthContext';
import type { ThemeType } from '@/contexts/ThemeContext';
import { useTheme } from '@/contexts/ThemeContext';
import { NATIVE_THEME_COLORS } from '@/lib/layout';
import { supabase } from '@/lib/supabase';
import { getMutedColor, getPrimaryColor } from '@/lib/themeColors';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import {
    Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer,
    Scatter,
    ScatterChart,
    Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts';

// ── Edit Modal ────────────────────────────────────────────────────────────────

const EditTargetModal = ({
  target,
  onClose,
  onSave,
}: {
  target: any;
  onClose: () => void;
  onSave: (id: string, updates: Record<string, any>) => void;
}) => {
  if (!target) return null;
  const isVolume = target.target_type === 'volume';
  const [quantity, setQuantity] = useState(String(target.target_quantity ?? ''));
  const [activeMins, setActiveMins] = useState(String(Math.round((target.target_active_seconds ?? 0) / 60)));
  const [lifecycleHours, setLifecycleHours] = useState(String(Math.round((target.target_lifecycle_seconds ?? 0) / 3600)));
  const [deadline, setDeadline] = useState<string | null>(
    target.target_deadline ? new Date(target.target_deadline).toISOString().split('T')[0] : null
  );

  const handleSave = () => {
    if (isVolume) {
      const qty = parseInt(quantity);
      if (isNaN(qty) || qty <= 0) return;
      onSave(target.id, { target_quantity: qty, target_deadline: deadline ?? null });
    } else {
      const mins = parseInt(activeMins);
      const hours = parseInt(lifecycleHours);
      if (isNaN(mins) || mins <= 0) return;
      onSave(target.id, {
        target_active_seconds: mins * 60,
        target_lifecycle_seconds: !isNaN(hours) ? hours * 3600 : null,
      });
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 items-center justify-center">
        <View className="bg-surface-card w-full max-w-2xl rounded-[32px] border border-surface-border premium-shadow overflow-hidden max-h-[90vh] flex-col">
          <View className="p-8 border-b border-surface-border flex-row justify-between items-center">
            <View>
              <Text className="text-typography-main text-xl font-black tracking-tight">Edit Target</Text>
              <Text className="text-typography-muted text-xs font-bold mt-1">
                {target.stage?.name} · {isVolume ? 'Volume Quota' : 'Performance SLA'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              className="w-9 h-9 rounded-full bg-surface-background border border-surface-border items-center justify-center"
            >
              <FontAwesome name="times" size={13} color="var(--color-text-dim)" />
            </TouchableOpacity>
          </View>

          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            <View className="p-8 gap-6">
              {isVolume ? (
                <>
                  <View>
                    <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-3">
                      Target Quota (units)
                    </Text>
                    <TextInput
                      value={quantity}
                      onChangeText={setQuantity}
                      keyboardType="numeric"
                      placeholderTextColor="var(--color-text-dim)"
                      className="bg-surface-background border border-surface-border text-typography-main font-black text-xl p-5 rounded-2xl focus:border-brand-primary"
                    />
                  </View>
                  <View>
                    <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-3">
                      Expiration Deadline
                    </Text>
                    <PremiumCalendarPicker selectedDate={deadline} onSelect={setDeadline} compact />
                  </View>
                </>
              ) : (
                <View className="flex-row gap-4">
                  <View className="flex-1">
                    <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-3">
                      Active Budget (minutes)
                    </Text>
                    <TextInput
                      value={activeMins}
                      onChangeText={setActiveMins}
                      keyboardType="numeric"
                      placeholderTextColor="var(--color-text-dim)"
                      className="bg-surface-background border border-surface-border text-typography-main font-black text-xl p-5 rounded-2xl focus:border-brand-primary"
                    />
                  </View>
                  <View className="flex-1">
                    <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-3">
                      Max Lifecycle (hours)
                    </Text>
                    <TextInput
                      value={lifecycleHours}
                      onChangeText={setLifecycleHours}
                      keyboardType="numeric"
                      placeholderTextColor="var(--color-text-dim)"
                      className="bg-surface-background border border-surface-border text-typography-main font-black text-xl p-5 rounded-2xl focus:border-brand-primary"
                    />
                  </View>
                </View>
              )}
            </View>
          </ScrollView>

          <View className="p-8 border-t border-surface-border flex-row gap-4 bg-surface-card/50">
            <TouchableOpacity
              onPress={onClose}
              className="flex-1 py-4 rounded-2xl bg-surface-background border border-surface-border items-center"
            >
              <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { handleSave(); onClose(); }}
              className="flex-1 py-4 rounded-2xl bg-brand-primary items-center"
            >
              <Text className="text-white font-black uppercase tracking-widest text-xs">Save Changes</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// ── Target Circle ─────────────────────────────────────────────────────────────

const CIRCLE_SIZE = 280;
const STROKE = 18;
const R = (CIRCLE_SIZE - STROKE) / 2;
const CX = CIRCLE_SIZE / 2;
const CIRCUMFERENCE = 2 * Math.PI * R;

const TargetCircle = ({
  target,
  onEdit,
  onClear,
  activeTheme,
}: {
  target: any;
  onEdit: () => void;
  onClear: (status: string) => void;
  activeTheme: ThemeType;
}) => {
  const palette = NATIVE_THEME_COLORS[activeTheme];
  const isVolume = target.target_type === 'volume';
  const progress = isVolume
    ? Math.min(((target.current_count ?? 0) / (target.target_quantity || 1)) * 100, 100)
    : 50;
  const strokeDashoffset = CIRCUMFERENCE - (progress / 100) * CIRCUMFERENCE;

  const isExpired =
    target.status === 'active' &&
    target.target_deadline &&
    new Date(target.target_deadline) < new Date();
  const isMet = isVolume && target.status === 'active' && (target.current_count ?? 0) >= (target.target_quantity ?? 1);

  const ringColor = target.status !== 'active'
    ? palette.textDim
    : isMet
      ? palette.success
      : isExpired
        ? palette.danger
        : palette.primary;

  const innerPad = STROKE + 14;
  const innerSize = CIRCLE_SIZE - innerPad * 2;

  return (
    <View style={{ width: CIRCLE_SIZE, height: CIRCLE_SIZE, position: 'relative' }}>
      {/* Progress Ring */}
      <Svg width={CIRCLE_SIZE} height={CIRCLE_SIZE} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={`grad-${target.id}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={ringColor} stopOpacity={0.7} />
            <Stop offset="100%" stopColor={ringColor} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        {/* Track */}
        <Circle
          cx={CX} cy={CX} r={R}
          fill="none"
          stroke={palette.border}
          strokeWidth={STROKE}
        />
        {/* Progress */}
        <Circle
          cx={CX} cy={CX} r={R}
          fill="none"
          stroke={`url(#grad-${target.id})`}
          strokeWidth={STROKE}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{ transform: `rotate(-90deg)`, transformOrigin: `${CX}px ${CX}px` }}
        />
        {/* Filled inner background */}
        <Circle cx={CX} cy={CX} r={R - STROKE / 2 - 1} fill={palette.card} />
      </Svg>

      {/* Content */}
      <View
        style={{
          position: 'absolute',
          left: innerPad,
          top: innerPad,
          width: innerSize,
          height: innerSize,
        }}
        className="items-center justify-center"
      >
        {/* Stage name */}
        <Text
          className="text-typography-main font-black text-sm text-center leading-tight mb-0.5"
          numberOfLines={1}
          style={{ maxWidth: innerSize - 8 }}
        >
          {target.stage?.name ?? '—'}
        </Text>

        {/* Type badge */}
        <View
          className={`px-2 py-0.5 rounded-full mb-3 ${isVolume ? 'bg-state-info/15' : 'bg-brand-primary/15'}`}
        >
          <Text className={`text-[7px] font-black uppercase tracking-widest ${isVolume ? 'text-state-info' : 'text-brand-primary'}`}>
            {isVolume ? 'Volume' : 'Performance'}
          </Text>
        </View>

        {/* Progress number */}
        <View className="flex-row items-baseline">
          <Text className="text-typography-main font-black" style={{ fontSize: 44, lineHeight: 48 }}>
            {Math.round(progress)}
          </Text>
          <Text className="text-typography-muted font-black text-lg ml-0.5">%</Text>
        </View>

        {/* Value display */}
        {isVolume ? (
          <Text className="text-typography-muted text-[11px] font-bold mt-1">
            {target.current_count ?? 0} / {target.target_quantity} units
          </Text>
        ) : (
          <View className="items-center mt-1">
            <Text className="text-typography-muted text-[10px] font-bold">
              {Math.round((target.target_active_seconds ?? 0) / 60)}m active
            </Text>
            <Text className="text-typography-dim text-[9px] font-bold">
              {Math.round((target.target_lifecycle_seconds ?? 0) / 3600)}h max life
            </Text>
          </View>
        )}

        {/* Deadline */}
        {target.target_deadline && (
          <Text className="text-typography-dim text-[9px] font-bold mt-2">
            {'Due '}
            {new Date(target.target_deadline).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </Text>
        )}

        {/* Action buttons */}
        <View className="flex-row flex-wrap justify-center gap-2 mt-4 w-full px-4">
          {target.status === 'active' && !isMet && !isExpired && (
            <TouchableOpacity
              onPress={onEdit}
              className="bg-brand-primary/10 border border-brand-primary/20 px-3 py-1.5 rounded-full flex-row items-center gap-1.5 hover:bg-brand-primary/20 transition-colors"
            >
              <FontAwesome name="pencil" size={9} color={palette.primary} />
              <Text className="text-brand-primary text-[8px] font-black uppercase tracking-widest">Edit</Text>
            </TouchableOpacity>
          )}
          {target.status === 'active' && isMet && (
            <TouchableOpacity
              onPress={() => onClear('completed')}
              className="bg-state-success px-3 py-1.5 rounded-full flex-row items-center gap-1.5"
            >
              <FontAwesome name="check" size={9} color="white" />
              <Text className="text-white text-[8px] font-black uppercase tracking-widest">Complete</Text>
            </TouchableOpacity>
          )}
          {target.status === 'active' && isExpired && (
            <TouchableOpacity
              onPress={() => onClear('expired')}
              className="bg-state-danger px-3 py-1.5 rounded-full flex-row items-center gap-1.5"
            >
              <FontAwesome name="times" size={9} color="white" />
              <Text className="text-white text-[8px] font-black uppercase tracking-widest">Expire</Text>
            </TouchableOpacity>
          )}
          {target.status !== 'active' && (
            <View className="bg-surface-background/50 px-3 py-1.5 rounded-full border border-surface-border/30">
              <Text className="text-typography-muted text-[8px] font-black uppercase tracking-widest">
                {target.status}
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function IntelligenceTargets() {
  const { profile } = useAuth();
  const { theme: activeTheme } = useTheme();
  const [targets, setTargets]       = useState<any[]>([]);
  const [history, setHistory]       = useState<any[]>([]);
  const [pipelines, setPipelines]   = useState<any[]>([]);
  const [allStages, setAllStages]   = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showModal, setShowModal]   = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [timeframe, setTimeframe]   = useState('30D');
  const [showRightSidebar, setShowRightSidebar] = useState(true);

  useEffect(() => {
    Promise.all([
      supabase.from('pipelines').select('id, name').is('deleted_at', null),
      supabase.from('pipeline_stages').select('id, name, pipeline_id').order('position', { ascending: true }),
    ]).then(([p, s]) => {
      if (p.data) setPipelines(p.data);
      if (s.data) setAllStages(s.data);
    });
    fetchTargets();
  }, []);

  const fetchTargets = async () => {
    setLoading(true);
    try {
      const { data: res } = await supabase
        .from('pipeline_stage_targets')
        .select('*, stage:pipeline_stages(name, pipeline_id)')
        .order('created_at', { ascending: false });

      const enriched = await Promise.all((res || []).map(async t => {
        if (t.target_type === 'volume' && t.status === 'active') {
          const { count } = await supabase
            .from('tasks')
            .select('*', { count: 'exact', head: true })
            .eq('current_stage_id', t.stage_id);
          return { ...t, current_count: count || 0 };
        }
        return { ...t, current_count: t.target_quantity };
      }));

      setTargets(enriched.filter(t => t.status === 'active'));
      setHistory(enriched.filter(t => t.status !== 'active'));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const handleCreate = async (params: any) => {
    try {
      const { error } = await supabase.from('pipeline_stage_targets').insert({
        stage_id: params.stage_id,
        company_id: profile?.company_id,
        target_type: params.target_type,
        target_active_seconds: params.active,
        target_lifecycle_seconds: params.lifecycle,
        target_quantity: params.quantity,
        target_deadline: params.deadline,
        status: 'active',
      });
      if (error) throw error;
      fetchTargets();
    } catch (e: any) { console.error(e); }
  };

  const handleClear = async (id: string, newStatus: string) => {
    const { error } = await supabase
      .from('pipeline_stage_targets')
      .update({
        status: newStatus,
        completed_at: newStatus === 'completed' ? new Date().toISOString() : null,
      })
      .eq('id', id);
    if (!error) fetchTargets();
  };

  const handleUpdateTarget = async (id: string, updates: Record<string, any>) => {
    const { error } = await supabase.from('pipeline_stage_targets').update(updates).eq('id', id);
    if (!error) fetchTargets();
  };

  const filteredHistory = history.filter(h => {
    const date = new Date(h.completed_at || h.created_at);
    const now = new Date();
    if (timeframe === '7D') return now.getTime() - date.getTime() < 7 * 86400000;
    if (timeframe === '30D') return now.getTime() - date.getTime() < 30 * 86400000;
    if (timeframe === '90D') return now.getTime() - date.getTime() < 90 * 86400000;
    return true;
  });

  const chartData = Object.values(
    filteredHistory.reduce((acc: any, t) => {
      const date = new Date(t.completed_at || t.created_at).toLocaleDateString(undefined, {
        month: 'short', day: 'numeric',
      });
      acc[date] = acc[date] || { date, met: 0, missed: 0 };
      if (t.status === 'completed') acc[date].met += 1;
      if (t.status === 'expired') acc[date].missed += 1;
      return acc;
    }, {})
  ).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const timelineCategories = Array.from(
    new Set(filteredHistory.filter(h => h.status === 'completed').map(h => h.stage?.name || 'Global'))
  ).sort();

  const timelineData = filteredHistory
    .filter(h => h.status === 'completed')
    .map(h => ({
      y: timelineCategories.indexOf(h.stage?.name || 'Global'),
      x: new Date(h.completed_at || h.created_at).getTime(),
      name: h.stage?.name || 'Global',
      type: h.target_type,
      dateLabel: new Date(h.completed_at).toLocaleDateString(),
    }));

  const filteredTargets = targets.filter(t =>
    t.stage?.name?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <View className="flex-1 bg-surface-background flex-row">

      {/* ── LEFT COLUMN ── */}
      <View className="flex-1 flex-col overflow-hidden">
        <View className="px-10 pt-8 pb-5 flex-row flex-wrap items-start justify-between gap-4 border-b border-surface-border">
          <View className="min-w-0">
            <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[9px] mb-1">Intelligence Hub</Text>
            <Text className="text-typography-main text-4xl font-black tracking-tighter">Performance Targets</Text>
          </View>
          <View className="flex-row flex-wrap items-center justify-end gap-3 max-w-full">
            <TouchableOpacity
              onPress={() => setShowModal(true)}
              className="bg-brand-primary px-6 py-2.5 rounded-xl flex-row items-center gap-2"
            >
              <FontAwesome name="plus" size={12} color="white" />
              <Text className="text-white font-black uppercase tracking-widest text-[11px]">New Target</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setShowRightSidebar(!showRightSidebar)}
              className={`px-4 py-2.5 rounded-xl border flex-row items-center gap-2 transition-all ${
                showRightSidebar ? 'bg-brand-primary border-brand-primary premium-shadow' : 'bg-surface-card border-surface-border hover:bg-surface-overlay'
              }`}
            >
              <FontAwesome name="columns" size={14} color={showRightSidebar ? 'white' : getMutedColor(activeTheme)} />
            </TouchableOpacity>
          </View>
        </View>

        {loading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color={getPrimaryColor(activeTheme)} />
          </View>
        ) : (
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            <View className="px-10 py-10">

              {/* Active Targets — Circle Grid */}
              {filteredTargets.length === 0 ? (
                <View className="w-full bg-surface-card/30 p-20 rounded-[3rem] border border-surface-border border-dashed items-center mb-12">
                  <FontAwesome name="bullseye" size={40} color={getMutedColor(activeTheme)} style={{ opacity: 0.2, marginBottom: 12 }} />
                  <Text className="text-typography-muted font-bold text-sm">No active targets found.</Text>
                  <TouchableOpacity
                    onPress={() => setShowModal(true)}
                    className="mt-6 bg-brand-primary px-6 py-2.5 rounded-xl"
                  >
                    <Text className="text-white font-black uppercase tracking-widest text-[10px]">Create First Target</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View className="flex-row flex-wrap gap-8 mb-12">
                  {filteredTargets.map(t => (
                    <TargetCircle
                      key={t.id}
                      target={t}
                      onEdit={() => setEditTarget(t)}
                      onClear={(status: string) => handleClear(t.id, status)}
                      activeTheme={activeTheme}
                    />
                  ))}
                </View>
              )}

              {/* Fulfillment Trace */}
              {timelineData.length > 0 && (
                <View className="bg-surface-card p-10 rounded-[3rem] border border-surface-border premium-shadow mb-10">
                  <View className="flex-row justify-between items-start mb-10">
                    <View>
                      <Text className="text-typography-main font-black text-2xl tracking-tighter">Fulfillment Trace</Text>
                      <Text className="text-typography-muted text-xs mt-1">
                        Timeline of satisfied performance benchmarks by stage
                      </Text>
                    </View>
                    <View className="bg-brand-primary/10 px-4 py-2 rounded-xl border border-brand-primary/20">
                      <Text className="text-brand-primary text-[10px] font-black uppercase tracking-widest">
                        {timelineData.length} Success Points
                      </Text>
                    </View>
                  </View>
                  <View style={{ height: 320 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.1} />
                        <XAxis
                          type="number" dataKey="x" name="time" domain={['auto', 'auto']}
                          tickFormatter={t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          stroke="var(--color-text-dim)" fontSize={10} fontWeight="bold"
                          axisLine={false} tickLine={false} dy={10}
                        />
                        <YAxis
                          type="number" dataKey="y" name="stage"
                          domain={[-1, timelineCategories.length]}
                          ticks={timelineCategories.map((_, i) => i)}
                          tickFormatter={i => timelineCategories[i]}
                          stroke="var(--color-text-dim)" fontSize={10}
                          axisLine={false} tickLine={false}
                        />
                        <ZAxis type="number" range={[100, 100]} />
                        <Tooltip
                          cursor={{ strokeDasharray: '3 3' }}
                          content={({ active, payload }: any) => {
                            if (active && payload?.length) {
                              const d = payload[0].payload;
                              return (
                                <View className="bg-surface-card border border-surface-border p-3 rounded-xl premium-shadow">
                                  <Text className="text-typography-main font-black text-sm mb-1">{d.name}</Text>
                                  <Text className="text-brand-primary font-bold text-[10px] uppercase tracking-widest">{d.type} MET</Text>
                                  <Text className="text-typography-muted text-[10px] mt-2">{d.dateLabel}</Text>
                                </View>
                              );
                            }
                            return null;
                          }}
                        />
                        <Scatter name="Successes" data={timelineData}>
                          {timelineData.map((_, index) => (
                            <Cell key={`cell-${index}`} fill="var(--color-primary)" />
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  </View>
                </View>
              )}
            </View>
          </ScrollView>
        )}
      </View>

      {/* ── RIGHT COLUMN: PERFORMANCE CONSOLE ── */}
      {showRightSidebar && (
        <View className="w-[480px] border-l border-surface-border bg-surface-card/10">
          <View className="p-8 pb-0">
            <View className="bg-surface-card border border-surface-border rounded-xl px-4 py-3 flex-row items-center w-full mb-6 premium-shadow">
              <FontAwesome name="search" size={12} color={getMutedColor(activeTheme)} style={{ marginRight: 10 }} />
              <TextInput
                placeholder="Search stage targets..."
                placeholderTextColor="var(--color-text-muted)"
                className="flex-1 text-typography-main text-xs font-bold outline-none"
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
          </View>
          <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
            <View className="px-8 pb-8">

              {/* Success Velocity */}
            <View className="bg-surface-card p-8 rounded-[40px] border border-surface-border premium-shadow mb-8">
              <View className="flex-row justify-between items-start mb-8">
                <View>
                  <Text className="text-typography-main font-black text-xl tracking-tight">Success Velocity</Text>
                  <Text className="text-typography-muted text-[10px] mt-1 uppercase tracking-widest">
                    Aggregate Achievement Rate
                  </Text>
                </View>
                <View className="flex-row gap-1">
                  {['7D', '30D', '90D', 'ALL'].map(tf => (
                    <TouchableOpacity
                      key={tf}
                      onPress={() => setTimeframe(tf)}
                      className={`px-3 py-1.5 rounded-lg border ${
                        timeframe === tf
                          ? 'bg-brand-primary border-brand-primary'
                          : 'bg-surface-overlay border-surface-border'
                      }`}
                    >
                      <Text className={`text-[8px] font-black ${timeframe === tf ? 'text-white' : 'text-typography-muted'}`}>
                        {tf}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={{ height: 320 }}>
                {filteredHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} margin={{ bottom: 20 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} opacity={0.1} />
                      <XAxis
                        dataKey="date" stroke="var(--color-text-dim)" fontSize={10} fontWeight="bold"
                        axisLine={false} tickLine={false} dy={10}
                      />
                      <YAxis hide />
                      <Tooltip
                        cursor={{ fill: 'var(--color-primary)', fillOpacity: 0.05 }}
                        contentStyle={{
                          backgroundColor: 'var(--color-surface-card)',
                          border: '1px solid var(--color-surface-border)',
                          borderRadius: '12px',
                        }}
                      />
                      <Bar dataKey="met" stackId="a" fill="var(--color-primary)" radius={[0, 0, 0, 0]} maxBarSize={40} />
                      <Bar dataKey="missed" stackId="a" fill="var(--color-danger)" radius={[8, 8, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <View className="flex-1 items-center justify-center bg-surface-background/50 rounded-2xl border border-dashed border-surface-border">
                    <Text className="text-typography-muted text-[10px] font-black">NO DATA IN RANGE</Text>
                  </View>
                )}
              </View>

              <View className="flex-row items-center justify-center gap-6 mt-8">
                <View className="flex-row items-center gap-2">
                  <View className="w-2.5 h-2.5 rounded-full bg-brand-primary" />
                  <Text className="text-[9px] font-black text-typography-main uppercase tracking-widest">Met Goals</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <View className="w-2.5 h-2.5 rounded-full bg-state-danger" />
                  <Text className="text-[9px] font-black text-typography-main uppercase tracking-widest">Missed Goals</Text>
                </View>
              </View>
            </View>

            {/* Recent Activity */}
            <View>
              <View className="flex-row items-center justify-between mb-6">
                <View className="flex-row items-center gap-2">
                  <View className="w-1.5 h-1.5 rounded-full bg-state-info" />
                  <Text className="text-typography-main font-black uppercase tracking-[0.2em] text-[10px]">Recent Activity</Text>
                </View>
                <TouchableOpacity onPress={fetchTargets}>
                  <FontAwesome name="refresh" size={10} color={getMutedColor(activeTheme)} />
                </TouchableOpacity>
              </View>

              {filteredHistory.length === 0 ? (
                <View className="p-10 items-center justify-center bg-surface-card/30 rounded-3xl border border-surface-border border-dashed">
                  <Text className="text-typography-muted text-[10px] font-bold">NO HISTORY IN RANGE</Text>
                </View>
              ) : (
                <View className="gap-4">
                  {filteredHistory.slice(0, 15).map((h, i) => (
                    <View key={i} className="bg-surface-card p-4 rounded-2xl border border-surface-border flex-row items-center">
                      <View
                        className={`w-8 h-8 rounded-full items-center justify-center mr-4 ${
                          h.status === 'completed' ? 'bg-state-success/10' : 'bg-state-danger/10'
                        }`}
                      >
                        <FontAwesome
                          name={h.status === 'completed' ? 'check' : 'times'}
                          size={10}
                          color={h.status === 'completed' ? 'var(--color-success)' : 'var(--color-danger)'}
                        />
                      </View>
                      <View className="flex-1">
                        <Text className="text-typography-main font-bold text-xs" numberOfLines={1}>
                          {h.stage?.name || 'Unknown Stage'}
                        </Text>
                        <Text className="text-typography-muted text-[9px] uppercase tracking-widest">
                          {h.target_type} {h.status === 'completed' ? 'Met' : 'Missed'}
                        </Text>
                      </View>
                      <Text className="text-typography-muted text-[9px] font-bold">
                        {new Date(h.completed_at || h.created_at).toLocaleDateString(undefined, {
                          month: 'short', day: 'numeric',
                        })}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
            </View>
          </ScrollView>
        </View>
      )}

      <TargetCreationModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleCreate}
        pipelines={pipelines}
        stages={allStages}
      />

      <EditTargetModal
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSave={handleUpdateTarget}
      />
    </View>
  );
}
