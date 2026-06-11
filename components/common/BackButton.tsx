import React from 'react';
import { TouchableOpacity, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { FontAwesome } from '@expo/vector-icons';
import { cssInterop } from 'react-native-css-interop';

cssInterop(FontAwesome, {
  className: {
    target: 'style',
    nativeStyleToProp: { color: true, size: true },
  },
} as any);

interface BackButtonProps {
  label?: string;
  onPress?: () => void;
}

export function BackButton({ label = 'Back', onPress }: BackButtonProps) {
  const router = useRouter();

  const handlePress = onPress || (() => router.back());

  return (
    <TouchableOpacity
      onPress={handlePress}
      className="flex-row items-center h-11 pr-4"
    >
      <FontAwesome name="chevron-left" size={14} className="text-typography-muted" />
      <Text className="text-typography-muted font-bold text-sm ml-2">{label}</Text>
    </TouchableOpacity>
  );
}
