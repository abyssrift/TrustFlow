import { useProjectDetail } from '@/contexts/ProjectDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, View } from 'react-native';
import { SkeletonList } from '@/components/Skeleton';
import { EntityEmptyState, EntityGlyph, StageChip } from '@/components/entities/EntityUI';

// #184 -- PLACEHOLDER TAB CONTENT. "Work" is #182's batch-configuration
// component generalised into an ongoing surface (plan §13.11: "which board /
// which team" as a creation-time step in #182, and this same component
// mounted again here for ongoing reassignment). That component does not
// exist yet -- building it here would duplicate #182 rather than reuse it,
// which is exactly the divergence plan §13.11 calls out ("mounted at two
// moments... building it twice would guarantee they diverge"). So this tab is
// a stub: it surfaces the one piece of "work" data rpc_project_dashboard
// already has (recent tasks) and says plainly what's missing. #182 replaces
// this file's body, not just adds to it.
//
// Phase 8 (#187): the notice no longer quotes issue numbers at the user, each
// task carries its entity glyph and its stage chip instead of a bare colour
// dot and an uppercase stage string, and the empty state explains what a task
// is rather than saying "No tasks" (plan §17).

export default function ProjectWorkTab() {
  const colors = useThemeColors();
  const { data, loading } = useProjectDetail();

  if (loading) {
    return <View className="p-4 md:p-8"><SkeletonList count={4} itemHeight={56} /></View>;
  }

  const tasks = data?.recent_tasks ?? [];

  return (
    <View className="p-4 md:p-8">
      <View className="bg-surface-card border border-surface-border rounded-2xl p-4 mb-5 flex-row items-start gap-3">
        <FontAwesome name="info-circle" size={15} color={colors.info} style={{ marginTop: 2 }} />
        <View className="flex-1">
          <Text className="text-typography-main text-sm font-bold">Assigning boards and teams lands here soon</Text>
          <Text className="text-typography-muted text-xs mt-1 leading-5">
            You’ll be able to change which board each category of work sits on, and which team owns it, without
            recreating the project. Until then, this lists the tasks already on it.
          </Text>
        </View>
      </View>

      {tasks.length === 0 ? (
        <EntityEmptyState
          kind="task"
          title="No tasks on this project yet"
          body="A task is one unit of work inside a project — assigned to a person, tracked with a timer. Tasks arrive when a project is created from a template, or when someone adds one on a board."
        />
      ) : (
        <View className="gap-2">
          {tasks.map(r => (
            <View key={r.id} className="flex-row items-center gap-3 bg-surface-card border border-surface-border rounded-xl px-3.5 py-3">
              <EntityGlyph kind="task" size={24} color={r.is_complete ? colors.success : null} />
              <Text
                numberOfLines={1}
                className={`text-sm font-semibold flex-1 ${r.is_complete ? 'text-typography-muted' : 'text-typography-main'}`}
              >
                {r.title}
              </Text>
              {r.is_complete ? (
                <View className="flex-row items-center gap-1.5">
                  <FontAwesome name="check" size={10} color={colors.success} />
                  <Text className="text-[11px] font-semibold" style={{ color: colors.success }}>Done</Text>
                </View>
              ) : (
                <StageChip name={r.stage_name} color={r.stage_color} size="sm" />
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
