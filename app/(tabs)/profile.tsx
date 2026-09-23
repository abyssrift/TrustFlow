import React from 'react';
import { Platform, View } from 'react-native';
import WebComponent from '@/components/tabs/_profile_web';
import AdaptiveComponent from '@/components/tabs/_profile_adaptive';

export default function profileScreen() {
  if (Platform.OS === 'web') {
    return <View className="flex-1"><WebComponent /></View>;
  }
  return <View className="flex-1"><AdaptiveComponent /></View>;
}
