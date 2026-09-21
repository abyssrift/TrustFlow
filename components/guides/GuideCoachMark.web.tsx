import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useContextualGuide } from '@/contexts/ContextualGuideContext';
import { GuideCoachPanel } from './GuideCoachPanel';

/** Keep guide context beside the right-side launchers without a modal backdrop. */
export default function GuideCoachMarkWeb() {
  const { width } = useWindowDimensions();
  const { activeGuide } = useContextualGuide();
  if (!activeGuide) return null;
  const cardWidth = Math.max(0, Math.min(360, width - 32));
  return <View pointerEvents="box-none" style={{ position: 'fixed', left: 0, top: 0, right: 0, bottom: 0, zIndex: 10000 } as any}>
    <View className="absolute right-4 top-[76px]" style={{ width: cardWidth, zIndex: 10001 }}>
      <GuideCoachPanel />
    </View>
  </View>;
}
