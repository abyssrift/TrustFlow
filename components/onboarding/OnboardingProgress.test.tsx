import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Text: 'Text', View: 'View' }));

const { default: OnboardingProgress } = await import('./OnboardingProgress');

const milestones = [
  { id: 'workspace_basics' as const, label: 'Workspace basics', status: 'complete' as const },
  { id: 'setup_choices' as const, label: 'Setup choices', status: 'active' as const },
  { id: 'workspace_ready' as const, label: 'Workspace ready', status: 'incomplete' as const },
];

function render(activeMilestoneId: 'workspace_basics' | 'setup_choices' | 'workspace_ready') {
  let renderer: any;
  act(() => {
    renderer = TestRenderer.create(React.createElement(OnboardingProgress, { activeMilestoneId, milestones }));
  });
  return renderer;
}

describe('OnboardingProgress', () => {
  it('fills one segment per reached step and captions the position', () => {
    const renderer = render('setup_choices');
    const segments = renderer.root.findByProps({ testID: 'onboarding-progress-bar' }).props.children;
    const filled = segments.filter((segment: any) => segment.props.className.includes('bg-brand-primary')).length;
    expect(filled).toBe(2);
    expect(renderer.root.findAllByType('Text').map((node: any) => node.children.join(' ')).join(' ')).toContain('Step 2 of 3');
  });

  it('renders identically at every width so nothing depends on a measured viewport', () => {
    // The previous version branched on useWindowDimensions and animated its opacity;
    // both are gone so the bar still paints with OS animations disabled.
    const renderer = render('workspace_basics');
    expect(renderer.root.findAllByType('Text').map((node: any) => node.children.join(' ')).join(' ')).toContain('Step 1 of 3');
    expect(JSON.stringify(renderer.toJSON())).not.toContain('AnimatedView');
  });
});
