import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import { useTaskDetail } from '@/contexts/TaskDetailContext';

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  completed: { dot: 'bg-state-success', label: 'Completed' },
  cancelled:  { dot: 'bg-state-danger',  label: 'Cancelled' },
  open:       { dot: 'bg-state-info',    label: 'Open' },
};

function getStatusStyle(status: string) {
  return STATUS_STYLES[status] ?? { dot: 'bg-typography-muted', label: status };
}

/**
 * ChildPipelinesPanel -- shows all spawned sub-tasks / sub-pipelines
 * that were created via recursive stage triggers (spawn_recursive_task).
 *
 * Each card links directly to /task/[child_id] for 1-tap navigation.
 * Hidden entirely when there are no child tasks.
 */
export default function ChildPipelinesPanel() {
  const { data } = useTaskDetail();
  const router = useRouter();

  if (!data || !data.child_tasks || data.child_tasks.length === 0) return null;

  return (
    <View className="bg-surface-card rounded-2xl border border-surface-border p-4">
      {/* Header */}
      <View className="flex-row items-center mb-3 gap-2">
        <View className="bg-brand-primary/10 p-1.5 rounded-lg border border-brand-primary/20">
          <FontAwesome name="code-fork" size={11} color="rgb(var(--brand-primary))" />
        </View>
        <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[0.15em]">
          Spawned Sub-Pipelines ({data.child_tasks.length})
        </Text>
      </View>

      <View className="gap-2">
        {data.child_tasks.map((child) => {
          const statusStyle = getStatusStyle(child.status);

          return (
            <TouchableOpacity
              key={child.id}
              onPress={() => router.push(`/task/${child.id}` as any)}
              className="flex-row items-center bg-surface-background rounded-xl border border-surface-border px-3 py-3 active:opacity-75"
            >
              {/* Stage color dot */}
              <View
                style={{ backgroundColor: child.stage_color ?? '#6366f1' }}
                className="w-2 h-2 rounded-full mr-3 flex-shrink-0"
              />

              {/* Content */}
              <View className="flex-1 min-w-0">
                <Text
                  className="text-typography-main text-sm font-bold"
                  numberOfLines={1}
                >
                  {child.title}
                </Text>
                <View className="flex-row items-center gap-2 mt-0.5">
                  {child.stage_name && (
                    <Text className="text-typography-muted text-[10px] font-semibold">
                      {child.stage_name}
                    </Text>
                  )}
                  {child.pipeline_name && (
                    <>
                      <Text className="text-typography-muted text-[10px]">{' | '}</Text>
                      <Text className="text-typography-muted text-[10px]">{child.pipeline_name}</Text>
                    </>
                  )}
                </View>
              </View>

              {/* Status badge */}
              <View className="flex-row items-center gap-1.5 ml-2">
                <View className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                <Text className="text-typography-muted text-[9px] font-black uppercase tracking-wider">
                  {statusStyle.label}
                </Text>
              </View>

              <FontAwesome name="chevron-right" size={10} color="rgb(var(--text-muted))" style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
