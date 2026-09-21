export type OnboardingProgressState = 'incomplete' | 'active' | 'complete';
export const ONBOARDING_MILESTONE_IDS = ['workspace_basics', 'setup_choices', 'workspace_ready'] as const;
export type OnboardingMilestoneId = typeof ONBOARDING_MILESTONE_IDS[number];
export type OnboardingMilestoneStatus = OnboardingProgressState;

export type OnboardingProgressInput = {
  phase: 'questions' | 'review' | 'submitting' | 'complete';
  companyCreationSucceeded: boolean;
  profileRefreshed: boolean;
  companyBasicsAccepted?: boolean;
};

export type OnboardingProgress = {
  state: OnboardingProgressState;
  completed: boolean;
  milestones: Array<{ id: OnboardingMilestoneId; status: OnboardingMilestoneStatus }>;
};

/** Pure client-side progress derivation; animation and platform are presentation concerns. */
export function deriveOnboardingProgress(input: OnboardingProgressInput): OnboardingProgress {
  const completed = input.phase === 'complete'
    && input.companyCreationSucceeded
    && input.profileRefreshed;
  const state: OnboardingProgressState = completed
    ? 'complete'
    : (input.phase === 'review' || input.phase === 'submitting' || input.companyCreationSucceeded ? 'active' : 'incomplete');
  const basicsComplete = input.companyBasicsAccepted === true;
  const choicesComplete = input.phase === 'review' || input.phase === 'submitting' || input.companyCreationSucceeded || completed;
  return {
    state,
    completed,
    milestones: [
      { id: 'workspace_basics', status: basicsComplete ? 'complete' : 'incomplete' },
      { id: 'setup_choices', status: choicesComplete ? 'complete' : (basicsComplete ? 'active' : 'incomplete') },
      { id: 'workspace_ready', status: completed ? 'complete' : (input.companyCreationSucceeded ? 'active' : 'incomplete') },
    ],
  };
}
