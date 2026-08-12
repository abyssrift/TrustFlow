// "The work assigned to me" — the list behind the `my-work` dashboard widget.
//
// NO NEW "MINE" RULE. Both halves are the two fetchers hooks/useUpcomingTasks.ts
// already exports, so the private `isMine` predicate there (:71 — manager_id, a
// personal assignment, or one of my teams) stays the single definition. A second
// derivation of "mine" would drift from the kanban and the deadline ribbon, and
// the drift would be silent.
//
// Why two calls instead of one query: `fetchDeadlineTasks` filters
// `due_date IS NOT NULL` and `fetchUnscheduledTasks` filters `due_date IS NULL`
// — between them that is every open task of mine, dated or not, which is what
// "my work" means and what neither fetcher covers alone.
//
// ponytail: 4 round trips (each fetcher resolves my team ids first), and the
// same client-side over-fetch ceiling useUpcomingTasks.ts:84-85 already
// documents. The widget is `singleton: true` so it happens once per dashboard.
// The upgrade path is that file's: one `rpc_my_tasks()` that owns the predicate
// server-side, which would collapse this hook to a single call.
//
// THE CEILING, NAMED: `fetchDeadlineTasks` takes the first 200 tasks in the
// window ordered by due_date and only then keeps mine. In a company with more
// than 200 dated tasks due in the last 30 days or later, the viewer's own work
// can fall entirely outside that page and the widget says "Nothing is assigned
// to you right now." to someone who has plenty. Raising `rawLimit` only moves
// the number; the fix is the `rpc_my_tasks()` above, which filters server-side
// and needs no ceiling at all.

import { useEffect, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { fetchDeadlineTasks, fetchUnscheduledTasks } from '@/hooks/useUpcomingTasks';

export type MyTask = {
  id: string;
  title: string;
  stageName: string;
  stageColor: string;
  pipelineName: string;
  /** Null for work nobody has scheduled — the half the deadline surfaces cannot show. */
  dueDate: string | null;
  overdue: boolean;
};

/** Same bounded lookback the deadline ribbon uses, so an old backlog can't fill the window. */
const LOOKBACK_MS = 30 * 86400000;

/**
 * Refresh-key driven, deliberately: no realtime channel and no poll. The
 * dashboard already has exactly one refresh signal (pull-to-refresh / the
 * header button, via DashboardDataContext's `refreshKey`), and a widget with
 * its own clock would show a different moment from the cards beside it.
 */
export function useMyTasks(refreshKey = 0): { tasks: MyTask[]; loading: boolean } {
  const { user } = useAuth();
  const userId = user?.id;
  const [tasks, setTasks] = useState<MyTask[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    (async () => {
      try {
        const lookback = new Date(Date.now() - LOOKBACK_MS).toISOString();
        const [dated, undated] = await Promise.all([
          fetchDeadlineTasks(userId, { gte: lookback }),
          fetchUnscheduledTasks(userId),
        ]);
        if (cancelled) return;
        // No comparator: `fetchDeadlineTasks` orders by due_date ascending, so
        // the late ones are already first and the soonest follow. Undated work
        // goes last because a task nobody has scheduled is never the next thing
        // you should look at.
        setTasks([
          ...dated.map(t => ({
            id: t.id,
            title: t.title,
            stageName: t.stageName,
            stageColor: t.stageColor,
            pipelineName: t.pipelineName,
            dueDate: t.dueDate,
            overdue: t.overdue,
          })),
          ...undated.map(t => ({
            id: t.id,
            title: t.title,
            stageName: t.stageName,
            stageColor: t.stageColor,
            pipelineName: '',
            dueDate: null,
            overdue: false,
          })),
        ]);
      } catch {
        // Keep whatever is on screen, same as useUpcomingTasks' refetch.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, refreshKey]);

  return { tasks, loading };
}
