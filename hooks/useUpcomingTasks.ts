// Personal deadline data for the topbar strip / dropdown / calendar overlay.
// "Mine" = I'm the task manager, personally assigned, or assigned via one of
// my teams — the same rule the kanban applies in _tasks_desktop.tsx.
// Plain client queries — RLS scopes visibility, no RPC needed.
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { supabase } from '@/lib/supabase';
import { toastError } from '@/lib/toast';
import { useAuth } from '@/contexts/AuthContext';

export type UpcomingTask = {
  id: string;
  title: string;
  dueDate: string;
  stageColor: string;
  stageName: string;
  pipelineName: string;
  overdue: boolean;
  // tasks.weight — the app's "points" unit (1-10), summed by the calendar's
  // range readout and by the analytics engine's daily/monthly point totals.
  points: number;
};

const REFRESH_MS = 60_000;

// Shared 42-cell (6x7) month grid builder — leading/trailing days from
// adjacent months fill the grid so the layout never jumps between months.
// Used by the desktop calendar overlay/dropdown and the mobile Deadlines screen.
export function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function buildMonthGrid(anchor: Date): Date[] {
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i));
}

// Shared by the topbar dropdown and the mobile Deadlines screen so both
// surfaces of the same "attention ribbon" data read identically.
export function formatRelativeDue(dueDate: string, overdue: boolean): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate); due.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (overdue) return `${-diffDays}d late`;
  if (diffDays === 0) return 'today';
  if (diffDays < 14) return `${diffDays}d`;
  return `${Math.floor(diffDays / 7)}w`;
}

const TASK_SELECT = `
  id, title, due_date, manager_id, weight,
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
      points: t.weight ?? 0,
    }));
}

// Phase 10 (#191) — project dates for the attention ribbon, alongside the task
// deadlines above. Shaped for lib/deadlineStrata.ts, which turns these into the
// ribbon's middle and top strata.
export type ProjectDeadline = {
  id: string;
  name: string;
  color: string | null;
  portfolioId: string | null;
  portfolioName: string | null;
  clientName: string | null;
  startDate: string | null;
  dueDate: string | null;
  /** §16: the project's CURRENT stage is terminal AND terminal_type='success'. */
  done: boolean;
};

// rpc_projects_table already applies fn_project_accessible — the `projects_select`
// boundary, which is default-deny — and already returns start_date, due_date AND
// the current stage's own stage_is_terminal / stage_terminal_type. So "done" is
// decided from the row in hand: no follow-up query to pipeline_stages, and no
// second reader of projects that could drift from the Projects screens.
//
// No per-user "mine" narrowing (unlike fetchDeadlineTasks): fn_project_accessible
// is this app's definition of who a project is visible to, and every other
// projects surface reads company-wide within that boundary. Narrowing to "I own
// it" here would make the ribbon disagree with the Projects screens about which
// projects exist.
//
// NOT FETCHED: projected_end / projection_confidence. fn_project_projection is
// the single definition of "when will this land" (§16.1) and the ribbon has no
// room to draw a forecast differently from a fact — so it draws committed dates
// only. The Timeline tab is where a projection belongs.
export async function fetchDeadlineProjects(): Promise<ProjectDeadline[]> {
  const { data, error } = await supabase.rpc('rpc_projects_table', { p_limit: 200 });
  if (error) throw error;
  return ((data || []) as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color ?? null,
    portfolioId: r.portfolio_id ?? null,
    portfolioName: r.portfolio_name ?? null,
    clientName: r.client_name ?? null,
    startDate: r.start_date ?? null,
    dueDate: r.due_date ?? null,
    done: !!r.stage_is_terminal && r.stage_terminal_type === 'success',
  }));
}

export type UnscheduledTask = { id: string; title: string; stageColor: string; stageName: string };

// Personal list of non-terminal tasks with no due date (nudge list in the
// calendar sidebar, so assignees don't lose track of undated work). Client-
// filtered for the same reason as fetchDeadlineTasks; capped by the row limit.
export async function fetchUnscheduledTasks(userId: string): Promise<UnscheduledTask[]> {
  const teamIds = await fetchMyTeamIds(userId);
  const { data, error } = await supabase
    .from('tasks')
    .select('id, title, manager_id, stage:current_stage_id(name, color, terminal_type), assignments:task_assignments(assignee_user_id, assignee_team_id)')
    .is('due_date', null)
    .is('deleted_at', null)
    .limit(200);
  if (error) throw error;
  return (data || [])
    .filter((t: any) => t.stage && !t.stage.terminal_type && isMine(t, userId, teamIds))
    .map((t: any) => ({
      id: t.id,
      title: t.title,
      stageColor: t.stage?.color || '#94a3b8',
      stageName: t.stage?.name || '',
    }));
}

export type CompletedTask = {
  id: string;
  title: string;
  completedDate: string;
  stageColor: string;
  stageName: string;
  pipelineName: string;
  archived: boolean;
  points: number;
};

// Completed tasks for the calendar's "show completed" toggle — two sources:
// live tasks.completed_at (still in the pipeline) and archived tasks, which
// rpc_archive_task deletes from `tasks` entirely and snapshots as JSONB into
// `archives`. Archived rows carry no stage/pipeline name, only ids, so those
// are resolved with a follow-up lookup (best-effort — the stage may since
// have been renamed or deleted). Restored archives are excluded so a
// restore-then-recomplete doesn't double-count.
export async function fetchCompletedTasks(
  userId: string,
  opts: { gte: string; lt: string },
): Promise<CompletedTask[]> {
  const teamIds = await fetchMyTeamIds(userId);

  const [liveRes, archiveRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, title, completed_at, manager_id, weight, pipeline:pipeline_id(name), stage:current_stage_id(name, color), assignments:task_assignments(assignee_user_id, assignee_team_id)')
      .not('completed_at', 'is', null)
      .is('deleted_at', null)
      .gte('completed_at', opts.gte)
      .lt('completed_at', opts.lt)
      .limit(500),
    supabase.rpc('rpc_get_archives', { p_entity_type: 'task' }),
  ]);
  if (liveRes.error) throw liveRes.error;
  // Archives are the optional half: no archive.view permission (or any other
  // archive-side failure) must not zero out the live completed tasks, which
  // are the part every user can see.
  if (archiveRes.error) toastError('Archived tasks could not be loaded.', 'Calendar');

  const live: CompletedTask[] = (liveRes.data || [])
    .filter((t: any) => isMine(t, userId, teamIds))
    .map((t: any) => ({
      id: t.id,
      title: t.title,
      completedDate: t.completed_at,
      stageColor: t.stage?.color || '#94a3b8',
      stageName: t.stage?.name || '',
      pipelineName: t.pipeline?.name || '',
      archived: false,
      points: t.weight ?? 0,
    }));

  const archiveRows = (archiveRes.error ? [] : ((archiveRes.data || []) as any[])).filter((a) => !a.restored_at);
  const candidates = archiveRows
    .map((a) => {
      const task = a.snapshot?.task;
      if (!task?.completed_at) return null;
      if (task.completed_at < opts.gte || task.completed_at >= opts.lt) return null;
      const involved: string[] = a.metadata?.involved_user_ids || [];
      const assignments = a.snapshot?.assignments || [];
      const mine = task.manager_id === userId
        || involved.includes(userId)
        || assignments.some((asg: any) => asg.assignee_user_id === userId || (asg.assignee_team_id && teamIds.includes(asg.assignee_team_id)));
      return mine ? { archiveId: a.id as string, task } : null;
    })
    .filter((c): c is { archiveId: string; task: any } => c !== null);

  const stageIds = Array.from(new Set(candidates.map((c) => c.task.current_stage_id).filter(Boolean)));
  const pipelineIds = Array.from(new Set(candidates.map((c) => c.task.pipeline_id).filter(Boolean)));
  const [stageRes, pipelineRes] = await Promise.all([
    stageIds.length > 0
      ? supabase.from('pipeline_stages').select('id, name, color').in('id', stageIds)
      : Promise.resolve({ data: [] as any[] }),
    pipelineIds.length > 0
      ? supabase.from('pipelines').select('id, name').in('id', pipelineIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);
  const stageMap = new Map((stageRes.data || []).map((s: any) => [s.id, s]));
  const pipelineMap = new Map((pipelineRes.data || []).map((p: any) => [p.id, p.name]));

  const archived: CompletedTask[] = candidates.map(({ archiveId, task }) => {
    const stage = stageMap.get(task.current_stage_id);
    return {
      id: archiveId,
      title: task.title,
      completedDate: task.completed_at,
      stageColor: stage?.color || '#64748b',
      stageName: stage?.name || 'Archived',
      pipelineName: pipelineMap.get(task.pipeline_id) || '',
      archived: true,
      points: task.weight ?? 0,
    };
  });

  return [...live, ...archived];
}

// Live updates for deadline data: task edits/creates (due date, stage, delete)
// and assignment changes (both affect "mine") from anyone, not just this tab.
// Also `projects` (Phase 10, #191) — a start/due edit or a stage move into or
// out of "done" changes the ribbon's project and portfolio strata.
export function subscribeDeadlineChanges(onChange: () => void): () => void {
  const channelName = `deadline-realtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const channel = supabase
    .channel(channelName)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'task_assignments' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects' }, onChange)
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}

