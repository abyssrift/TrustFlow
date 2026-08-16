/**
 * Issue #194 — one bounded page per stage column for the task board.
 *
 * Both task boards (`components/tabs/_tasks_desktop.tsx` and
 * `_tasks_adaptive.tsx`) used to fetch an entire pipeline's tasks in one
 * unbounded `from('tasks').select(...)` and bucket them into columns at render
 * time. At ~500 tasks on one real board that is a visibly slow first paint.
 *
 * This is the same shape `components/projects/ProjectBoard.tsx` already uses
 * for the project board (#176): PAGE_SIZE rows per stage, one request per
 * stage fetched in parallel, a manual "Show N more" per column, and a `N+`
 * count badge instead of an exact full-scan count. The constant is deliberately
 * the same 30.
 *
 * NO NEW RPC, AND NO CHANGE TO AN EXISTING ONE. ProjectBoard extends
 * `rpc_projects_table` because the project card's data (weighted progress, days
 * in stage) is *derived* and has to have one definition. The task board has no
 * RPC at all — it is a plain PostgREST select, and PostgREST already paginates
 * with `Range` headers via `.range()`. Adding an RPC here would be inventing a
 * second definition of "a task row" for no gain (see
 * `.agents/rules/global-utilities-index.md`, first rule).
 *
 * WHY THE FILTERS MOVED SERVER-SIDE TOO: with a bounded page, a client-side
 * `tasks.filter(...)` only ever narrows the 30 rows already in memory, so
 * searching a 500-task board would silently miss matches on page 2. Every
 * filter that is a plain column predicate is pushed into the query here so a
 * page is a page *of matching rows*. Each board still re-applies the same
 * predicates at render — that stays correct (it is now a no-op subset) and it
 * keeps covering the rows those boards load outside these pages, i.e. the
 * pinned running-timer / just-moved tasks.
 *
 * `mineOnly` is the one filter NOT pushed down: it is an OR across the parent
 * row (`manager_id`) and an embedded resource (`task_assignments`), which
 * PostgREST cannot express in one request without first materialising a task-id
 * list. ponytail: mineOnly stays a client-side narrowing of the loaded pages —
 * push it down (resolve my assigned task ids, then `id.in.(...)`) only if
 * someone reports "Mine" looking short on a big board.
 *
 * The `assigned_only` visibility mode is NOT re-filtered here or by the boards
 * any more: `tasks_select_visibility` (RLS) already enforces exactly that rule
 * — same created_by / manager_id / assignment / team predicate — so the page
 * the server returns is already visibility-filtered. Re-filtering it in the
 * client is what would make a bounded page ragged (30 fetched, 3 shown).
 */

export const TASK_PAGE_SIZE = 30;

/** Per-column paging cursor. `offset` is the offset of the LAST page fetched. */
export type ColumnPage = { offset: number; hasMore: boolean; loading: boolean };

export const emptyColumnPage = (): ColumnPage => ({ offset: 0, hasMore: false, loading: false });

export type BoardFilters = {
  priorities: string[];
  categories: string[];
  projectIds: string[];
  managerIds: string[];
  dueDates: string[];
  /** Title search. Trimmed; empty means "no search". */
  search?: string;
};

export const NO_BOARD_FILTERS: BoardFilters = {
  priorities: [], categories: [], projectIds: [], managerIds: [], dueDates: [], search: '',
};

/**
 * The board's four due-date buckets as one PostgREST `or=` clause.
 *
 * Mirrors each board's `getDueBucket()` exactly, including that its day
 * boundaries are LOCAL midnight, not UTC (see commit b3a85cc — the same trap
 * bit the KPI date ranges). Buckets, in `getDueBucket` terms:
 *   none    → due_date IS NULL
 *   overdue → due_date <  today 00:00
 *   today   → today 00:00 <= due_date < tomorrow 00:00
 *   week    → tomorrow 00:00 <= due_date < today+8d 00:00   (diffDays 1..7)
 * Returns null when nothing is selected, or when every bucket is selected and
 * the clause could only be noise.
 */
