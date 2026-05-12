-- ====================================================================
-- Fix: rpc_get_user_performance_series and rpc_get_pipeline_throughput
-- must read from analytics_snapshots, not live tasks.
-- 66 archived tasks hold the real historical data — querying only the
-- live tasks table returns mostly zeros.
-- ====================================================================

-- 1. rpc_get_user_performance_series — snapshot-backed
DROP FUNCTION IF EXISTS public.rpc_get_user_performance_series(uuid, text, integer);

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
DECLARE
  v_current_start DATE;
BEGIN
  v_current_start := date_trunc(p_period_type, CURRENT_DATE)::DATE;

  RETURN QUERY
  SELECT
    CASE p_period_type
      WHEN 'week'  THEN 'W' || to_char(gs.ps, 'IW IYYY')
      WHEN 'month' THEN to_char(gs.ps, 'Mon YYYY')
      WHEN 'year'  THEN to_char(gs.ps, 'YYYY')
    END                                                               AS period_label,
    gs.ps::TIMESTAMPTZ                                                AS period_start,
    COALESCE((snap.data->>'weight_points')::NUMERIC::BIGINT,      0)  AS weight_points,
    COALESCE((snap.data->>'active_seconds')::NUMERIC::BIGINT,     0)  AS active_seconds,
    COALESCE((snap.data->>'completed_tasks')::NUMERIC::BIGINT,    0)  AS completed_tasks,
    COALESCE((snap.data->>'failed_tasks')::NUMERIC::BIGINT,       0)  AS failed_tasks,
    COALESCE((snap.data->>'on_time_tasks')::NUMERIC::BIGINT,      0)  AS on_time_tasks,
    COALESCE((snap.data->>'revision_count')::NUMERIC::BIGINT,     0)  AS revision_count,
    COALESCE((snap.data->>'estimated_seconds')::NUMERIC::BIGINT,  0)  AS estimated_seconds,
    gs.ps = v_current_start                                            AS is_current_period,
    COALESCE((snap.data->>'within_budget_tasks')::NUMERIC::BIGINT, 0) AS within_budget_tasks,
    COALESCE((snap.data->>'over_budget_tasks')::NUMERIC::BIGINT,   0) AS over_budget_tasks
  FROM
    generate_series(0, p_n_periods - 1) AS gs_i(i),
    LATERAL (
      SELECT (v_current_start - (gs_i.i * ('1 ' || p_period_type)::INTERVAL))::DATE AS ps
    ) AS gs
  LEFT JOIN public.analytics_snapshots snap
    ON  snap.snapshot_type = 'user_performance'
    AND snap.subject_id    = p_user_id
    AND snap.period_type   = p_period_type
    AND snap.period_start  = gs.ps
  ORDER BY gs_i.i;
END;
$$;


-- 2. rpc_get_pipeline_throughput — snapshot-backed
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
DECLARE
  v_current_start DATE;
BEGIN
  IF NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access Denied: analytics.view required.';
  END IF;

  v_current_start := date_trunc(p_period_type, CURRENT_DATE)::DATE;

  RETURN QUERY
  SELECT
    CASE p_period_type
      WHEN 'week'  THEN 'W' || to_char(gs.ps, 'IW IYYY')
      WHEN 'month' THEN to_char(gs.ps, 'Mon YYYY')
      WHEN 'year'  THEN to_char(gs.ps, 'YYYY')
    END                                                               AS period_label,
    gs.ps                                                             AS period_start,
    COALESCE((snap.data->>'tasks_entered')::NUMERIC::BIGINT,    0)   AS tasks_entered,
    COALESCE((snap.data->>'tasks_succeeded')::NUMERIC::BIGINT,  0)   AS tasks_succeeded,
    COALESCE((snap.data->>'tasks_failed')::NUMERIC::BIGINT,     0)   AS tasks_failed,
    CASE
      WHEN COALESCE((snap.data->>'tasks_succeeded')::BIGINT, 0)
         + COALESCE((snap.data->>'tasks_failed')::BIGINT,    0) = 0 THEN NULL
      ELSE ROUND(
        (snap.data->>'tasks_succeeded')::NUMERIC /
        NULLIF(
          (snap.data->>'tasks_succeeded')::NUMERIC +
          (snap.data->>'tasks_failed')::NUMERIC, 0
        ) * 100, 1
      )
    END                                                               AS success_rate
  FROM
    generate_series(0, p_n_periods - 1) AS gs_i(i),
    LATERAL (
      SELECT (v_current_start - (gs_i.i * ('1 ' || p_period_type)::INTERVAL))::DATE AS ps
    ) AS gs
  LEFT JOIN public.analytics_snapshots snap
    ON  snap.snapshot_type = 'pipeline_performance'
    AND snap.subject_id    = p_pipeline_id
    AND snap.period_type   = p_period_type
    AND snap.period_start  = gs.ps
  ORDER BY gs_i.i;
END;
$$;
