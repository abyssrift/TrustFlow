import { describe, expect, it } from 'vitest';
import { runBulk, summarizeBulk } from './bulkTaskActions';

describe('runBulk', () => {
  it('runs the op for every id, in order', async () => {
    const seen: string[] = [];
    const out = await runBulk(['a', 'b', 'c'], async (id) => { seen.push(id); });
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(out.ok).toEqual(['a', 'b', 'c']);
    expect(out.failed).toEqual([]);
  });

  it('isolates failures — one throw does not abort the rest', async () => {
    const out = await runBulk(['a', 'b', 'c'], async (id) => {
      if (id === 'b') throw new Error('locked');
    });
    expect(out.ok).toEqual(['a', 'c']);
    expect(out.failed).toEqual([{ id: 'b', error: 'locked' }]);
  });

  it('is sequential (no overlap between ops)', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await runBulk(['a', 'b', 'c'], async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
    });
    expect(maxInFlight).toBe(1);
  });
});

describe('summarizeBulk', () => {
  it('all succeeded', () => {
    expect(summarizeBulk({ ok: ['a', 'b'], failed: [] }, 'Archived')).toBe('Archived 2 tasks.');
    expect(summarizeBulk({ ok: ['a'], failed: [] }, 'Archived')).toBe('Archived 1 task.');
  });

  it('all failed', () => {
    expect(summarizeBulk({ ok: [], failed: [{ id: 'a', error: 'nope' }] }, 'Moved'))
      .toBe('Moved 0 of 1 — all failed: nope');
  });

  it('partial', () => {
    expect(summarizeBulk({ ok: ['a', 'b'], failed: [{ id: 'c', error: 'timer running' }] }, 'Archived'))
      .toBe('Archived 2 of 3. 1 failed — e.g. timer running');
  });
});