export function dueDateOrClause(buckets: string[], now: Date = new Date()): string | null {
  if (!buckets || buckets.length === 0) return null;
  const day = (offsetDays: number) => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString();
  };
  const t0 = day(0), t1 = day(1), t8 = day(8);
  const parts: string[] = [];
  if (buckets.includes('none')) parts.push('due_date.is.null');
  if (buckets.includes('overdue')) parts.push(`due_date.lt.${t0}`);
  if (buckets.includes('today')) parts.push(`and(due_date.gte.${t0},due_date.lt.${t1})`);
  if (buckets.includes('week')) parts.push(`and(due_date.gte.${t1},due_date.lt.${t8})`);
  return parts.length > 0 ? parts.join(',') : null;
}

/**
 * Turn a `from('tasks').select(...).eq(pipeline).eq(stage)` builder into one
 * bounded, filtered, newest-first page.
 *
 * The caller supplies the builder (and therefore its own column list — the
 * desktop board asks for submission/comment counts, the adaptive one doesn't,
 * and that difference is theirs to keep). Keeping supabase out of this module
 * is what lets the bucket/merge logic have a plain vitest self-check, matching
 * every other tested helper in lib/.
 */
export function stagePageQuery(query: any, offset: number, filters: BoardFilters = NO_BOARD_FILTERS) {
  let q = query;

  if (filters.priorities.length > 0) q = q.in('priority', filters.priorities);
  if (filters.categories.length > 0) q = q.in('category', filters.categories);
  if (filters.projectIds.length > 0) q = q.in('project_id', filters.projectIds);
  if (filters.managerIds.length > 0) q = q.in('manager_id', filters.managerIds);
  const due = dueDateOrClause(filters.dueDates);
  if (due) q = q.or(due);
  const search = (filters.search || '').trim();
  // idx_tasks_title_trgm covers this. `%` and `,` would be read as PostgREST
  // syntax inside the pattern, so they're stripped rather than escaped.
  if (search) q = q.ilike('title', `%${search.replace(/[%,()]/g, ' ')}%`);

  // `id` is a tiebreaker, not decoration: OFFSET paging needs a TOTAL order or
  // it repeats and — worse — silently SKIPS rows. `created_at` alone is not
  // one. Verified against this repo's local data, where all 462 tasks in one
  // stage share a single `created_at` to the microsecond (bulk seeds and the
  // task importer both do that), which made page 1 and page 2 overlap. The
  // repeat would have been absorbed by mergeTasksById; the row it skipped
  // instead would just never have appeared on the board.
  return q
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + TASK_PAGE_SIZE - 1);
}

/**
 * Merge a freshly-fetched batch into the board's flat task array, keyed by id.
 *
 * This is what makes "a task moved between two paginated columns" safe. The
 * boards keep ONE flat `tasks` array and bucket by `current_stage_id` at render
 * time, so a move is a field update on a row that is already in memory: it can
 * never vanish (nothing is removed) and can never duplicate (one entry per id,
 * and a refetch replaces in place rather than appending). Offset paging over a
 * column whose membership just changed can hand back a row that is already
 * loaded — that repeat dies here.
 */
export function mergeTasksById<T extends { id: string }>(base: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return base;
  const byId = new Map(incoming.map(t => [t.id, t]));
  const merged = base.map(t => byId.get(t.id) ?? t);
  const seen = new Set(base.map(t => t.id));
  return merged.concat(incoming.filter(t => !seen.has(t.id)));
}

/**
 * The ids that must stay loaded regardless of which page they'd fall on:
 * the task this user's timer is running on, plus anything they (or a teammate)
 * just moved between columns. Without this, the ~500ms reconcile refetch after
 * a move re-fetches page 0 of every column and silently drops a card that
 * landed outside its new column's first page.
 *
 * ponytail: capped FIFO, newest kept — it feeds an `id.in.(...)` list and a URL
 * has a length limit. 50 moves per session before the oldest stops being
 * force-loaded; the row is still correct on any full reload that happens to
 * page over it. Switch to keyset paging if that ceiling is ever reached in anger.
 */
export const PINNED_TASK_LIMIT = 50;

export function addPinnedTaskId(pinned: string[], id: string | null | undefined): string[] {
  if (!id) return pinned;
  const next = pinned.filter(p => p !== id);
  next.push(id);
  return next.length > PINNED_TASK_LIMIT ? next.slice(next.length - PINNED_TASK_LIMIT) : next;
}
