import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GUIDE_REGISTRY } from '@/lib/contextualGuides';

type Renderer = ReturnType<typeof TestRenderer.create>;

const state = vi.hoisted(() => ({
  pathname: '/',
  searchParams: {} as Record<string, string | string[]>,
  owner: true,
  hasAccess: true,
  width: 1024,
  companyId: 'company-1',
  userId: 'user-1',
  initialized: true,
  profileReady: true,
  permissionsLoaded: true,
  progressCompanyId: 'company-1',
  progressLoading: false,
  fallbackActive: false,
  storage: new Map<string, string>(),
  readStorage: async (key: string) => state.storage.get(key) ?? null,
  listeners: new Set<(path: string) => void>(),
  push: vi.fn((route: string) => { const [path, query = ''] = route.split('?'); state.pathname = path; state.searchParams = Object.fromEntries(new URLSearchParams(query)); state.listeners.forEach((listener) => listener(state.pathname)); }),
  progress: {} as Record<string, any>,
  start: vi.fn(async () => undefined),
  saveStep: vi.fn(async () => undefined),
  skip: vi.fn(async () => undefined),
  complete: vi.fn(async () => undefined),
  acknowledge: vi.fn(async () => undefined),
}));

vi.mock('expo-router', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    usePathname: () => { const [path, setPath] = React.useState(state.pathname); React.useEffect(() => { state.listeners.add(setPath); return () => { state.listeners.delete(setPath); }; }, []); return path; },
    useGlobalSearchParams: () => { const [, refresh] = React.useState(0); React.useEffect(() => { const listener = () => refresh((value) => value + 1); state.listeners.add(listener as any); return () => { state.listeners.delete(listener as any); }; }, []); return state.searchParams; },
    useRouter: () => ({ push: state.push }),
  };
});
vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  useWindowDimensions: () => ({ width: state.width, height: 800, scale: 1, fontScale: 1 }),
}));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn((key: string) => state.readStorage(key)),
  setItem: vi.fn(async (key: string, value: string) => { state.storage.set(key, value); }),
} }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: state.userId ? { id: state.userId } : null, profile: state.profileReady ? { is_owner: state.owner, company_id: state.companyId } : null, initialized: state.initialized, permissionsLoaded: state.permissionsLoaded, hasPermission: () => state.hasAccess }) }));
vi.mock('@/hooks/useGuideProgress', () => ({ useGuideProgress: () => ({
  scope: `${state.userId ?? ''}:${state.companyId}`,
  progressById: state.progressCompanyId === state.companyId ? state.progress : {}, loading: state.progressLoading, error: null, retry: vi.fn(), fallbackActive: state.fallbackActive,
  start: state.start, saveStep: state.saveStep, skip: state.skip, complete: state.complete, acknowledge: state.acknowledge,
}) }));

const { ContextualGuideProvider, useContextualGuide } = await import('./ContextualGuideContext');
const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const guide = useContextualGuide();
  return <>{guide.activeGuide?.id ?? 'none'}:{guide.activeStep}:{guide.checklistVisible ? 'open' : 'closed'}</>;
}

