import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { Permission, Role } from '@/contexts/RoleManagerContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import type { RoleEditorSheetProps } from './RoleEditorSheet';

export default function RoleEditorSheet({
  visible,
  onClose,
  isCreating,
  editingRole,
  name,
  onChangeName,
  description,
  onChangeDescription,
  color,
  onChangeColor,
  selectedPerms,
  onTogglePerm,
  permissions,
  categories,
  isGlobal,
  canEdit,
  onSave,
  loading,
}: RoleEditorSheetProps) {
  const c = useThemeColors();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: 24 }}>
        <View
          className="w-full rounded-3xl overflow-hidden"
          style={{ maxWidth: 640, maxHeight: '88%', backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}
        >
          {/* Header */}
          <View className="flex-row items-center justify-between px-7 pt-6 pb-5" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
            <View className="flex-1 mr-4">
              <Text style={{ color: c.textMuted }} className="text-[10px] font-black uppercase tracking-[0.3em] mb-1">Role Editor</Text>
              <Text style={{ color: c.textMain }} className="text-2xl font-black tracking-tight" numberOfLines={1}>
                {isCreating ? 'New Role' : (editingRole?.name || 'Edit Role')}
              </Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              className="w-10 h-10 items-center justify-center rounded-full"
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
            >
              <FontAwesome name="times" size={16} color={c.textMain} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} className="px-7" contentContainerStyle={{ paddingTop: 20, paddingBottom: 28 }}>
            {isGlobal && (
              <View
                className="p-4 rounded-2xl mb-5 flex-row items-center"
                style={{ backgroundColor: c.info + '1A', borderWidth: 1, borderColor: c.info + '4D' }}
              >
                <View className="w-9 h-9 rounded-full items-center justify-center mr-3 flex-shrink-0" style={{ backgroundColor: c.info + '33' }}>
                  <FontAwesome name="shield" size={16} color={c.info} />
                </View>
                <View className="flex-1">
                  <Text style={{ color: c.textMain }} className="font-black text-xs uppercase tracking-tight mb-1">System Protected</Text>
                  <Text style={{ color: c.textMuted }} className="text-[10px] leading-4">This is a platform-wide role. Create a custom role to modify permissions.</Text>
                </View>
              </View>
            )}

            {/* Identity section */}
            <Text style={{ color: c.primary }} className="text-[10px] font-black uppercase mb-3 tracking-widest">Identity</Text>
            <TextInput
              value={name}
              onChangeText={onChangeName}
              editable={canEdit}
              placeholder="Role name"
              placeholderTextColor={c.textMuted}
              style={{
                backgroundColor: c.background, borderWidth: 1, borderColor: c.border, color: c.textMain,
                opacity: !canEdit ? 0.5 : 1,
              }}
              className="rounded-xl px-4 py-4 font-black text-sm mb-3"
            />
            <TextInput
              value={description}
              onChangeText={onChangeDescription}
              editable={canEdit}
              placeholder="Description..."
              placeholderTextColor={c.textMuted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              style={{
                backgroundColor: c.background, borderWidth: 1, borderColor: c.border, color: c.textMain,
                opacity: !canEdit ? 0.5 : 1,
              }}
              className="rounded-xl px-4 py-4 text-sm mb-5 h-24 leading-5"
            />

            {/* Color section */}
            <View className="flex-row items-center justify-between mb-3">
              <Text style={{ color: c.textMuted }} className="text-[10px] font-black uppercase tracking-widest">Color</Text>
              <Text style={{ color: c.primary }} className="font-black text-[10px]">{color}</Text>
            </View>
            <View className="flex-row flex-wrap gap-3 mb-6" style={{ opacity: !canEdit ? 0.5 : 1 }}>
              {[c.primary, c.success, c.warning, c.danger, '#6366f1', '#10b981', c.info, c.border].map(swatch => (
                <TouchableOpacity
                  key={swatch}
                  onPress={() => canEdit && onChangeColor(swatch)}
                  className="w-9 h-9 rounded-xl"
                  style={{ backgroundColor: swatch, borderWidth: 2, borderColor: color === swatch ? '#fff' : 'transparent' }}
                />
              ))}
            </View>

            {/* Permissions section */}
            <Text style={{ color: c.primary }} className="text-[10px] font-black uppercase mb-4 tracking-widest">Permissions</Text>
            <View className="gap-5">
              {categories.map(cat => (
                <View key={cat}>
                  <View className="flex-row items-center mb-3">
                    <View className="w-1.5 h-1.5 rounded-full mr-2 flex-shrink-0" style={{ backgroundColor: c.primary }} />
                    <Text style={{ color: c.textMain }} className="text-[11px] font-black uppercase tracking-widest">{cat}</Text>
                  </View>
                  <View className="gap-2">
                    {permissions.filter((p: Permission) => p.category === cat).map((perm: Permission) => {
                      const isActive = selectedPerms.includes(perm.id);
                      return (
                        <TouchableOpacity
                          key={perm.id}
                          onPress={() => canEdit && onTogglePerm(perm.id)}
                          className="flex-row items-center justify-between p-4 rounded-2xl"
                          style={{
                            backgroundColor: isActive ? c.primary + '0D' : c.background + '4D',
                            borderWidth: 1,
                            borderColor: isActive ? c.primary + '66' : c.border,
                            opacity: !canEdit ? 0.7 : 1,
                          }}
                        >
                          <View className="flex-1 mr-3">
                            <Text style={{ color: isActive ? c.textMain : c.textMuted }} className="font-black text-xs uppercase tracking-tight">{perm.label}</Text>
                            <Text style={{ color: c.textDim }} className="text-[10px] mt-1 font-bold leading-4">{perm.description || '(no documentation)'}</Text>
                          </View>
                          <View
                            className="w-6 h-6 rounded-full items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: isActive ? c.primary : 'transparent', borderWidth: 1, borderColor: isActive ? c.primary : c.border }}
                          >
                            {isActive && <FontAwesome name="check" size={10} color="white" />}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>

          {/* Footer buttons */}
          <View className="flex-row gap-3 px-7 py-5" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
            <TouchableOpacity
              onPress={onClose}
              className="flex-1 py-4 rounded-xl items-center"
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
            >
              <Text style={{ color: c.textMuted }} className="font-black text-[11px] uppercase tracking-widest">Cancel</Text>
            </TouchableOpacity>
            {canEdit && (
              <TouchableOpacity
                onPress={onSave}
                disabled={loading}
                className="flex-[2] py-4 rounded-xl items-center"
                style={{ backgroundColor: c.primary }}
              >
                <Text className="text-white font-black text-[11px] uppercase tracking-widest">Save Role</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}
