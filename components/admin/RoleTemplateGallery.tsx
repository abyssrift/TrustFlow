import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';

import DraggableSheet from '@/components/common/DraggableSheet';
import { Permission } from '@/contexts/RoleManagerContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { ROLE_TEMPLATES, RoleTemplate } from '@/lib/roleTemplates';

export type RoleTemplateGalleryProps = {
  visible: boolean;
  onClose: () => void;
  permissions: Permission[];
  onPickTemplate: (tpl: RoleTemplate) => void;
};

export default function RoleTemplateGallery({ visible, onClose, permissions, onPickTemplate }: RoleTemplateGalleryProps) {
  const colors = useThemeColors();

  return (
    <DraggableSheet
      visible={visible}
      onClose={onClose}
      dimBackdrop
      maxHeight="90%"
      containerClassName="bg-surface-card w-full rounded-t-3xl border-t border-x border-surface-border"
    >
      <View className="flex-row items-center justify-between px-5 pt-3 pb-4">
        <View className="flex-1 mr-4">
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.3em] mb-1">Role Templates</Text>
          <Text className="text-typography-main text-xl font-black tracking-tight">Start from a Preset</Text>
        </View>
        <TouchableOpacity
          onPress={onClose}
          className="w-10 h-10 items-center justify-center rounded-full bg-surface-background border border-surface-border"
        >
          <FontAwesome name="times" size={16} color={colors.textMain} />
        </TouchableOpacity>
      </View>

      <Text className="text-typography-muted text-xs leading-5 px-5 mb-4">
        Pick a starting point. You can rename it and adjust permissions before saving — nothing is created until you confirm.
      </Text>

      <ScrollView showsVerticalScrollIndicator={false} className="px-5" contentContainerStyle={{ paddingBottom: 32 }}>
        <View className="gap-3">
          {ROLE_TEMPLATES.map(tpl => {
            const matchCount = permissions.filter(p => tpl.permissionKeys.includes(p.key)).length;
            return (
              <TouchableOpacity
                key={tpl.id}
                onPress={() => onPickTemplate(tpl)}
                className="bg-surface-background border border-surface-border rounded-2xl p-4 flex-row items-center active:scale-[0.98]"
              >
                <View
                  style={{ backgroundColor: `${tpl.color}1A` }}
                  className="w-11 h-11 rounded-2xl items-center justify-center mr-4 flex-shrink-0"
                >
                  <FontAwesome name={tpl.icon as any} size={18} color={tpl.color} />
                </View>
                <View className="flex-1 mr-3">
                  <Text className="text-typography-main font-black text-sm tracking-tight">{tpl.name}</Text>
                  <Text className="text-typography-muted text-[11px] leading-4 mt-0.5" numberOfLines={2}>{tpl.description}</Text>
                  <Text className="text-typography-dim text-[10px] font-black uppercase tracking-widest mt-2">{matchCount} permissions</Text>
                </View>
                <FontAwesome name="chevron-right" size={12} color={colors.textMuted} />
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </DraggableSheet>
  );
}
