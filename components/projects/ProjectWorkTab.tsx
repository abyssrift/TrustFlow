import { useProjectDetail } from '@/contexts/ProjectDetailContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, View } from 'react-native';
import { SkeletonList } from '@/components/Skeleton';

// #184 -- PLACEHOLDER TAB CONTENT. "Work" is #182's batch-configuration
// component generalised into an ongoing surface (plan §13.11: "which board /
// which team" as a creation-time step in #182, and this same component
// mounted again here for ongoing reassignment). That component does not
// exist yet as of #184 -- building it here would duplicate #182 rather than
// reuse it, which is exactly the divergence plan §13.11 calls out
// ("mounted at two moments... building it twice would guarantee they
// diverge"). So this tab is a stub: it surfaces the one piece of "work" data
// rpc_project_dashboard already has (recent tasks + stage distribution) and
// says plainly what's missing. #182 replaces this file's body, not just adds
// to it.

export default function ProjectWorkTab() {
  const colors = useThemeColors();
  const { data, loading } = useProjectDetail();

  if (loading) {
    return <View className="p-4 md:p-8"><SkeletonList count={4} itemHeight={56} /></View>;
  }

  const tasks = data?.recent_tasks ?? [];

  return (
    <View className="p-4 md:p-8">
      <View className="bg-surface-card border border-surface-border rounded-2xl p-5 mb-5 flex-row items-start gap-3">
        <FontAwesome name="info-circle" size={16} color={colors.info} style={{ marginTop: 2 }} />
        <View className="flex-1">
          <Text className="text-typography-main text-sm font-black">Board / team assignment is coming here</Text>
          <Text className="text-typography-muted text-xs mt-1 leading-5">
            #182's batch-configuration step (category → board/team mapping) is being generalised into an
            ongoing surface mounted on this tab. Until then, this shows the tasks already on the project.
          </Text>
        </View>
      </View>

      {tasks.length === 0 ? (
        <View className="items-center py-16">
          <FontAwesome name="tasks" size={22} color={colors.textDim} />
          <Text className="text-typography-dim text-xs font-medium mt-3">No tasks on this project yet</Text>
        </View>
      ) : (
        <View className="gap-2">
          {tasks.map(r => (
            <View key={r.id} className="flex-row items-center bg-surface-card border border-surface-border rounded-xl p-4">
              <View style={{ width: 8, height: 8, borderRadius: 4, marginRight: 12, backgroundColor: r.is_complete ? colors.success : (r.stage_color || colors.muted) }} />
              <Text numberOfLines={1} className="text-typography-main text-sm font-bold flex-1">{r.title}</Text>
              <Text className="text-typography-muted text-[10px] font-bold uppercase ml-2">{r.stage_name || '—'}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
