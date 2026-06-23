import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';

import DraggableSheet from '@/components/common/DraggableSheet';
import { useThemeColors } from '@/hooks/useThemeColors';

export type TeamCreateSheetProps = {
  visible: boolean;
  onClose: () => void;
  name: string;
  onChangeName: (v: string) => void;
  description: string;
  onChangeDescription: (v: string) => void;
  color: string;
  onChangeColor: (v: string) => void;
  onCreate: () => void;
  loading: boolean;
};

export default function TeamCreateSheet({
  visible, onClose, name, onChangeName, description, onChangeDescription, color, onChangeColor, onCreate, loading,
}: TeamCreateSheetProps) {
  const colors = useThemeColors();

  return (
    <DraggableSheet visible={visible} onClose={onClose} dimBackdrop containerClassName="bg-surface-card w-full rounded-t-3xl border-t border-x border-surface-border">
      {/* Header */}
      <View className="flex-row items-center justify-between px-5 pt-3 pb-5">
        <View className="flex-1 mr-4">
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-[0.3em] mb-1">New Team</Text>
          <Text className="text-typography-main text-xl font-black tracking-tight">Create Team</Text>
        </View>
        <TouchableOpacity
          onPress={onClose}
          className="w-10 h-10 items-center justify-center rounded-full bg-surface-background border border-surface-border"
        >
          <FontAwesome name="times" size={16} className="text-typography-muted" />
        </TouchableOpacity>
      </View>

      <View className="px-5 pb-5 gap-4">
        <TextInput
          value={name}
          onChangeText={onChangeName}
          placeholder="Team name"
          placeholderTextColor={colors.textMuted}
          className="bg-surface-background border border-surface-border rounded-xl px-4 py-4 text-typography-main font-black text-sm"
        />
        <TextInput
          value={description}
          onChangeText={onChangeDescription}
          placeholder="Description..."
          placeholderTextColor={colors.textMuted}
          multiline
          numberOfLines={3}
          textAlignVertical="top"
          className="bg-surface-background border border-surface-border rounded-xl px-4 py-4 text-typography-main text-sm h-24 leading-5"
        />

        <View className="flex-row flex-wrap gap-3">
          {[colors.primary, colors.success, colors.warning, colors.danger, '#6366f1', '#10b981'].map(c => (
            <TouchableOpacity
              key={c}
              onPress={() => onChangeColor(c)}
              style={{ backgroundColor: c }}
              className={`w-9 h-9 rounded-xl border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
            />
          ))}
        </View>

        <View className="flex-row gap-3 pt-2 border-t border-surface-border">
          <TouchableOpacity
            onPress={onClose}
            className="flex-1 bg-surface-background py-4 rounded-xl border border-surface-border items-center"
          >
            <Text className="text-typography-muted font-black text-[10px] uppercase tracking-widest">Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onCreate}
            disabled={loading || !name.trim()}
            className="flex-[2] bg-brand-primary py-4 rounded-xl items-center active:scale-[0.98]"
          >
            <Text className="text-white font-black text-[10px] uppercase tracking-widest">Create Team</Text>
          </TouchableOpacity>
        </View>
      </View>
    </DraggableSheet>
  );
}
