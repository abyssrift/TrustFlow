import type { ToastInput } from '@/contexts/ToastContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { addAlpha } from '@/lib/layout';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type ToastItem = ToastInput & { id: string };

type Props = {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
};

const staticIcons = {
  success: 'check-circle',
  error: 'exclamation-circle',
  warning: 'warning',
  info: 'info-circle',
} as const;

export default function GlobalToastOverlay({ toasts, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();

  if (toasts.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={styles.overlay}>
      <SafeAreaView pointerEvents="box-none" style={[styles.safeArea, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.stack}>
          {toasts.map((toast) => {
            const type = toast.type ?? 'info';
            const palette = {
              icon: staticIcons[type],
              accent: (type === 'success' && colors.success) || (type === 'error' && colors.danger) || (type === 'warning' && colors.warning) || (type === 'info' && colors.info) || colors.accent,
              background: addAlpha((type === 'success' && colors.success) || (type === 'error' && colors.danger) || (type === 'warning' && colors.warning) || (type === 'info' && colors.info) || colors.accent, 0.12),
            };
            return (
              <View
                key={toast.id}
                className="w-full max-w-[420px] rounded-3xl border border-surface-border bg-surface-card px-4 py-3 premium-shadow"
                style={{
                  backgroundColor: Platform.OS === 'web' ? addAlpha(colors.card, 0.96) : undefined,
                  borderLeftWidth: 4,
                  borderLeftColor: palette.accent,
                }}
              >
                <View className="flex-row items-start gap-3">
                  <View
                    className="h-10 w-10 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: palette.background }}
                  >
                    <FontAwesome name={palette.icon as any} size={18} color={palette.accent} />
                  </View>

                  <View className="flex-1 pr-2">
                    {toast.title ? (
                      <Text style={{ color: colors.textMain }} className="text-sm font-black mb-0.5">{toast.title}</Text>
                    ) : null}
                    <Text style={{ color: colors.textMuted }} className="text-xs font-semibold leading-4">{toast.message}</Text>
                  </View>

                  <TouchableOpacity onPress={() => onDismiss(toast.id)} className="rounded-full p-1">
                    <FontAwesome name="close" size={16} color={colors.textDim} />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10000,
    pointerEvents: 'box-none',
    justifyContent: 'flex-end',
  },
  safeArea: {
    pointerEvents: 'box-none',
    width: '100%',
  },
  stack: {
    width: '100%',
    paddingHorizontal: 16,
    gap: 10,
  },
});