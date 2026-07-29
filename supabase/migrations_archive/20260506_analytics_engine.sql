-- ====================================================================
-- Analytics Engine — Phase 2: Implementation
-- ====================================================================

-- 1. Permissions
INSERT INTO public.permissions (key, label)
VALUES 
  ('analytics.view', 'View Analytics Dashboard'),
  ('analytics.compare', 'Compare Personnel Performance')
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label;

-- 2. Helper: rpc_get_user_performance_series
-- p_period_type: 'week', 'month', 'year'
CREATE OR REPLACE FUNCTION public.rpc_get_user_performance_series(
  p_user_id     UUID,
  p_period_type TEXT,
  p_n_periods   INT DEFAULT 12
)
RETURNS TABLE (
  period_label      TEXT,
  period_start      TIMESTAMPTZ,
  weight_points     BIGINT,
  active_seconds    BIGINT,
  completed_tasks   BIGINT,
  failed_tasks      BIGINT,
  on_time_tasks     BIGINT,
  revision_count    BIGINT,
  estimated_seconds BIGINT,
  is_current_period BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH periods AS (
    -- Generate the time buckets
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
      date_trunc(p_period_type, t.failed_at) as p_start_fail,
      t.id,
      t.weight,
      t.estimated_hours,
      -- Check if it was on time (completed_at <= due_date)
      (t.completed_at IS NOT NULL AND (t.due_date IS NULL OR t.completed_at <= t.due_date)) as is_on_time,
      -- Revisions: count history entries for this task beyond initial creation
      COALESCE((SELECT COUNT(*) - 1 FROM public.pipeline_stage_history psh WHERE psh.task_id = t.id), 0) as revisions
    FROM public.tasks t
    JOIN public.task_participants tp ON tp.task_id = t.id
    WHERE tp.user_id = p_user_id
      AND (t.completed_at >= (SELECT MIN(p_start) FROM periods) OR t.failed_at >= (SELECT MIN(p_start) FROM periods))
  )
  SELECT 
    p.p_label,
    p.p_start,
    COALESCE(SUM(ut.weight) FILTER (WHERE ut.p_start_comp = p.p_start), 0)::BIGINT as weight_points,
    COALESCE(us.total_seconds, 0)::BIGINT as active_seconds,
    COUNT(ut.id) FILTER (WHERE ut.p_start_comp = p.p_start)::BIGINT as completed_tasks,
    COUNT(ut.id) FILTER (WHERE ut.p_start_fail = p.p_start)::BIGINT as failed_tasks,
    COUNT(ut.id) FILTER (WHERE ut.p_start_comp = p.p_start AND ut.is_on_time)::BIGINT as on_time_tasks,
    COALESCE(SUM(ut.revisions) FILTER (WHERE ut.p_start_comp = p.p_start), 0)::BIGINT as revision_count,
    COALESCE(SUM(ut.estimated_hours * 3600) FILTER (WHERE ut.p_start_comp = p.p_start), 0)::BIGINT as estimated_seconds,
    p.is_curr
  FROM periods p
  LEFT JOIN user_sessions us ON us.p_start = p.p_start
  LEFT JOIN user_tasks ut ON (ut.p_start_comp = p.p_start OR ut.p_start_fail = p.p_start)
  GROUP BY p.p_label, p.p_start, p.is_curr, us.total_seconds
  ORDER BY p.p_start DESC;
END;
$$;

-- 3. rpc_get_user_performance_summary
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
  SELECT json_build_object(
    'weight_points',     COALESCE(SUM(t.weight), 0),
    'active_seconds',    COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (last_heartbeat_at - started_at))) FROM public.task_work_sessions WHERE user_id = p_user_id AND started_at BETWEEN p_from AND p_to), 0),
    'completed_tasks',   COUNT(t.id) FILTER (WHERE t.completed_at IS NOT NULL),
    'failed_tasks',      COUNT(t.id) FILTER (WHERE t.failed_at IS NOT NULL),
    'on_time_tasks',     COUNT(t.id) FILTER (WHERE t.completed_at IS NOT NULL AND (t.due_date IS NULL OR t.completed_at <= t.due_date)),
    'estimated_seconds', COALESCE(SUM(t.estimated_hours * 3600) FILTER (WHERE t.completed_at IS NOT NULL), 0),
    'revision_count',    COALESCE((SELECT COUNT(*) FROM public.pipeline_stage_history psh JOIN public.tasks t2 ON t2.id = psh.task_id JOIN public.task_participants tp ON tp.task_id = t2.id WHERE tp.user_id = p_user_id AND t2.completed_at BETWEEN p_from AND p_to), 0) - COUNT(t.id) FILTER (WHERE t.completed_at IS NOT NULL)
  ) INTO v_result
  FROM public.tasks t
  JOIN public.task_participants tp ON tp.task_id = t.id
  WHERE tp.user_id = p_user_id
    AND (t.completed_at BETWEEN p_from AND p_to OR t.failed_at BETWEEN p_from AND p_to);

  RETURN v_result;
