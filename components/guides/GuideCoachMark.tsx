import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useContextualGuide } from '@/contexts/ContextualGuideContext';
import { GuideCoachPanel } from './GuideCoachPanel';

export default function GuideCoachMark() {
  const { width } = useWindowDimensions();
  const { activeGuide } = useContextualGuide();
  if (!activeGuide) return null;
  const cardWidth = Math.max(0, Math.min(360, width - 32));
  return <View pointerEvents="box-none" className="absolute inset-0" style={{ zIndex: 10000 }}>
    <View className="absolute right-4 top-[76px]" style={{ width: cardWidth, zIndex: 10001 }}>
      <GuideCoachPanel />
    </View>
  </View>;
}
