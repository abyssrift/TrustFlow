import Popup from '@/components/common/Popup';
import Tooltip from '@/components/common/Tooltip';
import { EntityEmptyState, EntityGlyph, EntityTag } from '@/components/entities/EntityUI';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';

// #172 P2 -- lets a project be placed on / moved between stages of a
// project-kind pipeline via rpc_advance_project_stage. Originally shared by
// ProjectDashboard.tsx (desktop) and ProjectDashboardSheet.tsx (mobile); #184
// retired both in favor of the /projects/[id] route, so this is now rendered
// directly by ProjectHeader.tsx (no longer through a parent Popup's
// `overlays` prop -- the header is a full-screen route, not a Popup, so
// there is no outer card's `overflow: hidden` to escape).

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
    <Popup visible={visible} onClose={onClose} presentation="auto" title="Move this project" scrollable={false} maxWidth={460}>
      <View className="px-5 py-4" style={{ minHeight: 180 }}>
        {loading ? (
          <View className="items-center py-10"><ActivityIndicator color={c.primary} /></View>
        ) : noProjectPipelines ? (
          // §17: a board is one of the four things users confuse — say what it is.
          <EntityEmptyState
            kind="board"
            compact
            title="No project board yet"
            body="A board is the run of stages a project moves through. Open the pipeline editor, mark a pipeline as “Projects”, and its stages appear here."
          />
        ) : (
          <>
            <Text className="text-typography-muted text-xs mb-3 leading-5">
              Pick the stage this project should sit in. Moving it doesn’t touch its tasks.
            </Text>
            <ScrollView showsVerticalScrollIndicator={false} className="max-h-[60vh]">
              {groups.map(group => (
                <View key={group.pipelineId} className="mb-4">
                  <View className="flex-row items-center gap-2 mb-2">
                    <EntityGlyph kind="board" size={22} />
                    <View>
                      <EntityTag kind="board" />
                      <Text className="text-typography-main text-xs font-bold">{group.pipelineName}</Text>
                    </View>
                  </View>
                  {group.stages.length === 0 ? (
                    <Text className="text-typography-dim text-xs px-1">
                      This board has no stages yet, so nothing can be moved onto it.
                    </Text>
                  ) : (
                    <View className="gap-1.5">
                      {group.stages.map(stage => {
                        const isCurrent = stage.id === currentStageId;
                        const isMoving = movingStageId === stage.id;
                        const row = (
                          <TouchableOpacity
                            disabled={isCurrent || !!movingStageId}
                            onPress={() => handlePick(stage.id)}
                            accessibilityRole="button"
                            accessibilityState={{ selected: isCurrent, disabled: isCurrent || !!movingStageId }}
                            className={`flex-row items-center gap-3 px-3 rounded-xl border ${
                              isCurrent ? 'bg-brand-primary/10 border-brand-primary' : 'bg-surface-background border-surface-border hover:bg-surface-overlay'
                            }`}
                            style={{ minHeight: 44 }}
                          >
                            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: stage.color ?? c.primary }} />
                            <Text className={`text-sm font-semibold flex-1 ${isCurrent ? 'text-brand-primary' : 'text-typography-main'}`} numberOfLines={1}>
                              {stage.name}
                            </Text>
                            {isCurrent && <Text className="text-brand-primary text-[10px] font-bold">Currently here</Text>}
                            {isMoving && <ActivityIndicator size="small" color={c.primary} />}
                          </TouchableOpacity>
                        );
                        // §14.2 — a disabled control must always be able to say why.
                        return (
                          <View key={stage.id}>
                            {isCurrent
                              ? <Tooltip label="The project is already in this stage">{row}</Tooltip>
                              : movingStageId
                                ? <Tooltip label="Wait for the move in progress to finish">{row}</Tooltip>
                                : row}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          </>
        )}
      </View>
    </Popup>
  );
}
