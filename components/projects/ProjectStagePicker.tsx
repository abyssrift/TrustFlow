import Popup from '@/components/common/Popup';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

// #172 P2 -- lets a project be placed on / moved between stages of a
// project-kind pipeline via rpc_advance_project_stage. Shared by
// ProjectDashboard.tsx (desktop) and ProjectDashboardSheet.tsx (mobile),
// rendered through each one's `overlays` prop exactly like
// SaveAsTemplateSheet.tsx already does -- same Popup, same layering.

type PipelineGroup = {
  pipelineId: string;
  pipelineName: string;
  stages: { id: string; name: string; color: string | null; position: number }[];
};

export default function ProjectStagePicker({
  visible, currentStageId, onClose, onSelectStage,
}: {
  visible: boolean;
  currentStageId: string | null;
  onClose: () => void;
  /** Delegates to useProjectLifecycle's advanceStage -- already maps RPC errors and toasts. */
  onSelectStage: (stageId: string) => Promise<boolean>;
}) {
  const c = useThemeColors();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<PipelineGroup[]>([]);
  const [movingStageId, setMovingStageId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data: pipelines } = await supabase
        .from('pipelines')
        .select('id, name')
        .eq('subject_kind', 'project')
        .is('deleted_at', null)
        .order('name');
      const pipelineIds = (pipelines || []).map(p => p.id);
      const { data: stages } = pipelineIds.length
        ? await supabase
            .from('pipeline_stages')
            .select('id, pipeline_id, name, color, position')
            .in('pipeline_id', pipelineIds)
            .order('position')
        : { data: [] as any[] };
      if (cancelled) return;
      setGroups((pipelines || []).map(p => ({
        pipelineId: p.id,
        pipelineName: p.name,
        stages: (stages || []).filter(s => s.pipeline_id === p.id),
      })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const handlePick = async (stageId: string) => {
    if (stageId === currentStageId || movingStageId) return;
    setMovingStageId(stageId);
    const ok = await onSelectStage(stageId);
    setMovingStageId(null);
    if (ok) onClose();
  };

  const noProjectPipelines = !loading && groups.length === 0;

  return (
    <Popup visible={visible} onClose={onClose} presentation="auto" title="Move to Stage" scrollable={false} maxWidth={420}>
      <View className="px-6 py-5" style={{ minHeight: 160 }}>
        {loading ? (
          <View className="items-center py-10"><ActivityIndicator color={c.primary} /></View>
        ) : noProjectPipelines ? (
          <View className="items-center py-8 px-2">
            <FontAwesome name="sitemap" size={22} color={c.textDim} />
            <Text className="text-typography-main text-sm font-bold mt-3 text-center">No project pipelines yet</Text>
            <Text className="text-typography-muted text-xs mt-1.5 text-center leading-4">
              Mark a pipeline as "Projects" in the pipeline editor first, then its stages will show up here.
            </Text>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} className="max-h-[60vh]">
            {groups.map(group => (
              <View key={group.pipelineId} className="mb-4">
                <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest mb-2">{group.pipelineName}</Text>
                {group.stages.length === 0 ? (
                  <Text className="text-typography-dim text-xs italic px-1">No stages configured.</Text>
                ) : (
                  <View className="gap-2">
                    {group.stages.map(stage => {
                      const isCurrent = stage.id === currentStageId;
                      const isMoving = movingStageId === stage.id;
                      return (
                        <TouchableOpacity
                          key={stage.id}
                          disabled={isCurrent || !!movingStageId}
                          onPress={() => handlePick(stage.id)}
                          className={`flex-row items-center gap-3 px-3 py-2.5 rounded-xl border ${
                            isCurrent ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border'
                          }`}
                        >
                          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: stage.color ?? c.primary }} />
                          <Text className={`text-sm font-bold flex-1 ${isCurrent ? 'text-brand-primary' : 'text-typography-main'}`} numberOfLines={1}>
                            {stage.name}
                          </Text>
                          {isCurrent && <Text className="text-brand-primary text-[9px] font-black uppercase">Current</Text>}
                          {isMoving && <ActivityIndicator size="small" color={c.primary} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Popup>
  );
}
