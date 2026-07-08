import type { ActiveSessionUser } from '@/components/task-detail/TaskCardActions';

// Shared stale-while-revalidate cache for the task board, used by both the
// adaptive board (native + web-mobile) and the desktop board. Module scope so
// it survives screen unmounts AND is shared if the layout crosses the desktop
// breakpoint on resize. Session-only, no TTL — every board load refreshes its
// own entry and switching a board triggers a background refetch, so staleness
// is self-correcting. ponytail: plain Map + callback, not React Query.
//
// stages/tasks are `any[]` on purpose: the two boards store slightly different
// task shapes (desktop carries time metrics + mention flags). Each consumer
// casts back to its local type on read.
export type BoardSnapshot = {
  pipeline: { id: string; name: string; task_visibility_mode: 'all' | 'assigned_only'; is_default?: boolean } | null;
  stages: any[];
  tasks: any[];
  availablePipelines: any[];
  stageActions: any[];
  stageTransitions: { id: string; to_stage_id: string }[];
  activeSessions: Record<string, ActiveSessionUser[]>;
  myTeamIds: string[];
};

export const taskCache = new Map<string, BoardSnapshot>();

// Mutable holder so consumers can read/write the last-loaded board id across modules.
export const boardCacheMeta = { lastPipelineId: null as string | null };

// Prefetch every board that isn't the current one and isn't already cached, so a
// later switch is an instant cache hit. Sequential (not Promise.all) to avoid a
// burst of queries on slow connections. `loadOne` returns the snapshot for a
// board or null to skip. ponytail: sequential fan-out; batch it only if board
// counts get large enough to matter.
export async function prefetchOtherBoards(opts: {
  boards: { id: string }[];
  currentId: string | null | undefined;
  prefetched: Set<string>;
  isCancelled: () => boolean;
  loadOne: (boardId: string) => Promise<BoardSnapshot | null>;
}) {
  for (const board of opts.boards) {
    if (opts.isCancelled()) return;
    if (board.id === opts.currentId) continue;
    if (taskCache.has(board.id) || opts.prefetched.has(board.id)) continue;
    opts.prefetched.add(board.id);
    try {
      const snap = await opts.loadOne(board.id);
      // Cancelled mid-flight or no data → unmark so a later run can retry.
      if (opts.isCancelled() || !snap) { opts.prefetched.delete(board.id); return; }
      taskCache.set(board.id, snap);
    } catch {
      opts.prefetched.delete(board.id); // allow a retry on the next effect run
    }
  }
}
