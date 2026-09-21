import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Renderer = ReturnType<typeof TestRenderer.create>;

const state = vi.hoisted(() => ({
  pathname: '/',
  viewport: { width: 1400, height: 900 },
  storage: new Map<string, string>(),
  listeners: new Set<(path: string) => void>(),
  push: vi.fn((route: string) => { state.pathname = route.split('?')[0]; state.listeners.forEach((listener) => listener(state.pathname)); }),
  progress: {
    profile: { guideId: 'profile', guideVersion: 1, status: 'not_started', currentStep: 0, firstEligibleAt: 'now', acknowledgedAt: null },
    'top-bar': { guideId: 'top-bar', guideVersion: 1, status: 'in_progress', currentStep: 1, firstEligibleAt: 'now', acknowledgedAt: 'now' },
    tasks: { guideId: 'tasks', guideVersion: 1, status: 'done', currentStep: 1, firstEligibleAt: 'now', acknowledgedAt: 'now' },
    'workflow-pipelines': { guideId: 'workflow-pipelines', guideVersion: 1, status: 'done', currentStep: 1, firstEligibleAt: 'now', acknowledgedAt: 'now' },
    filehub: { guideId: 'filehub', guideVersion: 1, status: 'not_started', currentStep: 0, firstEligibleAt: 'now', acknowledgedAt: null },
  } as Record<string, any>,
  start: vi.fn(async () => undefined),
  skip: vi.fn(async () => undefined),
  complete: vi.fn(async () => undefined),
  retry: vi.fn(async () => undefined),
  progressError: null as string | null,
  fallbackActive: false,
}));

vi.mock('expo-router', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return { usePathname: () => { const [path, setPath] = React.useState(state.pathname); React.useEffect(() => { state.listeners.add(setPath); return () => { state.listeners.delete(setPath); }; }, []); return path; }, useGlobalSearchParams: () => ({}), useRouter: () => ({ push: state.push }) };
});
vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator', Platform: { OS: 'web' }, Pressable: 'Pressable', ScrollView: 'ScrollView',
  Text: 'Text', View: 'View', useWindowDimensions: () => state.viewport,
  PanResponder: { create: (handlers: any) => ({ panHandlers: handlers }) },
}));
vi.mock('@expo/vector-icons/FontAwesome', () => ({ default: 'FontAwesome' }));
vi.mock('@/hooks/useThemeColors', () => ({ useThemeColors: () => ({ primary: 'primary-token', textMuted: 'muted-token' }) }));
vi.mock('@/components/common/Tooltip', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return { default: ({ children, label }: any) => React.createElement('Tooltip', { testID: `tooltip-${label}` }, children) };
});
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => state.storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { state.storage.set(key, value); }),
} }));
vi.mock('@/components/common/Popup', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return { default: ({ visible, children }: any) => visible ? React.createElement('PopupModal', { testID: 'popup-modal' }, children) : null };
});
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' }, profile: { is_owner: true, company_id: 'company-1' }, initialized: true, permissionsLoaded: true, hasPermission: () => true }) }));
vi.mock('@/hooks/useGuideProgress', () => ({ useGuideProgress: () => ({ scope: 'user-1:company-1', progressById: state.progress, loading: false, error: state.progressError, fallbackActive: state.fallbackActive, retry: state.retry, start: state.start, saveStep: vi.fn(), skip: state.skip, complete: state.complete }) }));

const { ContextualGuideProvider } = await import('@/contexts/ContextualGuideContext');
const { GUIDE_REGISTRY } = await import('@/lib/contextualGuides');
const { default: GuideHost } = await import('./GuideHost');
const { default: GuideHelpButton } = await import('./GuideHelpButton');
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

function text(renderer: Renderer) {
  return renderer.root.findAllByType('Text').map((item: any) => item.children.join('')).join(' ');
}

async function press(renderer: Renderer, label: string) {
  const target = renderer.root.findByProps({ accessibilityLabel: label });
  await act(async () => { target.props.onPress(); });
}

