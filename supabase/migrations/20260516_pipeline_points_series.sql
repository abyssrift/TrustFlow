-- ====================================================================
-- Pipeline Points Series
-- New snapshot type 'pipeline_points' that stores SUM(weight) for
-- tasks completed in a pipeline during each period.
-- Follows the same lazy-flush pattern as pipeline_performance.
-- ====================================================================

-- 0. Extend the snapshot_type check constraint to allow 'pipeline_points'
ALTER TABLE public.analytics_snapshots
  DROP CONSTRAINT analytics_snapshots_snapshot_type_check;

ALTER TABLE public.analytics_snapshots
  ADD CONSTRAINT analytics_snapshots_snapshot_type_check
  CHECK (snapshot_type = ANY (ARRAY['user_performance'::text, 'pipeline_performance'::text, 'pipeline_points'::text]));

-- 1. Flush helper: compute and upsert one period's weight_points
-- Queries both live tasks AND archives (same pattern as rpc_flush_pipeline_snapshot)
CREATE OR REPLACE FUNCTION public.rpc_flush_pipeline_points_snapshot(
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
  v_period_end   DATE;
  v_points       BIGINT := 0;
  v_live_points  BIGINT := 0;
  v_arch_points  BIGINT := 0;
  v_company_id   UUID;
BEGIN
  SELECT company_id INTO v_company_id FROM public.pipelines WHERE id = p_pipeline_id;
  IF v_company_id IS NULL THEN RETURN; END IF;

  v_period_end := (p_period_start + ('1 ' || p_period_type)::INTERVAL)::DATE;

  -- Live tasks completed in this period
  SELECT COALESCE(SUM(t.weight), 0)::BIGINT
    INTO v_live_points
    FROM public.tasks t
   WHERE t.pipeline_id  = p_pipeline_id
     AND t.completed_at >= p_period_start::timestamptz
     AND t.completed_at  < v_period_end::timestamptz;

  -- Archived tasks completed in this period
  SELECT COALESCE(SUM((ar.snapshot->'task'->>'weight')::numeric), 0)::BIGINT
    INTO v_arch_points
    FROM public.archives ar
   WHERE ar.company_id  = v_company_id
     AND ar.entity_type = 'task'
     AND (ar.snapshot->'task'->>'pipeline_id') = p_pipeline_id::text
     AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= p_period_start::timestamptz
     AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  v_period_end::timestamptz;

  v_points := v_live_points + v_arch_points;

  INSERT INTO public.analytics_snapshots (company_id, snapshot_type, subject_id, period_type, period_start, data, computed_at)
  VALUES (
    v_company_id,
    'pipeline_points',
    p_pipeline_id,
    p_period_type,
    p_period_start,
    jsonb_build_object('weight_points', v_points),
    NOW()
  )
  ON CONFLICT (company_id, snapshot_type, subject_id, period_type, period_start)
  DO UPDATE SET data = EXCLUDED.data, computed_at = EXCLUDED.computed_at;
END;
$$;


-- 2. Read RPC: lazy-flush then SELECT from snapshots
CREATE OR REPLACE FUNCTION public.rpc_get_pipeline_points_series(
  p_pipeline_id UUID,
  p_period_type TEXT,
  p_n_periods   INT DEFAULT 12
)
RETURNS TABLE (
  period_label  TEXT,
  period_start  DATE,
  weight_points BIGINT
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
       WHERE s.snapshot_type = 'pipeline_points'
         AND s.subject_id    = p_pipeline_id
         AND s.period_type   = p_period_type
         AND s.period_start  = v_ps
         AND s.computed_at   > now() - v_snap_age
    ) THEN
      PERFORM public.rpc_flush_pipeline_points_snapshot(p_pipeline_id, p_period_type, v_ps);
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT
    CASE p_period_type
      WHEN 'week'  THEN 'W' || to_char(gs.ps, 'IW IYYY')
      WHEN 'month' THEN to_char(gs.ps, 'Mon YYYY')
      WHEN 'year'  THEN to_char(gs.ps, 'YYYY')
    END                                                               AS period_label,
    gs.ps                                                             AS period_start,
    COALESCE((snap.data->>'weight_points')::NUMERIC::BIGINT, 0)       AS weight_points
  FROM
    generate_series(0, p_n_periods - 1) AS gs_i(i),
    LATERAL (
      SELECT (v_current_start - (gs_i.i * ('1 ' || p_period_type)::INTERVAL))::DATE AS ps
    ) AS gs
  LEFT JOIN public.analytics_snapshots snap
    ON  snap.snapshot_type = 'pipeline_points'
    AND snap.subject_id    = p_pipeline_id
    AND snap.period_type   = p_period_type
    AND snap.period_start  = gs.ps
  ORDER BY gs_i.i;
END;
$$;
