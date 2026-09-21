import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { OnboardingQuestion } from '@/lib/onboardingProfile';

let viewportWidth = 1400;
vi.mock('react-native', () => ({
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
  useWindowDimensions: () => ({ width: viewportWidth, height: 800 }),
}));
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: 'FontAwesome' }));
vi.mock('@/hooks/useThemeColors', () => ({
  useThemeColors: () => ({ primary: '#2563eb', textMuted: '#94a3b8', textDim: '#64748b' }),
}));

const { default: OnboardingQuestionStep } = await import('./OnboardingQuestionStep');
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

const question: OnboardingQuestion = {
  key: 'size_band',
  type: 'single',
  label: 'How many people?',
  description: 'Choose the closest fit.',
  required: true,
  options: [
    { value: 'solo', label: 'Just me', description: '1-3 people' },
    { value: 'small', label: 'Small team', description: '4-10 people' },
  ],
};

function render(props: Partial<React.ComponentProps<typeof OnboardingQuestionStep>> = {}) {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(React.createElement(OnboardingQuestionStep, {
      question,
      value: undefined,
      onChange: vi.fn(),
      onContinue: vi.fn(),
      onBack: vi.fn(),
      ...props,
    }));
  });
  return renderer;
}

describe('OnboardingQuestionStep', () => {
  it('renders catalog options as tiles and reports the chosen value', () => {
    const onChange = vi.fn();
    const renderer = render({ onChange });
    const text = renderer.root.findAllByType('Text').map((node: any) => node.children.join(' ')).join(' ');
    expect(text).toContain('How many people?');
    // The per-option description sentence is deliberately not rendered any more.
    expect(text).not.toContain('1-3 people');
    act(() => renderer.root.findByProps({ accessibilityLabel: 'Choose Small team' }).props.onPress());
    expect(onChange).toHaveBeenCalledWith('small');
  });

  it('blocks Continue until something is selected', () => {
    const onContinue = vi.fn();
    expect(render({ onContinue }).root.findByProps({ accessibilityLabel: 'Continue setup' }).props.disabled).toBe(true);
    const chosen = render({ onContinue, value: 'solo' });
    expect(chosen.root.findByProps({ accessibilityLabel: 'Continue setup' }).props.disabled).toBe(false);
    act(() => chosen.root.findByProps({ accessibilityLabel: 'Continue setup' }).props.onPress());
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('toggles rather than replaces on a multi-select question', () => {
    const onChange = vi.fn();
    const renderer = render({
      question: { ...question, type: 'multi' },
      value: ['solo'],
      onChange,
    });
    act(() => renderer.root.findByProps({ accessibilityLabel: 'Choose Small team' }).props.onPress());
    expect(onChange).toHaveBeenCalledWith(['solo', 'small']);
    act(() => renderer.root.findByProps({ accessibilityLabel: 'Choose Just me' }).props.onPress());
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('keeps tap targets and tile sizing usable at phone width', () => {
    viewportWidth = 390;
    const renderer = render({ value: 'solo' });
    const tile = renderer.root.findByProps({ accessibilityLabel: 'Choose Just me' });
    expect(tile.props.style.flexBasis).toBe('48%');
    expect(tile.props.style.minHeight).toBeGreaterThanOrEqual(44);
    viewportWidth = 1400;
  });
});
