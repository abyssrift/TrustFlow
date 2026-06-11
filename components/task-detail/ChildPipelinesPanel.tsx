import { useTaskDetail } from '@/contexts/TaskDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import CollapsibleCard from './CollapsibleCard';

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
  const colors = useThemeColors();

  if (!data || !data.child_tasks || data.child_tasks.length === 0) return null;

  return (
    <CollapsibleCard
      icon="code-fork"
      title={`Spawned Sub-Pipelines (${data.child_tasks.length})`}
      defaultCollapsed
    >
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

              <FontAwesome name="chevron-right" size={10} color={colors.textMuted} style={{ marginLeft: 8 }} />
            </TouchableOpacity>
          );
        })}
      </View>
    </CollapsibleCard>
  );
}
