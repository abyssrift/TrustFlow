import { CircularTargetCardMobile, CompletionVelocityMobile, IntelligencePicker } from '@/components/intelligence/IntelligenceCommon';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';

const CreateModal = ({ visible, onClose, onConfirm, pipelines, stages }: any) => {
  const [type, setType]           = useState('performance');
  const [pipeline, setPipeline]   = useState<string | null>(null);
  const [stage, setStage]         = useState<string | null>(null);
  const [activeGoal, setActiveGoal] = useState('3600');
  const [lifeGoal, setLifeGoal]   = useState('86400');
  const [quantity, setQuantity]   = useState('50');
  const [deadline, setDeadline]   = useState<Date | null>(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
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
          
          <ScrollView className="px-8 max-h-[500px]" showsVerticalScrollIndicator={false}>
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
                    selectedDate={deadline ? deadline.toISOString().split('T')[0] : null}
                    onSelect={(d) => setDeadline(new Date(d))}
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
                  deadline:  type === 'volume' ? deadline?.toISOString() : null,
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

export default function IntelligenceTargetsNative() {
  const { profile } = useAuth();
  const [targets, setTargets]     = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [allStages, setAllStages] = useState<any[]>([]);
  const [loading, setLoading]     = useState(true);
  const [showModal, setShowModal] = useState(false);

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
        const { error } = await supabase.from('pipeline_stage_targets').delete().eq('id', targetId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('pipeline_stage_targets')
          .update({ 
            status: action,
            completed_at: action === 'completed' ? new Date().toISOString() : null
          })
          .eq('id', targetId);
        if (error) throw error;
      }
      fetchTargets();
    } catch (e: any) { Alert.alert('Error', e.message); }
  };

  const handleEdit = (target: any) => {
    Alert.prompt(
      'Adjust Benchmark',
      `Target: ${target.target_type === 'volume' ? target.target_quantity + ' units' : Math.round(target.target_active_seconds / 60) + 'm'}`,
      async (val) => {
        const num = parseInt(val || '');
        if (isNaN(num)) return;
        const field = target.target_type === 'volume' ? 'target_quantity' : 'target_active_seconds';
        const finalVal = target.target_type === 'volume' ? num : num * 60;
        const { error } = await supabase.from('pipeline_stage_targets').update({ [field]: finalVal }).eq('id', target.id);
        if (!error) fetchTargets();
      }
    );
  };

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
          <TouchableOpacity onPress={() => setShowModal(true)} className="bg-brand-primary px-5 py-3 rounded-2xl flex-row items-center gap-2">
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
            <TouchableOpacity onPress={() => setShowModal(true)} className="bg-brand-primary px-8 py-3 rounded-2xl">
              <Text className="text-white font-black uppercase tracking-widest text-xs">Create First Target</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView className="flex-1 px-6" showsVerticalScrollIndicator={false}>
          <View className="flex-row items-center gap-3 mb-6 mt-4">
            <View className="w-1 h-5 bg-brand-primary rounded-full" />
            <Text className="text-typography-main text-lg font-black tracking-tight">Active Benchmarks</Text>
          </View>
          
          {targets.filter(t => t.status === 'active').length === 0 ? (
            <View className="bg-surface-card/50 p-8 rounded-3xl border border-surface-border border-dashed items-center mb-8">
              <Text className="text-typography-muted font-bold text-[10px] uppercase tracking-widest">No Active Vectors</Text>
            </View>
          ) : (
            targets.filter(t => t.status === 'active').map((t, i) => (
              <CircularTargetCardMobile 
                key={t.id} 
                target={t} 
                onEdit={() => handleEdit(t)} 
                onAction={(action: any) => handleAction(t.id, action)}
              />
            ))
          )}

          <CompletionVelocityMobile 
            data={Object.values(targets.reduce((acc: any, t) => {
              if (t.status === 'completed' && t.completed_at) {
                const date = new Date(t.completed_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                acc[date] = acc[date] || { date, count: 0 };
                acc[date].count += 1;
              }
              return acc;
            }, {})).sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime()) as any} 
          />

          {targets.filter(t => t.status !== 'active').length > 0 && (
            <>
              <View className="flex-row items-center gap-3 mb-6 mt-10">
                <View className="w-1 h-5 bg-typography-muted rounded-full" />
                <Text className="text-typography-main text-lg font-black tracking-tight">Benchmark History</Text>
              </View>
              {targets.filter(t => t.status !== 'active').map((t, i) => (
                <CircularTargetCardMobile 
                  key={t.id} 
                  target={t} 
                  onEdit={() => handleEdit(t)} 
                  onAction={(action: any) => handleAction(t.id, action)}
                />
              ))}
            </>
          )}
          <View className="h-10" />
        </ScrollView>
      )}

      <CreateModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleCreate}
        pipelines={pipelines}
        stages={allStages}
      />
    </View>
  );
}