describe('ContextualGuideProvider', () => {
  beforeEach(() => {
    state.pathname = '/';
    state.searchParams = {};
    state.owner = true;
    state.hasAccess = true;
    state.width = 1024;
    state.companyId = 'company-1';
    state.userId = 'user-1';
    state.initialized = true;
    state.profileReady = true;
    state.permissionsLoaded = true;
    state.progressLoading = false;
    state.fallbackActive = false;
    state.progressCompanyId = 'company-1';
    state.storage.clear();
    state.readStorage = async (key: string) => state.storage.get(key) ?? null;
    state.listeners.clear();
    state.push.mockReset().mockImplementation((route: string) => { const [path, query = ''] = route.split('?'); state.pathname = path; state.searchParams = Object.fromEntries(new URLSearchParams(query)); state.listeners.forEach((listener) => listener(state.pathname)); });
    state.start.mockReset().mockResolvedValue(undefined);
    state.saveStep.mockReset().mockResolvedValue(undefined);
    state.skip.mockReset().mockResolvedValue(undefined);
    state.complete.mockReset().mockResolvedValue(undefined);
    state.acknowledge.mockReset().mockResolvedValue(undefined);
    state.progress = {};
  });

  it('never auto-opens the checklist; WelcomeTour owns the first-run introduction', async () => {
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    expect(guide!.checklistVisible).toBe(false);
    expect(state.storage.size).toBe(0);
    renderer.unmount();
  });

  it('suspends a guide when the user navigates away and resumes it from the launcher state', async () => {
    state.pathname = '/profile';
    state.progress = { profile: { guideId: 'profile', status: 'in_progress', currentStep: 1, acknowledgedAt: 'now' } };
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    await act(async () => { await guide!.launchGuide('profile'); });
    expect(guide!.suspendedGuide).toBeNull();
    await act(async () => { state.pathname = '/tasks'; state.listeners.forEach((listener) => listener(state.pathname)); });
    expect(guide!.activeGuide).toBeNull();
    expect(guide!.suspendedGuide?.id).toBe('profile');
    let resume!: Promise<void>;
    await act(async () => { resume = guide!.launchGuide(guide!.suspendedGuide!.id); });
    await act(async () => { renderer.update(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    await act(async () => { await resume; });
    expect(state.push).toHaveBeenCalledWith('/profile');
    expect(guide!.activeGuide?.id).toBe('profile');
    expect(guide!.activeStep).toBe(1);
    expect(guide!.suspendedGuide).toBeNull();
    await act(async () => { guide!.closeGuide(); });
    expect(guide!.suspendedGuide).toBeNull();
    renderer.unmount();
  });

  it('skips without writing progress and moves on to the next unfinished guide', async () => {
    state.pathname = '/profile';
    state.progress = { profile: { guideId: 'profile', status: 'in_progress', currentStep: 1, acknowledgedAt: 'now' } };
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    await act(async () => { await guide!.launchGuide('profile'); });
    expect(guide!.followingGuide?.id).toBe('top-bar');
    let skip!: Promise<void>;
    await act(async () => { skip = guide!.skipGuide(); });
    await act(async () => { renderer.update(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    await act(async () => { await skip; });
    expect(state.skip).not.toHaveBeenCalled();
    expect(state.complete).not.toHaveBeenCalled();
    expect(state.push).toHaveBeenCalledWith('/');
    expect(guide!.activeGuide?.id).toBe('top-bar');
    renderer.unmount();
  });

  it('allows only one active guide and resumes its stored step', async () => {
    state.progress = {
      'top-bar': { guideId: 'top-bar', status: 'in_progress', currentStep: 1, acknowledgedAt: 'now' },
      profile: { guideId: 'profile', status: 'not_started', currentStep: 0, acknowledgedAt: null },
    };
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Probe /></ContextualGuideProvider>); });
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    await act(async () => { renderer.update(<ContextualGuideProvider><><Probe /><Actions /></></ContextualGuideProvider>); });
    await act(async () => { await guide!.launchGuide('top-bar'); });
    expect(guide!.activeGuide?.id).toBe('top-bar');
    expect(guide!.activeStep).toBe(1);
    await act(async () => { renderer.update(<ContextualGuideProvider><><Probe /><Actions /></></ContextualGuideProvider>); });
    await act(async () => { state.pathname = '/profile'; state.listeners.forEach((listener) => listener(state.pathname)); });
    await act(async () => { await guide!.launchGuide('profile'); });
    expect(guide!.activeGuide?.id).toBe('profile');
    expect(guide!.activeStep).toBe(0);
    renderer.unmount();
  });

  it('exposes checklist and launch operations through the shared context', async () => {
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    state.pathname = '/profile';
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    await act(async () => { guide!.openChecklist(); });
    expect(guide!.checklistVisible).toBe(true);
    await act(async () => { await guide!.launchGuide('profile'); });
    expect(guide!.activeGuide?.id).toBe('profile');
    expect(state.start).toHaveBeenCalledWith('profile');
    renderer.unmount();
  });

  it('derives the first eligible route guide for the canonical launcher', async () => {
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    state.pathname = '/tasks';
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    expect(guide!.launcherGuide?.id).toBe('tasks');
    state.pathname = '/people';
    state.searchParams = { section: 'teams' };
    await act(async () => { state.listeners.forEach((listener) => listener(state.pathname)); });
    expect(guide!.launcherGuide?.id).toBe('team-people');
    renderer.unmount();
  });

  it('excludes a route guide when its declared query parameter is absent', async () => {
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    state.pathname = '/people';
    state.searchParams = {};
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    expect(guide!.launcherGuide).toBeNull();
    renderer.unmount();
  });

  it('exposes when guide progress is using the device fallback', async () => {
    state.fallbackActive = true;
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    expect(guide!.fallbackActive).toBe(true);
    renderer.unmount();
  });

  it('exposes completion, skip-as-familiar, and new-guide acknowledgement actions', async () => {
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    state.pathname = '/profile';
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    expect(guide!.completeGuide).toEqual(expect.any(Function));
    expect(guide!.markFamiliar).toEqual(expect.any(Function));
    expect(guide!.acknowledgeNewGuide).toEqual(expect.any(Function));
    await act(async () => { await guide!.acknowledgeNewGuide('profile'); });
    expect(state.acknowledge).toHaveBeenCalledWith('profile');
    await act(async () => { await guide!.markFamiliar('profile'); });
    expect(state.skip).toHaveBeenCalledWith('profile');
    await act(async () => { await guide!.completeGuide('profile'); });
    expect(state.complete).toHaveBeenCalledWith('profile');
    renderer.unmount();
  });

  it('exposes catalog phases and auto-hides a checklist when every eligible guide is done or familiar', async () => {
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    expect(guide!.guidePhases.map(({ id }) => id)).toEqual(['start', 'get-work-done', 'organize-workspace', 'understand-results']);
    expect(guide!.guidePhases.reduce((count, phase) => count + phase.guides.length, 0)).toBe(guide!.guideDefinitions.length);
    expect(guide!.checklistComplete).toBe(false);
    await act(async () => { guide!.openChecklist(); });
    state.progress = Object.fromEntries(GUIDE_REGISTRY.map(({ id }) => [id, { guideId: id, status: 'familiar', currentStep: 0, acknowledgedAt: 'now' }]));
    await act(async () => { renderer.update(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    expect(guide!.checklistComplete).toBe(true);
    expect(guide!.checklistVisible).toBe(false);
    renderer.unmount();
  });

  it('marks only newly available capability guides as subtle new items', async () => {
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    expect(guide!.newGuideIds).toEqual([]);
    state.hasAccess = false;
    await act(async () => { renderer.update(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    state.progress = Object.fromEntries(GUIDE_REGISTRY.map(({ id }) => [id, { guideId: id, status: 'not_started', currentStep: 0, acknowledgedAt: null }]));
    state.hasAccess = true;
    await act(async () => { renderer.update(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    expect(guide!.newGuideIds).toContain('projects');
    expect(guide!.newGuideIds).not.toContain('profile');
    state.progress = { ...state.progress, projects: { guideId: 'projects', status: 'familiar', currentStep: 0, acknowledgedAt: 'now' } };
    await act(async () => { renderer.update(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    expect(guide!.newGuideIds).not.toContain('projects');
    renderer.unmount();
  });

  it('derives deadlines eligibility from the current responsive surface', async () => {
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    expect(guide!.guideDefinitions.some(({ id }) => id === 'deadlines')).toBe(false);

    state.width = 390;
    await act(async () => { renderer.update(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    expect(guide!.guideDefinitions.some(({ id }) => id === 'deadlines')).toBe(true);
    renderer.unmount();
  });

  it('cancels an active guide and hides progress when the workspace changes', async () => {
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    state.pathname = '/profile';
    state.progress = { profile: { guideId: 'profile', status: 'in_progress', currentStep: 0, acknowledgedAt: 'now' } };
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    await act(async () => { await guide!.launchGuide('profile'); });
    expect(guide!.activeGuide?.id).toBe('profile');
    state.companyId = 'company-2';
    await act(async () => { renderer.update(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    expect(guide!.activeGuide).toBeNull();
    expect(guide!.progressById).toEqual({});
    renderer.unmount();
  });

  it('uses panel mode immediately when the registered target cannot be measured', async () => {
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    await act(async () => { await guide!.launchGuide('top-bar'); });
    expect(guide!.activeGuide?.id).toBe('top-bar');
    expect(guide!.activeAnchor).toBeNull();
    renderer.unmount();
  });

  it('reopens the checklist and does not start progress when navigation times out', async () => {
    state.pathname = '/';
    state.push.mockImplementation(() => undefined);
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    await act(async () => { await guide!.launchGuide('profile'); });
    expect(guide!.activeGuide).toBeNull();
    expect(guide!.guideError).toBe('Guide could not be opened.');
    expect(guide!.checklistVisible).toBe(true);
    expect(state.start).not.toHaveBeenCalled();
    expect(guide!.activeGuide).toBeNull();
    renderer.unmount();
  });

  it('routes to the declared query section when already on the same pathname', async () => {
    state.pathname = '/people';
    state.searchParams = { section: 'people' };
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    let launch!: Promise<void>;
    await act(async () => { launch = guide!.launchGuide('team-people'); });
    await act(async () => { renderer.update(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    await act(async () => { await launch; });
    expect(state.push).toHaveBeenCalledWith('/people?section=teams');
    expect(guide!.activeGuide?.id).toBe('team-people');
    renderer.unmount();
  });

  it('remeasures the active semantic anchor on registration and falls back when it unregisters', async () => {
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    state.pathname = '/profile';
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    const first = { x: 10, y: 20, width: 30, height: 40 };
    const unregister = guide!.registerAnchor('profile:identity', { measure: async () => first });
    await act(async () => { await guide!.launchGuide('profile'); });
    expect(guide!.activeAnchor).toEqual(first);
    const second = { x: 50, y: 60, width: 70, height: 80 };
    let unregisterSecond!: () => void;
    await act(async () => {
      unregisterSecond = guide!.registerAnchor('profile:identity', { measure: async () => second });
      await guide!.remeasureActiveAnchor();
    });
    expect(guide!.activeAnchor).toEqual(second);
    await act(async () => { unregister(); });
    expect(guide!.activeAnchor).toEqual(second);
    await act(async () => { unregisterSecond(); });
    expect(guide!.activeAnchor).toBeNull();
    renderer.unmount();
  });

  it('cancels an active guide when its navigation surface loses access', async () => {
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    state.pathname = '/people';
    state.searchParams = { section: 'teams' };
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    await act(async () => { await guide!.launchGuide('team-people'); });
    expect(guide!.activeGuide?.id).toBe('team-people');
    await act(async () => { state.owner = false; state.hasAccess = false; renderer.update(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    expect(guide!.activeGuide).toBeNull();
    expect(guide!.checklistVisible).toBe(true);
    renderer.unmount();
  });

  it('keeps a generic retryable error when a progress write fails', async () => {
    state.start.mockRejectedValueOnce(new Error('server detail should stay private'));
    let guide: ReturnType<typeof useContextualGuide> | null = null;
    function Actions() { guide = useContextualGuide(); return null; }
    let renderer!: Renderer;
    state.pathname = '/profile';
    await act(async () => { renderer = TestRenderer.create(<ContextualGuideProvider><Actions /></ContextualGuideProvider>); });
    await act(async () => { await guide!.launchGuide('profile'); });
    expect(guide!.guideError).toBe('Could not save guide progress. Retry your action.');
    expect(guide!.checklistVisible).toBe(true);
    expect(guide!.activeGuide).toBeNull();
    renderer.unmount();
  });
});
