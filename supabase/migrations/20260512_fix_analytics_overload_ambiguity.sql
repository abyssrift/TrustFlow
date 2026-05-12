-- ====================================================================
-- Fix PGRST203: drop old TIMESTAMPTZ overloads that conflicted with
-- the newer DATE-based versions, causing PostgREST ambiguity errors.
-- Also fix rpc_get_pipeline_throughput to include tasks_entered and
-- switch period_start to DATE for consistency.
-- ====================================================================

-- 1. Drop old TIMESTAMPTZ overloads
DROP FUNCTION IF EXISTS public.rpc_compare_personnel(uuid[], timestamptz, timestamptz, json);
DROP FUNCTION IF EXISTS public.rpc_get_pipeline_stage_dwell(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.rpc_get_user_performance_summary(uuid, timestamptz, timestamptz);

-- 2. Fix rpc_get_pipeline_throughput — add tasks_entered, switch to DATE
DROP FUNCTION IF EXISTS public.rpc_get_pipeline_throughput(uuid, text, integer);

CREATE FUNCTION public.rpc_get_pipeline_throughput(
  p_pipeline_id UUID,
  p_period_type TEXT,
  p_n_periods   INT DEFAULT 12
)
RETURNS TABLE (
  period_label    TEXT,
  period_start    DATE,
  tasks_entered   BIGINT,
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
      date_trunc(p_period_type, CURRENT_DATE - (i || ' ' || p_period_type)::INTERVAL)::DATE AS p_start,
      CASE
        WHEN p_period_type = 'week'  THEN 'W' || TO_CHAR(CURRENT_DATE - (i || ' week')::INTERVAL, 'IW IYYY')
        WHEN p_period_type = 'month' THEN TO_CHAR(CURRENT_DATE - (i || ' month')::INTERVAL, 'Mon YYYY')
        WHEN p_period_type = 'year'  THEN TO_CHAR(CURRENT_DATE - (i || ' year')::INTERVAL, 'YYYY')
      END AS p_label
    FROM generate_series(0, p_n_periods - 1) i
  ),
  task_failure AS (
    SELECT psh.task_id, date_trunc(p_period_type, MAX(psh.transitioned_at))::DATE AS failed_at
    FROM public.pipeline_stage_history psh
    JOIN public.pipeline_stages ps ON ps.id = psh.to_stage_id
    WHERE ps.pipeline_id = p_pipeline_id
      AND ps.is_terminal = TRUE AND ps.terminal_type != 'success'
    GROUP BY psh.task_id
  ),
  counts AS (
    SELECT
      date_trunc(p_period_type, t.created_at)::DATE   AS p_entered,
      date_trunc(p_period_type, t.completed_at)::DATE AS p_comp,
      date_trunc(p_period_type, tf.failed_at)::DATE   AS p_fail,
      t.id
    FROM public.tasks t
    LEFT JOIN task_failure tf ON tf.task_id = t.id
    WHERE t.pipeline_id = p_pipeline_id
      AND (
        date_trunc(p_period_type, t.created_at)::DATE    >= (SELECT MIN(p_start) FROM periods)
        OR date_trunc(p_period_type, t.completed_at)::DATE >= (SELECT MIN(p_start) FROM periods)
        OR tf.failed_at                                    >= (SELECT MIN(p_start) FROM periods)
      )
  )
  SELECT
    p.p_label,
    p.p_start,
    COUNT(c.id) FILTER (WHERE c.p_entered = p.p_start)::BIGINT,
    COUNT(c.id) FILTER (WHERE c.p_comp    = p.p_start)::BIGINT,
    COUNT(c.id) FILTER (WHERE c.p_fail    = p.p_start)::BIGINT,
    CASE
      WHEN COUNT(c.id) FILTER (WHERE c.p_comp = p.p_start OR c.p_fail = p.p_start) = 0 THEN NULL
      ELSE ROUND(
        COUNT(c.id) FILTER (WHERE c.p_comp = p.p_start)::NUMERIC /
        COUNT(c.id) FILTER (WHERE c.p_comp = p.p_start OR c.p_fail = p.p_start) * 100,
        1
      )
    END
  FROM periods p
  LEFT JOIN counts c ON (c.p_entered = p.p_start OR c.p_comp = p.p_start OR c.p_fail = p.p_start)
  GROUP BY p.p_label, p.p_start
  ORDER BY p.p_start DESC;
END;
$$;
