
-- FIX: Qualify period_start column in analytics RPCs to avoid ambiguity with output column name.

CREATE OR REPLACE FUNCTION public.rpc_get_user_performance_series(
  p_user_id     uuid,
  p_period_type text,
  p_n_periods   int DEFAULT 12
)
RETURNS TABLE (
  period_start       date,
  period_label       text,
  weight_points      bigint,
  active_seconds     bigint,
  estimated_seconds  numeric,
  completed_tasks    bigint,
  failed_tasks       bigint,
  revision_count     bigint,
  on_time_tasks      bigint,
  is_current_period  boolean
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_caller_id      uuid := auth.uid();
  v_company_id     uuid;
  v_periods        date[];
  v_ps             date;
  v_current_start  date;
  v_snap_age       interval;
  i                int;
BEGIN
  -- Only the user themselves or someone with analytics.view can read this
  SELECT u.company_id INTO v_company_id
  FROM public.users u
  WHERE u.id = p_user_id;

  IF v_company_id IS NULL THEN RETURN; END IF;

  IF v_caller_id <> p_user_id
     AND NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access Denied: analytics.view required to read another user''s performance.';
  END IF;

  -- Build array of period start dates (newest first: 0 = current, n-1 = oldest)
  v_current_start := date_trunc(p_period_type, CURRENT_DATE)::date;

  v_periods := ARRAY(
    SELECT (v_current_start - (gs.i * ('1 ' || p_period_type)::interval))::date
    FROM generate_series(0, p_n_periods - 1) AS gs(i)
  );

  -- Lazy-flush: ensure each period has a reasonably fresh snapshot.
  FOR i IN 0 .. array_length(v_periods, 1) - 1 LOOP
    v_ps       := v_periods[i + 1];
    v_snap_age := CASE WHEN i = 0 THEN interval '5 minutes' ELSE interval '9999 days' END;

    IF NOT EXISTS (
      SELECT 1 FROM public.analytics_snapshots s
      WHERE s.snapshot_type = 'user_performance'
        AND s.subject_id    = p_user_id
        AND s.period_type   = p_period_type
        AND s.period_start  = v_ps
        AND s.computed_at   > now() - v_snap_age
    ) THEN
      PERFORM public.rpc_flush_user_snapshot(p_user_id, p_period_type, v_ps);
    END IF;
  END LOOP;

  -- Return all periods, left-joining snapshots (zeros for empty periods)
  RETURN QUERY
  SELECT
    gs.ps                                                          AS period_start,
    CASE p_period_type
      WHEN 'week'  THEN 'W' || to_char(gs.ps, 'IW IYYY')
      WHEN 'month' THEN to_char(gs.ps, 'Mon YYYY')
      WHEN 'year'  THEN to_char(gs.ps, 'YYYY')
    END                                                            AS period_label,
    COALESCE((snap.data->>'weight_points')::bigint,    0)         AS weight_points,
    COALESCE((snap.data->>'active_seconds')::bigint,   0)         AS active_seconds,
    COALESCE((snap.data->>'estimated_seconds')::numeric,0)        AS estimated_seconds,
    COALESCE((snap.data->>'completed_tasks')::bigint,  0)         AS completed_tasks,
    COALESCE((snap.data->>'failed_tasks')::bigint,     0)         AS failed_tasks,
    COALESCE((snap.data->>'revision_count')::bigint,   0)         AS revision_count,
    COALESCE((snap.data->>'on_time_tasks')::bigint,    0)         AS on_time_tasks,
    gs.ps = v_current_start                                        AS is_current_period
  FROM
    unnest(v_periods) WITH ORDINALITY AS gs(ps, ord)
  LEFT JOIN public.analytics_snapshots snap
    ON  snap.snapshot_type = 'user_performance'
    AND snap.subject_id    = p_user_id
    AND snap.period_type   = p_period_type
    AND snap.period_start  = gs.ps
  ORDER BY gs.ord;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_get_pipeline_throughput(
  p_pipeline_id uuid,
  p_period_type text,
  p_n_periods   int DEFAULT 12
)
RETURNS TABLE (
  period_start    date,
  period_label    text,
  tasks_entered   bigint,
  tasks_succeeded bigint,
  tasks_failed    bigint,
  success_rate    numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_company_id     uuid;
  v_current_start  date;
  v_ps             date;
  v_snap_age       interval;
  i                int;
BEGIN
  IF NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access Denied: analytics.view required.';
  END IF;

  SELECT company_id INTO v_company_id FROM public.pipelines WHERE id = p_pipeline_id;
  IF v_company_id IS NULL THEN RETURN; END IF;

  v_current_start := date_trunc(p_period_type, CURRENT_DATE)::date;

  -- Lazy-flush pipeline snapshots
  FOR i IN 0 .. p_n_periods - 1 LOOP
    v_ps       := (v_current_start - (i * ('1 ' || p_period_type)::interval))::date;
    v_snap_age := CASE WHEN i = 0 THEN interval '15 minutes' ELSE interval '9999 days' END;

    IF NOT EXISTS (
      SELECT 1 FROM public.analytics_snapshots s
      WHERE s.snapshot_type = 'pipeline_performance'
        AND s.subject_id    = p_pipeline_id
        AND s.period_type   = p_period_type
        AND s.period_start  = v_ps
        AND s.computed_at   > now() - v_snap_age
    ) THEN
      PERFORM public.rpc_flush_pipeline_snapshot(p_pipeline_id, p_period_type, v_ps);
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT
    gs.ps                                                              AS period_start,
    CASE p_period_type
      WHEN 'week'  THEN 'W' || to_char(gs.ps, 'IW IYYY')
      WHEN 'month' THEN to_char(gs.ps, 'Mon YYYY')
      WHEN 'year'  THEN to_char(gs.ps, 'YYYY')
    END                                                                AS period_label,
    COALESCE((snap.data->>'tasks_entered')::bigint,   0)              AS tasks_entered,
    COALESCE((snap.data->>'tasks_succeeded')::bigint, 0)              AS tasks_succeeded,
    COALESCE((snap.data->>'tasks_failed')::bigint,    0)              AS tasks_failed,
    CASE
      WHEN COALESCE((snap.data->>'tasks_succeeded')::bigint, 0)
         + COALESCE((snap.data->>'tasks_failed')::bigint, 0) = 0
      THEN NULL
      ELSE ROUND(
        (snap.data->>'tasks_succeeded')::numeric
        / ((snap.data->>'tasks_succeeded')::numeric
           + (snap.data->>'tasks_failed')::numeric) * 100,
        1
      )
    END                                                                AS success_rate
  FROM
    generate_series(0, p_n_periods - 1) AS gs_i(i),
    LATERAL (
      SELECT (v_current_start - (gs_i.i * ('1 ' || p_period_type)::interval))::date AS ps
    ) AS gs
  LEFT JOIN public.analytics_snapshots snap
    ON  snap.snapshot_type = 'pipeline_performance'
    AND snap.subject_id    = p_pipeline_id
    AND snap.period_type   = p_period_type
    AND snap.period_start  = gs.ps
  ORDER BY gs_i.i;
END;
$$;
