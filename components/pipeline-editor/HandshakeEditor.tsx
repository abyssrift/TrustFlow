import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { usePipelineEditor, Stage, LinkedOutcome, Pipeline } from '@/contexts/PipelineEditorContext';
import { supabase } from '@/lib/supabase';

export default function HandshakeEditor() {
  const {
    selectedPipeline, stages, linkedOutcomes, loading, error, pipelines,
    upsertLinkedOutcome, deleteLinkedOutcome
  } = usePipelineEditor();

  const [parentStageId, setParentStageId] = useState<string | null>(null);
  const [childTerminalStageId, setChildTerminalStageId] = useState<string | null>(null);
  const [parentTargetStageId, setParentTargetStageId] = useState<string | null>(null);
  
  const [childStages, setChildStages] = useState<Stage[]>([]);
  const [fetchingChildStages, setFetchingChildStages] = useState(false);

  // Fetch child terminal stages when parent stage selection changes
  useEffect(() => {
    if (!parentStageId) {
      setChildStages([]);
      return;
    }

    const parentStage = stages.find(s => s.id === parentStageId);
    if (!parentStage?.linked_pipeline_id) {
      setChildStages([]);
      return;
    }

    const fetchChildStages = async () => {
      setFetchingChildStages(true);
      try {
        const { data } = await supabase
          .from('pipeline_stages')
          .select('*')
          .eq('pipeline_id', parentStage.linked_pipeline_id)
          .eq('is_terminal', true)
          .order('position');
        setChildStages(data || []);
      } catch (err) {
        console.error('Error fetching child stages:', err);
      } finally {
        setFetchingChildStages(false);
      }
    };

    fetchChildStages();
  }, [parentStageId, stages]);

  const handleCreate = async () => {
    if (!parentStageId || !childTerminalStageId || !parentTargetStageId) return;
    await upsertLinkedOutcome(parentStageId, childTerminalStageId, parentTargetStageId);
    // Reset selections
    setParentStageId(null);
    setChildTerminalStageId(null);
    setParentTargetStageId(null);
  };

  const parentStagesWithLinks = (stages || []).filter(s => !!s.linked_pipeline_id);

  if (!stages || !pipelines || !linkedOutcomes) {
    return (
      <View className="flex-1 items-center justify-center py-20">
        <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
      </View>
    );
  }

  return (
    <View className="flex-1">
      <View className="mb-6">
        <Text className="text-typography-main text-lg font-black">Linked Outcomes</Text>
        <Text className="text-typography-muted text-xs">Map child sub-task results to parent stage transitions.</Text>
      </View>

      {/* Add Mapping Form */}
      <View className="bg-surface-card p-4 rounded-2xl border border-brand-primary/20 mb-6">
        <Text className="text-typography-main font-black text-sm mb-4 uppercase tracking-wider">New Handshake</Text>

        {/* 1. Select Parent Stage */}
        <Text className="text-typography-label text-[10px] font-bold uppercase mb-2">1. When parent is in stage:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row mb-4">
          {parentStagesWithLinks.length === 0 ? (
            <Text className="text-typography-dim text-xs py-2 italic">No stages in this pipeline spawn sub-tasks.</Text>
          ) : (
            parentStagesWithLinks.map(s => (
              <TouchableOpacity
                key={s.id}
                onPress={() => { setParentStageId(s.id); setChildTerminalStageId(null); }}
                className={`px-3 py-2 rounded-xl border mr-2 ${parentStageId === s.id ? 'bg-brand-primary-dim border-brand-primary/40' : 'bg-surface-background border-surface-border'}`}
              >
                <Text className={`text-xs font-bold ${parentStageId === s.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{s.name}</Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>

        {/* 2. Select Child Result */}
        <Text className="text-typography-label text-[10px] font-bold uppercase mb-2">2. And child task resolves to:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row mb-4">
          {fetchingChildStages ? (
            <ActivityIndicator size="small" color="#6366f1" className="py-2" />
          ) : !parentStageId ? (
            <Text className="text-typography-dim text-xs py-2 italic">Select a parent stage first.</Text>
          ) : childStages.length === 0 ? (
            <Text className="text-typography-dim text-xs py-2 italic text-state-danger">The linked pipeline has no terminal stages!</Text>
          ) : (
            childStages.map(s => (
              <TouchableOpacity
                key={s.id}
                onPress={() => setChildTerminalStageId(s.id)}
                className={`px-3 py-2 rounded-xl border mr-2 ${childTerminalStageId === s.id ? 'bg-brand-primary-dim border-brand-primary/40' : 'bg-surface-background border-surface-border'}`}
              >
                <View className="flex-row items-center">
                   <View className="w-1.5 h-1.5 rounded-full mr-1.5" style={{ backgroundColor: s.terminal_type === 'success' ? 'rgb(var(--state-success))' : 'rgb(var(--state-danger))' }} />
                   <Text className={`text-xs font-bold ${childTerminalStageId === s.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{s.name}</Text>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>

        {/* 3. Select Target Stage */}
        <Text className="text-typography-label text-[10px] font-bold uppercase mb-2">3. Move parent to stage:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-row mb-6">
          {stages.map(s => (
            <TouchableOpacity
              key={s.id}
              onPress={() => setParentTargetStageId(s.id)}
              className={`px-3 py-2 rounded-xl border mr-2 ${parentTargetStageId === s.id ? 'bg-brand-primary-dim border-brand-primary/40' : 'bg-surface-background border-surface-border'}`}
            >
              <Text className={`text-xs font-bold ${parentTargetStageId === s.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{s.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <TouchableOpacity
          onPress={handleCreate}
          disabled={!parentStageId || !childTerminalStageId || !parentTargetStageId || loading}
          className={`py-3 rounded-xl flex-row items-center h-12 justify-center ${(!parentStageId || !childTerminalStageId || !parentTargetStageId) ? 'bg-surface-overlay border border-surface-border' : 'bg-brand-primary shadow-sm'}`}
        >
          {loading ? (
            <ActivityIndicator size="small" color="rgb(var(--text-main))" />
          ) : (
            <>
              <FontAwesome name="plus" size={12} color={(!parentStageId || !childTerminalStageId || !parentTargetStageId) ? 'rgb(var(--text-dim))' : 'rgb(var(--text-main))'} />
              <Text className={`font-black text-xs ml-2 uppercase tracking-widest ${(!parentStageId || !childTerminalStageId || !parentTargetStageId) ? 'text-typography-muted' : 'text-typography-main'}`}>Forge Handshake</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* List Existing Handshakes */}
      <ScrollView className="flex-1">
        {linkedOutcomes?.length === 0 ? (
          <View className="items-center py-12">
            <FontAwesome name="handshake-o" size={48} color="#1e293b" />
            <Text className="text-typography-muted text-sm mt-4">No handshakes configured for this pipeline.</Text>
          </View>
        ) : (
          linkedOutcomes?.map(lk => {
            const parentStage = stages?.find(s => s.id === lk.parent_stage_id);
            // Since child terminal stage might be in another pipeline, we might not have it in context 'stages'
            // But we can show the ID or do a lookup if needed. For now, we'll rely on the DB having them.
            const targetStage = stages?.find(s => s.id === lk.parent_target_stage_id);
            
            return (
              <View key={lk.id} className="bg-surface-card p-4 rounded-2xl border border-surface-border mb-3 flex-row items-center">
                <View className="flex-1">
                  <View className="flex-row items-center flex-wrap gap-2">
                    <View className="bg-brand-primary-dim px-2 py-1 rounded border border-brand-primary/20">
                      <Text className="text-brand-primary text-[10px] font-bold">{parentStage?.name || 'Unknown'}</Text>
                    </View>
                    <FontAwesome name="long-arrow-right" size={10} color="rgb(var(--text-dim))" />
                    <View className="bg-surface-background px-2 py-1 rounded border border-surface-border">
                      <Text className="text-typography-muted text-[10px] font-bold italic">Child Resolution</Text>
                    </View>
                    <FontAwesome name="long-arrow-right" size={10} color="rgb(var(--text-dim))" />
                    <View className="bg-state-info-dim px-2 py-1 rounded border border-state-info/20">
                      <Text className="text-state-info text-[10px] font-bold">{targetStage?.name || 'Unknown'}</Text>
                    </View>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => deleteLinkedOutcome(lk.id)}
                  className="w-10 h-10 items-center justify-center bg-state-danger-dim rounded-xl border border-state-danger/10 ml-2"
                >
                  <FontAwesome name="trash-o" size={14} color="rgb(var(--state-danger))" />
                </TouchableOpacity>
              </View>
            );
          })
        )}
        <View className="h-20" />
      </ScrollView>
    </View>
  );
}
