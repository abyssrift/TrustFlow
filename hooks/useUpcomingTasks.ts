// Personal deadline data for the topbar strip / dropdown / calendar overlay.
// "Mine" = I'm the task manager, personally assigned, or assigned via one of
// my teams — the same rule the kanban applies in _tasks_desktop.tsx.
// Plain client queries — RLS scopes visibility, no RPC needed.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export type UpcomingTask = {
  id: string;
  title: string;
  dueDate: string;
  stageColor: string;
  stageName: string;
  pipelineName: string;
  overdue: boolean;
};

const REFRESH_MS = 60_000;

const TASK_SELECT = `
  id, title, due_date, manager_id,
  pipeline:pipeline_id(name),
  stage:current_stage_id(name, color, terminal_type),
  assignments:task_assignments(assignee_user_id, assignee_team_id)
`;

async function fetchMyTeamIds(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('team_members')
    .select('team_id')
    .eq('user_id', userId)
    .is('removed_at', null);
  return (data || []).map((r: any) => r.team_id);
}

function isMine(t: any, userId: string, teamIds: string[]): boolean {
  if (t.manager_id === userId) return true;
  return (t.assignments || []).some(
    (a: any) =>
      (a.assignee_user_id && a.assignee_user_id === userId) ||
      (a.assignee_team_id && teamIds.includes(a.assignee_team_id)),
  );
}

// "Mine" spans tasks.manager_id, task_assignments.assignee_user_id, and
// team assignment resolved through team_members — not expressible as one
// server-side filter, so over-fetch by due date and filter client-side
// (the kanban does the same).
// ponytail: over-fetch window; if companies grow 100s of dated tasks that
// aren't the viewer's inside the window, move this into an RPC.
export async function fetchDeadlineTasks(
  userId: string,
  opts: { gte?: string; lt?: string; rawLimit?: number } = {},
): Promise<UpcomingTask[]> {
  const teamIds = await fetchMyTeamIds(userId);
  let q = supabase
    .from('tasks')
    .select(TASK_SELECT)
    .not('due_date', 'is', null)
    .is('deleted_at', null)
    .order('due_date', { ascending: true })
    .limit(opts.rawLimit ?? 200);
  if (opts.gte) q = q.gte('due_date', opts.gte);
  if (opts.lt) q = q.lt('due_date', opts.lt);
  const { data, error } = await q;
  if (error) throw error;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return (data || [])
    .filter((t: any) => t.stage && !t.stage.terminal_type && isMine(t, userId, teamIds))
    .map((t: any) => ({
      id: t.id,
      title: t.title,
      dueDate: t.due_date,
      stageColor: t.stage?.color || '#94a3b8',
      stageName: t.stage?.name || '',
      pipelineName: t.pipeline?.name || '',
      overdue: new Date(t.due_date) < today,
    }));
}

// Personal count of non-terminal tasks with no due date (nudge copy in the
// calendar sidebar). Client-counted for the same reason as above; capped by
// the row limit, which is fine for a nudge.
export async function fetchUnscheduledCount(userId: string): Promise<number> {
  const teamIds = await fetchMyTeamIds(userId);
  const { data, error } = await supabase
    .from('tasks')
    .select('id, manager_id, stage:current_stage_id(terminal_type), assignments:task_assignments(assignee_user_id, assignee_team_id)')
    .is('due_date', null)
    .is('deleted_at', null)
    .limit(200);
  if (error) throw error;
  return (data || []).filter((t: any) => t.stage && !t.stage.terminal_type && isMine(t, userId, teamIds)).length;
}

// Live updates for deadline data: task edits/creates (due date, stage, delete)
// and assignment changes (both affect "mine") from anyone, not just this tab.
export function subscribeDeadlineChanges(onChange: () => void): () => void {
  const channelName = `deadline-realtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignments' }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

export function useUpcomingTasks() {
  const { user } = useAuth();
  const userId = user?.id;
  const [tasks, setTasks] = useState<UpcomingTask[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoaded = useRef(false);

  const refetch = useCallback(async () => {
    if (!userId) return;
    try {
      if (!hasLoaded.current) setLoading(true);
      // Overdue lookback is bounded so an old backlog can't fill the window
      // and crowd out actual upcoming deadlines.
      const lookback = new Date(Date.now() - 30 * 86400000).toISOString();
      const mine = await fetchDeadlineTasks(userId, { gte: lookback });
      setTasks(mine.slice(0, 10));
    } catch {
      // keep previous data on error
    } finally {
      hasLoaded.current = true;
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, REFRESH_MS);
    window.addEventListener('focus', refetch);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', refetch);
    };
  }, [refetch]);

  // Realtime is the primary signal; the poll/focus refetch above is the fallback.
  useEffect(() => {
    if (!userId) return;
    return subscribeDeadlineChanges(refetch);
  }, [userId, refetch]);

  return { tasks, loading, refetch };
}
