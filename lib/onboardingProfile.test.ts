import { describe, expect, it } from 'vitest';
import {
  deriveOnboardingSteps,
  EXPERIENCE_LEVELS,
  DEFAULT_EXPERIENCE_LEVEL,
  onboardingAnswersForRpc,
  parseOnboardingCatalogManifest,
  parseOnboardingPresetEntry,
  pruneStaleOnboardingAnswers,
  resolveOnboardingProfile,
  validateOnboardingAnswers,
  type OnboardingAnswers,
  type OnboardingCatalogEntry,
} from './onboardingProfile';

const manifestEntry: OnboardingCatalogEntry = {
  catalog_key: 'onboarding_preset.manifest',
  version: 1,
  payload: {
    schema_version: 1,
    questions: [
      { key: 'size_band', type: 'single', label: 'Team size', description: 'How many people?', required: true, options: [{ value: 'solo', label: 'Just me' }] },
      { key: 'operating_models', type: 'multi', label: 'Work type', description: 'What do you manage?', required: true, options: [{ value: 'internal_operations', label: 'Internal work' }] },
      { key: 'gates', type: 'single', label: 'Approval', description: 'Does work need approval?', required: true, visible_when: { answer: 'operating_models', values: ['client_delivery'] }, options: [{ value: 'none', label: 'No' }] },
      { key: 'time_tracking', type: 'single', label: 'Time', description: 'Track time?', required: true, visible_when: { answer: 'operating_models', values: ['client_delivery'] }, options: [{ value: 'off', label: 'No' }] },
      { key: 'files', type: 'single', label: 'Files', description: 'Who sees files?', required: true, visible_when: { answer: 'operating_models', values: ['client_delivery'] }, options: [{ value: 'light', label: 'Task team' }] },
      { key: 'repeating_work', type: 'single', label: 'Repeating work', description: 'How often?', required: true, options: [{ value: 'rare', label: 'Rarely' }] },
    ],
  },
};

function preset(key: string, selectionKey: string, label: string) {
  return {
    catalog_key: key,
    version: 1,
    payload: {
      schema_version: 1,
      preset_type: key.includes('.size.') ? 'size_band' : 'operating_model_overlay',
      selection_key: selectionKey,
      label,
      recommendations: {
        workflow: [`workflow:${selectionKey}`],
        gates: [`gates:${selectionKey}`],
        time: [`time:${selectionKey}`],
        files: [`files:${selectionKey}`],
        repeating_work: [`repeat:${selectionKey}`],
        tutorial_topics: [`tutorial:${selectionKey}`],
      },
      guarantees: {
        admin: [`admin:${selectionKey}`],
        member: [`member:${selectionKey}`],
        tutorial_topics: [`guaranteed-tutorial:${selectionKey}`],
      },
      safe_defaults: {
        catalog_keys: [`catalog:${selectionKey}`],
        feature_settings: { [`setting:${selectionKey}`]: true },
      },
      deferred: [`deferred:${selectionKey}`],
    },
  } as OnboardingCatalogEntry;
}

function validAnswers(overrides: Partial<OnboardingAnswers> = {}): OnboardingAnswers {
  return {
    sizeBand: 'solo',
    operatingModels: ['internal_operations'],
    gates: 'none',
    timeTracking: 'off',
    files: 'light',
    repeatingWork: 'rare',
    ...overrides,
  };
}

