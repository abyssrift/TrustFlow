import React from 'react';
import { Platform, View } from 'react-native';
import WebComponent from '@/components/tabs/_profile_web';
import AdaptiveComponent from '@/components/tabs/_profile_adaptive';
import GuideHelpButton from '@/components/guides/GuideHelpButton';

export default function profileScreen() {
  if (Platform.OS === 'web') {
    return <View className="flex-1"><WebComponent /><View className="absolute right-4 top-4 z-50"><GuideHelpButton guideId="profile" /></View></View>;
  }
  return <View className="flex-1"><AdaptiveComponent /><View className="absolute right-4 top-4 z-50"><GuideHelpButton guideId="profile" /></View></View>;
}
