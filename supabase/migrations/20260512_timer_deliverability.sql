-- ====================================================================
-- Timer Deliverability: add within_budget_tasks / over_budget_tasks
-- to rpc_get_user_performance_series
-- ====================================================================
-- For each completed task that has an estimated_hours value, compare
-- the user's actual work time (sum of completed work sessions for that
-- task) against the budget: actual <= estimated → within budget.

-- Return type changes require a drop first.
DROP FUNCTION IF EXISTS public.rpc_get_user_performance_series(UUID, TEXT, INT);

CREATE OR REPLACE FUNCTION public.rpc_get_user_performance_series(
  p_user_id     UUID,
  p_period_type TEXT,
  p_n_periods   INT DEFAULT 12
)
RETURNS TABLE (
  period_label        TEXT,
  period_start        TIMESTAMPTZ,
  weight_points       BIGINT,
  active_seconds      BIGINT,
  completed_tasks     BIGINT,
  failed_tasks        BIGINT,
  on_time_tasks       BIGINT,
  revision_count      BIGINT,
  estimated_seconds   BIGINT,
  is_current_period   BOOLEAN,
  within_budget_tasks BIGINT,
  over_budget_tasks   BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH periods AS (
    SELECT
      date_trunc(p_period_type, NOW() - (i || ' ' || p_period_type)::INTERVAL) as p_start,
      CASE
        WHEN p_period_type = 'week'  THEN 'W' || EXTRACT(WEEK FROM NOW() - (i || ' week')::INTERVAL) || ' ' || EXTRACT(YEAR FROM NOW() - (i || ' week')::INTERVAL)
        WHEN p_period_type = 'month' THEN TO_CHAR(NOW() - (i || ' month')::INTERVAL, 'Mon YYYY')
        WHEN p_period_type = 'year'  THEN TO_CHAR(NOW() - (i || ' year')::INTERVAL, 'YYYY')
      END as p_label,
      i = 0 as is_curr
    FROM generate_series(0, p_n_periods - 1) i
  ),
  -- Per-task actual work time for this user (completed sessions only)
  task_actual_time AS (
    SELECT
      tws.task_id,
      SUM(EXTRACT(EPOCH FROM (tws.last_heartbeat_at - tws.started_at))) as actual_seconds
    FROM public.task_work_sessions tws
    WHERE tws.user_id = p_user_id
      AND tws.status = 'completed'
    GROUP BY tws.task_id
  ),
  user_sessions AS (
    SELECT
      date_trunc(p_period_type, tws.started_at) as p_start,
      SUM(EXTRACT(EPOCH FROM (tws.last_heartbeat_at - tws.started_at)))::BIGINT as total_seconds
    FROM public.task_work_sessions tws
    WHERE tws.user_id = p_user_id
      AND tws.started_at >= (SELECT MIN(p_start) FROM periods)
    GROUP BY 1
  ),
  user_tasks AS (
    SELECT
      date_trunc(p_period_type, t.completed_at) as p_start_comp,
      date_trunc(p_period_type, t.failed_at)    as p_start_fail,
      t.id,
      t.weight,
      t.estimated_hours,
      (t.completed_at IS NOT NULL AND (t.due_date IS NULL OR t.completed_at <= t.due_date)) as is_on_time,
      COALESCE((SELECT COUNT(*) - 1 FROM public.pipeline_stage_history psh WHERE psh.task_id = t.id), 0) as revisions,
      -- NULL when no estimate or no recorded sessions (exclude from deliverability)
      CASE
        WHEN t.estimated_hours > 0 AND tat.actual_seconds IS NOT NULL
          THEN tat.actual_seconds <= (t.estimated_hours * 3600)
        ELSE NULL
      END as is_within_budget
    FROM public.tasks t
    JOIN public.task_participants tp ON tp.task_id = t.id
    LEFT JOIN task_actual_time tat ON tat.task_id = t.id
    WHERE tp.user_id = p_user_id
      AND (
        t.completed_at >= (SELECT MIN(p_start) FROM periods)
        OR t.failed_at  >= (SELECT MIN(p_start) FROM periods)
      )
  )
  SELECT
    p.p_label,
    p.p_start,
    COALESCE(SUM(ut.weight) FILTER (WHERE ut.p_start_comp = p.p_start), 0)::BIGINT,
    COALESCE(us.total_seconds, 0)::BIGINT,
    COUNT(ut.id)   FILTER (WHERE ut.p_start_comp = p.p_start)::BIGINT,
    COUNT(ut.id)   FILTER (WHERE ut.p_start_fail = p.p_start)::BIGINT,
    COUNT(ut.id)   FILTER (WHERE ut.p_start_comp = p.p_start AND ut.is_on_time)::BIGINT,
    COALESCE(SUM(ut.revisions) FILTER (WHERE ut.p_start_comp = p.p_start), 0)::BIGINT,
    COALESCE(SUM(ut.estimated_hours * 3600) FILTER (WHERE ut.p_start_comp = p.p_start), 0)::BIGINT,
    p.is_curr,
    COUNT(ut.id)   FILTER (WHERE ut.p_start_comp = p.p_start AND ut.is_within_budget = true)::BIGINT,
    COUNT(ut.id)   FILTER (WHERE ut.p_start_comp = p.p_start AND ut.is_within_budget = false)::BIGINT
  FROM periods p
  LEFT JOIN user_sessions us ON us.p_start = p.p_start
  LEFT JOIN user_tasks ut ON (ut.p_start_comp = p.p_start OR ut.p_start_fail = p.p_start)
  GROUP BY p.p_label, p.p_start, p.is_curr, us.total_seconds
  ORDER BY p.p_start DESC;
END;
$$;
