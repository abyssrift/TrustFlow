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
  /** Where to go when there's no back-stack to pop (deep link, tab reset, etc). Defaults to '/'. */
  fallbackHref?: string;
}

export function BackButton({ label = 'Back', onPress, fallbackHref = '/' }: BackButtonProps) {
  const router = useRouter();

  const handlePress =
    onPress ||
    (() => (router.canGoBack() ? router.back() : router.replace(fallbackHref as any)));

  return (
    <TouchableOpacity
      onPress={handlePress}
      className="flex-row items-center h-11 pr-4 pt-1"
    >
      <FontAwesome name="chevron-left" size={14} className="text-typography-muted" />
      <Text className="text-typography-muted font-bold text-sm ml-2">{label}</Text>
    </TouchableOpacity>
  );
}
