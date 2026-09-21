import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanonicalAnalyticsTargets } from './useCanonicalAnalyticsTargets';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));

function mount(enabled = true) {
  let result!: ReturnType<typeof useCanonicalAnalyticsTargets>;
  let firstRenderedLoading: boolean | undefined;
  function Harness() {
    result = useCanonicalAnalyticsTargets({ enabled });
    firstRenderedLoading ??= result.loading;
    return null;
  }
  let renderer!: ReturnType<typeof TestRenderer.create>;
  act(() => { renderer = TestRenderer.create(React.createElement(Harness)); });
  return {
    get result() { return result; },
    firstRenderedLoading,
    unmount() { act(() => renderer.unmount()); },
  };
}

describe('useCanonicalAnalyticsTargets', () => {
  beforeEach(() => {
    rpc.mockReset().mockResolvedValue({ data: [], error: null });
  });

  it('starts in loading state when enabled before effects run', async () => {
    const hook = mount(true);
    expect(hook.firstRenderedLoading).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(hook.result.loading).toBe(false);
    hook.unmount();
  });

  it('stays idle and makes no RPC call when disabled', () => {
    const hook = mount(false);
    expect(hook.firstRenderedLoading).toBe(false);
    expect(hook.result.loading).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('returns an empty success state when the RPC has no rows', async () => {
    const hook = mount(true);
    await act(async () => {});
    expect(hook.result).toMatchObject({ targets: [], loading: false, error: null });
    hook.unmount();
  });

  it('preserves NULL creation time and observed value from the RPC', async () => {
    rpc.mockResolvedValueOnce({
      data: [{
        id: 'target-1',
        stage_id: 'stage-1',
        stage_name: 'Review',
        pipeline_id: 'pipeline-1',
        pipeline_name: 'Client work',
        target_type: 'volume',
        stored_status: 'active',
        target_quantity: 5,
        target_active_seconds: null,
        target_lifecycle_seconds: null,
        deadline: null,
        created_at: null,
        completed_at: null,
        observed_value: null,
        progress_unit: 'tasks',
      }],
      error: null,
    });
    const hook = mount(true);
    await act(async () => {});
    expect(hook.result.targets[0]).toMatchObject({ createdAt: null, observedValue: null });
    hook.unmount();
  });

  it('exposes RPC failures as an error state', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Target RPC unavailable' } });
    const hook = mount(true);
    await act(async () => {});
    expect(hook.result).toMatchObject({ targets: [], loading: false, error: 'Target RPC unavailable' });
    hook.unmount();
  });
});
