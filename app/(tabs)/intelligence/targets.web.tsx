import { CircularTargetCard } from '@/components/intelligence/IntelligenceCommon';
import { TargetCreationModal } from '@/components/intelligence/IntelligenceModals';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

export default function IntelligenceTargets() {
  const { profile } = useAuth();
  const [targets, setTargets]         = useState<any[]>([]);
  const [pipelines, setPipelines]     = useState<any[]>([]);
  const [allStages, setAllStages]     = useState<any[]>([]);
  const [loading, setLoading]         = useState(true);
  const [showModal, setShowModal]     = useState(false);

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
    } catch (e: any) { console.error(e); }
  };

  const handleUpdate = async (id: string, field: string, val: string) => {
    const num = parseInt(val);
    if (isNaN(num)) return;
    const { error } = await supabase.from('pipeline_stage_targets').update({ [field]: num }).eq('id', id);
    if (!error) fetchTargets();
  };

  const handleEdit = (target: any) => {
    const newVal = window.prompt(
      `Update ${target.target_type === 'volume' ? 'target quantity' : 'active seconds'}:`,
      String(target.target_type === 'volume' ? target.target_quantity : target.target_active_seconds),
    );
    if (newVal) handleUpdate(target.id, target.target_type === 'volume' ? 'target_quantity' : 'target_active_seconds', newVal);
  };

  return (
    <View className="flex-1 bg-surface-background flex-col">

      {/* ── Header ── */}
      <View className="px-10 pt-8 pb-5 flex-row items-center justify-between border-b border-surface-border flex-shrink-0">
        <View>
          <Text className="text-brand-primary font-black uppercase tracking-[0.3em] text-[9px] mb-1">Intelligence Hub</Text>
          <Text className="text-typography-main text-4xl font-black tracking-tighter">Targets</Text>
        </View>
        <View className="flex-row items-center gap-3">
          <TouchableOpacity onPress={fetchTargets} className="h-10 w-10 items-center justify-center bg-surface-card border border-surface-border rounded-xl">
            <FontAwesome name="refresh" size={13} color="rgb(var(--brand-primary))" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowModal(true)} className="bg-brand-primary px-6 py-2.5 rounded-xl flex-row items-center gap-2">
            <FontAwesome name="plus" size={12} color="white" />
            <Text className="text-white font-black uppercase tracking-widest text-[11px]">New Benchmark</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
        </View>
      ) : targets.length === 0 ? (
        <View className="flex-1 items-center justify-center">
          <View className="bg-surface-card p-12 rounded-[3rem] border border-surface-border items-center max-w-[480px] premium-shadow">
            <View className="w-16 h-16 bg-brand-primary/10 rounded-full items-center justify-center mb-5">
              <FontAwesome name="bullseye" size={28} color="rgb(var(--brand-primary))" />
            </View>
            <Text className="text-typography-main text-2xl font-black mb-2 text-center">No Targets Yet</Text>
            <Text className="text-typography-muted text-center mb-6 text-sm leading-relaxed">
              Define performance benchmarks and volume quotas for your pipeline stages.
            </Text>
            <TouchableOpacity onPress={() => setShowModal(true)} className="bg-brand-primary px-8 py-3 rounded-2xl">
              <Text className="text-white font-black uppercase tracking-widest text-xs">Create First Target</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
          <View className="px-10 py-8 flex-row flex-wrap gap-8">
            {targets.map((t, i) => (
              <CircularTargetCard key={i} target={t} onEdit={() => handleEdit(t)} />
            ))}
          </View>
        </ScrollView>
      )}

      <TargetCreationModal
        visible={showModal}
        onClose={() => setShowModal(false)}
        onConfirm={handleCreate}
        pipelines={pipelines}
        stages={allStages}
      />
    </View>
  );
}
