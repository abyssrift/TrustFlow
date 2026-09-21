import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { replace, rpc, refreshProfile, draftState } = vi.hoisted(() => ({
  replace: vi.fn(),
  rpc: vi.fn(),
  refreshProfile: vi.fn(),
  draftState: { value: null as unknown },
}));

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  KeyboardAvoidingView: 'KeyboardAvoidingView',
  Platform: { OS: 'web' },
  ScrollView: 'ScrollView',
  Text: 'Text',
  TextInput: 'TextInput',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
  useWindowDimensions: () => ({ width: 1400, height: 900 }),
}));

vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: 'FontAwesome' }));
vi.mock('expo-router', () => ({ useRouter: () => ({ replace }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ refreshProfile, signOut: vi.fn() }) }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('@/hooks/useThemeColors', () => ({
  useThemeColors: () => ({ primary: '#2563eb', success: '#22c55e', textDim: '#64748b', textMuted: '#94a3b8' }),
}));

const { default: OnboardingScreen } = await import('../app/onboarding');
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

function renderedText(renderer: any) {
  return renderer.root.findAllByType('Text').map((node: any) => node.children.join(' ')).join(' ');
}

async function press(renderer: any, accessibilityLabel: string) {
  await act(async () => { renderer.root.findByProps({ accessibilityLabel }).props.onPress(); });
}

/** selection -> create -> named workspace -> first question. */
async function startCreate(renderer: any, name: string) {
  await press(renderer, 'Set up a new workspace');
  await act(async () => { renderer.root.findByType('TextInput').props.onChangeText(name); });
  await press(renderer, 'Continue to setup');
}

describe('onboarding', () => {
  beforeEach(() => {
    draftState.value = null;
    replace.mockReset();
    refreshProfile.mockReset().mockResolvedValue(undefined);
    rpc.mockReset().mockImplementation((name: string) => {
      if (name === 'rpc_load_onboarding_draft') return Promise.resolve({ data: draftState.value, error: null });
      if (name === 'rpc_save_onboarding_draft') return Promise.resolve({ data: { revision: 1 }, error: null });
      if (name === 'rpc_create_company_and_link') {
        return Promise.resolve({
          data: {
            company_id: 'company-1',
            resolved_profile: { size_band: 'solo', operating_models: ['internal_operations'] },
          },
          error: null,
        });
      }
      if (name === 'rpc_list_onboarding_preset_catalog') {
        const options = (values: string[]) => values.map((value) => ({ value, label: value }));
        const preset = (key: string, type: string, selection: string) => ({
          catalog_key: key,
          version: 1,
          payload: {
            schema_version: 1, preset_type: type, selection_key: selection, label: selection,
            recommendations: { workflow: ['Main Workflow'], gates: [], time: [], files: [], repeating_work: [], tutorial_topics: [] },
            guarantees: { admin: [], member: [], tutorial_topics: [] },
            safe_defaults: { catalog_keys: [], feature_settings: {} },
            deferred: [],
          },
        });
        return Promise.resolve({ data: {
          manifest: { catalog_key: 'onboarding_preset.manifest', version: 1, payload: {
            schema_version: 1,
            questions: [
              { key: 'size_band', type: 'single', label: 'Team size', description: 'How many people?', required: true, options: options(['solo', 'small']) },
              { key: 'operating_models', type: 'multi', label: 'Work type', description: 'What do you manage?', required: true, options: options(['internal_operations', 'client_delivery']) },
              { key: 'repeating_work', type: 'single', label: 'Repeating work', description: 'Repeat?', required: true, options: options(['rare']) },
            ],
          } },
          presets: [
            preset('onboarding_preset.size.solo', 'size_band', 'solo'),
            preset('onboarding_preset.overlay.internal_operations', 'operating_model_overlay', 'internal_operations'),
          ],
        }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    });
  });

  it('creates a workspace in two questions and never shows a review step', async () => {
    let renderer: any;
    await act(async () => { renderer = TestRenderer.create(React.createElement(OnboardingScreen)); });

    await startCreate(renderer, 'Acme Corp');
    await press(renderer, 'Choose solo');
    await press(renderer, 'Continue setup');
    await press(renderer, 'Choose internal_operations');
    await press(renderer, 'Continue setup');

    // Straight from the last question to the workspace — no confirmation screen.
    expect(renderedText(renderer)).not.toContain('Your workspace plan');
    expect(renderedText(renderer)).toContain('Acme Corp is ready');
    expect(refreshProfile).toHaveBeenCalledOnce();
    expect(replace).not.toHaveBeenCalled();

    await press(renderer, 'Continue to workspace');
    expect(replace).toHaveBeenCalledWith('/(tabs)');
  });

  it('still sends the answers it stopped asking for, because the server validates them', async () => {
    let renderer: any;
    await act(async () => { renderer = TestRenderer.create(React.createElement(OnboardingScreen)); });

    await startCreate(renderer, 'Regulated Corp');
    await press(renderer, 'Choose solo');
    await press(renderer, 'Continue setup');
    // client_delivery is exactly the work type that makes the server demand gates/files.
    await press(renderer, 'Choose client_delivery');
    await press(renderer, 'Continue setup');

    const createCall = rpc.mock.calls.find(([name]) => name === 'rpc_create_company_and_link');
    expect(createCall?.[1].p_onboarding_answers).toMatchObject({
      size_band: 'solo',
      gates: 'none',
      time_tracking: 'off',
      files: 'light',
      repeating_work: 'rare',
    });
  });

  it('does not reach the ready screen when the profile refresh fails', async () => {
    refreshProfile.mockRejectedValueOnce(new Error('profile refresh failed'));
    let renderer: any;
    await act(async () => { renderer = TestRenderer.create(React.createElement(OnboardingScreen)); });

    await startCreate(renderer, 'Broken Corp');
    await press(renderer, 'Choose solo');
    await press(renderer, 'Continue setup');
    await press(renderer, 'Choose internal_operations');
    await press(renderer, 'Continue setup');

    expect(renderedText(renderer)).not.toContain('is ready');
    expect(replace).not.toHaveBeenCalled();
  });

  it('sends a fresh idempotency key per attempt rather than a module-wide one', async () => {
    let first: any;
    await act(async () => { first = TestRenderer.create(React.createElement(OnboardingScreen)); });
    await startCreate(first, 'First Corp');
    await press(first, 'Choose solo');
    await press(first, 'Continue setup');
    await press(first, 'Choose internal_operations');
    await press(first, 'Continue setup');

    let second: any;
    await act(async () => { second = TestRenderer.create(React.createElement(OnboardingScreen)); });
    await startCreate(second, 'Second Corp');
    await press(second, 'Choose solo');
    await press(second, 'Continue setup');
    await press(second, 'Choose internal_operations');
    await press(second, 'Continue setup');

    const keys = rpc.mock.calls
      .filter(([name]) => name === 'rpc_create_company_and_link')
      .map(([, args]) => args.p_idempotency_key);
    expect(keys).toHaveLength(2);
    // Sharing one key made the second attempt replay the first company's profile
    // and silently skip linking a company at all.
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('keeps the progress bar off the entry screens', async () => {
    let renderer: any;
    await act(async () => { renderer = TestRenderer.create(React.createElement(OnboardingScreen)); });
    expect(renderer.root.findAllByProps({ testID: 'onboarding-progress-bar' })).toHaveLength(0);

    await startCreate(renderer, 'Acme Corp');
    expect(renderer.root.findAllByProps({ testID: 'onboarding-progress-bar' })).toHaveLength(1);
  });

  it('preserves the join path', async () => {
    let renderer: any;
    await act(async () => { renderer = TestRenderer.create(React.createElement(OnboardingScreen)); });
    await press(renderer, 'Join an existing team');
    await act(async () => { renderer.root.findByType('TextInput').props.onChangeText('ABC123'); });
    await press(renderer, 'Join workspace');
    expect(refreshProfile).toHaveBeenCalledOnce();
    expect(rpc.mock.calls.some(([name]) => name === 'rpc_create_company_and_link')).toBe(false);
  });
});
