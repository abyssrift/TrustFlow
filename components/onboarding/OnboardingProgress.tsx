import React from 'react';
import { Text, View } from 'react-native';
import type { OnboardingMilestoneId, OnboardingMilestoneStatus } from '@/lib/onboardingProgress';

export type OnboardingProgressMilestone = { id: OnboardingMilestoneId; label: string; status: OnboardingMilestoneStatus };

// No animation and no width branch on purpose: the same markup has to read correctly
// on a phone, on a desktop, and on a machine with OS animations disabled — where an
// animated fill would either not paint or arrive already finished.
export default function OnboardingProgress({
  milestones,
  activeMilestoneId,
}: {
  milestones: OnboardingProgressMilestone[];
  activeMilestoneId?: OnboardingMilestoneId;
}) {
  const activeIndex = Math.max(0, milestones.findIndex((milestone) => milestone.id === activeMilestoneId || milestone.status === 'active'));
  return (
    <View className="mb-8">
      <View testID="onboarding-progress-bar" className="h-2 flex-row gap-1.5">
        {milestones.map((milestone, index) => (
          <View
            key={milestone.id}
            className={`flex-1 rounded-full ${index <= activeIndex ? 'bg-brand-primary' : 'bg-surface-border'}`}
          />
        ))}
      </View>
      <Text className="mt-3 text-xs font-bold uppercase tracking-widest text-typography-dim">
        {`Step ${activeIndex + 1} of ${milestones.length}`}
      </Text>
    </View>
  );
}
