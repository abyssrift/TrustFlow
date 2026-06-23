import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Modal, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useThemeColors } from '@/hooks/useThemeColors';
import type { TeamCreateSheetProps } from './TeamCreateSheet';

export default function TeamCreateSheet({
  visible, onClose, name, onChangeName, description, onChangeDescription, color, onChangeColor, onCreate, loading,
}: TeamCreateSheetProps) {
  const c = useThemeColors();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', padding: 24 }}>
        <View
          className="w-full rounded-3xl overflow-hidden"
          style={{ maxWidth: 480, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}
        >
          <View className="flex-row items-center justify-between px-7 pt-6 pb-5" style={{ borderBottomWidth: 1, borderBottomColor: c.border }}>
            <View className="flex-1 mr-4">
              <Text style={{ color: c.textMuted }} className="text-[10px] font-black uppercase tracking-[0.3em] mb-1">New Team</Text>
              <Text style={{ color: c.textMain }} className="text-2xl font-black tracking-tight">Create Team</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              className="w-10 h-10 items-center justify-center rounded-full"
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
            >
              <FontAwesome name="times" size={16} color={c.textMuted} />
            </TouchableOpacity>
          </View>

          <View className="px-7 pt-5 pb-7 gap-4">
            <TextInput
              value={name}
              onChangeText={onChangeName}
              placeholder="Team name"
              placeholderTextColor={c.textMuted}
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border, color: c.textMain }}
              className="rounded-xl px-4 py-4 font-black text-sm"
            />
            <TextInput
              value={description}
              onChangeText={onChangeDescription}
              placeholder="Description..."
              placeholderTextColor={c.textMuted}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
              style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border, color: c.textMain }}
              className="rounded-xl px-4 py-4 text-sm h-24 leading-5"
            />

            <View className="flex-row flex-wrap gap-3">
              {[c.primary, c.success, c.warning, c.danger, '#6366f1', '#10b981'].map(swatch => (
                <TouchableOpacity
                  key={swatch}
                  onPress={() => onChangeColor(swatch)}
                  className="w-9 h-9 rounded-xl"
                  style={{ backgroundColor: swatch, borderWidth: 2, borderColor: color === swatch ? '#fff' : 'transparent' }}
                />
              ))}
            </View>

            <View className="flex-row gap-3 pt-4" style={{ borderTopWidth: 1, borderTopColor: c.border }}>
              <TouchableOpacity
                onPress={onClose}
                className="flex-1 py-4 rounded-xl items-center"
                style={{ backgroundColor: c.background, borderWidth: 1, borderColor: c.border }}
              >
                <Text style={{ color: c.textMuted }} className="font-black text-[10px] uppercase tracking-widest">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={onCreate}
                disabled={loading || !name.trim()}
                className="flex-[2] py-4 rounded-xl items-center"
                style={{ backgroundColor: c.primary }}
              >
                <Text className="text-white font-black text-[10px] uppercase tracking-widest">Create Team</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}