END;
$$;

-- 4. Fix rpc_get_personal_pulse
CREATE OR REPLACE FUNCTION public.rpc_get_personal_pulse()
RETURNS TABLE (
  daily_points         BIGINT,
  monthly_points       BIGINT,
  active_seconds_today BIGINT,
  flap_rate_score      NUMERIC,
  is_working           BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(t.weight) FILTER (WHERE t.completed_at >= date_trunc('day', NOW())), 0)::BIGINT as daily_points,
    COALESCE(SUM(t.weight) FILTER (WHERE t.completed_at >= date_trunc('month', NOW())), 0)::BIGINT as monthly_points,
    COALESCE((
      SELECT SUM(EXTRACT(EPOCH FROM (last_heartbeat_at - started_at)))::BIGINT
      FROM public.task_work_sessions
      WHERE user_id = v_user_id AND started_at >= date_trunc('day', NOW())
    ), 0) as active_seconds_today,
    COALESCE((
      SELECT (COUNT(psh.id)::NUMERIC / NULLIF(COUNT(DISTINCT t2.id), 0))
      FROM public.pipeline_stage_history psh
      JOIN public.tasks t2 ON t2.id = psh.task_id
      JOIN public.task_participants tp2 ON tp2.task_id = t2.id
      WHERE tp2.user_id = v_user_id AND psh.created_at >= NOW() - INTERVAL '30 days'
    ), 1.0)::NUMERIC as flap_rate_score,
    EXISTS(
      SELECT 1 FROM public.task_work_sessions
      WHERE user_id = v_user_id AND status = 'active'
    ) as is_working
  FROM public.tasks t
  JOIN public.task_participants tp ON tp.task_id = t.id
  WHERE tp.user_id = v_user_id;
END;
$$;

-- 5. Admin: rpc_get_pipeline_stage_dwell
CREATE OR REPLACE FUNCTION public.rpc_get_pipeline_stage_dwell(
  p_pipeline_id UUID,
  p_from        TIMESTAMPTZ,
  p_to          TIMESTAMPTZ
)
RETURNS TABLE (
  stage_id       UUID,
  stage_name     TEXT,
  stage_position INT,
  avg_seconds    BIGINT,
  median_seconds BIGINT,
  p75_seconds    BIGINT,
  sample_count   BIGINT,
  reversal_count BIGINT,
  is_bottleneck  BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH transitions AS (
    SELECT 
      psh.from_stage_id,
      psh.to_stage_id,
      psh.created_at,
      LAG(psh.created_at) OVER (PARTITION BY psh.task_id ORDER BY psh.created_at) as prev_at,
      psh.from_stage_name
    FROM public.pipeline_stage_history psh
    WHERE psh.pipeline_id = p_pipeline_id
      AND psh.created_at BETWEEN p_from AND p_to
  ),
  dwell_times AS (
    SELECT 
      from_stage_id as s_id,
      EXTRACT(EPOCH FROM (created_at - prev_at)) as duration
    FROM transitions
    WHERE from_stage_id IS NOT NULL AND prev_at IS NOT NULL
  )
  SELECT 
    ps.id,
    ps.name,
    ps.position,
    COALESCE(AVG(dt.duration), 0)::BIGINT,
    COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt.duration), 0)::BIGINT,
    COALESCE(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY dt.duration), 0)::BIGINT,
    COUNT(dt.duration)::BIGINT,
    (SELECT COUNT(*) FROM public.pipeline_stage_history psh2 
     JOIN public.pipeline_stages ps_from ON ps_from.id = psh2.from_stage_id
     JOIN public.pipeline_stages ps_to ON ps_to.id = psh2.to_stage_id
     WHERE psh2.pipeline_id = p_pipeline_id 
       AND psh2.to_stage_id = ps.id
       AND ps_to.position < ps_from.position
       AND psh2.created_at BETWEEN p_from AND p_to)::BIGINT as reversals,
    FALSE as is_bottleneck
  FROM public.pipeline_stages ps
  LEFT JOIN dwell_times dt ON dt.s_id = ps.id
  WHERE ps.pipeline_id = p_pipeline_id
  GROUP BY ps.id, ps.name, ps.position
  ORDER BY ps.position ASC;
