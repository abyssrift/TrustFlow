import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useThemeColors } from '@/hooks/useThemeColors';
import React from 'react';
import { Platform, Text, TouchableOpacity } from 'react-native';

type TaskFilePasteTargetButtonProps = {
  label: string;
  isArmed: boolean;
  disabled?: boolean;
  onPress: () => void;
};

/** Explicitly selects the task attachment surface that owns the next file paste. */
export default function TaskFilePasteTargetButton({
  label,
  isArmed,
  disabled = false,
  onPress,
}: TaskFilePasteTargetButtonProps) {
  const colors = useThemeColors();
  if (Platform.OS !== 'web') return null;
  const stateLabel = isArmed ? `Paste target: ${label}` : `Arm paste to ${label}`;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={stateLabel}
      accessibilityHint="Pasted files continue going to this target until another target is selected."
      accessibilityState={{ selected: isArmed, disabled }}
      className={`min-h-[44px] flex-row items-center px-3 py-2 rounded-xl border ${isArmed ? 'bg-brand-primary/15 border-brand-primary' : 'bg-surface-background border-surface-border'} ${disabled ? 'opacity-50' : 'active:opacity-70'}`}
    >
      <FontAwesome name="clipboard" size={11} color={isArmed ? colors.primary : colors.textMuted} />
      <Text className={`text-[10px] font-black uppercase ml-1.5 ${isArmed ? 'text-brand-primary' : 'text-typography-muted'}`}>
        {stateLabel}
      </Text>
    </TouchableOpacity>
  );
}
