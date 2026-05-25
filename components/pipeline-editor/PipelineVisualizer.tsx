import { usePipelineEditor } from '@/contexts/PipelineEditorContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { FontAwesome } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { resolveNativeColorToken } from './colorCompat';

export default function PipelineVisualizer() {
  const colors = useThemeColors();
  const { 
    stages, transitions, permissions, selectedPipeline,
    addTransition, deleteTransition, loading, error
  } = usePipelineEditor();

  // Interactive State
  const [isAdding, setIsAdding] = useState(false);
  const [sourceStageId, setSourceStageId] = useState<string | null>(null);
  const [transitionLabel, setTransitionLabel] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  if (stages.length === 0) {
    return (
      <View className="flex-1 items-center justify-center py-20">
        <FontAwesome name="sitemap" size={48} color={colors.border} />
        <Text className="text-typography-muted text-base font-bold mt-4">Empty Pipeline</Text>
        <Text className="text-typography-dim text-sm mt-1">Add stages to visualize the flow.</Text>
      </View>
    );
  }

  // Build adjacency for layout
  const stageMap = new Map(stages.map(s => [s.id, s]));
  const outgoing = new Map<string, typeof transitions>();
  transitions.forEach(t => {
    if (!outgoing.has(t.from_stage_id)) outgoing.set(t.from_stage_id, []);
    outgoing.get(t.from_stage_id)?.push(t);
  });

  // Layered layout: Stages are in position order
  const sortedStages = [...stages].sort((a, b) => a.position - b.position);

  const handleStartAdd = (id: string) => {
    setSourceStageId(id);
    setIsAdding(true);
    setTransitionLabel('');
  };

  const handleCancelAdd = () => {
    setIsAdding(false);
    setSourceStageId(null);
  };

  const handleSelectTarget = async (targetId: string) => {
    if (!sourceStageId || !transitionLabel.trim()) return;
    if (sourceStageId === targetId) return; // Prevent self-loops
    
    await addTransition(sourceStageId, targetId, transitionLabel.trim());
    setIsAdding(false);
    setSourceStageId(null);
  };

  const handleDelete = async (id: string) => {
    await deleteTransition(id);
    setConfirmDeleteId(null);
  };

  return (
    <View className="flex-1">
      <View className="flex-row items-center justify-between mb-4">
        <View>
          <Text className="text-typography-main text-lg font-black">Pipeline Designer</Text>
          <Text className="text-typography-muted text-xs">
            {selectedPipeline?.name} — {stages.length} stages, {transitions.length} rules
          </Text>
        </View>
        {isAdding && (
          <TouchableOpacity 
            onPress={handleCancelAdd}
            className="bg-state-danger/10 px-3 py-1.5 rounded-xl border border-state-danger/30"
          >
            <Text className="text-state-danger font-bold text-[10px] uppercase">Cancel Design</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Helper Overlay when adding */}
      {isAdding && (
        <View className="bg-brand-primary/10 border border-brand-primary/30 p-3 rounded-2xl mb-4">
          <View className="flex-row items-center mb-1">
            <FontAwesome name="magic" size={12} color={colors.primary} />
            <Text className="text-brand-primary font-black text-xs ml-2">DESIGN MODE: CONNECTING STAGES</Text>
          </View>
          <Text className="text-typography-main text-[10px] mb-3">
            1. Enter label below. 2. Tap ANY card to set it as the destination flow.
          </Text>
          <TextInput
            value={transitionLabel}
            onChangeText={setTransitionLabel}
            placeholder="Enter Action Label (e.g. 'Approve')"
            placeholderTextColor={colors.textMuted}
            className="bg-surface-background text-typography-main px-3 py-2.5 rounded-lg border border-brand-primary/50 text-xs font-bold"
            autoFocus
          />
        </View>
      )}

      {error && (
        <View className="bg-state-danger/10 border border-state-danger/30 p-2 rounded-lg mb-3">
          <Text className="text-state-danger text-[10px] font-bold">{error}</Text>
        </View>
      )}

      <ScrollView showsVerticalScrollIndicator={false}>
        {sortedStages.map((stage, index) => {
          const stageTransitions = outgoing.get(stage.id) || [];
          const isSource = sourceStageId === stage.id;
          const canBeTarget = isAdding && !isSource;
          
          const borderColor = isSource 
            ? colors.primary // Brand primary for active source
            : canBeTarget 
              ? colors.success // Green for potential targets
              : stage.is_initial
                ? colors.info
                : stage.is_terminal
                  ? stage.terminal_type === 'success' ? colors.success : colors.danger
                  : resolveNativeColorToken(stage.color, colors);
          
          return (
            <View key={stage.id} className="mb-1">
              {/* Stage Node */}
              <TouchableOpacity
                disabled={!canBeTarget}
                onPress={() => handleSelectTarget(stage.id)}
                activeOpacity={0.7}
                className={`bg-surface-card p-4 rounded-2xl border-2 mx-4 ${isSource ? 'opacity-100 shadow-lg' : isAdding ? 'opacity-60' : 'opacity-100'}`}
                style={{ borderColor, borderWidth: (isSource || canBeTarget) ? 3 : 2 }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center flex-1 flex-wrap">
                    <View className="w-7 h-7 rounded-lg items-center justify-center mr-3" style={{ backgroundColor: resolveNativeColorToken(stage.color, colors) }}>
                      <Text className="text-white font-black text-[10px]">{stage.position}</Text>
                    </View>
                    <Text className="text-typography-main font-bold text-base mr-2">{stage.name}</Text>
                    {stage.is_initial && <FontAwesome name="sign-in" size={12} color={colors.info} style={{ marginRight: 4 }} />}
                    {stage.is_terminal && <FontAwesome name="flag-checkered" size={12} color={stage.terminal_type === 'success' ? colors.success : colors.danger} style={{ marginRight: 4 }} />}
                    {stage.requires_submission && <FontAwesome name="upload" size={10} color={colors.accent} style={{ marginRight: 4 }} />}
                    {stage.linked_pipeline_id && <FontAwesome name="bolt" size={12} color={colors.primary} />}
                  </View>

                  {/* Action Buttons */}
                  {!isAdding && (
                    <TouchableOpacity 
                      onPress={() => handleStartAdd(stage.id)}
                      className="bg-brand-primary/10 w-8 h-8 rounded-full items-center justify-center"
                    >
                      <FontAwesome name="plus" size={12} color={colors.primary} />
                    </TouchableOpacity>
                  )}
                  {canBeTarget && (
                    <View className="bg-state-success px-2 py-1 rounded-lg">
                      <Text className="text-white text-[8px] font-black uppercase">Click To Connect</Text>
                    </View>
                  )}
                </View>

                {/* Outgoing Transitions */}
                {stageTransitions.length > 0 && (
                  <View className="mt-3 pt-3 border-t border-surface-border/50">
                    {stageTransitions.map(t => {
                      const target = stageMap.get(t.to_stage_id);
                      const isBackward = target && target.position < stage.position;
                      const isDeleting = confirmDeleteId === t.id;

                      return (
                        <View key={t.id} className="flex-row items-center mb-1.5 last:mb-0">
                          <FontAwesome
                            name={isBackward ? 'reply' : 'long-arrow-right'}
                            size={10}
                            color={isBackward ? colors.warning : colors.textMuted}
                            style={{ width: 16 }}
                          />
                          <View className={`px-2 py-0.5 rounded-md mr-2 ${isBackward ? 'bg-state-warning/10' : 'bg-brand-primary/10'}`}>
                            <Text className={`text-[10px] font-black ${isBackward ? 'text-state-warning' : 'text-brand-primary'}`}>
                              {t.label}
                            </Text>
                          </View>
                          <View className="flex-row items-center flex-1">
                            <View className="w-2 h-2 rounded-full mr-1" style={{ backgroundColor: resolveNativeColorToken(target?.color, colors) }} />
                            <Text className="text-typography-muted text-[10px] font-bold">
                              {target?.name || 'Unknown'}
                            </Text>
                          </View>
                          
                          {/* Delete transition */}
                          {!isAdding && (
                            isDeleting ? (
                              <View className="flex-row items-center gap-1">
                                <TouchableOpacity onPress={() => handleDelete(t.id)} className="bg-state-danger px-1.5 py-0.5 rounded">
                                  <Text className="text-white text-[7px] font-black">X</Text>
                                </TouchableOpacity>
                                <TouchableOpacity onPress={() => setConfirmDeleteId(null)} className="bg-surface-border px-1.5 py-0.5 rounded">
                                  <Text className="text-typography-main text-[7px] font-black">CAN</Text>
                                </TouchableOpacity>
                              </View>
                            ) : (
                              <TouchableOpacity onPress={() => setConfirmDeleteId(t.id)} className="p-1">
                                <FontAwesome name="times-circle" size={10} color={colors.textMuted} />
                              </TouchableOpacity>
                            )
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </TouchableOpacity>

              {/* Connector line */}
              {index < sortedStages.length - 1 && (
                <View className="items-center my-0.5">
                  <View className="w-0.5 h-3 bg-surface-border" />
                  <FontAwesome name="chevron-down" size={8} color={colors.textMuted} />
                  <View className="w-0.5 h-1 bg-surface-border" />
                </View>
              )}
            </View>
          );
        })}
        <View className="h-20" />
      </ScrollView>

      {/* Loading Overlay */}
      {loading && (
        <View className="absolute inset-0 bg-surface-background/50 items-center justify-center">
          <ActivityIndicator color={colors.primary} />
        </View>
      )}
    </View>
  );
}