/**
 * `withProjects` is opt-in rather than always-on: the desktop ribbon draws
 * projects and portfolios, the mobile Deadlines screen does not, and there is
 * no reason to spend a query on rows a caller will never render. Both halves
 * share ONE refresh cycle (poll, window focus, AppState, realtime) so the two
 * strata of the same picture can never be refreshed out of step with each other.
 */
export function useUpcomingTasks({ withProjects = false }: { withProjects?: boolean } = {}) {
  const { user } = useAuth();
  const userId = user?.id;
  const [tasks, setTasks] = useState<UpcomingTask[]>([]);
  const [projects, setProjects] = useState<ProjectDeadline[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoaded = useRef(false);

  const refetch = useCallback(async () => {
    if (!userId) return;
    try {
      if (!hasLoaded.current) setLoading(true);
      // Overdue lookback is bounded so an old backlog can't fill the window
      // and crowd out actual upcoming deadlines.
      const lookback = new Date(Date.now() - 30 * 86400000).toISOString();
      // Projects are the optional half: a projects-side failure (no access, RPC
      // missing on an older environment) must not zero out the task deadlines,
      // which are the part every user has.
      const [mine, mineProjects] = await Promise.all([
        fetchDeadlineTasks(userId, { gte: lookback }),
        withProjects ? fetchDeadlineProjects().catch(() => [] as ProjectDeadline[]) : Promise.resolve([]),
      ]);
      setTasks(mine.slice(0, 10));
      if (withProjects) setProjects(mineProjects);
    } catch {
      // keep previous data on error
    } finally {
      hasLoaded.current = true;
      setLoading(false);
    }
  }, [userId, withProjects]);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, REFRESH_MS);

    if (Platform.OS === 'web') {
      window.addEventListener('focus', refetch);
      return () => {
        clearInterval(interval);
        window.removeEventListener('focus', refetch);
      };
    }

    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refetch();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [refetch]);

  // Realtime is the primary signal; the poll/focus refetch above is the fallback.
  useEffect(() => {
    if (!userId) return;
    return subscribeDeadlineChanges(refetch);
  }, [userId, refetch]);

  return { tasks, projects, loading, refetch };
}
