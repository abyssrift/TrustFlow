import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

let authStateChange: ((event: string, session: any) => void) | undefined;
let currentProfile: { id: string; company_id: string } | null = null;
let analyticsResponse: unknown = [];
const rpc = vi.fn();

const supabase = {
  auth: {
    getSession: vi.fn(),
    onAuthStateChange: vi.fn(),
    signOut: vi.fn(),
  },
  from: vi.fn(),
  rpc,
};

vi.mock('@/lib/supabase', () => ({
  supabase,
  setAuthErrorCallback: vi.fn(),
}));

const { AuthProvider, useAuth } = await import('./AuthContext');
const { AnalyticsProvider, useAnalytics } = await import('./AnalyticsContext');

type AnalyticsApi = ReturnType<typeof useAnalytics>;
type Pulse = {
  daily_points: number;
  monthly_points: number;
  active_seconds_today: number;
  flap_rate_score: number;
  is_working: boolean;
};

function defer<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function MountedAnalytics() {
  let analytics: AnalyticsApi | null = null;
  let userId: string | null = null;
  let companyId: string | null = null;

  function Probe() {
    analytics = useAnalytics();
    const auth = useAuth();
    userId = auth.user?.id ?? null;
    companyId = auth.profile?.company_id ?? null;
    return null;
  }

  return { tree: <AuthProvider><AnalyticsProvider><Probe /></AnalyticsProvider></AuthProvider>,
    getAnalytics: () => analytics!, getScope: () => ({ userId, companyId }) };
}

describe('AnalyticsProvider authorization-scoped cache', () => {
  beforeEach(() => {
    authStateChange = undefined;
    currentProfile = null;
    analyticsResponse = [];
    rpc.mockReset();
    supabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    supabase.auth.onAuthStateChange.mockImplementation((_callback: unknown) => {
      authStateChange = _callback as (event: string, session: any) => void;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    supabase.from.mockImplementation(() => ({
      select: () => ({
        eq: (_column: string, userId: string) => ({
          single: async () => ({
            data: currentProfile?.id === userId ? currentProfile : null,
            error: null,
          }),
        }),
      }),
    }));
    rpc.mockImplementation(async (name: string) => {
      if (name === 'get_my_permissions' || name === 'get_my_roles') {
        return { data: [], error: null };
      }
      if (name === 'rpc_touch_last_seen') return { data: null, error: null };
      return { data: analyticsResponse, error: null };
    });
  });

  async function mountFor(userId: string, companyId: string) {
    currentProfile = { id: userId, company_id: companyId };
    const mounted = MountedAnalytics();
    let renderer!: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(mounted.tree);
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    await switchScope(userId, companyId);
    return { ...mounted, renderer };
  }

  async function switchScope(userId: string, companyId: string) {
    currentProfile = { id: userId, company_id: companyId };
    await act(async () => {
      authStateChange?.('SIGNED_IN', { user: { id: userId, email: `${userId}@example.test` } });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  }

  it('does not serve user A/company A cache data after switching to user B/company B', async () => {
    const mounted = await mountFor('user-a', 'company-a');
    analyticsResponse = [{ stage_id: 'from-a' }];
    await expect(mounted.getAnalytics().getPortfolioWipByStage(null)).resolves.toEqual([
      { stage_id: 'from-a' },
    ]);

    await switchScope('user-b', 'company-b');
    expect(mounted.getScope()).toEqual({ userId: 'user-b', companyId: 'company-b' });
    analyticsResponse = [{ stage_id: 'from-b' }];
    await expect(mounted.getAnalytics().getPortfolioWipByStage(null)).resolves.toEqual([
      { stage_id: 'from-b' },
    ]);
    expect(rpc.mock.calls.filter(([name]) => name === 'rpc_portfolio_wip_by_stage')).toHaveLength(2);
    await act(async () => mounted.renderer.unmount());
  });

  it('discards a scope-A in-flight response without poisoning the scope-B cache', async () => {
    const mounted = await mountFor('user-a', 'company-a');
    const oldResponse = defer<Pulse>();
    const newResponse = defer<Pulse>();
    rpc.mockImplementation((name: string) => {
      if (name === 'rpc_get_personal_pulse') {
        return (rpc.mock.calls.filter(([callName]) => callName === name).length === 1
          ? oldResponse.promise
          : newResponse.promise).then(data => ({ data, error: null }));
      }
      if (name === 'get_my_permissions' || name === 'get_my_roles') return Promise.resolve({ data: [], error: null });
      if (name === 'rpc_touch_last_seen') return Promise.resolve({ data: null, error: null });
      return Promise.resolve({ data: analyticsResponse, error: null });
    });

    let oldRequest!: Promise<unknown>;
    await act(async () => {
      oldRequest = mounted.getAnalytics().getPersonalPulse();
      await Promise.resolve();
    });
    await switchScope('user-b', 'company-b');
    expect(mounted.getScope()).toEqual({ userId: 'user-b', companyId: 'company-b' });
    let newRequest!: Promise<unknown>;
    await act(async () => {
      newRequest = mounted.getAnalytics().getPersonalPulse();
      await Promise.resolve();
    });

    newResponse.resolve({ daily_points: 22, monthly_points: 0, active_seconds_today: 0, flap_rate_score: 0, is_working: false });
    await expect(newRequest).resolves.toMatchObject({ daily_points: 22 });
    oldResponse.resolve({ daily_points: 11, monthly_points: 0, active_seconds_today: 0, flap_rate_score: 0, is_working: false });
    await expect(oldRequest).rejects.toThrow(/authorization context changed/);
    await expect(mounted.getAnalytics().getPersonalPulse()).resolves.toMatchObject({ daily_points: 22 });
    expect(rpc.mock.calls.filter(([name]) => name === 'rpc_get_personal_pulse')).toHaveLength(2);
    await act(async () => mounted.renderer.unmount());
  });

  it('retains same-scope cache hits and supports logical-prefix invalidation', async () => {
    const mounted = await mountFor('user-a', 'company-a');
    analyticsResponse = [{ stage_id: 'cached' }];
    await mounted.getAnalytics().getPortfolioWipByStage('pipeline-a');
    await mounted.getAnalytics().getPortfolioWipByStage('pipeline-a');
    expect(rpc.mock.calls.filter(([name]) => name === 'rpc_portfolio_wip_by_stage')).toHaveLength(1);

    mounted.getAnalytics().invalidate('portfolio_wip:');
    analyticsResponse = [{ stage_id: 'fresh' }];
    await expect(mounted.getAnalytics().getPortfolioWipByStage('pipeline-a')).resolves.toEqual([
      { stage_id: 'fresh' },
    ]);
    expect(rpc.mock.calls.filter(([name]) => name === 'rpc_portfolio_wip_by_stage')).toHaveLength(2);
    await act(async () => mounted.renderer.unmount());
  });
});
