import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { randomId } from '@/lib/randomId';
import {
  deriveOnboardingSteps,
  pruneStaleOnboardingAnswers,
  DEFAULT_EXPERIENCE_LEVEL,
  type OnboardingCatalogManifest,
  type OnboardingAnswers,
} from '@/lib/onboardingProfile';

export type OnboardingFlowPhase = 'questions' | 'review' | 'submitting' | 'complete';

export type OnboardingFlowResult = {
  companyId?: string;
  profileId?: string;
  revision?: number;
  applied?: unknown;
  resolved_profile?: {
    size_band?: string;
    operating_models?: string[];
    recommendations?: { workflow?: string[] };
    deferred?: string[];
  };
  recommendations?: unknown;
  deferred?: unknown;
};

export type OnboardingFlowState = {
  phase: OnboardingFlowPhase;
  step: string;
  answers: OnboardingAnswers;
  idempotencyKey: string;
  draftRevision: number;
  error: string | null;
  result: OnboardingFlowResult | null;
};

export type OnboardingFlowAction =
  | { type: 'answer'; answers: OnboardingAnswers; manifest?: OnboardingCatalogManifest }
  | { type: 'step'; step: string }
  | { type: 'review' }
  | { type: 'submit' }
  | { type: 'failure'; message: string }
  | { type: 'success'; result: OnboardingFlowResult }
  | { type: 'draftSaved'; revision: number }
  | { type: 'hydrate'; answers: OnboardingAnswers; step?: string; idempotencyKey?: string; draftRevision?: number; manifest?: OnboardingCatalogManifest };

export const initialOnboardingFlowState: OnboardingFlowState = {
  phase: 'questions',
  step: 'size_band',
  answers: { experienceLevel: DEFAULT_EXPERIENCE_LEVEL },
  idempotencyKey: randomId(),
  draftRevision: 0,
  error: null,
  result: null,
};

// The key used to live on the exported constant above, evaluated once at import,
// so every onboarding attempt in a session shared it. Completing onboarding,
// disbanding, then starting again replayed the first attempt's
// company_onboarding_profiles row in rpc_create_company_and_link — which returns
// early and never links a company, leaving "Workspace ready" over no workspace.
// A resumed draft still restores its own key on hydrate, so double-submit
// protection is unaffected.
export function createInitialOnboardingFlowState(): OnboardingFlowState {
  return { ...initialOnboardingFlowState, idempotencyKey: randomId() };
}

export function onboardingFlowReducer(state: OnboardingFlowState, action: OnboardingFlowAction): OnboardingFlowState {
  switch (action.type) {
    case 'answer':
      return {
        ...state,
        phase: 'questions',
        answers: pruneStaleOnboardingAnswers({ ...state.answers, ...action.answers }, action.manifest),
        error: null,
      };
    case 'step':
      return { ...state, phase: 'questions', step: action.step, error: null };
    case 'review':
      return { ...state, phase: 'review', error: null };
    case 'submit':
      return state.phase === 'submitting' || state.phase === 'complete'
        ? state
        : { ...state, phase: 'submitting', error: null };
    case 'failure':
      return { ...state, phase: 'review', error: action.message };
    case 'success':
      return { ...state, phase: 'complete', result: action.result, error: null };
    case 'draftSaved':
      return { ...state, draftRevision: Math.max(state.draftRevision, action.revision) };
    case 'hydrate':
      {
        const answers = pruneStaleOnboardingAnswers({ experienceLevel: DEFAULT_EXPERIENCE_LEVEL, ...action.answers }, action.manifest);
        const availableSteps = deriveOnboardingSteps(answers, action.manifest);
        const step = action.step && availableSteps.includes(action.step)
          ? action.step
          : availableSteps[0] ?? 'size_band';
        return {
        ...state,
        phase: 'questions',
        answers,
        step,
        idempotencyKey: action.idempotencyKey ?? state.idempotencyKey,
        draftRevision: action.draftRevision ?? state.draftRevision,
        error: null,
        };
      }
    default:
      return state;
  }
}

type DraftClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export function useOnboardingFlow(options?: {
  client?: DraftClient;
  persistDraft?: boolean;
  enabled?: boolean;
  branch?: 'create' | 'join';
  manifest?: OnboardingCatalogManifest;
}) {
  const [state, dispatch] = useReducer(onboardingFlowReducer, undefined, createInitialOnboardingFlowState);
  const persistDraft = options?.persistDraft !== false;
  const enabled = options?.enabled !== false;
  const hydrationStarted = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const [hydrationError, setHydrationError] = useState<string | null>(null);
  const saveRevision = useRef(0);
  const lastSavedPayload = useRef<string | null>(null);
  const saveQueue = useRef(Promise.resolve());

  useEffect(() => {
    if (enabled) return;
    hydrationStarted.current = false;
    saveRevision.current = 0;
    lastSavedPayload.current = null;
    setHydrated(false);
    setHydrationError(null);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !options?.client || hydrationStarted.current) return;
    hydrationStarted.current = true;
    let cancelled = false;
    const load = async () => {
      try {
        const { data, error } = await options.client!.rpc('rpc_load_onboarding_draft', {});
        if (cancelled) return;
        if (error) setHydrationError(error.message || 'Saved setup could not be restored.');
        if (data && typeof data === 'object') {
          const draft = data as { answers?: unknown; step_key?: unknown; idempotency_key?: unknown; revision?: unknown };
          const draftAnswers = (draft.answers && typeof draft.answers === 'object' ? draft.answers : {}) as OnboardingAnswers;
          const draftStep = typeof draft.step_key === 'string' ? draft.step_key : 'size_band';
          const draftKey = typeof draft.idempotency_key === 'string' ? draft.idempotency_key : state.idempotencyKey;
          const draftRevision = typeof draft.revision === 'number' ? draft.revision : 0;
          saveRevision.current = draftRevision;
          lastSavedPayload.current = JSON.stringify([draftStep, draftAnswers, draftKey]);
          dispatch({ type: 'hydrate', answers: draftAnswers, step: draftStep, idempotencyKey: draftKey, draftRevision, manifest: options.manifest });
        }
      } catch (error: any) {
        if (!cancelled) setHydrationError(error?.message || 'Saved setup could not be restored.');
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [enabled, options?.client, options?.manifest]);

  useEffect(() => {
    if (!enabled || !hydrated || hydrationStarted.current === false || !persistDraft || !options?.client || state.phase === 'submitting' || state.phase === 'complete') return;
    const signature = JSON.stringify([state.step, state.answers, state.idempotencyKey]);
    if (signature === lastSavedPayload.current) return;
    lastSavedPayload.current = signature;
    let cancelled = false;
    const payload = {
      p_branch: options.branch ?? 'create',
      p_step_key: state.step,
      p_answers: state.answers,
      p_idempotency_key: state.idempotencyKey,
    };
    saveQueue.current = saveQueue.current.then(async () => {
      const { data, error } = await options.client!.rpc('rpc_save_onboarding_draft', {
        ...payload,
        p_expected_revision: saveRevision.current,
      });
      // ponytail: the draft is resumability only. Answers live in React state and
      // the create call reads them from there, so a failed save blocks nothing —
      // worst case the user re-answers. Clearing the signature lets the next
      // answer retry; surfacing it put a red banner beside "Create workspace"
      // for a background nicety and read as a dead end.
      if (error) {
        if (lastSavedPayload.current === signature) lastSavedPayload.current = null;
        return;
      }
      if (!data || typeof data !== 'object') return;
      const revision = (data as { revision?: unknown }).revision;
      if (typeof revision === 'number' && revision > saveRevision.current) {
        saveRevision.current = revision;
        if (!cancelled) dispatch({ type: 'draftSaved', revision });
      }
    }).catch(() => {
      if (lastSavedPayload.current === signature) lastSavedPayload.current = null;
    });
    return () => { cancelled = true; };
  }, [enabled, hydrated, options?.branch, options?.client, persistDraft, state.answers, state.idempotencyKey, state.phase, state.step]);

  const answer = useCallback((answers: OnboardingAnswers) => dispatch({ type: 'answer', answers, manifest: options?.manifest }), [options?.manifest]);
  const setStep = useCallback((step: string) => dispatch({ type: 'step', step }), []);
  const review = useCallback(() => dispatch({ type: 'review' }), []);
  const submit = useCallback(() => dispatch({ type: 'submit' }), []);
  return { state, dispatch, answer, setStep, review, submit, hydrated, hydrationError };
}
