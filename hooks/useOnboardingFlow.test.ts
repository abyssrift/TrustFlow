import { describe, expect, it } from 'vitest';
import {
  onboardingFlowReducer,
  initialOnboardingFlowState,
  createInitialOnboardingFlowState,
  type OnboardingFlowState,
} from './useOnboardingFlow';
import type { OnboardingCatalogManifest } from '@/lib/onboardingProfile';

describe('onboarding flow state', () => {
  // A module-level key made every attempt in a session share one idempotency key,
  // so a second workspace creation replayed the first and never linked a company.
  it('issues a fresh uuid idempotency key per flow instance', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const first = createInitialOnboardingFlowState();
    const second = createInitialOnboardingFlowState();
    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
    expect(first.idempotencyKey).toMatch(uuid);
    expect(second.idempotencyKey).toMatch(uuid);
  });

  it('moves through review and preserves answers when submission fails', () => {
    const answers = { sizeBand: 'solo' as const, operatingModels: ['internal_operations' as const] };
    let state = onboardingFlowReducer(initialOnboardingFlowState, { type: 'answer', answers });
    state = onboardingFlowReducer(state, { type: 'review' });
    expect(state.phase).toBe('review');
    state = onboardingFlowReducer(state, { type: 'submit' });
    expect(state.phase).toBe('submitting');
    state = onboardingFlowReducer(state, { type: 'failure', message: 'Network error' });
    expect(state.phase).toBe('review');
    expect(state.answers).toEqual({ experienceLevel: 'guided', ...answers });
    expect(state.error).toBe('Network error');
  });

  it('ignores a second submit and marks a successful completion', () => {
    let state: OnboardingFlowState = { ...initialOnboardingFlowState, phase: 'review' };
    state = onboardingFlowReducer(state, { type: 'submit' });
    state = onboardingFlowReducer(state, { type: 'submit' });
    expect(state.phase).toBe('submitting');
    state = onboardingFlowReducer(state, { type: 'success', result: { companyId: 'company-1' } });
    expect(state).toMatchObject({ phase: 'complete', result: { companyId: 'company-1' }, error: null });
  });

  it('restores a draft without changing the submit identity', () => {
    const state = onboardingFlowReducer(initialOnboardingFlowState, {
      type: 'hydrate',
      answers: { sizeBand: 'growing' },
      step: 'operating_models',
      idempotencyKey: 'same-key',
    });
    expect(state).toMatchObject({ phase: 'questions', step: 'operating_models', idempotencyKey: 'same-key' });
  });

  it('prunes hidden answers using the authoritative catalog manifest', () => {
    const manifest: OnboardingCatalogManifest = {
      catalogKey: 'onboarding_preset.manifest', version: 1,
      questions: [
        { key: 'size_band', type: 'single', label: 'Size', description: 'Size', required: true, options: [{ value: 'solo', label: 'Solo' }] },
        { key: 'operating_models', type: 'multi', label: 'Work', description: 'Work', required: true, options: [{ value: 'internal_operations', label: 'Internal' }] },
        { key: 'gates', type: 'single', label: 'Gates', description: 'Gates', required: true, visibleWhen: { answer: 'operating_models', values: ['client_delivery'] }, options: [{ value: 'formal', label: 'Formal' }] },
      ],
    };
    const state = onboardingFlowReducer(initialOnboardingFlowState, {
      type: 'answer', manifest,
      answers: { operatingModels: ['internal_operations'], gates: 'formal' },
    });
    expect(state.answers).toEqual({ experienceLevel: 'guided', operatingModels: ['internal_operations'] });
  });

  it('clamps an unknown retired draft step_key to the first available manifest step', () => {
    const manifest = {
      catalogKey: 'onboarding_preset.manifest' as const,
      version: 1,
      questions: [
        { key: 'size_band', type: 'single' as const, label: 'Size', description: 'Size', required: true, options: [{ value: 'solo', label: 'Solo' }] },
        { key: 'gates', type: 'single' as const, label: 'Gates', description: 'Gates', required: true, options: [{ value: 'none', label: 'None' }] },
      ],
    };
    const draft = { answers: { sizeBand: 'solo' as const }, step_key: 'retired_step', idempotency_key: 'legacy-key' };
    const state = onboardingFlowReducer(initialOnboardingFlowState, {
      type: 'hydrate', manifest, answers: draft.answers, step: draft.step_key, idempotencyKey: draft.idempotency_key,
    });
    expect(state.step).toBe('size_band');
  });
});
