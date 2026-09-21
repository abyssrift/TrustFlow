import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  profile: { company_id: 'company-1', onboarded_at: null as string | null },
  segments: ['(tabs)'],
  refreshProfile: vi.fn(async () => undefined),
  openChecklist: vi.fn(),
  rpc: vi.fn(async (): Promise<{ error: Error | null }> => ({ error: null })),
}));

vi.mock('expo-router', () => ({ useSegments: () => state.segments }));
vi.mock('react-native', () => ({ Pressable: 'Pressable', Text: 'Text', View: 'View' }));
vi.mock('@expo/vector-icons', () => ({ FontAwesome: 'FontAwesome' }));
vi.mock('@/components/common/Popup', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return { default: ({ visible, children, onClose, title }: any) => visible ? React.createElement('PopupTest', { onClose, title }, children) : null };
});
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ profile: state.profile, refreshProfile: state.refreshProfile }) }));
vi.mock('@/contexts/ContextualGuideContext', () => ({ useContextualGuide: () => ({ openChecklist: state.openChecklist }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: state.rpc } }));

const { default: WelcomeTour } = await import('./WelcomeTour');
type Renderer = ReturnType<typeof TestRenderer.create>;
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

function renderedText(renderer: Renderer) {
  return renderer.root.findAllByType('Text').map((node: any) => node.children.join('')).join(' ');
}

describe('WelcomeTour checklist introduction', () => {
  beforeEach(() => {
    state.profile = { company_id: 'company-1', onboarded_at: null };
    state.segments = ['(tabs)'];
    state.refreshProfile.mockReset().mockResolvedValue(undefined);
    state.openChecklist.mockReset();
    state.rpc.mockReset().mockResolvedValue({ error: null });
  });

  it('offers a single checklist introduction and no generic tour steps', async () => {
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<WelcomeTour />); });
    expect(renderer.root.findByType('PopupTest').props.title).toBe('Your To Do checklist');
    expect(renderedText(renderer)).not.toContain('Step 1');
    expect(renderedText(renderer)).not.toContain('Welcome to TrustFlow');
    expect(renderer.root.findAllByType('PopupTest')).toHaveLength(1);
    renderer.unmount();
  });

  it('acknowledges first run then opens the persistent checklist launcher', async () => {
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<WelcomeTour />); });
    const continueButton = renderer.root.findByProps({ accessibilityLabel: 'Open To Do checklist' });
    await act(async () => { await continueButton.props.onPress(); });
    expect(state.rpc).toHaveBeenCalledWith('rpc_complete_onboarding');
    expect(state.refreshProfile).toHaveBeenCalledOnce();
    expect(state.openChecklist).toHaveBeenCalledOnce();
    renderer.unmount();
  });

  it('keeps the introduction hidden on auth, onboarding, and share routes', async () => {
    for (const segment of ['(auth)', 'onboarding', 'share']) {
      state.segments = [segment];
      let renderer!: Renderer;
      await act(async () => { renderer = TestRenderer.create(<WelcomeTour />); });
      expect(renderedText(renderer)).toBe('');
      renderer.unmount();
    }
  });

  it('does not show the introduction to users whose onboarding marker is complete', async () => {
    state.profile.onboarded_at = '2026-09-01T00:00:00Z';
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<WelcomeTour />); });
    expect(renderer.root.findAllByType('PopupTest')).toHaveLength(0);
    renderer.unmount();
  });

  it('completes onboarding when the introduction is dismissed without launching a guide', async () => {
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<WelcomeTour />); });
    const dismiss = renderer.root.findByProps({ accessibilityLabel: 'Dismiss checklist introduction' });
    await act(async () => { await dismiss.props.onPress(); });
    expect(state.rpc).toHaveBeenCalledWith('rpc_complete_onboarding');
    expect(state.openChecklist).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('keeps the introduction visible and shows a generic retry message when the RPC returns an error', async () => {
    state.rpc.mockResolvedValueOnce({ error: new Error('private backend detail') });
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<WelcomeTour />); });
    const continueButton = renderer.root.findByProps({ accessibilityLabel: 'Open To Do checklist' });
    await act(async () => { await continueButton.props.onPress(); });
    expect(renderer.root.findAllByType('PopupTest')).toHaveLength(1);
    expect(renderedText(renderer)).toContain('Please try again');
    expect(renderedText(renderer)).not.toContain('private backend detail');
    expect(state.openChecklist).not.toHaveBeenCalled();
    expect(state.refreshProfile).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('keeps the introduction visible and retryable when the RPC throws', async () => {
    state.rpc.mockRejectedValueOnce(new Error('private backend detail'));
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<WelcomeTour />); });
    const continueButton = renderer.root.findByProps({ accessibilityLabel: 'Open To Do checklist' });
    await act(async () => { await continueButton.props.onPress(); });
    expect(renderer.root.findAllByType('PopupTest')).toHaveLength(1);
    expect(renderedText(renderer)).toContain('Please try again');
    expect(renderedText(renderer)).not.toContain('private backend detail');
    expect(state.openChecklist).not.toHaveBeenCalled();
    expect(state.refreshProfile).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('mounts one guide provider and host in each authenticated root, excluding public routes', () => {
    for (const file of ['app/_layout.tsx', 'app/_layout.web.tsx']) {
      const source = readFileSync(path.resolve(process.cwd(), file), 'utf8');
      expect(source.match(/<ContextualGuideProvider>/g)).toHaveLength(1);
      expect(source.match(/<GuideHost(?:\s+[^>]*)?\s*\/>/g)).toHaveLength(1);
      const providerStart = source.indexOf('<ContextualGuideProvider>');
      const routedSurface = source.indexOf(file.endsWith('.web.tsx') ? '<Slot' : '<Stack>');
      const providerEnd = source.lastIndexOf('</ContextualGuideProvider>');
      expect(providerStart).toBeLessThan(routedSurface);
      expect(providerEnd).toBeGreaterThan(routedSurface);
      expect(source).toMatch(/profile\?\.company_id/);
      expect(source).toMatch(/segments\[0\] !== '\(auth\)'/);
      expect(source).toMatch(/segments\[0\] !== 'onboarding'/);
      expect(source).toMatch(/segments\[0\] !== 'share'/);
    }
  });
});
