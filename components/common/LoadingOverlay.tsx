import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { useThemeColors } from '@/hooks/useThemeColors';

export default function LoadingOverlay({
  visible,
  message,
  variant = 'fullscreen',
  blocking = true,
}: {
  visible: boolean;
  message?: string;
  variant?: 'fullscreen' | 'inline';
  blocking?: boolean;
}) {
  const c = useThemeColors();

  if (!visible) return null;

  if (variant === 'inline') {
    return (
      <View className="absolute inset-0 items-center justify-center" style={blocking ? { backgroundColor: c.card + 'CC' } : undefined}>
        <ActivityIndicator size="large" color={c.primary} />
        {message && (
          <Text className="text-sm font-medium mt-3" style={{ color: c.textMuted }}>{message}</Text>
        )}
      </View>
    );
  }

  return (
    <View className="absolute inset-0 items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 9999 }} pointerEvents={blocking ? 'auto' : 'none'}>
      <View className="rounded-3xl px-10 py-8 items-center" style={{ backgroundColor: c.card, borderWidth: 1, borderColor: c.border }}>
        <ActivityIndicator size="large" color={c.primary} />
        {message && (
          <Text className="text-sm font-medium mt-4" style={{ color: c.textMuted }}>{message}</Text>
        )}
      </View>
    </View>
  );
}
