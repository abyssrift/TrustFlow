import React from 'react';
import { useWindowDimensions, View } from 'react-native';
import { Slot } from 'expo-router';
import IntelligenceDesktopLayout from '@/components/intelligence/_IntelligenceDesktopLayout';

export default function IntelligenceLayout() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;

  if (isDesktop) {
    return <IntelligenceDesktopLayout />;
  }

  // Mobile Web View: Simple Slot (full width)
  // The mobile navigation is handled by the root TabLayout's bottom tabs
  // and the page-specific toggles.
  return (
    <View className="flex-1 bg-surface-background">
      <Slot />
    </View>
  );
}
