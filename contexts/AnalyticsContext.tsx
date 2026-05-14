import React, { createContext, useContext, useRef } from 'react';
import { supabase } from '../lib/supabase';

// ── Types ──────────────────────────────────────────────────────────────────

export interface PersonalPulse {
  daily_points: number;
  monthly_points: number;
  active_seconds_today: number;
  flap_rate_score: number;
  is_working: boolean;
}

export interface PerformancePeriod {
  period_start: string;
  period_label: string;
  weight_points: number;
  active_seconds: number;
  estimated_seconds: number;
  completed_tasks: number;
  failed_tasks: number;
  revision_count: number;
  on_time_tasks: number;
  is_current_period: boolean;
  within_budget_tasks: number;
  over_budget_tasks: number;
}

export interface PerformanceSummary {
  weight_points: number;
  active_seconds: number;
  estimated_seconds: number;
  completed_tasks: number;
  failed_tasks: number;
  revision_count: number;
  on_time_tasks: number;
  timer_efficiency: number | null;
  on_time_rate: number | null;
}

export interface StageDwell {
  stage_id: string;
  stage_name: string;
  stage_position: number;
  is_terminal: boolean;
  terminal_type: string | null;
  avg_seconds: number;
  median_seconds: number;
  p75_seconds: number;
  sample_count: number;
  reversal_count: number;
  is_bottleneck: boolean;
}

export interface ThroughputPeriod {
  period_start: string;
  period_label: string;
  tasks_entered: number;
  tasks_succeeded: number;
  tasks_failed: number;
  success_rate: number | null;
}

export interface TargetStatus {
  id: string;
  stage_id: string;
  stage_name: string;
  pipeline_name: string;
  target_type: string;
  target_value: number;
  current_value: number;
  status: 'hit' | 'expired' | 'active';
  deadline: string | null;
  created_at: string;
}

export interface PersonnelRow {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  weight_points: number;
  active_seconds: number;
  active_hours: number;
  estimated_seconds: number;
  completed_tasks: number;
  failed_tasks: number;
  revision_count: number;
  on_time_tasks: number;
  on_time_rate: number | null;
  timer_efficiency: number | null;
  daily_rate_usd: number | null;
  working_days: number;
  total_cost_usd: number | null;
  cost_per_point: number | null;
  points_per_hour: number | null;
  activity_count: number;
}

export interface ActivityEntry {
  id: string;
  transitioned_at: string;
  task_title: string;
  from_stage_name: string;
  to_stage_name: string;
  moved_by: string;
  is_completion: boolean;
}

// ── Context interface ──────────────────────────────────────────────────────

interface AnalyticsContextType {
  getPersonalPulse: () => Promise<PersonalPulse>;
  getUserPerformanceSeries: (userId: string, periodType: string, nPeriods: number) => Promise<PerformancePeriod[]>;
  getUserPerformanceSummary: (userId: string, from: string, to: string) => Promise<PerformanceSummary>;
  getPipelineStageDwell: (pipelineId: string, from: string, to: string) => Promise<StageDwell[]>;
  getPipelineThroughput: (pipelineId: string, periodType: string, nPeriods: number) => Promise<ThroughputPeriod[]>;
  getTargetsStatus: () => Promise<TargetStatus[]>;
  comparePersonnel: (userIds: string[], from: string, to: string, salaries: Record<string, number>) => Promise<PersonnelRow[]>;
  getRecentActivity: (limit?: number) => Promise<ActivityEntry[]>;
  invalidate: (keyPrefix?: string) => void;
}

const AnalyticsContext = createContext<AnalyticsContextType | undefined>(undefined);

// ── Cache internals ────────────────────────────────────────────────────────

interface CacheEntry {
  data: unknown;
  fetchedAt: number;
  permanent: boolean; // true = never re-fetch (past closed periods)
}

const SERIES_TTL_MS = 5 * 60 * 1000; // 5 min for current-period series
const PULSE_TTL_MS  = 60 * 1000;     // 1 min for personal pulse (live metric)

// ── Provider ───────────────────────────────────────────────────────────────

