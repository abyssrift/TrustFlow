import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import {
  MIN_PROJECTION_SAMPLE,
  type ProjectionSeries,
} from '@/components/charts/projection';

// Issue #198 — the data behind the project Assignments screen.
//
// READS: no new RPC. The project's tasks come straight off `tasks` through
// PostgREST, which is access-controlled by the `tasks_select_visibility` RLS
// policy (company scope + per-pipeline visibility mode + assignment), so the
// list a manager sees here is the same set they can see anywhere else. That
// policy is why this does not need — and must not add — a SECURITY DEFINER
// reader: adding one would be a sixth definition of "who can see this work"
// when plan §13.14 is about there being one.
//
// The select shape is copied from _tasks_desktop.tsx's, so the two screens
// resolve assignments identically rather than each inventing a join.
//
// WRITES: `rpc_bulk_update_task_assignments`, which is a wrapper that calls
// the app's ONE assignment writer (`rpc_update_task_assignments`) once per
// task in a single transaction. There is deliberately no second writer here.

export type AssignmentTask = {
  id: string;
  title: string;
  category: string | null;
  priority: string | null;
  due_date: string | null;
  completed_at: string | null;
  pipeline_id: string | null;
  stage_name: string | null;
  stage_color: string | null;
  is_complete: boolean;
  user_ids: string[];
  team_ids: string[];
  /** Kept so this row satisfies TimeByCategoryPie's `tasks` prop directly. */
  total_seconds: number;
};

export type Assignee = {
  id: string;
  name: string;
  kind: 'user' | 'team';
  color: string | null;
  /** Open (not-done) tasks this person/team holds ON THIS PROJECT. */
  load: number;
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Cumulative completed-tasks-over-time for this project.
 *
 * This is HISTORY, not a forecast — a running count of `completed_at` stamps
 * that already happened. It is safe to derive on the client for the same
 * reason a bar chart of last month's invoices is: nothing is being predicted.
 *
 * What it very deliberately does NOT do is compute `projectedEnd` or
 * `confidence`. Those stay `null` / `'none'` until Phase 10's
 * `rpc_project_health` supplies them from the server-side pace maths that
 * `rpc_portfolio_throughput` already owns. Plan §16.1/§16.2: one definition of
 * "projected end", computed once, server-side — a pace calculation written
 * here would be the second one, and the two would disagree on screen.
 */
function buildProjection(tasks: AssignmentTask[], dueDate: string | null): ProjectionSeries {
  const done = tasks
    .filter(t => !!t.completed_at)
    .map(t => t.completed_at!.slice(0, 10))
    .sort();

  const points: { date: string; actual: number | null; projected: number | null }[] = [];

  if (done.length > 0) {
    // One point per day from the first completion to today, so a flat stretch
    // reads as a flat stretch rather than being compressed out of existence.
    const start = new Date(done[0] + 'T00:00:00Z');
    const end = new Date();
    let cursor = 0;
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const day = isoDay(d);
      while (cursor < done.length && done[cursor] <= day) cursor++;
      points.push({ date: day, actual: cursor, projected: null });
      if (points.length > 400) break; // ponytail: a 400-day engagement is off the chart's useful range anyway
    }
  }

  return {
    points,
    target: tasks.length,
    unitLabel: 'tasks',
    sampleSize: done.length,
    // Both null/'none' on purpose — see the doc comment above. The chart is
    // wired, the contract is real, and the forecast arrives from the server.
    projectedEnd: null,
    dueDate,
    confidence: 'none',
  };
}

