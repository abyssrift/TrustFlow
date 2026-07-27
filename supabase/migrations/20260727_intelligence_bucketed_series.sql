-- ====================================================================
-- #139: Calendar-range Intelligence filtering with constant granularity.
-- Range-bucketed variants of the throughput / points series RPCs:
-- arbitrary [from, to] split into N equal buckets (N = screen-driven,
-- decided client-side). Computed live from tasks + archives, mirroring
-- rpc_flush_pipeline_snapshot semantics; no snapshot cache since bucket
-- boundaries shift with every range/width combination.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.rpc_get_pipeline_throughput_range(
  p_pipeline_id UUID,
  p_from        DATE,
  p_to          DATE,
  p_buckets     INT DEFAULT 12
)
RETURNS TABLE (
  bucket_start    TIMESTAMPTZ,
  bucket_end      TIMESTAMPTZ,
  tasks_succeeded BIGINT,
  tasks_failed    BIGINT,
  success_rate    NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_t0 TIMESTAMPTZ := p_from::timestamptz;
  v_t1 TIMESTAMPTZ := (p_to + 1)::timestamptz; -- inclusive end date
  v_nb INT := LEAST(GREATEST(COALESCE(p_buckets, 12), 1), 60);
BEGIN
  IF NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access Denied: analytics.view required.';
  END IF;
  IF v_t1 <= v_t0 THEN RETURN; END IF;

  SELECT company_id INTO v_company_id FROM public.pipelines WHERE id = p_pipeline_id;
  IF v_company_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH term AS (
    -- Live tasks sitting in a terminal stage, completed inside the range
    SELECT t.completed_at AS ts, ps.terminal_type AS ttype
    FROM public.tasks t
    JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
    WHERE t.pipeline_id = p_pipeline_id
      AND ps.is_terminal = true
      AND t.completed_at >= v_t0 AND t.completed_at < v_t1
    UNION ALL
    -- Archived tasks (same semantics as rpc_flush_pipeline_snapshot)
    SELECT (ar.snapshot->'task'->>'completed_at')::timestamptz,
           ps.terminal_type
    FROM public.archives ar
    LEFT JOIN public.pipeline_stages ps
      ON ps.id = (ar.snapshot->'task'->>'current_stage_id')::uuid
    WHERE ar.company_id  = v_company_id
      AND ar.entity_type = 'task'
      AND (ar.snapshot->'task'->>'pipeline_id') = p_pipeline_id::text
      AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= v_t0
      AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  v_t1
  ),
  bucketed AS (
    SELECT width_bucket(EXTRACT(EPOCH FROM ts), EXTRACT(EPOCH FROM v_t0), EXTRACT(EPOCH FROM v_t1), v_nb) AS b,
           ttype
    FROM term
  )
  SELECT
    v_t0 + (v_t1 - v_t0) * (gs.i - 1) / v_nb  AS bucket_start,
    v_t0 + (v_t1 - v_t0) * gs.i / v_nb        AS bucket_end,
    COUNT(*) FILTER (WHERE bk.ttype = 'success')::BIGINT AS tasks_succeeded,
    COUNT(*) FILTER (WHERE bk.ttype = 'failure')::BIGINT AS tasks_failed,
    CASE
      WHEN COUNT(*) FILTER (WHERE bk.ttype IN ('success','failure')) = 0 THEN NULL
      ELSE ROUND(
        COUNT(*) FILTER (WHERE bk.ttype = 'success')::NUMERIC /
        COUNT(*) FILTER (WHERE bk.ttype IN ('success','failure')) * 100, 1)
    END AS success_rate
  FROM generate_series(1, v_nb) AS gs(i)
  LEFT JOIN bucketed bk ON bk.b = gs.i
  GROUP BY gs.i
  ORDER BY gs.i;
END;
$$;


CREATE OR REPLACE FUNCTION public.rpc_get_pipeline_points_range(
  p_pipeline_id UUID,
  p_from        DATE,
  p_to          DATE,
  p_buckets     INT DEFAULT 12
)
RETURNS TABLE (
  bucket_start  TIMESTAMPTZ,
  bucket_end    TIMESTAMPTZ,
  weight_points BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_t0 TIMESTAMPTZ := p_from::timestamptz;
  v_t1 TIMESTAMPTZ := (p_to + 1)::timestamptz;
  v_nb INT := LEAST(GREATEST(COALESCE(p_buckets, 12), 1), 60);
BEGIN
  IF NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access Denied: analytics.view required.';
  END IF;
  IF v_t1 <= v_t0 THEN RETURN; END IF;

  SELECT company_id INTO v_company_id FROM public.pipelines WHERE id = p_pipeline_id;
  IF v_company_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  WITH pts AS (
    SELECT t.completed_at AS ts, COALESCE(t.weight, 0)::numeric AS w
    FROM public.tasks t
    WHERE t.pipeline_id = p_pipeline_id
      AND t.completed_at >= v_t0 AND t.completed_at < v_t1
    UNION ALL
    SELECT (ar.snapshot->'task'->>'completed_at')::timestamptz,
           COALESCE((ar.snapshot->'task'->>'weight')::numeric, 0)
    FROM public.archives ar
    WHERE ar.company_id  = v_company_id
      AND ar.entity_type = 'task'
      AND (ar.snapshot->'task'->>'pipeline_id') = p_pipeline_id::text
      AND (ar.snapshot->'task'->>'completed_at')::timestamptz >= v_t0
      AND (ar.snapshot->'task'->>'completed_at')::timestamptz <  v_t1
  ),
  bucketed AS (
    SELECT width_bucket(EXTRACT(EPOCH FROM ts), EXTRACT(EPOCH FROM v_t0), EXTRACT(EPOCH FROM v_t1), v_nb) AS b, w
    FROM pts
  )
  SELECT
    v_t0 + (v_t1 - v_t0) * (gs.i - 1) / v_nb AS bucket_start,
    v_t0 + (v_t1 - v_t0) * gs.i / v_nb       AS bucket_end,
    COALESCE(SUM(bk.w), 0)::BIGINT           AS weight_points
  FROM generate_series(1, v_nb) AS gs(i)
  LEFT JOIN bucketed bk ON bk.b = gs.i
  GROUP BY gs.i
  ORDER BY gs.i;
END;
$$;
