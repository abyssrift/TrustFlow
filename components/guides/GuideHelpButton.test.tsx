import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { launchGuide } = vi.hoisted(() => ({ launchGuide: vi.fn(async () => undefined) }));

vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text' }));
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: 'FontAwesomeIcon' }));
vi.mock('@/components/common/Tooltip', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return { default: ({ children, label }: any) => React.createElement('Tooltip', { label }, children) };
});
vi.mock('@/contexts/ContextualGuideContext', () => ({
  useContextualGuide: () => ({ launchGuide }),
}));
vi.mock('@/hooks/useThemeColors', () => ({ useThemeColors: () => ({ textMain: 'text-token' }) }));

const { default: GuideHelpButton } = await import('./GuideHelpButton');

describe('GuideHelpButton', () => {
  beforeEach(() => launchGuide.mockClear());

  it('renders an accessible, icon-only Help control with a 44px target and launches the requested guide', async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<GuideHelpButton guideId="profile" />);
    });

    const button = renderer.root.findByType('Pressable');
    expect(button.props.accessibilityRole).toBe('button');
    expect(button.props.accessibilityLabel).toBe('Open profile guide');
    expect(button.props.className).toContain('h-11');
    expect(button.props.className).toContain('w-11');
    expect(button.props.className).toContain('border-surface-border');
    expect(button.props.className).toContain('hover:bg-surface-background');
    expect(button.props.className).toContain('active:bg-surface-background');

    const icon = renderer.root.findByType('FontAwesomeIcon');
    expect(icon.props.name).toBe('question-circle');
    expect(renderer.root.findAllByType('Text')).toHaveLength(0);

    const tooltip = renderer.root.findByType('Tooltip');
    expect(tooltip.props.label).toBe('Help');

    await act(async () => button.props.onPress());
    expect(launchGuide).toHaveBeenCalledWith('profile');
    renderer.unmount();
  });
});
