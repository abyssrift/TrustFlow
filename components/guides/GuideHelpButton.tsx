import React from 'react';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Tooltip from '@/components/common/Tooltip';
import { useContextualGuide } from '@/contexts/ContextualGuideContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import type { GuideId } from '@/lib/contextualGuides';
import { Pressable } from 'react-native';

export default function GuideHelpButton({ guideId }: { guideId: GuideId }) {
  const { launchGuide } = useContextualGuide();
  const colors = useThemeColors();
  return (
    <Tooltip label="Help">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${guideId} guide`}
        onPress={() => { void launchGuide(guideId); }}
        className="h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-surface-border hover:bg-surface-background active:bg-surface-background"
      >
        <FontAwesome name="question-circle" size={16} color={colors.textMain} />
      </Pressable>
    </Tooltip>
  );
}