describe('onboarding profile catalog adapter', () => {
  it('accepts only stable experience-level values and defaults legacy answers', () => {
    expect(EXPERIENCE_LEVELS).toEqual(['guided', 'full_control']);
    expect(onboardingAnswersForRpc({}).experience_level).toBe(DEFAULT_EXPERIENCE_LEVEL);
    expect(onboardingAnswersForRpc({ experienceLevel: 'full_control' }).experience_level).toBe('full_control');
    expect(validateOnboardingAnswers({ ...validAnswers(), experienceLevel: 'unsupported' as never })).toContain('Choose an experience level.');
  });

  it('serializes experience level in snake_case and keeps it on the resolved profile', () => {
    const answers = validAnswers({ experienceLevel: 'full_control' });
    const payload = onboardingAnswersForRpc(answers);
    expect(payload).toEqual({
      experience_level: 'full_control',
      size_band: 'solo',
      operating_models: ['internal_operations'],
      gates: 'none',
      time_tracking: 'off',
      files: 'light',
      repeating_work: 'rare',
    });
    expect(payload).not.toHaveProperty('experienceLevel');
    expect(resolveOnboardingProfile(answers, [
      parseOnboardingPresetEntry(preset('onboarding_preset.size.solo', 'solo', 'Just me')),
      parseOnboardingPresetEntry(preset('onboarding_preset.overlay.internal_operations', 'internal_operations', 'Internal work')),
    ])).toMatchObject({ experienceLevel: 'full_control' });
    expect(resolveOnboardingProfile(validAnswers(), [
      parseOnboardingPresetEntry(preset('onboarding_preset.size.solo', 'solo', 'Just me')),
      parseOnboardingPresetEntry(preset('onboarding_preset.overlay.internal_operations', 'internal_operations', 'Internal work')),
    ])).toMatchObject({ experienceLevel: 'guided' });
  });

  it('parses the manifest and rejects malformed catalog data', () => {
    expect(parseOnboardingCatalogManifest(manifestEntry).questions).toHaveLength(6);
    expect(() => parseOnboardingCatalogManifest({
      ...manifestEntry,
      payload: { schema_version: 2, questions: [] },
    })).toThrow('Invalid onboarding catalog manifest');
  });

  it('parses a size or operating-model preset without embedding tenant IDs', () => {
    expect(parseOnboardingPresetEntry(preset('onboarding_preset.size.small', 'small', 'Small team'))).toMatchObject({
      catalogKey: 'onboarding_preset.size.small',
      version: 1,
      selectionKey: 'small',
      label: 'Small team',
    });
    expect(() => parseOnboardingPresetEntry({
      ...preset('onboarding_preset.size.small', 'small', 'Small team'),
      payload: { ...(preset('onboarding_preset.size.small', 'small', 'Small team').payload as Record<string, unknown>), deferred: 'not-an-array' },
    })).toThrow('Invalid onboarding preset catalog entry');
  });

  it('composes size and multiple overlays in a stable catalog order', () => {
    const entries = [
      preset('onboarding_preset.size.small', 'small', 'Small team'),
      preset('onboarding_preset.overlay.client_delivery', 'client_delivery', 'Client work'),
      preset('onboarding_preset.overlay.governed_regulatory', 'governed_regulatory', 'Regulated work'),
    ];
    const profile = resolveOnboardingProfile({
      sizeBand: 'small',
      operatingModels: ['governed_regulatory', 'client_delivery'],
      gates: 'formal',
      timeTracking: 'required',
      files: 'governed',
      repeatingWork: 'frequent',
    }, entries.map(parseOnboardingPresetEntry));

    expect(profile.selectedCatalogKeys).toEqual([
      'onboarding_preset.size.small',
      'onboarding_preset.overlay.client_delivery',
      'onboarding_preset.overlay.governed_regulatory',
    ]);
    expect(profile.recommendations.workflow).toEqual([
      'workflow:small',
      'workflow:client_delivery',
      'workflow:governed_regulatory',
    ]);
    expect(profile.deferred).toContain('deferred:governed_regulatory');
  });

  it('uses a safe low-automation profile for not-sure answers', () => {
    const answers: OnboardingAnswers = {
      sizeBand: 'solo',
      operatingModels: ['internal_operations'],
      gates: 'none',
      timeTracking: 'off',
      files: 'light',
      repeatingWork: 'rare',
    };
    const profile = resolveOnboardingProfile(answers, [
      parseOnboardingPresetEntry(preset('onboarding_preset.size.solo', 'solo', 'Just me')),
      parseOnboardingPresetEntry(preset('onboarding_preset.overlay.internal_operations', 'internal_operations', 'Internal work')),
    ]);
    expect(profile.safeDefaults).toEqual({
      'setting:solo': true,
      'setting:internal_operations': true,
    });
    expect(profile.deferred).toContain('deferred:internal_operations');
  });

  it('derives conditional questions and removes stale answers when the model changes', () => {
    const parsedManifest = parseOnboardingCatalogManifest(manifestEntry);
    expect(deriveOnboardingSteps({ sizeBand: 'solo', operatingModels: ['internal_operations'] }, parsedManifest)).toEqual([
      'size_band', 'operating_models', 'repeating_work',
    ]);
    expect(deriveOnboardingSteps({ sizeBand: 'small', operatingModels: ['client_delivery'] }, parsedManifest)).toEqual([
      'size_band', 'operating_models', 'gates', 'time_tracking', 'files', 'repeating_work',
    ]);
    expect(deriveOnboardingSteps({
      sizeBand: 'small',
      operatingModels: ['client_delivery'],
    })).toEqual(['size_band', 'operating_models', 'gates', 'time_tracking', 'files', 'repeating_work']);
    expect(deriveOnboardingSteps({
      sizeBand: 'solo',
      operatingModels: ['internal_operations'],
    })).toEqual(['size_band', 'operating_models', 'repeating_work']);

    expect(pruneStaleOnboardingAnswers({
      experienceLevel: 'full_control',
      sizeBand: 'small',
      operatingModels: ['internal_operations'],
      gates: 'formal',
      timeTracking: 'required',
      files: 'governed',
      repeatingWork: 'sometimes',
    })).toEqual({
      experienceLevel: 'full_control',
      sizeBand: 'small',
      operatingModels: ['internal_operations'],
      repeatingWork: 'sometimes',
    });
  });
});
