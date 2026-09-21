import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({
  Text: 'Text',
  TouchableOpacity: 'TouchableOpacity',
  View: 'View',
  useWindowDimensions: () => ({ width: 1400, height: 800 }),
}));
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: 'FontAwesome' }));
vi.mock('@/hooks/useThemeColors', () => ({
  useThemeColors: () => ({ primary: '#2563eb', success: '#22c55e', textMuted: '#94a3b8' }),
}));

const { default: WorkspaceReadyStep } = await import('./WorkspaceReadyStep');
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

function renderedText(renderer: any) {
  return renderer.root.findAllByType('Text').map((node: any) => node.children.join(' ')).join(' ');
}

describe('WorkspaceReadyStep', () => {
  it('names the workspace, summarises the choices, and offers one way forward', () => {
    const onContinue = vi.fn();
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(WorkspaceReadyStep, {
        onContinue,
        workspaceName: 'Acme Corp',
        setupSummary: { sizeBand: 'Just me', operatingModels: ['Internal operations'] },
      }));
    });

    const text = renderedText(renderer);
    expect(text).toContain('Acme Corp is ready');
    expect(text).toContain('Just me');
    expect(text).toContain('Internal operations');
    // One CTA only — the starter-template detour and the checklist wall are gone.
    expect(renderer.root.findAllByType('TouchableOpacity')).toHaveLength(1);

    act(() => renderer.root.findByProps({ accessibilityLabel: 'Continue to workspace' }).props.onPress());
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('falls back to a generic heading when the name is unknown', () => {
    let renderer: any;
    act(() => {
      renderer = TestRenderer.create(React.createElement(WorkspaceReadyStep, { onContinue: vi.fn() }));
    });
    expect(renderedText(renderer)).toContain('Your workspace is ready');
  });
});
