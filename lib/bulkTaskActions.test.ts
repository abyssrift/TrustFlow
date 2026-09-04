import { describe, expect, it, vi } from 'vitest';

// bulkTaskActions.ts imports the real supabase client (react-native /
// AsyncStorage under the hood), which vitest's plain Node environment can't
// parse (Flow syntax) -- this file only exercises the pure helpers below, so
// stub the client rather than pull that chain in, same as uploadHelpers.test.ts.
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: vi.fn(), from: vi.fn() } }));

const { runSequential, summarizeBulkOutcome } = await import('./bulkTaskActions');

describe('runSequential', () => {
  it('resolves succeeded ids in call order', async () => {
    const outcome = await runSequential(['a', 'b', 'c'], async () => {});
    expect(outcome).toEqual({ succeededIds: ['a', 'b', 'c'], failed: [] });
  });

  it('isolates a failure so the rest of the batch still runs', async () => {
    const outcome = await runSequential(['a', 'b', 'c'], async (id) => {
      if (id === 'b') throw new Error('nope');
    });
    expect(outcome.succeededIds).toEqual(['a', 'c']);
    expect(outcome.failed).toEqual([{ id: 'b', message: 'nope' }]);
  });

  it('falls back to a generic message when the thrown error has none', async () => {
    const outcome = await runSequential(['a'], async () => { throw {}; });
    expect(outcome.failed).toEqual([{ id: 'a', message: 'Unknown error' }]);
  });

  it('runs sequentially, not in parallel', async () => {
    const order: string[] = [];
    await runSequential(['a', 'b'], async (id) => {
      order.push(`start:${id}`);
      await new Promise(r => setTimeout(r, id === 'a' ? 10 : 0));
      order.push(`end:${id}`);
    });
    // If these ran in parallel, 'b' (no delay) would finish before 'a' ends.
    expect(order).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
  });
});

describe('summarizeBulkOutcome', () => {
  it('all succeeded', () => {
    const msg = summarizeBulkOutcome({ succeededIds: ['a', 'b'], failed: [] }, 'Archived');
    expect(msg).toBe('Archived 2 tasks.');
  });

  it('all failed', () => {
    const msg = summarizeBulkOutcome(
      { succeededIds: [], failed: [{ id: 'a', message: 'x' }] },
      'Archived',
    );
    expect(msg).toBe('No tasks were archived (1 selected).');
  });

  it('partial success', () => {
    const msg = summarizeBulkOutcome(
      { succeededIds: ['a'], failed: [{ id: 'b', message: 'x' }] },
      'Archived',
    );
    expect(msg).toBe('Archived 1 of 2 tasks — 1 failed.');
  });
});
