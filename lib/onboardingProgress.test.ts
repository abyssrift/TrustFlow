import { describe, expect, it } from 'vitest';
import { deriveOnboardingProgress, ONBOARDING_MILESTONE_IDS, type OnboardingProgressInput } from './onboardingProgress';

const base: OnboardingProgressInput = {
  phase: 'questions',
  companyCreationSucceeded: false,
  profileRefreshed: false,
};

describe('onboarding progress', () => {
  it('is incomplete before company creation', () => {
    expect(deriveOnboardingProgress(base)).toMatchObject({ state: 'incomplete', completed: false });
  });

  it('is active during setup and review', () => {
    expect(deriveOnboardingProgress({ ...base, phase: 'review' })).toMatchObject({ state: 'active', completed: false });
    expect(deriveOnboardingProgress({ ...base, phase: 'submitting' })).toMatchObject({ state: 'active', completed: false });
  });

  it('completes only after creation succeeds and profile refresh finishes', () => {
    expect(deriveOnboardingProgress({ ...base, phase: 'complete', profileRefreshed: true })).toMatchObject({ state: 'incomplete', completed: false });
    expect(deriveOnboardingProgress({ ...base, phase: 'complete', companyCreationSucceeded: true })).toMatchObject({ state: 'active', completed: false });
    expect(deriveOnboardingProgress({ ...base, phase: 'complete', companyCreationSucceeded: true, profileRefreshed: true })).toMatchObject({ state: 'complete', completed: true });
  });

  it('is pure and has no animation or platform dependency', () => {
    expect(deriveOnboardingProgress({ ...base, phase: 'complete', companyCreationSucceeded: true, profileRefreshed: true })).toEqual(
      deriveOnboardingProgress({ ...base, phase: 'complete', companyCreationSucceeded: true, profileRefreshed: true }),
    );
  });

  it('derives stable milestone ids and keeps workspace ready incomplete until refresh', () => {
    expect(ONBOARDING_MILESTONE_IDS).toEqual(['workspace_basics', 'setup_choices', 'workspace_ready']);
    expect(deriveOnboardingProgress({ ...base, companyBasicsAccepted: true, phase: 'questions' }).milestones).toEqual([
      { id: 'workspace_basics', status: 'complete' },
      { id: 'setup_choices', status: 'active' },
      { id: 'workspace_ready', status: 'incomplete' },
    ]);
    expect(deriveOnboardingProgress({ ...base, companyBasicsAccepted: true, phase: 'complete', companyCreationSucceeded: true }).milestones.at(-1)).toEqual({
      id: 'workspace_ready', status: 'active',
    });
    expect(deriveOnboardingProgress({ ...base, companyBasicsAccepted: true, phase: 'complete', companyCreationSucceeded: true, profileRefreshed: true }).milestones.at(-1)).toEqual({
      id: 'workspace_ready', status: 'complete',
    });
  });
});
