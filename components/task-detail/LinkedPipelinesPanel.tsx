import { supabase } from '@/lib/supabase';
import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import CollapsibleCard from './CollapsibleCard';

type PipelineOption = { id: string; name: string };

/**
 * LinkedPipelinesPanel -- issue #23 (visible-only shared tasks). Lets a
 * task.edit holder link this task onto OTHER task-kind pipelines' boards
 * as a read-only reference (via task_pipeline_links / rpc_link_task_to_pipeline),
 * so another team can see it without duplicating it. The task keeps its
 * one real pipeline_id/current_stage_id -- this is not independent
 * per-pipeline progress tracking.
 */
export default function LinkedPipelinesPanel() {
  const { data, linkPipeline, unlinkPipeline } = useTaskDetail();
  const router = useRouter();
  const colors = useThemeColors();
  const [showPicker, setShowPicker] = useState(false);
  const [options, setOptions] = useState<PipelineOption[] | null>(null);
  // A Set, not a single id: linking one pipeline while unlinking another must
  // not clear the first row's busy/disabled state while its request is still
  // in flight.
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  if (!data) return null;
  const { pipeline, permissions, linked_pipelines } = data;

  if (!permissions.can_edit && linked_pipelines.length === 0) return null;

  const openPicker = async () => {
    setShowPicker((v) => !v);
    if (options === null) {
      const { data: p } = await supabase
        .from('pipelines')
        .select('id, name, subject_kind')
        .is('deleted_at', null)
        .eq('subject_kind', 'task')
        .order('name');
      setOptions((p || []).map((r: any) => ({ id: r.id, name: r.name })));
    }
  };

  const linkedIds = new Set(linked_pipelines.map((l) => l.pipeline_id));
  const selectable = (options || []).filter((p) => p.id !== pipeline?.id && !linkedIds.has(p.id));

  const setBusy = (pipelineId: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(pipelineId); else next.delete(pipelineId);
      return next;
    });
  };

  const handleLink = async (pipelineId: string) => {
    setBusy(pipelineId, true);
    try {
      await linkPipeline(pipelineId);
      setShowPicker(false);
    } catch {
      // linkPipeline already toasts
    } finally {
      setBusy(pipelineId, false);
    }
  };

  const handleUnlink = async (pipelineId: string) => {
    setBusy(pipelineId, true);
    try {
      await unlinkPipeline(pipelineId);
    } catch {
      // unlinkPipeline already toasts
    } finally {
      setBusy(pipelineId, false);
    }
  };

  return (
    <CollapsibleCard
      icon="share-alt"
      title={`Linked Pipelines (${linked_pipelines.length})`}
      defaultCollapsed
    >
      <View className="gap-2">
        {linked_pipelines.map((l) => (
          <TouchableOpacity
            key={l.pipeline_id}
            onPress={() => router.push(`/(tabs)/tasks?pipelineId=${l.pipeline_id}` as any)}
            className="flex-row items-center bg-surface-background rounded-xl border border-surface-border px-3 py-3 active:opacity-75"
          >
            <FontAwesome name="code-fork" size={12} color={colors.textMuted} style={{ marginRight: 10 }} />
            <View className="flex-1 min-w-0">
              <Text className="text-typography-main text-sm font-bold" numberOfLines={1}>{l.pipeline_name}</Text>
              {l.linked_by?.full_name && (
                <Text className="text-typography-dim text-[10px] mt-0.5">linked by {l.linked_by.full_name}</Text>
              )}
            </View>
            {permissions.can_edit && (
              <TouchableOpacity
                onPress={(e: any) => { e.stopPropagation(); handleUnlink(l.pipeline_id); }}
                disabled={busyIds.has(l.pipeline_id)}
                className="p-2"
              >
                {busyIds.has(l.pipeline_id) ? (
                  <ActivityIndicator size="small" color={colors.danger} style={{ transform: [{ scale: 0.6 }] }} />
                ) : (
                  <FontAwesome name="times" size={12} color={colors.danger} />
                )}
              </TouchableOpacity>
            )}
            <FontAwesome name="chevron-right" size={10} color={colors.textMuted} style={{ marginLeft: 8 }} />
          </TouchableOpacity>
        ))}

        {linked_pipelines.length === 0 && !showPicker && (
          <Text className="text-typography-dim text-xs opacity-60">Not linked to any other pipeline board.</Text>
        )}

        {permissions.can_edit && (
          <View>
            <TouchableOpacity
              onPress={openPicker}
              className="flex-row items-center justify-center bg-surface-background rounded-xl border border-dashed border-surface-border px-3 py-2.5 mt-1"
            >
              <FontAwesome name="plus" size={10} color={colors.primary} />
              <Text className="text-brand-primary text-[10px] font-black uppercase ml-2">Link to Another Pipeline</Text>
            </TouchableOpacity>

            {showPicker && (
              <View className="mt-2 rounded-xl overflow-hidden border border-surface-border" style={{ maxHeight: 200 }}>
                {options === null ? (
                  <View className="py-4 items-center">
                    <ActivityIndicator size="small" color={colors.primary} />
                  </View>
                ) : selectable.length === 0 ? (
                  <Text className="text-typography-dim text-xs p-3">No other task pipelines to link.</Text>
                ) : (
                  <ScrollView nestedScrollEnabled>
                    {selectable.map((p) => (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => handleLink(p.id)}
                        disabled={busyIds.has(p.id)}
                        className="px-4 py-3 bg-surface-background border-b border-surface-border/50 last:border-0"
                      >
                        <Text className="text-typography-main text-sm font-bold">{p.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}
              </View>
            )}
          </View>
        )}
      </View>
    </CollapsibleCard>
  );
}
