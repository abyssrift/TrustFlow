import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GUIDE_REGISTRY, GuideDefinition, GuideProgress } from '../lib/contextualGuides';
import { useGuideProgress } from './useGuideProgress';

type Renderer = ReturnType<typeof TestRenderer.create>;

const auth = vi.hoisted(() => ({ userId: 'account-a' as string | null, companyId: 'company-a' as string | null, profileReady: true }));
const rpc = vi.hoisted(() => vi.fn());
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: auth.userId ? { id: auth.userId } : null, initialized: true, permissionsLoaded: true, profile: auth.profileReady ? { company_id: auth.companyId } : null }) }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
  setItem: vi.fn(async (key: string, value: string) => { storage.set(key, value); }),
  removeItem: vi.fn(async (key: string) => { storage.delete(key); }),
} }));

function mount(definitions: readonly GuideDefinition[] = GUIDE_REGISTRY.filter((guide) => guide.id === 'tasks')) {
  let result!: ReturnType<typeof useGuideProgress>;
  function Harness() { result = useGuideProgress(definitions); return null; }
  let renderer!: Renderer;
  act(() => { renderer = TestRenderer.create(React.createElement(Harness)); });
  return { get result() { return result; }, rerender() { act(() => renderer.update(React.createElement(Harness))); }, unmount() { act(() => renderer.unmount()); } };
}

const row = (status = 'not_started', current_step = 0): any => ({
  guide_id: 'tasks', guide_version: 1, status, current_step,
  first_eligible_at: '2026-01-01T00:00:00Z', acknowledged_at: null,
  completed_at: null, updated_at: '2026-01-01T00:00:00Z',
});

