import React from 'react';
import { Pressable, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Tooltip from '@/components/common/Tooltip';
import GuideChecklist from './GuideChecklist';
import GuideCoachMark from './GuideCoachMark';
import { useContextualGuide } from '@/contexts/ContextualGuideContext';
import { useThemeColors } from '@/hooks/useThemeColors';

export default function GuideHost({ launcherBottom }: { launcherBottom?: number }) {
  const { openChecklist, launchGuide, launcherGuide, suspendedGuide, newGuideIds, progressLoading, progressError } = useContextualGuide();
  const colors = useThemeColors();
  const hasNewCapabilityGuides = !progressLoading && !progressError && newGuideIds.length > 0;
  const launcherLabel = suspendedGuide ? `Resume ${suspendedGuide.title} guide` : launcherGuide ? `Open ${launcherGuide.title} guide` : 'Open To Do checklist';
  const openLauncher = () => suspendedGuide ? launchGuide(suspendedGuide.id) : launcherGuide ? launchGuide(launcherGuide.id) : openChecklist();
  return <View pointerEvents="box-none" className="absolute inset-0" style={{ zIndex: 1000 }}>
    <Tooltip label={launcherLabel} className="absolute right-4 min-h-[44px] min-w-[44px] items-center justify-center" style={launcherBottom === undefined ? { top: 76 } : { bottom: launcherBottom }}>
      <Pressable accessibilityRole="button" accessibilityLabel={launcherLabel} onPress={openLauncher} className="min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-surface-border bg-surface-card hover:bg-surface-background active:bg-surface-background">
        <FontAwesome name="question" size={16} color={colors.textMain} />
        {suspendedGuide ? <View accessibilityRole="image" accessibilityLabel="Guide paused" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-brand-primary" /> : hasNewCapabilityGuides && <View accessibilityRole="image" accessibilityLabel="New guides available" className="absolute right-1 top-1 h-2 w-2 rounded-full bg-state-info" />}
      </Pressable>
    </Tooltip>
    <GuideChecklist launcherBottom={launcherBottom ?? 24} />
    <GuideCoachMark />
  </View>;
}
