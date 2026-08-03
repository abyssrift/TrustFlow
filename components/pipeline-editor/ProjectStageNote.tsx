import React from 'react';
import { View, Text } from 'react-native';
import { FontAwesome } from '@expo/vector-icons';
import { useThemeColors } from '@/hooks/useThemeColors';

/**
 * Issue #142 Phase 12, plan §20.6.
 *
 * A project pipeline's stage editor hides every control that does nothing for
 * `subject_kind = 'project'` — submission/timer gates, stage action buttons,
 * escalation routing, recursive spawning. This note stands in their place.
 *
 * It exists because a silent no-op is worse than an absent feature: before
 * this, a user could configure a `requires_submission` gate on a project
 * pipeline, save it, and never learn it was never enforced — believing the
 * gate was protecting them. Hiding the controls without saying anything would
 * only trade that for an editor that looks mysteriously short.
 *
 * Shared by StageBuilder.tsx and StageBuilder.web.tsx, which is the point —
 * a native-only fix does not fix web, and vice versa.
 */
export default function ProjectStageNote() {
  const colors = useThemeColors();
  return (
    <View className="bg-state-info/5 p-4 rounded-xl border border-state-info/20 mb-4">
      <View className="flex-row items-center gap-2 mb-2">
        <FontAwesome name="info-circle" size={14} color={colors.info} />
        <Text className="text-state-info font-bold text-xs">Project stages are simpler</Text>
      </View>
      <Text className="text-typography-muted text-[10px] leading-relaxed">
        A project&apos;s work happens in its tasks, so submission and timer gates, action
        buttons and escalation routing are configured on task pipelines, not here.
        What a project stage does: it notifies everyone who can see the project when it
        moves, and an automation can move it on when it is overdue.
      </Text>
    </View>
  );
}
