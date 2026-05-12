-- ====================================================================
-- Fix: tasks table has no failed_at column.
-- Task failure is derived from pipeline_stage_history transitions
-- to terminal stages where terminal_type != 'success'.
-- Applies to: rpc_get_user_performance_series,
--             rpc_get_user_performance_summary,
--             rpc_get_pipeline_throughput,
--             rpc_compare_personnel
-- ====================================================================

-- 1. rpc_get_user_performance_series
DROP FUNCTION IF EXISTS public.rpc_get_user_performance_series(UUID, TEXT, INT);

CREATE FUNCTION public.rpc_get_user_performance_series(
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
  task_failure AS (
    SELECT psh.task_id, MAX(psh.transitioned_at) as failed_at
    FROM public.pipeline_stage_history psh
    JOIN public.pipeline_stages ps ON ps.id = psh.to_stage_id
    WHERE ps.is_terminal = true AND ps.terminal_type != 'success'
    GROUP BY psh.task_id
  ),
  task_actual_time AS (
    SELECT tws.task_id, SUM(EXTRACT(EPOCH FROM (tws.last_heartbeat_at - tws.started_at))) as actual_seconds
    FROM public.task_work_sessions tws
    WHERE tws.user_id = p_user_id AND tws.status = 'completed'
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
      date_trunc(p_period_type, tf.failed_at)   as p_start_fail,
      t.id,
      t.weight,
      t.estimated_hours,
      (t.completed_at IS NOT NULL AND (t.due_date IS NULL OR t.completed_at <= t.due_date)) as is_on_time,
      COALESCE((SELECT COUNT(*) - 1 FROM public.pipeline_stage_history psh WHERE psh.task_id = t.id), 0) as revisions,
      CASE
        WHEN t.estimated_hours > 0 AND tat.actual_seconds IS NOT NULL
          THEN tat.actual_seconds <= (t.estimated_hours * 3600)
        ELSE NULL
      END as is_within_budget
    FROM public.tasks t
    JOIN public.task_participants tp ON tp.task_id = t.id
    LEFT JOIN task_failure    tf  ON tf.task_id  = t.id
    LEFT JOIN task_actual_time tat ON tat.task_id = t.id
    WHERE tp.user_id = p_user_id
      AND (
        t.completed_at >= (SELECT MIN(p_start) FROM periods)
        OR tf.failed_at >= (SELECT MIN(p_start) FROM periods)
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


-- 2. rpc_get_user_performance_summary
CREATE OR REPLACE FUNCTION public.rpc_get_user_performance_summary(
  p_user_id UUID,
  p_from    TIMESTAMPTZ,
  p_to      TIMESTAMPTZ
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result JSON;
BEGIN
  WITH task_failure AS (
    SELECT psh.task_id, MAX(psh.transitioned_at) as failed_at
    FROM public.pipeline_stage_history psh
    JOIN public.pipeline_stages ps ON ps.id = psh.to_stage_id
    WHERE ps.is_terminal = true AND ps.terminal_type != 'success'
    GROUP BY psh.task_id
  )
  SELECT json_build_object(
    'weight_points',     COALESCE(SUM(t.weight), 0),
    'active_seconds',    COALESCE((
      SELECT SUM(EXTRACT(EPOCH FROM (last_heartbeat_at - started_at)))
      FROM public.task_work_sessions
      WHERE user_id = p_user_id AND started_at BETWEEN p_from AND p_to
    ), 0),
    'completed_tasks',   COUNT(t.id) FILTER (WHERE t.completed_at IS NOT NULL),
    'failed_tasks',      COUNT(t.id) FILTER (WHERE tf.failed_at IS NOT NULL),
    'on_time_tasks',     COUNT(t.id) FILTER (WHERE t.completed_at IS NOT NULL AND (t.due_date IS NULL OR t.completed_at <= t.due_date)),
    'estimated_seconds', COALESCE(SUM(t.estimated_hours * 3600) FILTER (WHERE t.completed_at IS NOT NULL), 0),
    'revision_count',    COALESCE((
      SELECT COUNT(*) FROM public.pipeline_stage_history psh
      JOIN public.tasks t2 ON t2.id = psh.task_id
      JOIN public.task_participants tp2 ON tp2.task_id = t2.id
      WHERE tp2.user_id = p_user_id AND t2.completed_at BETWEEN p_from AND p_to
    ), 0) - COUNT(t.id) FILTER (WHERE t.completed_at IS NOT NULL)
  ) INTO v_result
  FROM public.tasks t
  JOIN public.task_participants tp ON tp.task_id = t.id
  LEFT JOIN task_failure tf ON tf.task_id = t.id
  WHERE tp.user_id = p_user_id
    AND (t.completed_at BETWEEN p_from AND p_to OR tf.failed_at BETWEEN p_from AND p_to);

  RETURN v_result;
END;
$$;


-- 3. rpc_get_pipeline_throughput
CREATE OR REPLACE FUNCTION public.rpc_get_pipeline_throughput(
  p_pipeline_id UUID,
  p_period_type TEXT,
  p_n_periods   INT DEFAULT 12
)
RETURNS TABLE (
  period_label    TEXT,
  period_start    TIMESTAMPTZ,
  tasks_succeeded BIGINT,
  tasks_failed    BIGINT,
  success_rate    NUMERIC
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
        WHEN p_period_type = 'week'  THEN 'W' || EXTRACT(WEEK FROM NOW() - (i || ' week')::INTERVAL)
        WHEN p_period_type = 'month' THEN TO_CHAR(NOW() - (i || ' month')::INTERVAL, 'Mon YYYY')
        WHEN p_period_type = 'year'  THEN TO_CHAR(NOW() - (i || ' year')::INTERVAL, 'YYYY')
      END as p_label
    FROM generate_series(0, p_n_periods - 1) i
  ),
  task_failure AS (
    SELECT psh.task_id, MAX(psh.transitioned_at) as failed_at
    FROM public.pipeline_stage_history psh
    JOIN public.pipeline_stages ps ON ps.id = psh.to_stage_id
    WHERE ps.is_terminal = true AND ps.terminal_type != 'success'
    GROUP BY psh.task_id
  ),
  counts AS (
    SELECT
      date_trunc(p_period_type, t.completed_at) as p_start_comp,
      date_trunc(p_period_type, tf.failed_at)   as p_start_fail,
      t.id
    FROM public.tasks t
    LEFT JOIN task_failure tf ON tf.task_id = t.id
    WHERE t.pipeline_id = p_pipeline_id
      AND (
        t.completed_at >= (SELECT MIN(p_start) FROM periods)
        OR tf.failed_at >= (SELECT MIN(p_start) FROM periods)
      )
  )
  SELECT
    p.p_label,
    p.p_start,
    COUNT(c.id) FILTER (WHERE c.p_start_comp = p.p_start)::BIGINT,
    COUNT(c.id) FILTER (WHERE c.p_start_fail = p.p_start)::BIGINT,
    COALESCE(
      (COUNT(c.id) FILTER (WHERE c.p_start_comp = p.p_start)::NUMERIC /
       NULLIF(COUNT(c.id) FILTER (WHERE c.p_start_comp = p.p_start OR c.p_start_fail = p.p_start), 0)) * 100,
      100
    )::NUMERIC
  FROM periods p
  LEFT JOIN counts c ON (c.p_start_comp = p.p_start OR c.p_start_fail = p.p_start)
  GROUP BY p.p_label, p.p_start
  ORDER BY p.p_start DESC;
END;
$$;


-- 4. rpc_compare_personnel
CREATE OR REPLACE FUNCTION public.rpc_compare_personnel(
  p_user_ids UUID[],
  p_from     TIMESTAMPTZ,
  p_to       TIMESTAMPTZ,
  p_salaries JSON DEFAULT '{}'::JSON
)
RETURNS TABLE (
  user_id           UUID,
  full_name         TEXT,
  avatar_url        TEXT,
  weight_points     BIGINT,
  active_hours      NUMERIC,
  completed_tasks   BIGINT,
  failed_tasks      BIGINT,
  on_time_rate      NUMERIC,
  timer_efficiency  NUMERIC,
  revision_count    BIGINT,
  daily_rate_usd    NUMERIC,
  total_cost_usd    NUMERIC,
  cost_per_point    NUMERIC,
  points_per_hour   NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH task_failure AS (
    SELECT psh.task_id, MAX(psh.transitioned_at) as failed_at
    FROM public.pipeline_stage_history psh
    JOIN public.pipeline_stages ps ON ps.id = psh.to_stage_id
    WHERE ps.is_terminal = true AND ps.terminal_type != 'success'
    GROUP BY psh.task_id
  ),
  stats AS (
    SELECT
      u.id as u_id,
      u.full_name as u_name,
      u.avatar_url as u_avatar,
      COALESCE(SUM(t.weight) FILTER (WHERE t.completed_at BETWEEN p_from AND p_to), 0)::BIGINT as pts,
      COALESCE((
        SELECT SUM(EXTRACT(EPOCH FROM (last_heartbeat_at - started_at)))/3600.0
        FROM public.task_work_sessions WHERE user_id = u.id AND started_at BETWEEN p_from AND p_to
      ), 0)::NUMERIC as hrs,
      COUNT(t.id) FILTER (WHERE t.completed_at BETWEEN p_from AND p_to)::BIGINT as comp,
      COUNT(t.id) FILTER (WHERE tf.failed_at BETWEEN p_from AND p_to)::BIGINT as fail,
      COALESCE(
        (COUNT(t.id) FILTER (WHERE t.completed_at BETWEEN p_from AND p_to AND (t.due_date IS NULL OR t.completed_at <= t.due_date))::NUMERIC /
         NULLIF(COUNT(t.id) FILTER (WHERE t.completed_at BETWEEN p_from AND p_to OR tf.failed_at BETWEEN p_from AND p_to), 0)) * 100,
        null
      )::NUMERIC as ot_rate,
      COALESCE(
        ((SELECT SUM(EXTRACT(EPOCH FROM (last_heartbeat_at - started_at)))
          FROM public.task_work_sessions WHERE user_id = u.id AND started_at BETWEEN p_from AND p_to) /
         NULLIF(SUM(t.estimated_hours * 3600) FILTER (WHERE t.completed_at BETWEEN p_from AND p_to), 0)) * 100,
        null
      )::NUMERIC as eff,
      COALESCE((
        SELECT COUNT(*) FROM public.pipeline_stage_history psh
        JOIN public.tasks t2 ON t2.id = psh.task_id
        JOIN public.task_participants tp2 ON tp2.task_id = t2.id
        WHERE tp2.user_id = u.id AND t2.completed_at BETWEEN p_from AND p_to
      ), 0) - COUNT(t.id) FILTER (WHERE t.completed_at BETWEEN p_from AND p_to) as revs
    FROM public.users u
    LEFT JOIN public.task_participants tp ON tp.user_id = u.id
    LEFT JOIN public.tasks t ON t.id = tp.task_id
    LEFT JOIN task_failure tf ON tf.task_id = t.id
    WHERE u.id = ANY(p_user_ids)
    GROUP BY u.id, u.full_name, u.avatar_url
  )
  SELECT
    s.u_id,
    s.u_name,
    s.u_avatar,
    s.pts,
    s.hrs,
    s.comp,
    s.fail,
    s.ot_rate,
    s.eff,
    s.revs,
    (p_salaries->>(s.u_id::TEXT))::NUMERIC,
    ((p_salaries->>(s.u_id::TEXT))::NUMERIC * (EXTRACT(EPOCH FROM (p_to - p_from)) / 86400.0))::NUMERIC,
    ((p_salaries->>(s.u_id::TEXT))::NUMERIC * (EXTRACT(EPOCH FROM (p_to - p_from)) / 86400.0) / NULLIF(s.pts, 0))::NUMERIC,
    (s.pts / NULLIF(s.hrs, 0))::NUMERIC
  FROM stats s;
END;
$$;
