import CollapsibleCard from '@/components/task-detail/CollapsibleCard';
import type { LinkedTask } from '@/components/tabs/taskBoardCache';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

const PRIORITY_DOT: Record<string, string> = {
  urgent: '#e53e3e',
  high: '#dd6b20',
  medium: '#3182ce',
  low: '#718096',
};

/**
 * #203: read-only reference strip for tasks linked onto this board from
 * another pipeline (task_pipeline_links) — distinct from the real stage
 * columns, since a linked task has no stage on this board. Shared between
 * the desktop and adaptive (mobile web + native) boards; both fetch the same
 * `LinkedTask[]` shape via `fetchLinkedTasks`.
 */
export default function LinkedTasksStrip({ tasks }: { tasks: LinkedTask[] }) {
  const router = useRouter();
  const colors = useThemeColors();

  if (!tasks || tasks.length === 0) return null;

  return (
    <View className="mb-5">
      <CollapsibleCard icon="code-fork" title={`Linked from other pipelines (${tasks.length})`} defaultCollapsed>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 2 }}>
          {tasks.map((t) => (
            <TouchableOpacity
              key={t.id}
              onPress={() => router.push(`/task/${t.id}` as any)}
              className="bg-surface-background border border-surface-border rounded-xl px-3 py-2.5"
              style={{ minWidth: 170, maxWidth: 220 }}
            >
              <View className="flex-row items-center gap-1.5 mb-1.5">
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: PRIORITY_DOT[t.priority] ?? colors.textMuted }} />
                <Text className="text-typography-dim text-[9px] font-black uppercase tracking-wider flex-1" numberOfLines={1}>
                  {t.pipeline_name || 'Other pipeline'}
                </Text>
                <FontAwesome name="external-link" size={8} color={colors.textMuted} />
              </View>
              <Text className="text-typography-main text-xs font-bold" numberOfLines={2}>{t.title}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </CollapsibleCard>
    </View>
  );
}
