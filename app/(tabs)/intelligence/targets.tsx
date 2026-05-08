import { CircularTargetCardMobile } from '@/components/intelligence/IntelligenceCommon';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

const Picker = ({ items, selectedId, onSelect, labelKey = 'name' }: any) => (
  <View className="flex-row flex-wrap gap-2">
    {items.map((item: any) => (
      <TouchableOpacity
        key={item.id}
        onPress={() => onSelect(item.id)}
        className={`px-4 py-2 rounded-xl border ${selectedId === item.id ? 'bg-surface-background border-brand-primary' : 'border-surface-border'}`}
      >
        <Text className={`text-[11px] font-medium ${selectedId === item.id ? 'text-brand-primary font-bold' : 'text-typography-muted'}`}>
          {item[labelKey] || 'N/A'}
        </Text>
      </TouchableOpacity>
    ))}
  </View>
);

const CreateModal = ({ visible, onClose, onConfirm, pipelines, stages }: any) => {
  const [type, setType]           = useState('performance');
  const [pipeline, setPipeline]   = useState<string | null>(null);
  const [stage, setStage]         = useState<string | null>(null);
  const [activeGoal, setActiveGoal] = useState('3600');
  const [lifeGoal, setLifeGoal]   = useState('86400');
  const [quantity, setQuantity]   = useState('50');
  const [deadline, setDeadline]   = useState('7');
  const filteredStages = stages.filter((s: any) => s.pipeline_id === pipeline);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 bg-black/70 items-center justify-center px-6">
        <View className="bg-surface-card w-full max-h-[90%] rounded-[32px] border border-surface-border overflow-hidden">
          <View className="p-8 pb-4">
            <Text className="text-typography-main text-2xl font-black mb-1">New Benchmark</Text>
            <Text className="text-typography-muted text-xs">Set performance or volume targets</Text>
          </View>
          <ScrollView className="px-8" showsVerticalScrollIndicator={false}>
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-4 mb-3">Type</Text>
            <View className="flex-row bg-surface-background p-1 rounded-xl mb-4">
              {['performance', 'volume'].map(t => (
                <TouchableOpacity key={t} onPress={() => setType(t)} className={`flex-1 py-2 rounded-lg items-center ${type === t ? 'bg-brand-primary' : ''}`}>
                  <Text className={`font-bold text-[10px] uppercase ${type === t ? 'text-white' : 'text-typography-muted'}`}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-2 mb-3">Pipeline</Text>
            <Picker items={pipelines} selectedId={pipeline} onSelect={(id: string) => { setPipeline(id); setStage(null); }} />
            {pipeline && (
              <>
                <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-6 mb-3">Stage</Text>
                <Picker items={filteredStages} selectedId={stage} onSelect={setStage} />
              </>
            )}
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-6 mb-3">
              {type === 'performance' ? 'Performance Rules' : 'Volume Rules'}
            </Text>
            {type === 'performance' ? (
              <View className="flex-row gap-4 mb-6">
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-bold mb-2">Target Active (sec)</Text>
                  <TextInput value={activeGoal} onChangeText={setActiveGoal} keyboardType="numeric" className="bg-surface-background border border-surface-border text-typography-main p-4 rounded-xl font-bold" />
                </View>
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-bold mb-2">Max Life (sec)</Text>
                  <TextInput value={lifeGoal} onChangeText={setLifeGoal} keyboardType="numeric" className="bg-surface-background border border-surface-border text-typography-main p-4 rounded-xl font-bold" />
                </View>
              </View>
            ) : (
              <View className="flex-row gap-4 mb-6">
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-bold mb-2">Target Quota</Text>
                  <TextInput value={quantity} onChangeText={setQuantity} keyboardType="numeric" className="bg-surface-background border border-surface-border text-typography-main p-4 rounded-xl font-bold" />
                </View>
                <View className="flex-1">
                  <Text className="text-typography-muted text-[10px] font-bold mb-2">In (Days)</Text>
                  <TextInput value={deadline} onChangeText={setDeadline} keyboardType="numeric" className="bg-surface-background border border-surface-border text-typography-main p-4 rounded-xl font-bold" />
                </View>
              </View>
            )}
            <View className="h-10" />
          </ScrollView>
          <View className="p-8 pt-4 flex-row gap-3 border-t border-surface-border">
            <TouchableOpacity onPress={onClose} className="flex-1 py-4 rounded-2xl bg-surface-background border border-surface-border items-center">
              <Text className="text-typography-muted font-bold">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              disabled={!stage}
              onPress={() => {
                const dDate = new Date();
                dDate.setDate(dDate.getDate() + parseInt(deadline));
                onConfirm({
                  stage_id: stage,
                  target_type: type,
                  active:    type === 'performance' ? parseInt(activeGoal) : null,
                  lifecycle: type === 'performance' ? parseInt(lifeGoal) : null,
                  quantity:  type === 'volume' ? parseInt(quantity) : null,
                  deadline:  type === 'volume' ? dDate.toISOString() : null,
                });
                onClose();
              }}
              className={`flex-1 py-4 rounded-2xl items-center ${stage ? 'bg-brand-primary' : 'bg-surface-border'}`}
            >
              <Text className="text-white font-bold">Create</Text>
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

  const handleEdit = (target: any) => {
    Alert.prompt(
      'Update Target',
      `Current: ${target.target_type === 'volume' ? target.target_quantity : target.target_active_seconds}`,
      async (val) => {
        const num = parseInt(val || '');
        if (isNaN(num)) return;
        const field = target.target_type === 'volume' ? 'target_quantity' : 'target_active_seconds';
        const { error } = await supabase.from('pipeline_stage_targets').update({ [field]: num }).eq('id', target.id);
        if (!error) fetchTargets();
      }
    );
  };

  return (
    <View className="flex-1 bg-surface-background">
      <View className="px-6 pt-14 pb-4 flex-row items-end justify-between">
        <View>
          <Text className="text-brand-primary font-black uppercase tracking-[4px] text-[10px] mb-1">Intelligence Hub</Text>
          <Text className="text-typography-main text-3xl font-black">Targets</Text>
        </View>
        <View className="flex-row gap-2">
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
          {targets.map((t, i) => (
            <CircularTargetCardMobile key={i} target={t} onEdit={() => handleEdit(t)} />
          ))}
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
