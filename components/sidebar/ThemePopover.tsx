import { DensityType, RoundnessType, useTheme } from '@/contexts/ThemeContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { cssInterop } from 'react-native-css-interop';
import { THEME_OPTIONS } from './constants';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

export default function ThemePopover({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const colors = useThemeColors();
  const { theme, setTheme, density, setDensity, roundness, setRoundness } = useTheme();

  if (!visible) return null;

  return (
    <>
      <Pressable onPress={onClose} className="absolute inset-0 z-40 bg-surface-background/60" />
      <View
        className="absolute right-4 top-16 z-50 w-80 rounded-2xl border border-surface-border bg-surface-card/95 p-5 premium-shadow glass-card transition-all duration-300"
      >
        <View className="mb-5 flex-row items-center justify-between border-b border-surface-border pb-4">
          <View>
            <Text className="text-[10px] font-black uppercase tracking-[0.3em] text-typography-dim">Workspace Controls</Text>
            <Text className="mt-1 text-sm font-black uppercase tracking-widest text-typography-main">Display & Theme</Text>
          </View>
          <Pressable
            onPress={onClose}
            className="h-10 w-10 items-center justify-center rounded-xl border border-surface-border bg-surface-background hover:bg-surface-overlay active:scale-95 transition-transform"
          >
            <FontAwesome name="times" size={14} color="var(--color-accent-muted)" />
          </Pressable>
        </View>

        <View className="gap-2">
          {THEME_OPTIONS.map((option) => (
            <Pressable
              key={option.id}
              onPress={() => setTheme(option.id)}
              className={`h-12 flex-row items-center rounded-xl border px-4 transition-all ${theme === option.id
                ? 'border-brand-primary bg-brand-primary/10'
                : 'border-surface-border bg-surface-background/50 hover:bg-surface-overlay'
                }`}
            >
              <View className={`h-8 w-8 items-center justify-center rounded-lg ${theme === option.id ? 'bg-brand-primary/20' : 'bg-surface-overlay'}`}>
                <FontAwesome name={option.icon} size={14} color={theme === option.id ? colors.primary : colors.textDim} />
              </View>
              <Text className={`ml-3 text-xs font-bold ${theme === option.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{option.label}</Text>
              {theme === option.id && (
                <View className="ml-auto">
                  <FontAwesome name="check-circle" size={14} color={colors.primary} />
                </View>
              )}
            </Pressable>
          ))}
        </View>

        <View className="mt-5 gap-5">
          <View>
            <Text className="mb-3 text-[10px] font-black uppercase tracking-widest text-typography-dim">Interface Density</Text>
            <View className="flex-row gap-1 rounded-xl border border-surface-border bg-surface-background/50 p-1">
              {(['compact', 'normal', 'comfort'] as DensityType[]).map((d) => (
                <Pressable
                  key={d}
                  onPress={() => setDensity(d)}
                  className={`h-10 flex-1 items-center justify-center rounded-lg transition-all ${density === d ? 'bg-brand-primary shadow-sm' : 'hover:bg-surface-overlay'
                    }`}
                >
                  <Text className={`text-[10px] font-bold capitalize ${density === d ? 'text-typography-main' : 'text-typography-muted'}`}>{d}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View>
            <Text className="mb-3 text-[10px] font-black uppercase tracking-widest text-typography-dim">Corner Style</Text>
            <View className="flex-row gap-1 rounded-xl border border-surface-border bg-surface-background/50 p-1">
              {(['sharp', 'normal', 'soft'] as RoundnessType[]).map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setRoundness(r)}
                  className={`h-10 flex-1 items-center justify-center rounded-lg transition-all ${roundness === r ? 'bg-brand-primary shadow-sm' : 'hover:bg-surface-overlay'
                    }`}
                >
                  <Text className={`text-[10px] font-bold capitalize ${roundness === r ? 'text-typography-main' : 'text-typography-muted'}`}>{r}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </View>
    </>
  );
}
