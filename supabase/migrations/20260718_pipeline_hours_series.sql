-- ====================================================================
-- Pipeline Hours Series
-- New snapshot type 'pipeline_hours' that stores SUM of active work
-- seconds (task_work_sessions) for a pipeline during each period.
-- Mirrors the lazy-flush pattern of rpc_get_pipeline_points_series so
-- the dashboard overview graph can plot an "Hours" line per pipeline,
-- summed client-side across all tracked pipelines.
-- Sessions are bucketed by started_at. Includes archived tasks' sessions
-- (stored under archives.snapshot->'work_sessions') to stay consistent
-- with the points series, so hours don't drop when tasks are archived.
-- ====================================================================

-- 0. Extend the snapshot_type check constraint to allow 'pipeline_hours'
ALTER TABLE public.analytics_snapshots
  DROP CONSTRAINT analytics_snapshots_snapshot_type_check;

ALTER TABLE public.analytics_snapshots
  ADD CONSTRAINT analytics_snapshots_snapshot_type_check
  CHECK (snapshot_type = ANY (ARRAY[
    'user_performance'::text,
    'pipeline_performance'::text,
    'pipeline_points'::text,
    'pipeline_hours'::text
  ]));

-- 1. Flush helper: compute and upsert one period's active_seconds
CREATE OR REPLACE FUNCTION public.rpc_flush_pipeline_hours_snapshot(
  p_pipeline_id UUID,
  p_period_type TEXT,
  p_period_start DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_end    DATE;
  v_seconds       BIGINT := 0;
  v_live_seconds  BIGINT := 0;
  v_arch_seconds  BIGINT := 0;
  v_company_id    UUID;
BEGIN
  SELECT company_id INTO v_company_id FROM public.pipelines WHERE id = p_pipeline_id;
  IF v_company_id IS NULL THEN RETURN; END IF;

  v_period_end := (p_period_start + ('1 ' || p_period_type)::INTERVAL)::DATE;

  -- Live work sessions for this pipeline's tasks, bucketed by started_at
  SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (ws.last_heartbeat_at - ws.started_at))), 0)::BIGINT
    INTO v_live_seconds
    FROM public.task_work_sessions ws
    JOIN public.tasks t ON t.id = ws.task_id
   WHERE t.pipeline_id  = p_pipeline_id
     AND ws.started_at >= p_period_start::timestamptz
     AND ws.started_at  < v_period_end::timestamptz
     AND ws.last_heartbeat_at >= ws.started_at;

  -- Archived tasks' work sessions (stored inside the archive snapshot)
  SELECT COALESCE(SUM(
           GREATEST(
             EXTRACT(EPOCH FROM (
               (sess->>'last_heartbeat_at')::timestamptz - (sess->>'started_at')::timestamptz
             )),
             0
           )
         ), 0)::BIGINT
    INTO v_arch_seconds
    FROM public.archives ar
    CROSS JOIN LATERAL jsonb_array_elements(
      COALESCE(ar.snapshot->'work_sessions', '[]'::jsonb)
    ) AS sess
   WHERE ar.company_id  = v_company_id
     AND ar.entity_type = 'task'
     AND (ar.snapshot->'task'->>'pipeline_id') = p_pipeline_id::text
     AND (sess->>'started_at')::timestamptz >= p_period_start::timestamptz
     AND (sess->>'started_at')::timestamptz  < v_period_end::timestamptz;

  v_seconds := v_live_seconds + v_arch_seconds;

  INSERT INTO public.analytics_snapshots (company_id, snapshot_type, subject_id, period_type, period_start, data, computed_at)
  VALUES (
    v_company_id,
    'pipeline_hours',
    p_pipeline_id,
    p_period_type,
    p_period_start,
    jsonb_build_object('active_seconds', v_seconds),
    NOW()
  )
  ON CONFLICT (company_id, snapshot_type, subject_id, period_type, period_start)
  DO UPDATE SET data = EXCLUDED.data, computed_at = EXCLUDED.computed_at;
END;
$$;


-- 2. Read RPC: lazy-flush then SELECT from snapshots
CREATE OR REPLACE FUNCTION public.rpc_get_pipeline_hours_series(
  p_pipeline_id UUID,
  p_period_type TEXT,
  p_n_periods   INT DEFAULT 12
)
RETURNS TABLE (
  period_label  TEXT,
  period_start  DATE,
  active_hours  NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_start DATE;
  v_ps            DATE;
  v_snap_age      INTERVAL;
  i               INT;
BEGIN
  IF NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access Denied: analytics.view required.';
  END IF;

  v_current_start := date_trunc(p_period_type, CURRENT_DATE)::DATE;

  -- Lazy-flush: current period every 15 min, closed periods once forever
  FOR i IN 0 .. p_n_periods - 1 LOOP
    v_ps       := (v_current_start - (i * ('1 ' || p_period_type)::INTERVAL))::DATE;
    v_snap_age := CASE WHEN i = 0 THEN INTERVAL '15 minutes' ELSE INTERVAL '9999 days' END;

    IF NOT EXISTS (
      SELECT 1 FROM public.analytics_snapshots s
       WHERE s.snapshot_type = 'pipeline_hours'
         AND s.subject_id    = p_pipeline_id
         AND s.period_type   = p_period_type
         AND s.period_start  = v_ps
         AND s.computed_at   > now() - v_snap_age
    ) THEN
      PERFORM public.rpc_flush_pipeline_hours_snapshot(p_pipeline_id, p_period_type, v_ps);
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT
    CASE p_period_type
      WHEN 'week'  THEN 'W' || to_char(gs.ps, 'IW IYYY')
      WHEN 'month' THEN to_char(gs.ps, 'Mon YYYY')
      WHEN 'year'  THEN to_char(gs.ps, 'YYYY')
    END                                                                       AS period_label,
    gs.ps                                                                     AS period_start,
    ROUND(COALESCE((snap.data->>'active_seconds')::NUMERIC, 0) / 3600.0, 2)   AS active_hours
  FROM
    generate_series(0, p_n_periods - 1) AS gs_i(i),
    LATERAL (
      SELECT (v_current_start - (gs_i.i * ('1 ' || p_period_type)::INTERVAL))::DATE AS ps
    ) AS gs
  LEFT JOIN public.analytics_snapshots snap
    ON  snap.snapshot_type = 'pipeline_hours'
    AND snap.subject_id    = p_pipeline_id
    AND snap.period_type   = p_period_type
    AND snap.period_start  = gs.ps
  ORDER BY gs_i.i;
END;
$$;
