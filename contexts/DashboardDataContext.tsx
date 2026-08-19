// The dashboard's shared data, fetched ONCE above the widget grid (#213, Wave 1).
//
// This is a correctness requirement, not tidiness. With N widget instances and
// per-widget hooks you get N copies of every query — including the 500-row
// `rpc_projects_table` read that `useDashboardProjects` exists specifically to
// deduplicate ("they used to fire the same 500-row call twice"). One provider
// above the grid gives one of each, whatever the user's layout looks like.
//
// Everything here moved in from components/tabs/_index_desktop.tsx and
// _index_adaptive.tsx: the adaptive Promise.all form (strictly better) with the
// desktop isAuthError/triggerAuthError guards kept (the adaptive copy drops
// them — that is a latent bug, not a simplification).
//
// Two widgets legitimately fetch their own data and are NOT served from here:
//   - pending-time-approvals (rpc_get_my_pending_time_approvals + a realtime
//     channel per mount — hence `singleton: true` in the registry)
//   - pipeline-overview (usePipelineOverviewData, backed by AnalyticsContext's
//     dedup cache, so two instances with identical params share one fetch)
// Both take `refreshKey` so pull-to-refresh still reaches them.

import { useDashboardProjects, type DashboardProjectsState } from '@/hooks/useDashboardProjects';
import type { DashboardConfig } from '@/lib/dashboardWidgets';
import { isAuthError, supabase, triggerAuthError } from '@/lib/supabase';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { InteractionManager, Platform } from 'react-native';

// ── Types (verbatim from the two screens they came from) ─────────────────

export type DashboardStats = {
  totalTasks: number;
  activeNow: number;
  completed: number;
  failed: number;
  activeSessions: number;
};

export type PersonalPulse = {
  daily_points: number;
  monthly_points: number;
  active_seconds_today: number;
  flap_rate_score: number;
  is_working: boolean;
};

/**
 * One currently-running work session, from `rpc_company_live_sessions`.
 *
 * Lived in hooks/useLiveSessions.ts until that hook was deleted — it existed
 * only because this context's session select was too narrow (no `id`, no
 * `task_id`, no task title) and exposed nothing but a count. It is widened
 * here instead, so the `live-now` widget and the "working now" fact are two
 * readings of ONE array and cannot disagree.
 */
export type LiveSession = {
  id: string;
  userId: string;
  name: string;
  avatar: string | null;
  taskId: string;
  taskTitle: string;
  pipelineName: string | null;
  startedAt: string;
  lastHeartbeatAt: string | null;
};

export type ActivityEntry = {
  id: string;
  taskId: string;
  taskTitle: string;
  fromStage: string;
  toStage: string;
  movedBy: string;
  /**
   * The actor's picture, so the activity feed can draw a face instead of a
   * 10px name. Null is the ordinary case (no avatar uploaded, or a system
   * move) and the row falls back to a monogram of `movedBy` — one extra column
   * on the embed this query already makes, not a second request.
   */
  movedByAvatar: string | null;
  movedAt: string;
};

export type ProjectSummary = {
  id: string;
  name: string;
  completionRate: number;
  totalTasks: number;
  completedTasks: number;
};

export type DashboardData = {
  stats: DashboardStats;
  pulse: PersonalPulse | null;
  /**
   * Everyone in the company working RIGHT NOW, one row per person, earliest
   * session first. `stats.activeSessions` is this array's length — read this
   * for the list, that for the number, never a second query for either.
   */
  sessions: LiveSession[];
  activity: ActivityEntry[];
  projects: ProjectSummary[];
  trackedPipelineIds: string[];
  /** The ONE rpc_projects_table read — see hooks/useDashboardProjects.ts. */
  dashProjects: DashboardProjectsState;
  loading: boolean;
  refreshing: boolean;
  /** Bumps refreshKey and re-runs every fetch, including the self-fetching widgets. */
  refreshAll: () => void;
  refreshKey: number;
  /** The screen owns LiveSessionsPopup; the facts widget triggers it. */
  openLiveSessions: () => void;
};

// The activity fetch is deliberately NOT driven by layout state: it always
// reads the largest row count any widget can show, and widgets slice
// client-side. Making the query depend on a widget's `limit` config would
// re-fetch on a config change and break the moment two instances disagree.
const ACTIVITY_FETCH_LIMIT = 20;

const EMPTY_STATS: DashboardStats = { totalTasks: 0, activeNow: 0, completed: 0, failed: 0, activeSessions: 0 };

/** Wire shape of `rpc_company_live_sessions` (snake_case, straight from SQL). */
type LiveSessionRow = {
  session_id: string;
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  task_id: string;
  task_title: string | null;
  pipeline_name: string | null;
  started_at: string;
  last_heartbeat_at: string | null;
};

const DashboardDataContext = createContext<DashboardData | null>(null);

export const useDashboardData = () => {
  const ctx = useContext(DashboardDataContext);
  if (!ctx) throw new Error('useDashboardData must be used within a DashboardDataProvider');
  return ctx;
};

