import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import DraggableSheet from '@/components/common/DraggableSheet';
import Tooltip from '@/components/common/Tooltip';
import { Role, Team } from '@/contexts/RoleManagerContext';

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
        <TouchableOpacity
          onPress={() => onToggleClaiming(!team?.enforce_single_claimant)}
          className="flex-row items-center justify-between bg-surface-background rounded-xl border border-surface-border px-4 py-4 mb-5"
        >
          <View className="flex-1 mr-3">
            <Text className="text-typography-main font-black text-xs uppercase tracking-widest">Task Claiming</Text>
            <Text className="text-typography-muted text-[10px] mt-1 leading-4">
              Only one assigned member can be the active worker on a task at a time.
            </Text>
          </View>
          <View
            className={`w-11 h-6 rounded-full justify-center px-0.5 ${team?.enforce_single_claimant ? 'bg-brand-primary items-end' : 'bg-surface-border items-start'}`}
          >
            <View className="w-5 h-5 rounded-full bg-white" />
          </View>
        </TouchableOpacity>

        <View className="flex-row items-center mb-4">
          <FontAwesome name="shield" size={12} className="text-brand-primary" />
          <Text className="text-brand-primary text-xs font-black uppercase ml-2 tracking-widest">Roles</Text>
        </View>
        <View className="flex-row flex-wrap gap-2 pb-4">
          {roles.map(role => {
            const isActive = draftRoleIds.includes(role.id);
            return (
              <TouchableOpacity
                key={role.id}
                onPress={() => onToggleRole(role.id)}
                className={`px-4 py-3 rounded-xl border ${
                  isActive ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'
                }`}
              >
                <Text className={`text-[10px] font-black uppercase tracking-widest ${isActive ? 'text-white' : 'text-typography-muted'}`}>
                  {role.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
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
