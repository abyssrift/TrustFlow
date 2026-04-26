import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useTaskDetail } from '@/contexts/TaskDetailContext';

const PRIORITY_MAP: Record<string, { color: string; label: string }> = {
  urgent: { color: '#ef4444', label: 'URGENT' },
  high:   { color: '#f59e0b', label: 'HIGH' },
  medium: { color: '#94a3b8', label: 'NORMAL' },
  low:    { color: '#22c55e', label: 'LOW' },
};

export default function TaskHeader() {
  const { data } = useTaskDetail();
  const router = useRouter();
  if (!data) return null;

  const { task, current_stage } = data;
  const prio = PRIORITY_MAP[task.priority] || PRIORITY_MAP.medium;

  const handleBack = () => {
    // If we have a pipeline, go back to it directly.
    // router.back() falls through to the dashboard when there's no stack.
    if (data.pipeline?.id) {
      router.replace(`/(tabs)/tasks?pipelineId=${data.pipeline.id}` as any);
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/tasks' as any);
    }
  };

  return (
    <View className="px-5 pt-12 pb-4 bg-surface-card border-b border-surface-border">
      {/* Top row: back + badges */}
      <View className="flex-row items-center mb-3">
        <TouchableOpacity
          onPress={handleBack}
          className="mr-4 bg-surface-background p-2 rounded-xl border border-surface-border active:opacity-50"
        >
          <FontAwesome name="chevron-left" size={16} color="#94a3b8" />
        </TouchableOpacity>

        <View className="flex-1 flex-row items-center flex-wrap gap-2">
          {/* Priority badge */}
          <View className="bg-surface-background px-2 py-0.5 rounded-md border border-surface-border">
            <Text style={{ color: prio.color }} className="text-[9px] font-black uppercase tracking-tighter">
              {prio.label}
            </Text>
          </View>

          {/* Stage badge */}
          {current_stage && (
            <View className="flex-row items-center bg-brand-primary/10 px-2.5 py-0.5 rounded-full border border-brand-primary/30">
              <View style={{ backgroundColor: current_stage.color || '#6366f1' }} className="w-1.5 h-1.5 rounded-full mr-1.5" />
              <Text className="text-brand-primary text-[9px] font-black uppercase tracking-wider">
                {current_stage.name}
              </Text>
            </View>
          )}

          {/* Sub-task badge */}
          {task.parent_task_id && (
            <View className="bg-brand-primary/20 px-1.5 py-0.5 rounded-sm">
              <Text className="text-brand-primary text-[8px] font-black italic">SUB-TASK</Text>
            </View>
          )}

          {/* Error state badge */}
          {task.error_state && (
            <View className="bg-state-danger/10 px-2 py-0.5 rounded-md border border-state-danger/30">
              <Text className="text-state-danger text-[8px] font-black uppercase">{task.error_state}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Title */}
      <Text className="text-typography-main text-2xl font-black tracking-tight mb-1">
        {task.title}
      </Text>

      {/* Muted info row */}
      <View className="flex-row items-center gap-4 mt-1">
        {task.category && (
          <Text className="text-typography-dim text-[10px] font-bold uppercase tracking-wider">{task.category}</Text>
        )}
        {data.pipeline && (
          <Text className="text-typography-dim text-[10px] font-bold">
            <FontAwesome name="code-fork" size={9} color="#64748b" /> {data.pipeline.name}
          </Text>
        )}
      </View>
    </View>
  );
}
