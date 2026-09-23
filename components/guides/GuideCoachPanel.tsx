import React from 'react';
import { Pressable, Text, View } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import Tooltip from '@/components/common/Tooltip';
import { useContextualGuide } from '@/contexts/ContextualGuideContext';
import { useThemeColors } from '@/hooks/useThemeColors';

export function GuideCoachPanel() {
  const { activeGuide, activeStep, guideError, followingGuide, nextStep, previousStep, skipGuide, closeGuide } = useContextualGuide();
  const colors = useThemeColors();
  if (!activeGuide) return null;
  const step = activeGuide.steps[activeStep];
  const final = activeStep === activeGuide.steps.length - 1;
  const finishLabel = followingGuide ? `Finish and continue to ${followingGuide.title}` : 'Finish guide';
  return <View className="w-full max-w-[640px] rounded-xl border border-surface-border bg-surface-card/90 p-3">
    <View className="mb-2 flex-row items-start justify-between gap-2">
      <View className="flex-1"><Text className="mb-1 text-lg font-bold text-typography-main">{activeGuide.title}</Text><Text className="text-xs font-semibold text-typography-muted">Step {activeStep + 1} of {activeGuide.steps.length}</Text></View>
      <Tooltip label="Close guide">
        <Pressable accessibilityRole="button" accessibilityLabel="Close guide" onPress={closeGuide} className="h-11 w-11 items-center justify-center rounded-xl hover:bg-brand-primary/10 active:bg-brand-primary/20">
          <FontAwesome name="times" size={14} color={colors.textMuted} />
        </Pressable>
      </Tooltip>
    </View>
    <Text className="mb-1 text-base font-semibold text-typography-main">{step.title}</Text>
    <Text className="mb-3 text-sm leading-5 text-typography-muted">{step.body}</Text>
    {guideError && <Text accessibilityRole="alert" className="mb-2 rounded-lg bg-state-danger p-2 text-sm text-typography-main">{guideError}</Text>}
    <View className="flex-row items-center justify-between gap-2">
      <Tooltip label="Skip for now">
        <Pressable accessibilityRole="button" accessibilityLabel="Skip for now" onPress={() => { void skipGuide(); }} className="h-11 flex-row items-center gap-2 rounded-xl px-2 hover:bg-brand-primary/10 active:bg-brand-primary/20">
          <FontAwesome name="forward" size={12} color={colors.textMuted} />
          <Text className="text-xs font-semibold text-typography-muted">Skip</Text>
        </Pressable>
      </Tooltip>
      <View className="flex-row gap-1">
        {activeStep > 0 && <Tooltip label="Previous step">
          <Pressable accessibilityRole="button" accessibilityLabel="Previous guide step" onPress={previousStep} className="h-11 w-11 items-center justify-center rounded-xl hover:bg-brand-primary/10 active:bg-brand-primary/20">
            <FontAwesome name="arrow-left" size={14} color={colors.textMuted} />
          </Pressable>
        </Tooltip>}
        {final && followingGuide && <Text numberOfLines={1} className="max-w-[180px] self-center text-xs font-semibold text-typography-muted">Next: {followingGuide.title}</Text>}
        <Tooltip label={final ? finishLabel : 'Next step'}>
          <Pressable accessibilityRole="button" accessibilityLabel={final ? finishLabel : 'Next guide step'} accessibilityState={{ selected: final }} onPress={() => { void nextStep(); }} className={`h-11 w-11 items-center justify-center rounded-full border ${final ? 'border-state-success bg-state-success/10' : 'border-brand-primary bg-brand-primary/10'} hover:bg-brand-primary/20 active:bg-brand-primary/30`}>
            <FontAwesome name={final ? 'check' : 'arrow-right'} size={15} color={final ? colors.success : colors.primary} />
          </Pressable>
        </Tooltip>
      </View>
    </View>
  </View>;
}
