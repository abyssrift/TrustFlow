import { useThemeColors } from '@/hooks/useThemeColors';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import React from 'react';
import { Pressable } from 'react-native';
import { cssInterop } from 'react-native-css-interop';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

export default function TopBarPullTab({
  direction,
  onPress,
  style,
}: {
  direction: 'up' | 'down';
  onPress: () => void;
  style?: any;
}) {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={direction === 'down' ? 'Show top bar' : 'Hide top bar'}
      className="h-3 w-10 items-center justify-center rounded-b-lg border border-t-0 border-surface-border bg-surface-card hover:bg-surface-overlay"
      style={style}
    >
      <FontAwesome name={direction === 'down' ? 'chevron-down' : 'chevron-up'} size={8} color={colors.textDim} />
    </Pressable>
  );
}
