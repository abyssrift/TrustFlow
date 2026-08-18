import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { ScrollView, Switch, Text, TouchableOpacity, View } from 'react-native';

import SearchableMultiSelect from '@/components/common/SearchableMultiSelect';
import { Role } from '@/contexts/RoleManagerContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import Popup from '@/components/common/Popup';
import Tooltip from '@/components/common/Tooltip';
import type { TeamRolesSheetProps } from './TeamRolesSheet';

export default function TeamRolesSheet({ visible, onClose, team, roles, draftRoleIds, onToggleRole, onSave, loading, onToggleClaiming }: TeamRolesSheetProps) {
  const c = useThemeColors();

  return (
    <Popup
      visible={visible}
      onClose={onClose}
      dimBackdrop
      maxHeight="90%"
      presentation="auto"
      maxWidth={560}
      containerClassName="w-[95%] max-h-[90vh] rounded-3xl overflow-hidden premium-shadow"
    >
      <View
        className="w-full flex-1 rounded-3xl overflow-hidden"
        style={{ maxWidth: 560, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}
      >
          <View className="flex-row items-center justify-between px-7 pt-6 pb-5" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
            <View className="flex-1 mr-4">
              <Text style={{ color: c.textMuted }} className="text-[10px] font-black uppercase tracking-[0.3em] mb-1">Assign Roles</Text>
              <Text style={{ color: c.textMain }} className="text-2xl font-black tracking-tight" numberOfLines={1}>
                {team?.name}
              </Text>
            </View>
            <Tooltip label="Close">
              <TouchableOpacity
                onPress={onClose}
                className="w-10 h-10 items-center justify-center rounded-full"
                style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
              >
                <FontAwesome name="times" size={16} color={c.textMuted} />
              </TouchableOpacity>
            </Tooltip>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} className="px-7" style={{ flexShrink: 1 }} contentContainerStyle={{ paddingTop: 16 }}>
            <View
              className="flex-row items-center justify-between rounded-xl px-4 py-4 mb-5"
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
            >
              <View className="flex-1 mr-3">
                <Text style={{ color: c.textMain }} className="font-black text-xs uppercase tracking-widest">Task Claiming</Text>
                <Text style={{ color: c.textMuted }} className="text-[10px] mt-1 leading-4">
                  Only one assigned member can be the active worker on a task at a time.
                </Text>
              </View>
              <Switch
                value={!!team?.enforce_single_claimant}
                onValueChange={onToggleClaiming}
                disabled={loading}
                trackColor={{ false: c.border, true: c.primary }}
                thumbColor="white"
              />
            </View>

            <View className="flex-row items-center mb-4">
              <FontAwesome name="shield" size={12} color={c.primary} />
              <Text style={{ color: c.primary }} className="text-xs font-black uppercase ml-2 tracking-widest">Roles</Text>
            </View>
            <SearchableMultiSelect
              title="Roles"
              items={roles.map((role: Role) => ({
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

          <View className="flex-row gap-3 px-7 py-5" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
            <TouchableOpacity
              onPress={onClose}
              className="flex-1 py-4 rounded-xl items-center"
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
            >
              <Text style={{ color: c.textMuted }} className="font-black text-[10px] uppercase tracking-widest">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onSave}
              disabled={loading}
              className="flex-[2] py-4 rounded-xl items-center"
              style={{ backgroundColor: c.primary }}
            >
              <Text className="text-white font-black text-[10px] uppercase tracking-widest">Save Changes</Text>
            </TouchableOpacity>
          </View>
        </View>
    </Popup>
  );
}