export const AnalyticsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const cache    = useRef<Map<string, CacheEntry>>(new Map());
  const inFlight = useRef<Map<string, Promise<unknown>>>(new Map());

  function fetchWithDedup<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs: number,
    permanent = false,
  ): Promise<T> {
    const hit = cache.current.get(key);
    if (hit && (hit.permanent || Date.now() - hit.fetchedAt < ttlMs)) {
      return Promise.resolve(hit.data as T);
    }

    const existing = inFlight.current.get(key);
    if (existing) return existing as Promise<T>;

    const promise = fetcher()
      .then(data => {
        cache.current.set(key, { data, fetchedAt: Date.now(), permanent });
        inFlight.current.delete(key);
        return data;
      })
      .catch(err => {
        inFlight.current.delete(key);
        throw err;
      });

    inFlight.current.set(key, promise);
    return promise;
  }

  // ── Methods ──────────────────────────────────────────────────────────────

  const getPersonalPulse = (): Promise<PersonalPulse> =>
    fetchWithDedup(
      'pulse',
      async () => {
        const { data, error } = await supabase.rpc('rpc_get_personal_pulse');
        if (error) throw error;
        return data as PersonalPulse;
      },
      PULSE_TTL_MS,
    );

  const getUserPerformanceSeries = (
    userId: string,
    periodType: string,
    nPeriods: number,
  ): Promise<PerformancePeriod[]> =>
    fetchWithDedup(
      `series:${userId}:${periodType}:${nPeriods}`,
      async () => {
        const { data, error } = await supabase.rpc('rpc_get_user_performance_series', {
          p_user_id:     userId,
          p_period_type: periodType,
          p_n_periods:   nPeriods,
        });
        if (error) throw error;
        return (data ?? []) as PerformancePeriod[];
      },
      SERIES_TTL_MS,
    );

  const getUserPerformanceSummary = (
    userId: string,
    from: string,
    to: string,
  ): Promise<PerformanceSummary> => {
    // Only permanently cache if "to" is strictly a closed past period (yesterday or earlier).
    // Comparing a bare date string like "2026-05-13" against new Date() always yields true
    // (it parses as midnight UTC), which permanently caches today's open period in-session.
    const toDate = new Date(to);
    toDate.setDate(toDate.getDate() + 1); // advance to end-of-day for the "to" date
    const isPast = toDate < new Date();
    return fetchWithDedup(
      `summary:${userId}:${from}:${to}`,
      async () => {
        const { data, error } = await supabase.rpc('rpc_get_user_performance_summary', {
          p_user_id: userId,
          p_from:    from,
          p_to:      to,
        });
        if (error) throw error;
        return data as PerformanceSummary;
      },
      SERIES_TTL_MS,
      isPast,
    );
  };

  const getPipelineStageDwell = (
    pipelineId: string,
    from: string,
    to: string,
  ): Promise<StageDwell[]> => {
    // Never permanently cache dwell data — "to" as a date string always parses
    // to midnight UTC which is technically in the past, causing isPast=true and
    // permanent caching that makes the refresh button a no-op all day.
    return fetchWithDedup(
      `dwell:${pipelineId}:${from}:${to}`,
      async () => {
        const { data, error } = await supabase.rpc('rpc_get_pipeline_stage_dwell', {
          p_pipeline_id: pipelineId,
          p_from:        from,
          p_to:          to,
        });
        if (error) throw error;
        return (data ?? []) as StageDwell[];
      },
      SERIES_TTL_MS,
    );
  };

  const getPipelineThroughput = (
    pipelineId: string,
    periodType: string,
    nPeriods: number,
  ): Promise<ThroughputPeriod[]> =>
    fetchWithDedup(
      `throughput:${pipelineId}:${periodType}:${nPeriods}`,
      async () => {
        const { data, error } = await supabase.rpc('rpc_get_pipeline_throughput', {
          p_pipeline_id: pipelineId,
          p_period_type: periodType,
          p_n_periods:   nPeriods,
        });
        if (error) throw error;
        return (data ?? []) as ThroughputPeriod[];
      },
      SERIES_TTL_MS,
    );

  const getTargetsStatus = (): Promise<TargetStatus[]> =>
    fetchWithDedup(
      'targets_status',
      async () => {
        const { data, error } = await supabase.rpc('rpc_get_targets_status');
        if (error) throw error;
        return (data ?? []) as TargetStatus[];
      },
      PULSE_TTL_MS,
    );

  // Personnel comparison is never cached — salary inputs are session-local state
  const comparePersonnel = async (
    userIds: string[],
    from: string,
    to: string,
    salaries: Record<string, number>,
  ): Promise<PersonnelRow[]> => {
    const { data, error } = await supabase.rpc('rpc_compare_personnel', {
      p_user_ids: userIds,
      p_from:     from,
      p_to:       to,
      p_salaries: salaries,
    });
    if (error) throw error;
    return (data ?? []) as PersonnelRow[];
  };

  const getRecentActivity = (limit = 15): Promise<ActivityEntry[]> =>
    fetchWithDedup(
      `activity:${limit}`,
      async () => {
        const { data: history, error } = await supabase
          .from('pipeline_stage_history')
          .select(`
            id,
            transitioned_at,
            task:task_id(title, pipeline_id),
            from_stage:from_stage_id(name),
            to_stage:to_stage_id(name, is_terminal, terminal_type),
            moved_by_user:users!transitioned_by(full_name, display_name)
          `)
          .order('transitioned_at', { ascending: false })
          .limit(limit);

        if (error) throw error;

        return (history || []).map((h: any) => ({
          id: h.id,
          transitioned_at: h.transitioned_at,
          task_title: h.task?.title || 'Unknown Task',
          from_stage_name: h.from_stage?.name || 'Start',
          to_stage_name: h.to_stage?.name || 'End',
          moved_by: h.moved_by_user?.display_name || h.moved_by_user?.full_name || 'System',
          is_completion: h.to_stage?.is_terminal && h.to_stage?.terminal_type === 'success'
        }));
      },
      PULSE_TTL_MS,
    );

  const invalidate = (keyPrefix?: string) => {
    if (!keyPrefix) { cache.current.clear(); return; }
    for (const key of cache.current.keys()) {
      if (key.startsWith(keyPrefix)) cache.current.delete(key);
    }
  };

  return (
    <AnalyticsContext.Provider value={{
      getPersonalPulse,
      getUserPerformanceSeries,
      getUserPerformanceSummary,
      getPipelineStageDwell,
      getPipelineThroughput,
      getTargetsStatus,
      comparePersonnel,
      getRecentActivity,
      invalidate,
    }}>
      {children}
    </AnalyticsContext.Provider>
  );
};

export const useAnalytics = () => {
  const ctx = useContext(AnalyticsContext);
  if (!ctx) throw new Error('useAnalytics must be used within AnalyticsProvider');
  return ctx;
};
