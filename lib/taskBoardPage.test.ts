import { describe, expect, it } from 'vitest';
import { addPinnedTaskId, dueDateOrClause, mergeTasksById, PINNED_TASK_LIMIT, stagePageQuery, TASK_PAGE_SIZE } from './taskBoardPage';

// Fixed local noon so the day boundaries below are unambiguous.
const NOW = new Date(2026, 7, 16, 12, 0, 0);
const localMidnight = (offsetDays: number) => {
  const d = new Date(NOW);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString();
};

describe('dueDateOrClause', () => {
  it('is null when nothing is selected', () => {
    expect(dueDateOrClause([], NOW)).toBeNull();
  });

  it('uses LOCAL midnight boundaries, not UTC', () => {
    const clause = dueDateOrClause(['today'], NOW)!;
    expect(clause).toBe(`and(due_date.gte.${localMidnight(0)},due_date.lt.${localMidnight(1)})`);
    // The trap this guards (see commit b3a85cc): a UTC-derived boundary would
    // read 00:00Z, which is a different instant everywhere but UTC.
    expect(clause.includes('T00:00:00.000Z')).toBe(false);
  });

  it('matches getDueBucket: week is tomorrow..+7d, overdue is before today', () => {
    expect(dueDateOrClause(['overdue'], NOW)).toBe(`due_date.lt.${localMidnight(0)}`);
    expect(dueDateOrClause(['week'], NOW)).toBe(`and(due_date.gte.${localMidnight(1)},due_date.lt.${localMidnight(8)})`);
    expect(dueDateOrClause(['none'], NOW)).toBe('due_date.is.null');
  });

  it('ORs several buckets into one clause', () => {
    expect(dueDateOrClause(['none', 'overdue'], NOW)).toBe(`due_date.is.null,due_date.lt.${localMidnight(0)}`);
  });
});

describe('mergeTasksById', () => {
  it('replaces in place and never duplicates — the moved-card hazard', () => {
    const base = [{ id: 'a', stage: 1 }, { id: 'b', stage: 1 }];
    const merged = mergeTasksById(base, [{ id: 'b', stage: 2 }]);
    expect(merged).toEqual([{ id: 'a', stage: 1 }, { id: 'b', stage: 2 }]);
  });

  it('appends rows it has not seen, preserving page order', () => {
    const merged = mergeTasksById([{ id: 'a' }], [{ id: 'b' }, { id: 'c' }]);
    expect(merged.map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('keeps the base array identity when there is nothing to merge', () => {
    const base = [{ id: 'a' }];
    expect(mergeTasksById(base, [])).toBe(base);
  });
});

describe('addPinnedTaskId', () => {
  it('ignores empty ids and de-dupes', () => {
    expect(addPinnedTaskId([], null)).toEqual([]);
    expect(addPinnedTaskId(['a'], 'a')).toEqual(['a']);
  });

  it('evicts oldest past the cap so the id.in.() list stays URL-sized', () => {
    let pinned: string[] = [];
    for (let i = 0; i < PINNED_TASK_LIMIT + 5; i++) pinned = addPinnedTaskId(pinned, `t${i}`);
    expect(pinned).toHaveLength(PINNED_TASK_LIMIT);
    expect(pinned[0]).toBe('t5');
    expect(pinned[pinned.length - 1]).toBe(`t${PINNED_TASK_LIMIT + 4}`);
  });
});

describe('stagePageQuery', () => {
  // Records the builder calls a page makes, so the pushdown is checked without
  // a database: every filter the board applies at render must also reach the
  // server, or a page of 30 would be filtered down to nothing in memory.
  const spyBuilder = () => {
    const calls: string[] = [];
    const q: any = new Proxy({}, {
      get: (_t, prop: string) => (...args: any[]) => {
        calls.push(`${prop}(${args.map(a => JSON.stringify(a)).join(',')})`);
        return q;
      },
    });
    return { q, calls };
  };

  it('pages newest-first with a bounded range', () => {
    const { q, calls } = spyBuilder();
    stagePageQuery(q, 60);
    expect(calls).toContain('order("created_at",{"ascending":false})');
    expect(calls).toContain(`range(60,${60 + TASK_PAGE_SIZE - 1})`);
  });

  // The bug this caught for real: every task in a bulk-seeded stage shares one
  // created_at, so without a tiebreaker the order is not total and OFFSET
  // paging repeats rows AND skips others. Order matters — id must sort after.
  it('breaks created_at ties by id so offset paging is stable', () => {
    const { q, calls } = spyBuilder();
    stagePageQuery(q, 0);
    expect(calls.indexOf('order("id",{"ascending":false})'))
      .toBe(calls.indexOf('order("created_at",{"ascending":false})') + 1);
  });

  it('pushes every column-predicate filter down to the query', () => {
    const { q, calls } = spyBuilder();
    stagePageQuery(q, 0, {
      priorities: ['urgent'], categories: ['ops'], projectIds: ['p1'], managerIds: ['m1'],
      dueDates: ['none'], search: 'ship it',
    });
    expect(calls).toContain('in("priority",["urgent"])');
    expect(calls).toContain('in("category",["ops"])');
    expect(calls).toContain('in("project_id",["p1"])');
    expect(calls).toContain('in("manager_id",["m1"])');
    expect(calls).toContain('or("due_date.is.null")');
    expect(calls).toContain('ilike("title","%ship it%")');
  });

  it('applies no predicates when nothing is filtered', () => {
    const { q, calls } = spyBuilder();
    stagePageQuery(q, 0, { priorities: [], categories: [], projectIds: [], managerIds: [], dueDates: [], search: '  ' });
    expect(calls.filter(c => !c.startsWith('order') && !c.startsWith('range'))).toEqual([]);
  });

  it('neutralises PostgREST syntax inside a search term', () => {
    const { q, calls } = spyBuilder();
    stagePageQuery(q, 0, { ...{ priorities: [], categories: [], projectIds: [], managerIds: [], dueDates: [] }, search: 'a,b(%)' });
    expect(calls).toContain('ilike("title","%a b   %")');
  });
});