export function useProjectAssignments(projectId: string) {
  const { profile } = useAuth();
  const companyId = profile?.company_id;

  const [tasks, setTasks] = useState<AssignmentTask[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [teams, setTeams] = useState<{ id: string; name: string; color: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError(null);

    const [taskRes, userRes, teamRes] = await Promise.all([
      supabase
        .from('tasks')
        .select(`
          id, title, category, priority, due_date, completed_at, pipeline_id,
          stage:current_stage_id(name, color, is_terminal, terminal_type),
          assignments:task_assignments(assignee_user_id, assignee_team_id)
        `)
        .eq('project_id', projectId)
        .is('deleted_at', null)
        .order('created_at', { ascending: true }),
      supabase
        .from('users')
        .select('id, full_name, email')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .order('full_name'),
      supabase
        .from('teams')
        .select('id, name, color')
        .eq('company_id', companyId)
        .is('deleted_at', null)
        .order('name'),
    ]);

    if (taskRes.error) {
      // Surfaced as one flat message. An empty list and a denied read are not
      // distinguished here for the same reason ProjectDetailContext folds
      // them together (#186) — but a genuine network/query failure must not
      // masquerade as "this project has no work".
      setError('Could not load this project’s tasks. Check your connection and try again.');
      setTasks([]);
      setLoading(false);
      return;
    }

    setTasks(
      (taskRes.data ?? []).map((t: any) => {
        const stage = Array.isArray(t.stage) ? t.stage[0] : t.stage;
        const asg = t.assignments ?? [];
        return {
          id: t.id,
          title: t.title,
          category: t.category,
          priority: t.priority,
          due_date: t.due_date,
          completed_at: t.completed_at,
          pipeline_id: t.pipeline_id,
          stage_name: stage?.name ?? null,
          stage_color: stage?.color ?? null,
          is_complete: !!(stage?.is_terminal && stage?.terminal_type === 'success'),
          user_ids: asg.map((a: any) => a.assignee_user_id).filter(Boolean),
          team_ids: asg.map((a: any) => a.assignee_team_id).filter(Boolean),
          total_seconds: 0,
        } as AssignmentTask;
      })
    );
    setUsers((userRes.data ?? []).map((u: any) => ({ id: u.id, name: u.full_name || u.email || 'Unnamed' })));
    setTeams((teamRes.data ?? []).map((t: any) => ({ id: t.id, name: t.name, color: t.color })));
    setLoading(false);
  }, [projectId, companyId]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /**
   * Everyone who CAN be assigned, with what they are already carrying on THIS
   * project. The load is counted from the task rows already in hand — it is
   * not a second query and not a second definition of "active task": open
   * means "not in a success-terminal stage", exactly as the rest of this file
   * and rpc_project_dashboard's `active` total mean it.
   */
  const assignees: Assignee[] = useMemo(() => {
    const userLoad = new Map<string, number>();
    const teamLoad = new Map<string, number>();
    for (const t of tasks) {
      if (t.is_complete) continue;
      for (const u of t.user_ids) userLoad.set(u, (userLoad.get(u) ?? 0) + 1);
      for (const tm of t.team_ids) teamLoad.set(tm, (teamLoad.get(tm) ?? 0) + 1);
    }
    return [
      ...teams.map(t => ({ id: t.id, name: t.name, kind: 'team' as const, color: t.color, load: teamLoad.get(t.id) ?? 0 })),
      ...users.map(u => ({ id: u.id, name: u.name, kind: 'user' as const, color: null, load: userLoad.get(u.id) ?? 0 })),
    ];
  }, [tasks, users, teams]);

  const nameById = useMemo(() => {
    const m = new Map<string, string>();
    users.forEach(u => m.set(u.id, u.name));
    teams.forEach(t => m.set(t.id, t.name));
    return m;
  }, [users, teams]);

  /**
   * Assign a set of tasks to a set of people/teams, in one transaction.
   *
   * REPLACES the assignment on each task rather than adding to it, because
   * that is what the underlying `rpc_update_task_assignments` has always done
   * (it deletes then inserts). Pretending otherwise at this layer would make
   * the bulk action mean something different from the single-task modal.
   */
  const assign = useCallback(
    async (taskIds: string[], userIds: string[], teamIds: string[]) => {
      const { error: e } = await supabase.rpc('rpc_bulk_update_task_assignments', {
        p_task_ids: taskIds,
        p_user_ids: userIds,
        p_team_ids: teamIds,
      });
      if (e) throw e;
      await fetchAll();
    },
    [fetchAll]
  );

  return { tasks, assignees, nameById, loading, error, refresh: fetchAll, assign, buildProjection, MIN_PROJECTION_SAMPLE };
}