END;
$$;

-- 6. Admin: rpc_get_pipeline_throughput
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
  counts AS (
    SELECT 
      date_trunc(p_period_type, t.completed_at) as p_start_comp,
      date_trunc(p_period_type, t.failed_at) as p_start_fail,
      t.id
    FROM public.tasks t
    WHERE t.pipeline_id = p_pipeline_id
      AND (t.completed_at >= (SELECT MIN(p_start) FROM periods) OR t.failed_at >= (SELECT MIN(p_start) FROM periods))
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

-- 7. Admin: rpc_compare_personnel
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
  WITH stats AS (
    SELECT 
      u.id as u_id,
      u.full_name as u_name,
      u.avatar_url as u_avatar,
      COALESCE(SUM(t.weight) FILTER (WHERE t.completed_at BETWEEN p_from AND p_to), 0)::BIGINT as pts,
      COALESCE((SELECT SUM(EXTRACT(EPOCH FROM (last_heartbeat_at - started_at)))/3600.0 FROM public.task_work_sessions WHERE user_id = u.id AND started_at BETWEEN p_from AND p_to), 0)::NUMERIC as hrs,
      COUNT(t.id) FILTER (WHERE t.completed_at BETWEEN p_from AND p_to)::BIGINT as comp,
      COUNT(t.id) FILTER (WHERE t.failed_at BETWEEN p_from AND p_to)::BIGINT as fail,
      COALESCE(
        (COUNT(t.id) FILTER (WHERE t.completed_at BETWEEN p_from AND p_to AND (t.due_date IS NULL OR t.completed_at <= t.due_date))::NUMERIC / 
         NULLIF(COUNT(t.id) FILTER (WHERE t.completed_at BETWEEN p_from AND p_to OR t.failed_at BETWEEN p_from AND p_to), 0)) * 100,
        null
      )::NUMERIC as ot_rate,
      COALESCE(
        ((SELECT SUM(EXTRACT(EPOCH FROM (last_heartbeat_at - started_at))) FROM public.task_work_sessions WHERE user_id = u.id AND started_at BETWEEN p_from AND p_to) / 
         NULLIF(SUM(t.estimated_hours * 3600) FILTER (WHERE t.completed_at BETWEEN p_from AND p_to), 0)) * 100,
        null
      )::NUMERIC as eff,
      COALESCE((SELECT COUNT(*) FROM public.pipeline_stage_history psh JOIN public.tasks t2 ON t2.id = psh.task_id JOIN public.task_participants tp ON tp.task_id = t2.id WHERE tp.user_id = u.id AND t2.completed_at BETWEEN p_from AND p_to), 0) - COUNT(t.id) FILTER (WHERE t.completed_at BETWEEN p_from AND p_to) as revs
    FROM public.users u
    LEFT JOIN public.task_participants tp ON tp.user_id = u.id
    LEFT JOIN public.tasks t ON t.id = tp.task_id
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
    (p_salaries->>(s.u_id::TEXT))::NUMERIC as daily_rate,
    ((p_salaries->>(s.u_id::TEXT))::NUMERIC * (EXTRACT(EPOCH FROM (p_to - p_from)) / 86400.0))::NUMERIC as total_cost,
    ((p_salaries->>(s.u_id::TEXT))::NUMERIC * (EXTRACT(EPOCH FROM (p_to - p_from)) / 86400.0) / NULLIF(s.pts, 0))::NUMERIC as cost_pt,
    (s.pts / NULLIF(s.hrs, 0))::NUMERIC as pts_hr
  FROM stats s;
END;
$$;
