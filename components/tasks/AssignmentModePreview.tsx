import { useThemeColors } from '@/hooks/useThemeColors';
import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { Text, View, ViewStyle } from 'react-native';
import type { AssignmentPreview } from '@/lib/usePipelineAssignmentPreview';

const MODE_LABEL: Record<string, string> = {
  round_robin: 'Round Robin',
  smart: 'Smart Assign',
};

type Props = {
  preview: AssignmentPreview | null;
  hasManualAssignees: boolean;
  style?: ViewStyle;
};

// Banner shown at task creation when the chosen pipeline auto-assigns. Colors are
// inline (theme-token color classes can render black inside a RN Modal on web).
export default function AssignmentModePreview({ preview, hasManualAssignees, style }: Props) {
  const colors = useThemeColors();

  if (!preview || preview.mode === 'manual') return null;

  const label = MODE_LABEL[preview.mode] ?? 'Auto-assign';
  const poolEmpty = (preview.pool_size ?? 0) === 0;
  const name = preview.assignee_name;

  let tint: string;
  let icon: keyof typeof FontAwesome.glyphMap;
  let title: string;
  let detail: string;

  if (hasManualAssignees) {
    // Engine is fill_if_empty: a manual pick suppresses auto-assign entirely.
    tint = colors.textMuted;
    icon = 'hand-pointer-o';
    title = `${label} · Overridden`;
    detail = 'You picked assignees manually, so auto-assign will not run for this task.';
  } else if (poolEmpty) {
    tint = colors.warning;
    icon = 'exclamation-triangle';
    title = `${label} · Empty pool`;
    detail = `This pipeline auto-assigns, but its ${preview.pool_type === 'teams' ? 'team' : 'member'} pool is empty — no one will be assigned.`;
  } else if (name) {
    tint = colors.primary;
    icon = 'random';
    title = `${label} · Next up`;
    detail = `On create, this task will be assigned to ${name}.`;
  } else {
    tint = colors.primary;
    icon = 'random';
    title = label;
    detail = 'This task will be auto-assigned from the pipeline pool on create.';
  }

  return (
    <View
      className="flex-row items-start gap-3 rounded-2xl px-4 py-3 border"
      style={[{ backgroundColor: tint + '14', borderColor: tint + '40' }, style]}
    >
      <FontAwesome name={icon} size={14} color={tint} style={{ marginTop: 2 }} />
      <View className="flex-1">
        <Text style={{ color: tint }} className="text-[10px] font-black uppercase tracking-widest">
          {title}
        </Text>
        <Text style={{ color: colors.textMuted }} className="text-xs font-medium mt-0.5 leading-4">
          {detail}
        </Text>
      </View>
    </View>
  );
}
