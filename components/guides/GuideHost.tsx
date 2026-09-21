import React from 'react';
import { Pressable, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Tooltip from '@/components/common/Tooltip';
import GuideChecklist from './GuideChecklist';
import GuideCoachMark from './GuideCoachMark';
import { useContextualGuide } from '@/contexts/ContextualGuideContext';
import { useThemeColors } from '@/hooks/useThemeColors';

export default function GuideHost({ launcherBottom }: { launcherBottom?: number }) {
  const { openChecklist, newGuideIds, progressLoading, progressError } = useContextualGuide();
  const colors = useThemeColors();
  const hasNewCapabilityGuides = !progressLoading && !progressError && newGuideIds.length > 0;
  return <View pointerEvents="box-none" className="absolute inset-0" style={{ zIndex: 1000 }}>
    <Tooltip label="Open To Do checklist">
      <Pressable accessibilityRole="button" accessibilityLabel="Open To Do checklist" onPress={openChecklist} className="absolute right-4 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-surface-border bg-surface-card hover:bg-surface-background active:bg-surface-background" style={launcherBottom === undefined ? { top: 24 } : { bottom: launcherBottom }}>
        <FontAwesome name="question" size={16} color={colors.textMain} />
        {hasNewCapabilityGuides && <View accessibilityRole="image" accessibilityLabel="New guides available" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-state-info" />}
      </Pressable>
    </Tooltip>
    <GuideChecklist launcherBottom={launcherBottom ?? 24} />
    <GuideCoachMark />
  </View>;
}
