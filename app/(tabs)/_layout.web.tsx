import React from 'react';
import { View } from 'react-native';
import { Slot } from 'expo-router';

export default function WebTabLayout() {
  return (
    <View className="flex-1 bg-surface-background">
      <Slot />
    </View>
  );
}
