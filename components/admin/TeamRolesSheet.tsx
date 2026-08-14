import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';

import DraggableSheet from '@/components/common/DraggableSheet';
import SearchableMultiSelect from '@/components/common/SearchableMultiSelect';
import Tooltip from '@/components/common/Tooltip';
import { Role, Team } from '@/contexts/RoleManagerContext';
import { useThemeColors } from '@/hooks/useThemeColors';

export type TeamRolesSheetProps = {
  visible: boolean;
  onClose: () => void;
  team: Team | null;
  roles: Role[];
  draftRoleIds: string[];
  onToggleRole: (id: string) => void;
  onSave: () => void;
  loading: boolean;
  onToggleClaiming: (enabled: boolean) => void;
};

export default function TeamRolesSheet({ visible, onClose, team, roles, draftRoleIds, onToggleRole, onSave, loading, onToggleClaiming }: TeamRolesSheetProps) {
  const colors = useThemeColors();
  return (
    <DraggableSheet visible={visible} onClose={onClose} dimBackdrop maxHeight="85%" containerClassName="bg-surface-card w-full rounded-t-3xl border-t border-x border-surface-border">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pt-3 pb-5">
        <View className="flex-1 mr-4">
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.3em] mb-1">Assign Roles</Text>
          <Text className="text-typography-main text-xl font-black tracking-tight" numberOfLines={1}>
            {team?.name}
          </Text>
        </View>
        <Tooltip label="Close">
          <TouchableOpacity
            onPress={onClose}
            className="w-10 h-10 items-center justify-center rounded-full bg-surface-background border border-surface-border"
          >
            <FontAwesome name="times" size={16} className="text-typography-muted" />
          </TouchableOpacity>
        </Tooltip>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} className="px-5">
        <View className="flex-row items-center justify-between bg-surface-background rounded-xl border border-surface-border px-4 py-4 mb-5">
          <View className="flex-1 mr-3">
            <Text className="text-typography-main font-black text-xs uppercase tracking-widest">Task Claiming</Text>
            <Text className="text-typography-muted text-[10px] mt-1 leading-4">
              Only one assigned member can be the active worker on a task at a time.
            </Text>
          </View>
          <Switch
            value={!!team?.enforce_single_claimant}
            onValueChange={onToggleClaiming}
            disabled={loading}
            trackColor={{ false: colors.border, true: colors.primary }}
            thumbColor="white"
          />
        </View>

        <View className="flex-row items-center mb-4">
          <FontAwesome name="shield" size={12} className="text-brand-primary" />
          <Text className="text-brand-primary text-xs font-black uppercase ml-2 tracking-widest">Roles</Text>
        </View>
        <SearchableMultiSelect
          title="Roles"
          items={roles.map(role => ({
            id: role.id,
            label: role.name,
            description: role.description,
            color: role.color,
          }))}
          selectedIds={draftRoleIds}
          onToggle={onToggleRole}
          searchPlaceholder="Search roles..."
          emptyText="No roles match your search."
        />
        <View className="pb-4" />
      </ScrollView>

      <View className="flex-row gap-3 px-5 py-4 border-t border-surface-border">
        <TouchableOpacity
          onPress={onClose}
          className="flex-1 bg-surface-background py-4 rounded-xl border border-surface-border items-center"
        >
          <Text className="text-typography-muted font-black text-[10px] uppercase tracking-widest">Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={onSave}
          disabled={loading}
          className="flex-[2] bg-brand-primary py-4 rounded-xl items-center active:scale-[0.98]"
        >
          <Text className="text-white font-black text-[10px] uppercase tracking-widest">Save Changes</Text>
        </TouchableOpacity>
      </View>
    </DraggableSheet>
  );
}
