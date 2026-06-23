import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { Role } from '@/contexts/RoleManagerContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import type { TeamRolesSheetProps } from './TeamRolesSheet';

export default function TeamRolesSheet({ visible, onClose, team, roles, draftRoleIds, onToggleRole, onSave, loading }: TeamRolesSheetProps) {
  const c = useThemeColors();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: 24 }}>
        <View
          className="w-full rounded-3xl overflow-hidden"
          style={{ maxWidth: 560, maxHeight: '80%', backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}
        >
          <View className="flex-row items-center justify-between px-7 pt-6 pb-5" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
            <View className="flex-1 mr-4">
              <Text style={{ color: c.textMuted }} className="text-[10px] font-black uppercase tracking-[0.3em] mb-1">Assign Roles</Text>
              <Text style={{ color: c.textMain }} className="text-2xl font-black tracking-tight" numberOfLines={1}>
                {team?.name}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              className="w-10 h-10 items-center justify-center rounded-full"
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
            >
              <FontAwesome name="times" size={16} color={c.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} className="px-7" contentContainerStyle={{ paddingTop: 16 }}>
            <View className="flex-row items-center mb-4">
              <FontAwesome name="shield" size={12} color={c.primary} />
              <Text style={{ color: c.primary }} className="text-xs font-black uppercase ml-2 tracking-widest">Roles</Text>
            </View>
            <View className="flex-row flex-wrap gap-2 pb-4">
              {roles.map((role: Role) => {
                const isActive = draftRoleIds.includes(role.id);
                return (
                  <TouchableOpacity
                    key={role.id}
                    onPress={() => onToggleRole(role.id)}
                    className="px-4 py-3 rounded-xl"
                    style={{
                      backgroundColor: isActive ? c.primary : c.background,
                      borderWidth: 1,
                      borderColor: isActive ? c.primary : c.border,
                    }}
                  >
                    <Text style={{ color: isActive ? '#fff' : c.textMuted }} className="text-[10px] font-black uppercase tracking-widest">
                      {role.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
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
      </View>
    </Modal>
  );
}