describe('GuideHost checklist', () => {
  beforeEach(() => {
    state.progress = {
      profile: { guideId: 'profile', guideVersion: 1, status: 'not_started', currentStep: 0, firstEligibleAt: 'now', acknowledgedAt: null },
      'top-bar': { guideId: 'top-bar', guideVersion: 1, status: 'in_progress', currentStep: 1, firstEligibleAt: 'now', acknowledgedAt: 'now' },
      tasks: { guideId: 'tasks', guideVersion: 1, status: 'done', currentStep: 1, firstEligibleAt: 'now', acknowledgedAt: 'now' },
      'workflow-pipelines': { guideId: 'workflow-pipelines', guideVersion: 1, status: 'done', currentStep: 1, firstEligibleAt: 'now', acknowledgedAt: 'now' },
      filehub: { guideId: 'filehub', guideVersion: 1, status: 'not_started', currentStep: 0, firstEligibleAt: 'now', acknowledgedAt: null },
    };
    state.pathname = '/';
    state.viewport = { width: 1400, height: 900 };
    state.storage.clear();
    state.storage.set('guide-checklist:auto-open:v1:user-1:company-1', '1');
    state.listeners.clear();
    state.push.mockReset();
    state.push.mockImplementation((route: string) => { state.pathname = route.split('?')[0]; state.listeners.forEach((listener) => listener(state.pathname)); });
    state.start.mockReset().mockResolvedValue(undefined);
    state.skip.mockReset().mockResolvedValue(undefined);
    state.complete.mockReset().mockResolvedValue(undefined);
    state.progressError = null;
    state.fallbackActive = false;
  });

  it('keeps Start enabled with a nonblocking warning when cloud progress falls back locally', async () => {
    state.progressError = 'Could not load guide progress. Retry to try again.';
    state.fallbackActive = true;
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><GuideHost /></ContextualGuideProvider>); });
    await press(renderer, 'Open To Do checklist');
    expect(text(renderer)).toContain('Cloud progress is unavailable. You can keep learning; progress is saved on this device.');
    const start = renderer.root.findByProps({ accessibilityLabel: 'Start Your profile guide' });
    expect(start.props.disabled).toBe(false);
    expect(renderer.root.findByProps({ accessibilityLabel: 'Retry guide progress' })).toBeTruthy();
    await press(renderer, 'Start Your profile guide');
    await vi.waitFor(() => expect(state.start).toHaveBeenCalledWith('profile'));
    renderer.unmount();
  });

  it('keeps guide rows disabled when progress fails without fallback', async () => {
    state.progressError = 'Could not load guide progress. Retry to try again.';
    state.fallbackActive = false;
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><GuideHost /></ContextualGuideProvider>); });
    await press(renderer, 'Open To Do checklist');
    expect(renderer.root.findByProps({ accessibilityLabel: 'Start Your profile guide' }).props.disabled).toBe(true);
    expect(text(renderer)).toContain('Could not load guide progress.');
    expect(renderer.root.findByProps({ accessibilityLabel: 'Retry guide progress' })).toBeTruthy();
    expect(state.start).not.toHaveBeenCalled();
    renderer.unmount();
  });

  it('renders the checklist as a non-modal panel with keyboard movement, reset, and close controls', async () => {
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><GuideHost /></ContextualGuideProvider>); });
    await press(renderer, 'Open To Do checklist');
    expect(renderer.root.findAllByProps({ testID: 'popup-modal' })).toHaveLength(0);
    const panel = () => renderer.root.findByProps({ testID: 'guide-checklist-panel' });
    const moveHandle = renderer.root.findByProps({ accessibilityLabel: 'Move To Do checklist' });
    const before = panel().props.style;
    await act(async () => { moveHandle.props.onKeyDown({ key: 'ArrowLeft', preventDefault: vi.fn() }); });
    expect(panel().props.style.left).toBe(before.left - 16);
    const afterArrow = panel().props.style;
    await act(async () => { moveHandle.props.onKeyDown({ key: 'ArrowDown', shiftKey: true, preventDefault: vi.fn() }); });
    expect(panel().props.style.top).toBe(afterArrow.top + 48);
    await press(renderer, 'Reset checklist position');
    expect(panel().props.style.left).toBe(1000);
    expect(panel().props.style.top).toBe(72);
    await press(renderer, 'Close checklist');
    expect(renderer.root.findAllByProps({ testID: 'guide-checklist-panel' })).toHaveLength(0);
    renderer.unmount();
  });

  it('uses a tooltip-labeled icon launcher to reopen the checklist after completion', async () => {
    const originalProgress = state.progress;
    state.progress = Object.fromEntries(GUIDE_REGISTRY.map((guide) => [guide.id, { ...(state.progress[guide.id] ?? {}), guideId: guide.id, guideVersion: guide.version, status: 'in_progress', firstEligibleAt: 'now', acknowledgedAt: 'now' }]));
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><GuideHost launcherBottom={86} /></ContextualGuideProvider>); });
    const launcher = renderer.root.findByProps({ accessibilityLabel: 'Open To Do checklist' });
    expect(launcher.findAllByType('FontAwesome')).toHaveLength(1);
    expect(launcher.findAllByType('Text')).toHaveLength(0);
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'New guides available' })).toHaveLength(0);
    expect(renderer.root.findByProps({ testID: 'tooltip-Open To Do checklist' })).toBeTruthy();
    await press(renderer, 'Open To Do checklist');
    expect(renderer.root.findByProps({ testID: 'guide-checklist-panel' })).toBeTruthy();
    state.progress = Object.fromEntries(Object.entries(state.progress).map(([id, guide]) => [id, { ...guide, status: 'done' }]));
    await act(async () => { renderer.update(<ContextualGuideProvider><GuideHost launcherBottom={86} /></ContextualGuideProvider>); });
    await vi.waitFor(() => expect(renderer.root.findAllByProps({ testID: 'guide-checklist-panel' })).toHaveLength(0));
    await press(renderer, 'Open To Do checklist');
    expect(renderer.root.findByProps({ testID: 'guide-checklist-panel' })).toBeTruthy();
    renderer.unmount();
    state.progress = originalProgress;
  });

  it('groups guides into phases with done counts and collapsible sections', async () => {
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><GuideHost /></ContextualGuideProvider>); });
    await press(renderer, 'Open To Do checklist');

    expect(text(renderer)).toContain('Start here');
    expect(text(renderer)).toContain('0 of 2');
    expect(text(renderer)).toContain('Get work done');
    expect(text(renderer)).toContain('1 of 4');
    expect(renderer.root.findByProps({ accessibilityLabel: 'Start here guides' }).props.accessibilityState.expanded).toBe(true);
    expect(renderer.root.findByProps({ accessibilityLabel: 'Get work done guides' }).props.accessibilityState.expanded).toBe(true);
    expect(renderer.root.findByProps({ accessibilityLabel: 'Start here progress' }).props.accessibilityValue).toMatchObject({ min: 0, max: 2, now: 0, text: '0 of 2 guides complete' });
    expect(renderer.root.findByProps({ accessibilityLabel: 'Start here progress' }).children).toHaveLength(2);
    expect(text(renderer)).toContain('Your profile');
    expect(text(renderer)).toContain('Shape your workflow');

    await press(renderer, 'Start here guides');
    expect(renderer.root.findByProps({ accessibilityLabel: 'Start here guides' }).props.accessibilityState.expanded).toBe(false);
    expect(text(renderer)).not.toContain('Your profile');
    expect(text(renderer)).toContain('Shape your workflow');

    renderer.unmount();
  });

  it('moves the panel through direct pan handlers and persists the released position', async () => {
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><GuideHost /></ContextualGuideProvider>); });
    await press(renderer, 'Open To Do checklist');
    const moveHandle = renderer.root.findByProps({ accessibilityLabel: 'Move To Do checklist' });
    const pan = moveHandle.props;
    expect(pan.onMoveShouldSetPanResponderCapture({}, { dx: -100, dy: 50 })).toBe(true);
    await act(async () => { pan.onPanResponderGrant(); });
    await act(async () => { pan.onPanResponderMove({}, { dx: -100, dy: 50 }); });
    await act(async () => { pan.onPanResponderRelease(); });

    const panel = renderer.root.findByProps({ testID: 'guide-checklist-panel' });
    expect(panel.props.style.left).toBe(900);
    expect(panel.props.style.top).toBe(122);
    await vi.waitFor(() => expect(state.storage.get('guide-checklist:panel-position')).toBe(JSON.stringify({ x: 900, y: 122 })));
    renderer.unmount();
  });

  it('does not mark initially eligible capability guides as newly unlocked, shows statuses, and hides completed rows', async () => {
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><GuideHost /></ContextualGuideProvider>); });
    await press(renderer, 'Open To Do checklist');
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'Find shared files, newly available' })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ accessibilityLabel: 'New guides available' })).toHaveLength(0);
    expect(text(renderer)).toContain('Not started');
    expect(text(renderer)).toContain('In progress');
    expect(text(renderer)).toContain('Done');
    expect(state.start).not.toHaveBeenCalled();
    await press(renderer, 'Hide completed');
    expect(text(renderer)).not.toContain('Shape your workflow');
    expect(text(renderer)).toContain('Your profile');
    renderer.unmount();
  });

  it('uses compact icon launch controls with tooltips and touch-sized targets for every status', async () => {
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><GuideHost /></ContextualGuideProvider>); });
    await press(renderer, 'Open To Do checklist');

    const actions = [
      ['Start Your profile guide', 'Start Your profile guide'],
      ['Resume Navigate TrustFlow guide', 'Resume Navigate TrustFlow guide'],
      ['Replay Work through tasks guide', 'Replay Work through tasks guide'],
    ];
    for (const [label, tooltip] of actions) {
      const control = renderer.root.findByProps({ accessibilityLabel: label });
      expect(control.findAllByType('FontAwesome')).toHaveLength(1);
      expect(control.findAllByType('Text')).toHaveLength(0);
      expect(control.props.className).toContain('min-h-[44px]');
      expect(control.props.className).toContain('min-w-[44px]');
      expect(renderer.root.findByProps({ testID: `tooltip-${tooltip}` })).toBeTruthy();
    }

    expect(text(renderer)).toContain('Not started');
    expect(text(renderer)).toContain('In progress');
    expect(text(renderer)).toContain('Done');
    await press(renderer, 'Resume Navigate TrustFlow guide');
    await vi.waitFor(() => expect(state.start).toHaveBeenCalledWith('top-bar'));
    renderer.unmount();
  });

  it('routes a selected incomplete guide and launches the same registry entry', async () => {
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><GuideHost /></ContextualGuideProvider>); });
    await press(renderer, 'Open To Do checklist');
    await press(renderer, 'Start Your profile guide');
    await vi.waitFor(() => expect(state.start).toHaveBeenCalledWith('profile'));
    expect(state.push).toHaveBeenCalledWith('/profile');
    renderer.unmount();
  });

  it('keeps Replay available for Done and does not turn Skip for now into Done', async () => {
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><GuideHost /></ContextualGuideProvider>); });
    await press(renderer, 'Open To Do checklist');
    await press(renderer, 'Replay Work through tasks guide');
    await vi.waitFor(() => expect(state.start).toHaveBeenCalledWith('tasks'));
    await vi.waitFor(() => expect(text(renderer)).toContain('Step 1 of 3'));
    await act(async () => { renderer.unmount(); });

    state.pathname = '/profile';
    let skipped!: Renderer;
    await act(async () => { skipped = TestRenderer.create(<ContextualGuideProvider><GuideHost /></ContextualGuideProvider>); });
    await press(skipped, 'Open To Do checklist');
    await press(skipped, 'Start Your profile guide');
    await vi.waitFor(() => expect(state.start).toHaveBeenCalledWith('profile'));
    await vi.waitFor(() => expect(text(skipped)).toContain('Step 1 of 3'));
    await press(skipped, 'Skip for now');
    expect(state.skip).toHaveBeenCalledWith('profile');
    expect(state.complete).not.toHaveBeenCalled();
    await act(async () => { skipped.unmount(); });
  });

  it('per-screen Help launches the registry guide for its screen', async () => {
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><GuideHelpButton guideId="profile" /></ContextualGuideProvider>); });
    await press(renderer, 'Open profile guide');
    await vi.waitFor(() => expect(state.start).toHaveBeenCalledWith('profile'));
    expect(state.push).toHaveBeenCalledWith('/profile');
    await act(async () => { renderer.unmount(); });
  });

  it('auto-hides when every eligible guide is done or familiar, and remains rediscoverable', async () => {
    state.progress = Object.fromEntries(GUIDE_REGISTRY.map((guide) => [guide.id, {
      guideId: guide.id, guideVersion: guide.version, status: guide.id === 'profile' ? 'familiar' : 'done',
      currentStep: 0, firstEligibleAt: 'now', acknowledgedAt: 'now', completedAt: 'now',
    }]));
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><GuideHost /></ContextualGuideProvider>); });
    await press(renderer, 'Open To Do checklist');
    expect(renderer.root.findAllByProps({ testID: 'guide-checklist-panel' })).toHaveLength(1);
    expect(text(renderer)).toContain('Familiar');
    await act(async () => { renderer.update(<ContextualGuideProvider><GuideHost /></ContextualGuideProvider>); });
    await press(renderer, 'Close checklist');
    await press(renderer, 'Open To Do checklist');
    expect(renderer.root.findAllByProps({ testID: 'guide-checklist-panel' })).toHaveLength(1);
    renderer.unmount();
  });
});
