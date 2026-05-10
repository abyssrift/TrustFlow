import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput,
  TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';
import { IntelligencePicker } from '@/components/intelligence/IntelligenceCommon';
import { CompletionVelocityMobile } from '@/components/intelligence/IntelligenceCommon';

// ── Create Modal ───────────────────────────────────────────────────────────────

const CreateModal = ({ visible, onClose, onConfirm, pipelines, stages }: any) => {
  const [type, setType]           = useState('performance');
  const [pipeline, setPipeline]   = useState<string | null>(null);
  const [stage, setStage]         = useState<string | null>(null);
  const [activeGoal, setActiveGoal] = useState('3600');
  const [lifeGoal, setLifeGoal]   = useState('86400');
  const [quantity, setQuantity]   = useState('50');
  const [deadline, setDeadline]   = useState<string | null>(
    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const filteredStages = stages.filter((s: any) => s.pipeline_id === pipeline);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 justify-end">
        <View className="bg-surface-card w-full rounded-t-[40px] border-t border-surface-border overflow-hidden pb-10">
          <View className="p-8 pb-4 items-center">
            <View className="w-12 h-1.5 bg-surface-border rounded-full mb-6" />
            <Text className="text-typography-main text-2xl font-black mb-1">Define Objective</Text>
            <Text className="text-typography-muted text-xs">Establish high-fidelity benchmarks</Text>
          </View>

          <ScrollView className="px-8 max-h-[520px]" showsVerticalScrollIndicator={false}>
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mt-6 mb-4">Targeting Vector</Text>
            <View className="flex-row bg-surface-background p-1.5 rounded-2xl mb-6">
              {['performance', 'volume'].map(t => (
                <TouchableOpacity
                  key={t}
                  onPress={() => setType(t)}
                  className={`flex-1 py-3 rounded-xl items-center flex-row justify-center ${type === t ? 'bg-brand-primary premium-shadow' : ''}`}
                >
                  <FontAwesome
                    name={t === 'performance' ? 'bolt' : 'database'}
                    size={10}
                    color={type === t ? 'white' : 'var(--color-text-muted)'}
                    style={{ marginRight: 8 }}
                  />
                  <Text className={`font-black text-[10px] uppercase tracking-widest ${type === t ? 'text-white' : 'text-typography-muted'}`}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mb-4">Pipeline Architecture</Text>
            <IntelligencePicker items={pipelines} selectedId={pipeline} onSelect={(id: string) => { setPipeline(id); setStage(null); }} />

            {pipeline && (
              <>
                <View className="h-4" />
                <IntelligencePicker items={filteredStages} selectedId={stage} onSelect={setStage} />
              </>
            )}

            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.2em] mt-8 mb-4">
              {type === 'performance' ? 'SLA Constraints' : 'Volume Metrics'}
            </Text>

            {type === 'performance' ? (
              <View className="flex-row flex-wrap gap-4 mb-6">
                <View className="flex-1">
                  <Text className="text-typography-muted text-[9px] font-black uppercase mb-2">Target Active (s)</Text>
                  <TextInput
                    value={activeGoal}
                    onChangeText={setActiveGoal}
                    keyboardType="numeric"
                    placeholderTextColor="var(--color-text-dim)"
                    className="bg-surface-background border border-surface-border text-typography-main p-4 rounded-2xl font-black text-lg"
                  />
                </View>
                <View className="flex-1">
                  <Text className="text-typography-muted text-[9px] font-black uppercase mb-2">Max Life (s)</Text>
                  <TextInput
                    value={lifeGoal}
                    onChangeText={setLifeGoal}
                    keyboardType="numeric"
                    placeholderTextColor="var(--color-text-dim)"
                    className="bg-surface-background border border-surface-border text-typography-main p-4 rounded-2xl font-black text-lg"
                  />
                </View>
              </View>
            ) : (
              <View className="gap-6 mb-6">
                <View>
                  <Text className="text-typography-muted text-[9px] font-black uppercase mb-2">Target Quota (Units)</Text>
                  <TextInput
                    value={quantity}
                    onChangeText={setQuantity}
                    keyboardType="numeric"
                    placeholderTextColor="var(--color-text-dim)"
                    className="bg-surface-background border border-surface-border text-typography-main p-4 rounded-2xl font-black text-lg"
                  />
                </View>
                <View>
                  <Text className="text-typography-muted text-[9px] font-black uppercase mb-3">Expiration Deadline</Text>
                  <PremiumCalendarPicker
                    selectedDate={deadline ? (typeof deadline === 'string' ? deadline : deadline.toISOString().split('T')[0]) : null}
                    onSelect={(d) => setDeadline(d)}

                  />
                </View>
              </View>
            )}
            <View className="h-10" />
          </ScrollView>

          <View className="px-8 pt-4 flex-row flex-wrap gap-4 border-t border-surface-border">
            <TouchableOpacity onPress={onClose} className="flex-1 py-4 rounded-2xl bg-surface-background border border-surface-border items-center">
              <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!stage}
              onPress={() => {
                onConfirm({
                  stage_id: stage,
                  target_type: type,
                  active:    type === 'performance' ? parseInt(activeGoal) : null,
                  lifecycle: type === 'performance' ? parseInt(lifeGoal) : null,
                  quantity:  type === 'volume' ? parseInt(quantity) : null,
                  deadline:  type === 'volume' ? deadline : null,
                });
                onClose();
              }}
              className={`flex-1 py-4 rounded-2xl items-center premium-shadow ${stage ? 'bg-brand-primary' : 'bg-surface-border opacity-50'}`}
            >
              <Text className="text-brand-on-primary font-black uppercase tracking-widest text-xs">Deploy</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// ── Edit Modal ─────────────────────────────────────────────────────────────────

const EditModal = ({ target, onClose, onSave }: { target: any; onClose: () => void; onSave: (id: string, updates: Record<string, any>) => void }) => {
  if (!target) return null;
  const isVolume = target.target_type === 'volume';
  const [quantity, setQuantity]   = useState(String(target.target_quantity ?? ''));
  const [activeMins, setActiveMins] = useState(String(Math.round((target.target_active_seconds ?? 0) / 60)));
  const [lifecycleHours, setLifecycleHours] = useState(String(Math.round((target.target_lifecycle_seconds ?? 0) / 3600)));
  const [deadline, setDeadline]   = useState<string | null>(
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
    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 justify-end">
        <View className="bg-surface-card w-full rounded-t-[40px] border-t border-surface-border overflow-hidden pb-10">
          <View className="p-8 pb-4 items-center">
            <View className="w-12 h-1.5 bg-surface-border rounded-full mb-6" />
            <Text className="text-typography-main text-2xl font-black mb-1">Edit Target</Text>
            <Text className="text-typography-muted text-xs">
              {target.stage?.name} · {isVolume ? 'Volume Quota' : 'Performance SLA'}
            </Text>
          </View>

          <ScrollView className="px-8 max-h-[520px]" showsVerticalScrollIndicator={false}>
            {isVolume ? (
              <View className="gap-6">
                <View>
                  <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-3">Target Quota (Units)</Text>
                  <TextInput
                    value={quantity}
                    onChangeText={setQuantity}
                    keyboardType="numeric"
                    placeholderTextColor="var(--color-text-dim)"
                    className="bg-surface-background border border-surface-border text-typography-main p-5 rounded-2xl font-black text-xl"
                  />
                </View>
                <View>
                  <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-3">Expiration Deadline</Text>
                  <PremiumCalendarPicker
                    selectedDate={deadline}
                    onSelect={setDeadline}
                    compact
                  />
                </View>
              </View>
            ) : (
              <View className="gap-6">
                <View>
                  <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-3">Active Budget (minutes)</Text>
                  <TextInput
                    value={activeMins}
                    onChangeText={setActiveMins}
                    keyboardType="numeric"
                    placeholderTextColor="var(--color-text-dim)"
                    className="bg-surface-background border border-surface-border text-typography-main p-5 rounded-2xl font-black text-xl"
                  />
                </View>
                <View>
                  <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest mb-3">Max Lifecycle (hours)</Text>
                  <TextInput
                    value={lifecycleHours}
                    onChangeText={setLifecycleHours}
                    keyboardType="numeric"
                    placeholderTextColor="var(--color-text-dim)"
                    className="bg-surface-background border border-surface-border text-typography-main p-5 rounded-2xl font-black text-xl"
                  />
                </View>
              </View>
            )}
            <View className="h-10" />
          </ScrollView>

          <View className="px-8 pt-4 flex-row gap-4 border-t border-surface-border">
            <TouchableOpacity onPress={onClose} className="flex-1 py-4 rounded-2xl bg-surface-background border border-surface-border items-center">
              <Text className="text-typography-muted font-black uppercase tracking-widest text-xs">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleSave}
              className="flex-1 py-4 rounded-2xl bg-brand-primary items-center"
            >
              <Text className="text-brand-on-primary font-black uppercase tracking-widest text-xs">Save Changes</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// ── Target Circle ──────────────────────────────────────────────────────────────

const STROKE = 16;

const TargetCircle = ({
  target,
  size,
  onEdit,
  onAction,
}: {
  target: any;
  size: number;
  onEdit: () => void;
  onAction: (action: string) => void;
}) => {
  const r = (size - STROKE) / 2;
  const cx = size / 2;
  const circumference = 2 * Math.PI * r;

  const isVolume = target.target_type === 'volume';
  const progress = isVolume
    ? Math.min(((target.current_count ?? 0) / (target.target_quantity || 1)) * 100, 100)
    : 50;
  const strokeDashoffset = circumference - (progress / 100) * circumference;

  const isExpired =
    target.status === 'active' &&
    target.target_deadline &&
    new Date(target.target_deadline) < new Date();
  const isMet = isVolume && target.status === 'active' && (target.current_count ?? 0) >= (target.target_quantity ?? 1);

  const ringColor = target.status !== 'active'
    ? 'var(--color-text-dim)'
    : isMet
      ? 'var(--color-success)'
      : isExpired
        ? 'var(--color-danger)'
        : 'var(--color-primary)';

  const innerPad = STROKE + 12;
  const innerSize = size - innerPad * 2;
  const gradId = `grad-mob-${target.id}`;

  return (
    <View style={{ width: size, height: size, position: 'relative' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={ringColor} stopOpacity={0.7} />
            <Stop offset="100%" stopColor={ringColor} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        {/* Track */}
        <Circle cx={cx} cy={cx} r={r} fill="none" stroke="var(--color-surface-border)" strokeWidth={STROKE} />
        {/* Progress */}
        <Circle
          cx={cx} cy={cx} r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={STROKE}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{ transform: `rotate(-90deg)`, transformOrigin: `${cx}px ${cx}px` }}
        />
        {/* Inner fill */}
        <Circle cx={cx} cy={cx} r={r - STROKE / 2 - 1} fill="var(--color-surface-card)" />
      </Svg>

      <View
        style={{ position: 'absolute', left: innerPad, top: innerPad, width: innerSize, height: innerSize }}
        className="items-center justify-center"
      >
        <Text className="text-typography-main font-black text-xs text-center leading-tight mb-1" numberOfLines={1} style={{ maxWidth: innerSize - 8 }}>
          {target.stage?.name ?? '—'}
        </Text>

        <View className={`px-2 py-0.5 rounded-full mb-2 ${isVolume ? 'bg-state-info/15' : 'bg-brand-primary/15'}`}>
          <Text className={`text-[7px] font-black uppercase tracking-widest ${isVolume ? 'text-state-info' : 'text-brand-primary'}`}>
            {isVolume ? 'Volume' : 'Perf'}
          </Text>
        </View>

        <View className="flex-row items-baseline">
          <Text className="text-typography-main font-black" style={{ fontSize: Math.round(size * 0.14), lineHeight: Math.round(size * 0.16) }}>
            {Math.round(progress)}
          </Text>
          <Text className="text-typography-muted font-black text-sm ml-0.5">%</Text>
        </View>

        {isVolume ? (
          <Text className="text-typography-muted font-bold mt-1" style={{ fontSize: 10 }}>
            {target.current_count ?? 0}/{target.target_quantity}
          </Text>
        ) : (
          <Text className="text-typography-muted font-bold mt-1" style={{ fontSize: 10 }}>
            {Math.round((target.target_active_seconds ?? 0) / 60)}m
          </Text>
        )}

        {target.target_deadline && (
          <Text className="text-typography-dim font-bold mt-1" style={{ fontSize: 9 }}>
            {'Due '}
            {new Date(target.target_deadline).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
          </Text>
        )}

        <View className="flex-row gap-1.5 mt-3">
          {target.status === 'active' && !isMet && !isExpired && (
            <TouchableOpacity
              onPress={onEdit}
              className="bg-brand-primary/10 border border-brand-primary/20 px-2.5 py-1 rounded-full flex-row items-center gap-1"
            >
              <FontAwesome name="pencil" size={8} color="var(--color-primary)" />
              <Text className="text-brand-primary font-black uppercase" style={{ fontSize: 7 }}>Edit</Text>
            </TouchableOpacity>
          )}
          {target.status === 'active' && isMet && (
            <TouchableOpacity
              onPress={() => onAction('completed')}
              className="bg-state-success px-2.5 py-1 rounded-full flex-row items-center gap-1"
            >
              <FontAwesome name="check" size={8} color="white" />
              <Text className="text-white font-black uppercase" style={{ fontSize: 7 }}>Done</Text>
            </TouchableOpacity>
          )}
          {target.status === 'active' && isExpired && (
            <TouchableOpacity
              onPress={() => onAction('expired')}
              className="bg-state-danger px-2.5 py-1 rounded-full flex-row items-center gap-1"
            >
              <FontAwesome name="times" size={8} color="white" />
              <Text className="text-white font-black uppercase" style={{ fontSize: 7 }}>Expire</Text>
            </TouchableOpacity>
          )}
          {target.status !== 'active' && (
            <View className="bg-surface-background/50 px-2.5 py-1 rounded-full border border-surface-border/30">
              <Text className="text-typography-muted font-black uppercase" style={{ fontSize: 7 }}>{target.status}</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
};

// ── Main Screen ────────────────────────────────────────────────────────────────

export default function IntelligenceTargetsNative() {
  const { profile } = useAuth();
  const { width: screenWidth } = useWindowDimensions();
  const [targets, setTargets]     = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [allStages, setAllStages] = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<any>(null);

  // Two-column grid: each circle fills half the content width
  const PADDING = 24;
  const GAP = 16;
  const circleSize = Math.min(Math.floor((screenWidth - PADDING * 2 - GAP) / 2), 200);

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
        if (t.target_type === 'volume') {
          const { count } = await supabase.from('tasks').select('*', { count: 'exact', head: true }).eq('current_stage_id', t.stage_id);
          return { ...t, current_count: count || 0 };
        }
        return t;
      }));
      setTargets(enriched);
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
      });
      if (error) throw error;
      fetchTargets();
    } catch (e: any) { Alert.alert('Error', e.message); }
  };

  const handleAction = async (targetId: string, action: 'completed' | 'expired' | 'clear') => {
    try {
      if (action === 'clear') {
        await supabase.from('pipeline_stage_targets').delete().eq('id', targetId);
      } else {
        await supabase.from('pipeline_stage_targets').update({
          status: action,
          completed_at: action === 'completed' ? new Date().toISOString() : null,
        }).eq('id', targetId);
      }
      fetchTargets();
    } catch (e: any) { Alert.alert('Error', e.message); }
  };

  const handleUpdate = async (id: string, updates: Record<string, any>) => {
    const { error } = await supabase.from('pipeline_stage_targets').update(updates).eq('id', id);
    if (!error) fetchTargets();
  };

  const activeTargets  = targets.filter(t => t.status === 'active');
  const historyTargets = targets.filter(t => t.status !== 'active');

  const velocityData = Object.values(
    historyTargets.reduce((acc: any, t) => {
      if (t.status === 'completed' && t.completed_at) {
        const date = new Date(t.completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
        acc[date] = acc[date] || { date, count: 0 };
        acc[date].count += 1;
      }
      return acc;
    }, {})
  ).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()) as any[];

  return (
    <View className="flex-1 bg-surface-background">
      <View className="px-6 pt-14 pb-4 flex-row flex-wrap items-end justify-between gap-y-4">
        <View>
          <Text className="text-brand-primary font-black uppercase tracking-[4px] text-[10px] mb-1">Intelligence Hub</Text>
          <Text className="text-typography-main text-3xl font-black">Targets</Text>
        </View>
        <View className="flex-row flex-wrap gap-2">
          <TouchableOpacity onPress={fetchTargets} className="w-11 h-11 items-center justify-center bg-surface-card border border-surface-border rounded-2xl">
            <FontAwesome name="refresh" size={13} color="rgb(var(--brand-primary))" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowCreate(true)} className="bg-brand-primary px-5 py-3 rounded-2xl flex-row items-center gap-2">
            <FontAwesome name="plus" size={11} color="white" />
            <Text className="text-white font-black text-[11px]">New</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
        </View>
      ) : targets.length === 0 ? (
        <View className="flex-1 items-center justify-center px-6">
          <View className="bg-surface-card p-10 rounded-[2.5rem] border border-surface-border items-center w-full">
            <View className="w-16 h-16 bg-brand-primary/10 rounded-full items-center justify-center mb-4">
              <FontAwesome name="bullseye" size={28} color="rgb(var(--brand-primary))" />
            </View>
            <Text className="text-typography-main text-xl font-black mb-2">No Targets Yet</Text>
            <Text className="text-typography-muted text-center text-sm leading-relaxed mb-6">
              Define performance benchmarks and volume quotas for your pipeline stages.
            </Text>
            <TouchableOpacity onPress={() => setShowCreate(true)} className="bg-brand-primary px-8 py-3 rounded-2xl">
              <Text className="text-white font-black uppercase tracking-widest text-xs">Create First Target</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>

          {/* Active */}
          <View className="flex-row items-center gap-3 mb-6 mt-4">
            <View className="w-1 h-5 bg-brand-primary rounded-full" />
            <Text className="text-typography-main text-lg font-black tracking-tight">Active Benchmarks</Text>
          </View>

          {activeTargets.length === 0 ? (
            <View className="bg-surface-card/50 p-8 rounded-3xl border border-surface-border border-dashed items-center mb-8">
              <Text className="text-typography-muted font-bold text-[10px] uppercase tracking-widest">No Active Vectors</Text>
            </View>
          ) : (
            <View className="flex-row flex-wrap mb-8" style={{ gap: GAP }}>
              {activeTargets.map(t => (
                <TargetCircle
                  key={t.id}
                  target={t}
                  size={circleSize}
                  onEdit={() => setEditTarget(t)}
                  onAction={(action: any) => handleAction(t.id, action)}
                />
              ))}
            </View>
          )}

          <CompletionVelocityMobile data={velocityData} />

          {/* History */}
          {historyTargets.length > 0 && (
            <>
              <View className="flex-row items-center gap-3 mb-6 mt-10">
                <View className="w-1 h-5 bg-typography-muted rounded-full" />
                <Text className="text-typography-main text-lg font-black tracking-tight">Benchmark History</Text>
              </View>
              <View className="flex-row flex-wrap mb-4" style={{ gap: GAP }}>
                {historyTargets.map(t => (
                  <TargetCircle
                    key={t.id}
                    target={t}
                    size={circleSize}
                    onEdit={() => setEditTarget(t)}
                    onAction={(action: any) => handleAction(t.id, action)}
                  />
                ))}
              </View>
            </>
          )}

          <View className="h-10" />
        </ScrollView>
      )}

      <CreateModal
        visible={showCreate}
        onClose={() => setShowCreate(false)}
        onConfirm={handleCreate}
        pipelines={pipelines}
        stages={allStages}
      />

      <EditModal
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSave={handleUpdate}
      />
    </View>
  );
}
