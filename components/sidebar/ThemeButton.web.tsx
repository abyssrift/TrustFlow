import { useTheme } from '@/contexts/ThemeContext';
import { useDropdownTrigger } from '@/hooks/useDropdownTrigger';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import Tooltip from '../common/Tooltip';
import { THEME_OPTIONS } from './constants';
import DropdownPanel from './DropdownPanel.web';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

// Self-contained theme selector: trigger + anchored dropdown in one wrapper,
// sharing the topbar's hover/click trigger (useDropdownTrigger) and animated
// card (DropdownPanel) with PinnedShortcuts' "+" picker and the notifications
// bell.
export default function ThemeButton() {
  const colors = useThemeColors();
  const { theme, setTheme } = useTheme();
  const { open, wrapperRef, toggle } = useDropdownTrigger();

  return (
    <View ref={wrapperRef} style={{ position: 'relative', zIndex: open ? 100 : undefined }}>
      <Tooltip label="Display & theme" side="left">
        <Pressable
          onPress={toggle}
          accessibilityLabel="Theme settings"
          className="h-9 w-9 items-center justify-center rounded-xl border border-surface-border bg-surface-card transition-all duration-200 ease-out hover:border-brand-primary/40 hover:bg-surface-overlay active:scale-95"
        >
          <FontAwesome name="paint-brush" size={14} color={colors.textDim} />
        </Pressable>
      </Tooltip>

      <DropdownPanel open={open} align="right" width={320} contentClassName="p-4">
        <Text className="mb-3 px-1 text-[10px] font-black uppercase tracking-widest text-typography-dim">
          Display & Theme
        </Text>

        <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
          <View className="gap-1.5">
            {THEME_OPTIONS.map((option) => (
              <Pressable
                key={option.id}
                onPress={() => setTheme(option.id)}
                className={`h-11 flex-row items-center rounded-xl border px-3 transition-all duration-150 ${theme === option.id
                  ? 'border-brand-primary bg-brand-primary/10'
                  : 'border-surface-border bg-surface-background/50 hover:bg-surface-overlay'
                  }`}
              >
                <View className={`h-7 w-7 items-center justify-center rounded-lg ${theme === option.id ? 'bg-brand-primary/20' : 'bg-surface-overlay'}`}>
                  <FontAwesome name={option.icon} size={13} color={theme === option.id ? colors.primary : colors.textDim} />
                </View>
                <Text className={`ml-3 text-xs font-bold ${theme === option.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{option.label}</Text>
                {theme === option.id && (
                  <View className="ml-auto">
                    <FontAwesome name="check-circle" size={13} color={colors.primary} />
                  </View>
                )}
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </DropdownPanel>
    </View>
  );
}