export function DashboardDataProvider({ config, ready = true, onOpenLiveSessions, children }: {
  config: DashboardConfig | null;
  /**
   * False while the stored config is still coming back from AsyncStorage.
   *
   * `config: null` cannot carry that on its own — it also means "nothing is
   * stored", which is a perfectly fetchable state. Without this the first
   * render fetches every pipeline, storage then resolves, the fetch key
   * changes and the whole dashboard is fetched a second time on every single
   * load. The screens this replaced awaited their loadConfig() before
   * fetching; `ready` is how that ordering survives the move into a provider.
   */
  ready?: boolean;
  onOpenLiveSessions: () => void;
  children: React.ReactNode;
}) {
  const [stats, setStats] = useState<DashboardStats>(EMPTY_STATS);
  const [pulse, setPulse] = useState<PersonalPulse | null>(null);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [trackedPipelineIds, setTrackedPipelineIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Called exactly once, here. global-utilities-index.md states the same rule
  // for the sibling case: "Call this hook exactly once, inside
  // ProjectDetailContext — do not call it a second time from a component."
  const dashProjects = useDashboardProjects(refreshKey);

  const configRef = useRef(config);
  configRef.current = config;

  const fetchDashboardData = async () => {
    try {
      const currentConfig = configRef.current;
      let targetPipelineIds: string[] = [];
      let successStageIds: string[] = [];
      let terminalStageIds: string[] = [];

      // Default to all pipelines when no config, or when useAllPipelines is set, or no pipelines selected
      const isAllPipelines =
        !currentConfig ||
        currentConfig.useAllPipelines === true ||
        currentConfig.pipelineIds.length === 0;

      if (isAllPipelines) {
        const { data: allPipelines, error: pipelineError } = await supabase
          .from('pipelines')
          .select('id')
          .is('deleted_at', null);
        if (isAuthError(pipelineError)) {
          triggerAuthError();
          return;
        }
        targetPipelineIds = (allPipelines || []).map((p: any) => p.id);
      } else {
        targetPipelineIds = currentConfig!.pipelineIds;
      }

      // Expose the resolved tracked set to the overview graph.
      setTrackedPipelineIds(targetPipelineIds);

      if (targetPipelineIds.length === 0) return;

      // Run all pipeline-dependent queries in parallel (the adaptive form),
      // keeping the desktop copy's auth guards on every one of them.
      const [
        { data: terminalStages, error: stageError },
        { data: tasks, error: tasksError },
        { data: sessionRows, error: sessionError },
        { data: historyData, error: historyError },
        { data: rawProjects, error: projectsError },
      ] = await Promise.all([
        supabase.from('pipeline_stages')
          .select('id, terminal_type')
          .in('pipeline_id', targetPipelineIds)
          .eq('is_terminal', true),
        supabase.from('tasks')
          .select('id, current_stage_id')
          .in('pipeline_id', targetPipelineIds)
          .is('deleted_at', null),
        // NOT a direct read of task_work_sessions: its only select policy is
        // `auth.uid() = user_id`, so that table can never answer "who else is
        // working" — it capped this count at 1. See the RPC's own migration.
        //
        // Until that migration is applied this call returns PGRST202 (function
        // not found) in `sessionError`, which isAuthError does not match, so it
        // falls through to `sessionRows = null` → no live sessions and a
        // "working now" of 0. Every other stat on this dashboard still renders;
        // Promise.all never rejects, because supabase-js resolves errors.
        supabase.rpc('rpc_company_live_sessions'),
        supabase.from('pipeline_stage_history')
          .select(`
            id,
            transitioned_at,
            task_id,
            task:task_id(title, pipeline_id),
            from_stage:from_stage_id(name),
            to_stage:to_stage_id(name),
            transitioned_by_user:users!transitioned_by(full_name, display_name, avatar_url)
          `)
          .order('transitioned_at', { ascending: false })
          .limit(ACTIVITY_FETCH_LIMIT),
        supabase.from('projects')
          .select('id, name')
          .eq('status', 'active')
          .order('is_featured', { ascending: false })
          .limit(4),
      ]);
      if (isAuthError(stageError) || isAuthError(tasksError) || isAuthError(sessionError)
        || isAuthError(historyError) || isAuthError(projectsError)) {
        triggerAuthError();
        return;
      }

      terminalStageIds = (terminalStages || []).map((s: any) => s.id);

      // Use configured success stages if explicitly set; otherwise auto-detect terminal_type='success'
      if (!isAllPipelines && currentConfig!.successStageIds.length > 0) {
        successStageIds = currentConfig!.successStageIds;
      } else {
        successStageIds = (terminalStages || [])
          .filter((s: any) => s.terminal_type === 'success')
          .map((s: any) => s.id);
      }

      const total = tasks?.length || 0;
      const completed = tasks?.filter((t: any) => successStageIds.includes(t.current_stage_id)).length || 0;
      const activeNow = tasks?.filter((t: any) => !terminalStageIds.includes(t.current_stage_id)).length || 0;
      // Tasks in a terminal stage that isn't a success stage (failed, rejected, cancelled)
      const failed = total - completed - activeNow;

      // One session per person, even if they somehow hold several, keeping
      // their earliest (the RPC orders by started_at ASC, so first wins).
      // `stats.activeSessions` is this array's LENGTH rather than a separately
      // counted Set: the number and the `live-now` widget's list are then the
      // same reading and cannot drift apart.
      const seenUsers = new Set<string>();
      const liveSessions: LiveSession[] = [];
      for (const s of (sessionRows || []) as LiveSessionRow[]) {
        if (seenUsers.has(s.user_id)) continue;
        seenUsers.add(s.user_id);
        liveSessions.push({
          id: s.session_id,
          userId: s.user_id,
          name: s.full_name || 'User',
          avatar: s.avatar_url ?? null,
          taskId: s.task_id,
          // `task_title` is NULL BY DESIGN, not only on bad data: the RPC
          // withholds the title of a task this viewer could not read through
          // tasks RLS (an `assigned_only` pipeline they are not on). Presence
          // is company-wide, the task is not. "Unknown task" is the neutral
          // string the direct select this replaced already rendered in exactly
          // that case — keep it vague; naming the reason would itself be a hint.
          taskTitle: s.task_title || 'Unknown task',
          pipelineName: s.pipeline_name ?? null,
          startedAt: s.started_at,
          lastHeartbeatAt: s.last_heartbeat_at,
        });
      }
      setSessions(liveSessions);

      setStats({
        totalTasks: total,
        activeNow,
        completed,
        failed,
        activeSessions: liveSessions.length,
      });

      const activityEntries: ActivityEntry[] = (historyData || [])
        .filter((h: any) => targetPipelineIds.includes(h.task?.pipeline_id))
        .slice(0, ACTIVITY_FETCH_LIMIT)
        .map((h: any) => ({
          id: h.id,
          taskId: h.task_id,
          taskTitle: h.task?.title || 'Unknown Task',
          fromStage: h.from_stage?.name || '-',
          toStage: h.from_stage ? (h.to_stage?.name || '—') : 'created',
          movedBy: h.transitioned_by_user?.display_name || h.transitioned_by_user?.full_name || 'System',
          movedByAvatar: h.transitioned_by_user?.avatar_url ?? null,
          movedAt: h.transitioned_at,
        }));
      setActivity(activityEntries);

      if (rawProjects && rawProjects.length > 0) {
        const { data: projectStats, error: statsError } = await supabase.rpc('rpc_get_project_stats', {
          p_project_ids: rawProjects.map((p: any) => p.id),
        });
        if (isAuthError(statsError)) {
          triggerAuthError();
          return;
        }
        setProjects(rawProjects.map((p: any) => {
          const s = (projectStats || []).find((stat: any) => stat.project_id === p.id) || {
            total_tasks: 0, completed_tasks: 0, completion_rate: 0,
          };
          return {
            id: p.id,
            name: p.name,
            completionRate: s.completion_rate || 0,
            totalTasks: s.total_tasks || 0,
            completedTasks: s.completed_tasks || 0,
          };
        }));
      }
    } catch (err) {
      console.error('[Dashboard] Data fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const fetchPulse = async () => {
    try {
      const { data, error } = await supabase.rpc('rpc_get_personal_pulse');
      if (isAuthError(error)) {
        triggerAuthError();
        return;
      }
      if (data) setPulse(data);
    } catch (err) {
      console.error('[Dashboard] Pulse fetch error:', err);
    }
  };

  // Only the fields the fetch actually reads — `config` gets a new identity on
  // every widget resize/reorder, and refetching the whole dashboard because
  // someone moved a card would be absurd.
  const fetchKey = JSON.stringify([
    config?.useAllPipelines ?? null,
    config?.pipelineIds ?? [],
    config?.successStageIds ?? [],
  ]);

  const firstRun = useRef(true);
  useEffect(() => {
    // `loading` is already true, so not fetching yet reads as still loading —
    // which is exactly what it is.
    if (!ready) return;
    const run = () => { fetchDashboardData(); fetchPulse(); };
    // On web, InteractionManager.runAfterInteractions can hang indefinitely
    // (its handle never clears with ongoing subscriptions/animations), so the
    // callback never fires and loading stays true forever. Run directly on web.
    if (Platform.OS === 'web' || !firstRun.current) {
      firstRun.current = false;
      run();
      return;
    }
    firstRun.current = false;
    const task = InteractionManager.runAfterInteractions(run);
    return () => task.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, refreshKey, ready]);

  const refreshAll = () => {
    setRefreshing(true);
    // One bump drives everything: this provider's effect, useDashboardProjects,
    // and the two self-fetching widgets that read refreshKey.
    setRefreshKey(k => k + 1);
  };

  return (
    <DashboardDataContext.Provider
      value={{
        stats, pulse, sessions, activity, projects, trackedPipelineIds, dashProjects,
        loading, refreshing, refreshAll, refreshKey,
        openLiveSessions: onOpenLiveSessions,
      }}
    >
      {children}
    </DashboardDataContext.Provider>
  );
}
