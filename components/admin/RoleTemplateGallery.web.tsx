import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import Popup from '@/components/common/Popup';
import { Permission } from '@/contexts/RoleManagerContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { ROLE_TEMPLATES } from '@/lib/roleTemplates';
import type { RoleTemplateGalleryProps } from './RoleTemplateGallery';

export default function RoleTemplateGallery({ visible, onClose, permissions, onPickTemplate }: RoleTemplateGalleryProps) {
  const c = useThemeColors();

  return (
    <Popup
      visible={visible}
      onClose={onClose}
      dimBackdrop
      maxHeight="90%"
      presentation="sheet"
      containerClassName="max-h-[90vh] rounded-3xl overflow-hidden premium-shadow"
    >
      <View className="flex-row items-center justify-between px-7 pt-6 pb-4" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
        <View className="flex-1 mr-4">
          <Text style={{ color: c.textMuted }} className="text-[10px] font-black uppercase tracking-[0.3em] mb-1">Role Templates</Text>
          <Text style={{ color: c.textMain }} className="text-2xl font-black tracking-tight">Start from a Preset</Text>
        </View>
        <TouchableOpacity
          onPress={onClose}
          className="w-10 h-10 items-center justify-center rounded-full"
          style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
        >
          <FontAwesome name="times" size={16} color={c.textMain} />
        </TouchableOpacity>
      </View>

      <Text style={{ color: c.textMuted }} className="text-xs leading-5 px-7 pt-4 mb-4">
        Pick a starting point. You can rename it and adjust permissions before saving — nothing is created until you confirm.
      </Text>

      <ScrollView showsVerticalScrollIndicator={false} className="px-7" contentContainerStyle={{ paddingBottom: 28 }}>
        <View className="gap-3">
          {ROLE_TEMPLATES.map(tpl => {
            const matchCount = permissions.filter((p: Permission) => tpl.permissionKeys.includes(p.key)).length;
            return (
              <TouchableOpacity
                key={tpl.id}
                onPress={() => onPickTemplate(tpl)}
                className="rounded-2xl p-4 flex-row items-center"
                style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
              >
                <View
                  style={{ backgroundColor: `${tpl.color}1A` }}
                  className="w-11 h-11 rounded-2xl items-center justify-center mr-4 flex-shrink-0"
                >
                  <FontAwesome name={tpl.icon as any} size={18} color={tpl.color} />
                </View>
                <View className="flex-1 mr-3">
                  <Text style={{ color: c.textMain }} className="font-black text-sm tracking-tight">{tpl.name}</Text>
                  <Text style={{ color: c.textMuted }} className="text-[11px] leading-4 mt-0.5" numberOfLines={2}>{tpl.description}</Text>
                  <Text style={{ color: c.textDim }} className="text-[10px] font-black uppercase tracking-widest mt-2">{matchCount} permissions</Text>
                </View>
                <FontAwesome name="chevron-right" size={12} color={c.textMuted} />
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </Popup>
  );
}
