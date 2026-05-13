import { usePipelineEditor } from '@/contexts/PipelineEditorContext';
import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Platform, ScrollView, Text, TouchableOpacity, View } from 'react-native';

export default function SubpipelineEditor() {
  const { stages, pipelines, loading, selectedPipeline, updateStage, updateStageSpawnConfig } = usePipelineEditor();

  const spawningStages = (stages || []).filter(s => !!s.linked_pipeline_id);
  const availablePipelines = pipelines.filter(p => p.id !== selectedPipeline?.id);

  const handleLinkPipeline = async (stageId: string, linkedPipelineId: string | null) => {
    await updateStage(stageId, { linked_pipeline_id: linkedPipelineId });
  };

  return (
    <View className="flex-1">
      <View className="mb-6">
        <Text className="text-typography-main text-lg font-black">Subpipeline Spawning</Text>
        <Text className="text-typography-muted text-xs">
          Choose which stages spawn subpipelines, then configure child inheritance behavior.
        </Text>
      </View>

      <View className="bg-surface-card border border-surface-border rounded-2xl mb-4 overflow-hidden">
        <View className="px-4 py-3 border-b border-surface-border bg-surface-background">
          <Text className="text-typography-main font-black text-sm">Stage Spawn Routing</Text>
          <Text className="text-typography-dim text-[10px] mt-0.5">
            Set a target pipeline for any stage. "No Spawn" keeps the stage in the parent flow only.
          </Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={Platform.OS === 'web'}>
          <View className="p-4 gap-3 min-w-full">
            {(stages || []).map(stage => (
              <View key={stage.id} className="bg-surface-background border border-surface-border rounded-xl p-3">
                <View className="flex-row items-center mb-2">
                  <View
                    className="w-2.5 h-2.5 rounded-full mr-2"
                    style={{ backgroundColor: stage.color || 'var(--color-text-dim)' }}
                  />
                  <Text className="text-typography-main font-bold text-xs flex-1">{stage.name}</Text>
                  {stage.linked_pipeline_id && (
                    <View className="bg-brand-primary-dim px-2 py-0.5 rounded-md border border-brand-primary/20">
                      <Text className="text-brand-primary text-[9px] font-black uppercase tracking-wider">Spawns</Text>
                    </View>
                  )}
                </View>

                <View className="flex-row flex-wrap gap-1.5">
                  <TouchableOpacity
                    disabled={loading}
                    onPress={() => handleLinkPipeline(stage.id, null)}
                    className={`px-2.5 py-1.5 rounded-lg border ${!stage.linked_pipeline_id ? 'bg-brand-primary-dim border-brand-primary/40' : 'bg-surface-card border-surface-border'}`}
                  >
                    <Text className={`text-[10px] font-bold uppercase tracking-wider ${!stage.linked_pipeline_id ? 'text-brand-primary' : 'text-typography-muted'}`}>
                      No Spawn
                    </Text>
                  </TouchableOpacity>

                  {availablePipelines.map(p => (
                    <TouchableOpacity
                      key={`${stage.id}-${p.id}`}
                      disabled={loading}
                      onPress={() => handleLinkPipeline(stage.id, p.id)}
                      className={`px-2.5 py-1.5 rounded-lg border ${stage.linked_pipeline_id === p.id ? 'bg-brand-primary-dim border-brand-primary/40' : 'bg-surface-card border-surface-border'}`}
                    >
                      <Text className={`text-[10px] font-bold uppercase tracking-wider ${stage.linked_pipeline_id === p.id ? 'text-brand-primary' : 'text-typography-muted'}`}>
                        {p.name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            ))}
          </View>
        </ScrollView>
      </View>

      {spawningStages.length === 0 ? (
        <View className="flex-1 items-center justify-center py-20">
          <FontAwesome name="sitemap" size={48} color="var(--color-surface-overlay)" />
          <Text className="text-typography-muted text-sm font-bold mt-4">No spawning stages configured.</Text>
          <Text className="text-typography-dim text-xs mt-1 text-center px-8">
            Assign a target pipeline above to configure inheritance settings below.
          </Text>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          showsVerticalScrollIndicator={Platform.OS === 'web'}
        >
          {spawningStages.map(stage => {
            const linkedPipeline = pipelines.find(p => p.id === stage.linked_pipeline_id);

            return (
              <View
                key={stage.id}
                className="bg-surface-card border border-surface-border rounded-2xl mb-4 overflow-hidden"
              >
                {/* Stage header */}
                <View className="flex-row items-center px-4 py-3 border-b border-surface-border bg-surface-background">
                  <View
                    className="w-3 h-3 rounded-full mr-2.5"
                    style={{ backgroundColor: stage.color || 'var(--color-text-dim)' }}
                  />
                  <Text className="text-typography-main font-black text-sm flex-1">{stage.name}</Text>
                  <View className="flex-row items-center bg-brand-primary-dim px-2.5 py-1 rounded-lg border border-brand-primary/20">
                    <FontAwesome name="bolt" size={9} color="var(--color-brand-primary)" />
                    <Text className="text-brand-primary text-[9px] font-black ml-1.5 uppercase tracking-wider">
                      {linkedPipeline?.name || 'Linked Pipeline'}
                    </Text>
                  </View>
                </View>

                {/* Spawn settings */}
                <View className="p-4 gap-3">
                  <Text className="text-typography-label text-[10px] font-bold uppercase tracking-wider mb-1">
                    Inheritance Settings
                  </Text>

                  <SpawnToggle
                    label="Inherit Submission Work"
                    desc="The spawned child task receives the parent's submitted files and notes as its initial content."
                    icon="upload"
                    color="var(--color-brand-accent)"
                    active={stage.child_inherits_submission}
                    loading={loading}
                    onToggle={() =>
                      updateStageSpawnConfig(stage.id, !stage.child_inherits_submission)
                    }
                  />
                </View>
              </View>
            );
          })}
          <View className="h-20" />
        </ScrollView>
      )}
    </View>
  );
}

function SpawnToggle({
  label, desc, icon, color, active, loading, onToggle,
}: {
  label: string;
  desc: string;
  icon: string;
  color: string;
  active: boolean;
  loading: boolean;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      disabled={loading}
      className={`flex-row items-center p-3 rounded-xl border ${
        active ? 'border-brand-primary/30 bg-brand-primary-dim' : 'border-surface-border bg-surface-background'
      }`}
    >
      <View
        className="w-9 h-9 rounded-lg items-center justify-center mr-3"
        style={{ backgroundColor: active ? color : 'rgb(var(--surface-overlay))', opacity: active ? 0.85 : 0.5 }}
      >
        <FontAwesome name={icon as any} size={14} color={active ? 'white' : 'var(--color-text-dim)'} />
      </View>
      <View className="flex-1">
        <Text className={`font-bold text-sm ${active ? 'text-typography-main' : 'text-typography-muted'}`}>
          {label}
        </Text>
        <Text className="text-typography-dim text-[10px] italic mt-0.5">{desc}</Text>
      </View>
      <View className="ml-3">
        {loading ? (
          <ActivityIndicator size="small" color="var(--color-brand-primary)" />
        ) : (
          <View
            className={`w-11 h-6 rounded-full border-2 items-center justify-center relative ${
              active ? 'bg-brand-primary border-brand-primary' : 'bg-surface-overlay border-surface-border'
            }`}
          >
            <View
              className={`w-4 h-4 rounded-full bg-white absolute transition-all ${
                active ? 'right-0.5' : 'left-0.5'
              }`}
            />
          </View>
        )}
      </View>
    </TouchableOpacity>
  );
}
