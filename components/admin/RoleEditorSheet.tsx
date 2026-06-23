import { FontAwesome } from '@expo/vector-icons';
import React from 'react';
import { ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';

import DraggableSheet from '@/components/common/DraggableSheet';
import { Permission, Role } from '@/contexts/RoleManagerContext';
import { useThemeColors } from '@/hooks/useThemeColors';

export type RoleEditorSheetProps = {
  visible: boolean;
  onClose: () => void;
  isCreating: boolean;
  editingRole: Role | null;
  name: string;
  onChangeName: (v: string) => void;
  description: string;
  onChangeDescription: (v: string) => void;
  color: string;
  onChangeColor: (v: string) => void;
  selectedPerms: string[];
  onTogglePerm: (id: string) => void;
  permissions: Permission[];
  categories: string[];
  isGlobal: boolean | undefined;
  canEdit: boolean;
  onSave: () => void;
  loading: boolean;
};

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
  const colors = useThemeColors();

  return (
    <DraggableSheet
      visible={visible}
      onClose={onClose}
      dimBackdrop
      maxHeight="95%"
      containerClassName="bg-surface-card w-full rounded-t-3xl border-t border-x border-surface-border"
    >
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pt-3 pb-5">
        <View className="flex-1 mr-4">
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.3em] mb-1">Role Editor</Text>
          <Text className="text-typography-main text-xl font-black tracking-tight" numberOfLines={1}>
            {isCreating ? 'New Role' : (editingRole?.name || 'Edit Role')}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onClose}
          className="w-10 h-10 items-center justify-center rounded-full bg-surface-background border border-surface-border"
        >
          <FontAwesome name="times" size={16} color={colors.textMain} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} className="px-5" contentContainerStyle={{ paddingBottom: 24 }}>
        {isGlobal && (
          <View className="bg-state-info/10 border border-state-info/30 p-4 rounded-2xl mb-5 flex-row items-center">
            <View className="w-9 h-9 rounded-full bg-state-info/20 items-center justify-center mr-3 flex-shrink-0">
              <FontAwesome name="shield" size={16} color={colors.info} />
            </View>
            <View className="flex-1">
              <Text className="text-typography-main font-black text-xs uppercase tracking-tight mb-1">System Protected</Text>
              <Text className="text-typography-muted text-[10px] leading-4">This is a platform-wide role. Create a custom role to modify permissions.</Text>
            </View>
          </View>
        )}

        {/* Identity section */}
        <Text className="text-brand-primary text-[10px] font-black uppercase mb-3 tracking-widest">Identity</Text>
        <TextInput
          value={name}
          onChangeText={onChangeName}
          editable={canEdit}
          placeholder="Role name"
          placeholderTextColor={colors.textMuted}
          className={`bg-surface-background border border-surface-border rounded-xl px-4 py-4 text-typography-main font-black text-sm mb-3 ${!canEdit ? 'opacity-50' : ''}`}
        />
        <TextInput
          value={description}
          onChangeText={onChangeDescription}
          editable={canEdit}
          placeholder="Description..."
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          className={`bg-surface-background border border-surface-border rounded-xl px-4 py-4 text-typography-main text-sm mb-5 h-24 leading-5 ${!canEdit ? 'opacity-50' : ''}`}
        />

        {/* Color section */}
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-typography-label text-[10px] font-black uppercase tracking-widest">Color</Text>
          <Text className="text-brand-primary font-black text-[10px]">{color}</Text>
        </View>
        <View className={`flex-row flex-wrap gap-3 mb-6 ${!canEdit ? 'opacity-50' : ''}`}>
          {[colors.primary, colors.success, colors.warning, colors.danger, '#6366f1', '#10b981', colors.info, colors.border].map(c => (
            <TouchableOpacity
              key={c}
              onPress={() => canEdit && onChangeColor(c)}
              style={{ backgroundColor: c }}
              className={`w-9 h-9 rounded-xl border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
            />
          ))}
        </View>

        {/* Permissions section */}
        <Text className="text-brand-primary text-[10px] font-black uppercase mb-4 tracking-widest">Permissions</Text>
        <View className="gap-5">
          {categories.map(cat => (
            <View key={cat}>
              <View className="flex-row items-center mb-3">
                <View className="w-1.5 h-1.5 rounded-full bg-brand-primary mr-2 flex-shrink-0" />
                <Text className="text-typography-main text-[11px] font-black uppercase tracking-widest">{cat}</Text>
              </View>
              <View className="gap-2">
                {permissions.filter(p => p.category === cat).map(perm => {
                  const isActive = selectedPerms.includes(perm.id);
                  return (
                    <TouchableOpacity
                      key={perm.id}
                      onPress={() => canEdit && onTogglePerm(perm.id)}
                      className={`flex-row items-center justify-between p-4 rounded-2xl border ${
                        isActive ? 'bg-brand-primary/5 border-brand-primary/40' : 'bg-surface-background/30 border-surface-border'
                      } ${!canEdit ? 'opacity-70' : ''}`}
                    >
                      <View className="flex-1 mr-3">
                        <Text className={`font-black text-xs uppercase tracking-tight ${isActive ? 'text-typography-main' : 'text-typography-muted'}`}>{perm.label}</Text>
                        <Text className="text-typography-dim text-[10px] mt-1 font-bold leading-4">{perm.description || '(no documentation)'}</Text>
                      </View>
                      <View className={`w-6 h-6 rounded-full items-center justify-center border flex-shrink-0 ${isActive ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
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
      <View className="flex-row gap-3 px-5 py-4 border-t border-surface-border">
        <TouchableOpacity
          onPress={onClose}
          className="flex-1 bg-surface-background py-4 rounded-xl border border-surface-border items-center"
        >
          <Text className="text-typography-muted font-black text-[11px] uppercase tracking-widest">Cancel</Text>
        </TouchableOpacity>
        {canEdit && (
          <TouchableOpacity
            onPress={onSave}
            disabled={loading}
            className="flex-[2] bg-brand-primary py-4 rounded-xl items-center"
          >
            <Text className="text-white font-black text-[11px] uppercase tracking-widest">Save Role</Text>
          </TouchableOpacity>
        )}
      </View>
    </DraggableSheet>
  );
}