describe('useGuideProgress', () => {
  beforeEach(() => { auth.userId = 'account-a'; auth.companyId = 'company-a'; auth.profileReady = true; storage.clear(); rpc.mockReset().mockResolvedValue({ data: [row()], error: null }); });

  it('syncs exact eligible guide payload and parses snake_case account rows', async () => {
    const hook = mount();
    await act(async () => {});
    expect(rpc).toHaveBeenCalledWith('rpc_sync_user_guide_progress', { p_guides: [{ guide_id: 'tasks', guide_version: 1 }] });
    expect(hook.result.progressById.tasks).toMatchObject({ guideId: 'tasks', guideVersion: 1, status: 'not_started', currentStep: 0, firstEligibleAt: row().first_eligible_at });
    hook.unmount();
  });

  it('clears hydrated rows immediately when the account changes', async () => {
    const hook = mount();
    await act(async () => {});
    expect(hook.result.progressById.tasks).toBeDefined();
    rpc.mockResolvedValueOnce({ data: [], error: null });
    auth.userId = 'account-b';
    await act(async () => { hook.rerender(); });
    expect(hook.result.progressById.tasks).toBeUndefined();
    hook.unmount();
  });

  it('ignores a late hydration response from the previous account', async () => {
    let resolveA!: (value: any) => void;
    rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveA = resolve; }));
    const hook = mount();
    auth.userId = 'account-b';
    rpc.mockResolvedValueOnce({ data: [{ ...row(), current_step: 1 }], error: null });
    await act(async () => { hook.rerender(); });
    expect(hook.result.progressById.tasks?.currentStep).toBe(1);
    await act(async () => { resolveA({ data: [{ ...row(), status: 'done', completed_at: '2026-03-01T00:00:00Z' }], error: null }); });
    expect(hook.result.progressById.tasks?.status).toBe('not_started');
    expect(hook.result.progressById.tasks?.currentStep).toBe(1);
    hook.unmount();
  });

  it('clears progress on a company switch and ignores the previous workspace response', async () => {
    let resolveCompanyA!: (value: any) => void;
    rpc.mockImplementationOnce(() => new Promise((resolve) => { resolveCompanyA = resolve; }));
    const hook = mount();
    auth.companyId = 'company-b';
    rpc.mockResolvedValueOnce({ data: [{ ...row(), current_step: 1 }], error: null });
    await act(async () => { hook.rerender(); });
    expect(hook.result.progressById.tasks?.currentStep).toBe(1);
    await act(async () => { resolveCompanyA({ data: [{ ...row('done', 1), completed_at: '2026-03-01T00:00:00Z' }], error: null }); });
    expect(hook.result.progressById.tasks?.status).toBe('not_started');
    expect(hook.result.progressById.tasks?.currentStep).toBe(1);
    hook.unmount();
  });

  it('does not hydrate or write without a current workspace', async () => {
    auth.companyId = null;
    const hook = mount();
    await act(async () => {});
    expect(rpc).not.toHaveBeenCalled();
    await act(async () => { await expect(hook.result.start('tasks')).rejects.toThrow(); });
    expect(rpc).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('ignores malformed or unknown rows and validates all persisted fields', async () => {
    rpc.mockResolvedValueOnce({ data: [
      row('not_started'),
      { ...row(), guide_id: 'invented' },
      { ...row(), guide_version: 0 },
      { ...row(), current_step: 1.5 },
      { ...row(), first_eligible_at: 'yesterday' },
      { ...row(), status: 'done' },
      { ...row(), status: 'in_progress', completed_at: '2026-01-01T00:00:00Z' },
    ], error: null });
    const hook = mount();
    await act(async () => {});
    expect(hook.result.progressById.tasks?.status).toBe('not_started');
    expect(hook.result.progressById).not.toHaveProperty('invented');
    rpc.mockResolvedValueOnce({ data: [{ ...row(), current_step: 100 }], error: null });
    await act(async () => { await hook.result.retry(); });
    expect(hook.result.progressById.tasks?.currentStep).toBe(2);
    hook.unmount();
  });

  it('preserves Done and its completion record when replaying or saving steps', async () => {
    const completed = { ...row('done', 1), acknowledged_at: '2026-02-01T00:00:00Z', completed_at: '2026-02-02T00:00:00Z' };
    rpc.mockResolvedValueOnce({ data: [completed], error: null });
    const hook = mount();
    await act(async () => {});
    rpc.mockImplementation(async (_name: string, args: any) => ({ data: [{ ...completed, current_step: args.p_current_step }], error: null }));
    await act(async () => { await hook.result.start('tasks'); });
    expect(rpc).toHaveBeenLastCalledWith('rpc_update_user_guide_progress', expect.objectContaining({ p_status: 'done', p_current_step: 1 }));
    await act(async () => { await hook.result.saveStep('tasks', 0); });
    expect(rpc).toHaveBeenLastCalledWith('rpc_update_user_guide_progress', expect.objectContaining({ p_status: 'done', p_current_step: 0 }));
    expect(hook.result.progressById.tasks?.completedAt).toBe(completed.completed_at);
    hook.unmount();
  });

  it('uses generic load and save errors and preserves same-account rows on retry failure', async () => {
    const hook = mount();
    await act(async () => {});
    const before = hook.result.progressById.tasks;
    rpc.mockResolvedValueOnce({ data: null, error: new Error('SECRET backend detail') });
    await act(async () => { await hook.result.retry(); });
    expect(hook.result.progressById.tasks).toEqual(before);
    expect(hook.result.error).not.toContain('SECRET');
    rpc.mockResolvedValueOnce({ data: null, error: new Error('SECRET write detail') });
    await act(async () => { await hook.result.start('tasks'); });
    expect(hook.result.error).not.toContain('SECRET');
    expect(hook.result.fallbackActive).toBe(true);
    hook.unmount();
  });

  it('writes start, resumable step, skip, and completion through the RPC contract', async () => {
    rpc.mockResolvedValue({ data: [row()], error: null });
    const hook = mount();
    await act(async () => {});
    rpc.mockImplementation(async (_name: string, args: any) => ({ data: [{ ...row(args.p_status, args.p_current_step), acknowledged_at: args.p_acknowledge ? '2026-02-01T00:00:00Z' : null, completed_at: args.p_status === 'done' ? '2026-02-01T00:00:00Z' : null }], error: null }));
    await act(async () => { await hook.result.start('tasks'); });
    expect(rpc).toHaveBeenLastCalledWith('rpc_update_user_guide_progress', { p_guide_id: 'tasks', p_guide_version: 1, p_status: 'in_progress', p_current_step: 0, p_acknowledge: true });
    await act(async () => { await hook.result.saveStep('tasks', 99); });
    expect(rpc).toHaveBeenLastCalledWith('rpc_update_user_guide_progress', { p_guide_id: 'tasks', p_guide_version: 1, p_status: 'in_progress', p_current_step: 2, p_acknowledge: true });
    const beforeSkip = hook.result.progressById.tasks;
    await act(async () => { await hook.result.skip('tasks'); });
    expect(rpc).toHaveBeenLastCalledWith('rpc_update_user_guide_progress', { p_guide_id: 'tasks', p_guide_version: 1, p_status: 'familiar', p_current_step: 0, p_acknowledge: true });
    expect(beforeSkip?.status).toBe('in_progress');
    await act(async () => { await hook.result.complete('tasks'); });
    expect(rpc).toHaveBeenLastCalledWith('rpc_update_user_guide_progress', { p_guide_id: 'tasks', p_guide_version: 1, p_status: 'familiar', p_current_step: 0, p_acknowledge: true });
    hook.unmount();
  });

  it('acknowledges a newly eligible guide without starting or completing it', async () => {
    const hook = mount();
    await act(async () => {});
    rpc.mockImplementation(async (_name: string, args: any) => ({ data: [{ ...row(args.p_status, args.p_current_step), acknowledged_at: '2026-02-01T00:00:00Z' }], error: null }));
    await act(async () => { await hook.result.acknowledge('tasks'); });
    expect(rpc).toHaveBeenLastCalledWith('rpc_update_user_guide_progress', expect.objectContaining({ p_status: 'not_started', p_current_step: 0, p_acknowledge: true }));
    expect(hook.result.progressById.tasks).toMatchObject({ status: 'not_started', acknowledgedAt: '2026-02-01T00:00:00Z', completedAt: null });
    hook.unmount();
  });

  it('parses catalog additions dynamically and keeps familiar distinct from done', async () => {
    const familiar = { ...row('familiar'), acknowledged_at: '2026-02-01T00:00:00Z' };
    rpc.mockResolvedValueOnce({ data: [familiar, { ...familiar, guide_id: 'intelligence' }], error: null });
    const hook = mount();
    await act(async () => {});
    expect(hook.result.progressById.tasks?.status).toBe('familiar');
    expect(hook.result.progressById.intelligence?.status).toBe('familiar');
    hook.unmount();
  });

  it('synchronizes every catalog guide and keeps Familiar terminal during replay writes', async () => {
    const definitions = GUIDE_REGISTRY;
    rpc.mockResolvedValueOnce({ data: definitions.map((guide) => ({
      ...row('familiar'), guide_id: guide.id, guide_version: guide.version,
      acknowledged_at: '2026-02-01T00:00:00Z',
    })), error: null });
    const hook = mount(definitions);
    await act(async () => {});
    expect(rpc).toHaveBeenCalledWith('rpc_sync_user_guide_progress', {
      p_guides: definitions.map(({ id, version }) => ({ guide_id: id, guide_version: version })),
    });
    expect(Object.keys(hook.result.progressById).sort()).toEqual(definitions.map(({ id }) => id).sort());

    rpc.mockImplementation(async (_name: string, args: any) => ({
      data: [{
        ...row(args.p_status, args.p_current_step), guide_id: args.p_guide_id,
        guide_version: args.p_guide_version, acknowledged_at: '2026-02-01T00:00:00Z',
        completed_at: args.p_status === 'done' ? '2026-02-01T00:00:00Z' : null,
      }], error: null,
    }));
    await act(async () => { await hook.result.start('tasks'); });
    expect(rpc).toHaveBeenLastCalledWith('rpc_update_user_guide_progress', expect.objectContaining({ p_guide_id: 'tasks', p_status: 'familiar', p_current_step: 0 }));
    await act(async () => { await hook.result.saveStep('tasks', 2); });
    expect(rpc).toHaveBeenLastCalledWith('rpc_update_user_guide_progress', expect.objectContaining({ p_guide_id: 'tasks', p_status: 'familiar', p_current_step: 0 }));
    hook.unmount();
  });

  it('preserves visible progress when a write is rejected and exposes a useful error', async () => {
    const hook = mount();
    await act(async () => {});
    const before = hook.result.progressById.tasks as GuideProgress;
    rpc.mockResolvedValue({ data: null, error: new Error('network unavailable') });
    let saved!: Awaited<ReturnType<typeof hook.result.start>>;
    await act(async () => { saved = await hook.result.start('tasks'); });
    expect(saved.status).toBe('in_progress');
    expect(hook.result.progressById.tasks?.firstEligibleAt).toBe(before.firstEligibleAt);
    expect(hook.result.error).toMatch(/network|retry|save/i);
    hook.unmount();
  });

  it('seeds local progress for every eligible guide when sync fails', async () => {
    const definitions = GUIDE_REGISTRY;
    rpc.mockRejectedValueOnce(new Error('private backend detail'));
    const hook = mount(definitions);
    await act(async () => {});
    expect(Object.keys(hook.result.progressById).sort()).toEqual(definitions.map(({ id }) => id).sort());
    expect(hook.result.fallbackActive).toBe(true);
    expect(hook.result.error).toMatch(/cloud|sync|retry/i);
    expect(hook.result.error).not.toContain('private backend detail');
    expect([...storage.keys()]).toEqual([expect.stringMatching(/v\d+.*account-a.*company-a/)]);
    hook.unmount();
  });

  it('persists the local lifecycle and preserves Done and Familiar terminal timestamps', async () => {
    rpc.mockRejectedValueOnce(new Error('offline'));
    const hook = mount();
    await act(async () => {});
    await act(async () => { await hook.result.start('tasks'); });
    expect(hook.result.progressById.tasks?.status).toBe('in_progress');
    await act(async () => { await hook.result.saveStep('tasks', 1); });
    expect(hook.result.progressById.tasks?.currentStep).toBe(1);
    await act(async () => { await hook.result.acknowledge('tasks'); });
    expect(hook.result.progressById.tasks?.acknowledgedAt).toBeTruthy();
    await act(async () => { await hook.result.markFamiliar('tasks'); });
    const familiar = hook.result.progressById.tasks;
    expect(familiar?.status).toBe('familiar');
    expect(familiar?.completedAt).toBeNull();
    await act(async () => { await hook.result.skip('tasks'); });
    expect(hook.result.progressById.tasks?.status).toBe('familiar');
    expect(hook.result.progressById.tasks?.acknowledgedAt).toBe(familiar?.acknowledgedAt);
    expect(JSON.parse([...storage.values()][0]).rows.tasks).toEqual(hook.result.progressById.tasks);
    hook.unmount();

    auth.companyId = 'company-b';
    rpc.mockRejectedValueOnce(new Error('offline'));
    const doneHook = mount();
    await act(async () => {});
    await act(async () => { await doneHook.result.complete('tasks'); });
    const done = doneHook.result.progressById.tasks;
    expect(done?.status).toBe('done');
    expect(done?.completedAt).toBeTruthy();
    await act(async () => { await doneHook.result.saveStep('tasks', 0); });
    expect(doneHook.result.progressById.tasks?.status).toBe('done');
    expect(doneHook.result.progressById.tasks?.completedAt).toBe(done?.completedAt);
    doneHook.unmount();
  });

  it('hydrates a remount from fallback storage scoped to account and workspace', async () => {
    rpc.mockRejectedValueOnce(new Error('offline'));
    const first = mount();
    await act(async () => {});
    await act(async () => { await first.result.saveStep('tasks', 2); });
    first.unmount();
    rpc.mockRejectedValueOnce(new Error('offline'));
    const remount = mount();
    await act(async () => {});
    expect(remount.result.progressById.tasks?.currentStep).toBe(2);
    expect(remount.result.fallbackActive).toBe(true);
    remount.unmount();

    auth.companyId = 'company-b';
    rpc.mockRejectedValueOnce(new Error('offline'));
    const otherWorkspace = mount();
    await act(async () => {});
    expect(otherWorkspace.result.progressById.tasks?.currentStep).toBe(0);
    expect(storage.size).toBe(2);
    otherWorkspace.unmount();
  });

  it('degrades a failed server write locally and returns the applied row', async () => {
    const hook = mount();
    await act(async () => {});
    rpc.mockRejectedValueOnce(new Error('private write detail'));
    let saved!: Awaited<ReturnType<typeof hook.result.start>>;
    await act(async () => { saved = await hook.result.start('tasks'); });
    expect(saved.status).toBe('in_progress');
    expect(hook.result.progressById.tasks).toEqual(saved);
    expect(hook.result.fallbackActive).toBe(true);
    expect(hook.result.error).not.toContain('private write detail');
    expect(storage.size).toBe(1);
    hook.unmount();
  });

  it('refreshes the device cache after a successful server write', async () => {
    const hook = mount();
    await act(async () => {});
    rpc.mockResolvedValueOnce({
      data: [{ ...row('in_progress', 1), acknowledged_at: '2026-02-01T00:00:00Z', updated_at: '2026-02-01T00:00:00Z' }],
      error: null,
    });
    await act(async () => { await hook.result.saveStep('tasks', 1); });
    expect(JSON.parse([...storage.values()][0]).rows.tasks).toEqual(hook.result.progressById.tasks);
    hook.unmount();

    rpc.mockRejectedValueOnce(new Error('offline'));
    const remount = mount();
    await act(async () => {});
    expect(remount.result.progressById.tasks?.currentStep).toBe(1);
    remount.unmount();
  });

  it('rejects malformed scoped fallback data and seeds fresh rows', async () => {
    storage.set('@TrustFlow_guide_progress_v1:account-a:company-a', JSON.stringify({ tasks: { ...row(), currentStep: 'bad' } }));
    rpc.mockRejectedValueOnce(new Error('offline'));
    const hook = mount();
    await act(async () => {});
    expect(hook.result.progressById.tasks?.status).toBe('not_started');
    expect(hook.result.progressById.tasks?.currentStep).toBe(0);
    expect(hook.result.fallbackActive).toBe(true);
    hook.unmount();
  });

  it('retries cloud sync and replaces fallback rows when it recovers', async () => {
    rpc.mockRejectedValueOnce(new Error('offline'));
    const hook = mount();
    await act(async () => {});
    await act(async () => { await hook.result.saveStep('tasks', 2); });
    rpc.mockResolvedValueOnce({ data: [{ ...row('in_progress', 1), updated_at: '2026-04-01T00:00:00Z' }], error: null });
    await act(async () => { await hook.result.retry(); });
    expect(hook.result.progressById.tasks?.currentStep).toBe(1);
    expect(hook.result.fallbackActive).toBe(false);
    expect(hook.result.error).toBeNull();
    expect(rpc).toHaveBeenLastCalledWith('rpc_sync_user_guide_progress', { p_guides: [{ guide_id: 'tasks', guide_version: 1 }] });
    hook.unmount();
  });
});
