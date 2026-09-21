import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { useThemeColors } from '@/hooks/useThemeColors';

// Selection is signalled four ways — border, card tint, glyph color, check badge —
// so it survives high-contrast mode and an OS with animations switched off. Nothing
// here depends on a transition having run in order to be readable.
export default function OptionTile({
  label,
  icon,
  selected,
  onPress,
  compact = false,
}: {
  label: string;
  icon: React.ComponentProps<typeof FontAwesome>['name'];
  selected: boolean;
  onPress: () => void;
  compact?: boolean;
}) {
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={`Choose ${label}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{ flexBasis: compact ? '48%' : '31.5%', minHeight: compact ? 112 : 132 }}
      className={`items-center justify-center rounded-2xl border-2 p-4 transition-colors ${
        selected
          ? 'border-brand-primary bg-brand-primary-dim'
          : 'border-surface-border bg-surface-card hover:border-brand-primary hover:bg-brand-primary-dim active:bg-brand-primary-dim'
      }`}
    >
      {selected && (
        <View className="absolute right-2 top-2">
          <FontAwesome name="check-circle" size={18} color={colors.primary} />
        </View>
      )}
      <View className={`${compact ? 'h-12 w-12' : 'h-14 w-14'} items-center justify-center rounded-2xl bg-brand-primary-dim`}>
        <FontAwesome name={icon} size={compact ? 22 : 26} color={selected ? colors.primary : colors.textMuted} />
      </View>
      <Text
        numberOfLines={2}
        className={`mt-3 text-center text-[15px] font-semibold ${selected ? 'text-brand-primary' : 'text-typography-main'}`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
