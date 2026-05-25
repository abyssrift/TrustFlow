-- Adds per-company filtering to user performance series.
-- rpc_get_user_company_history  → distinct companies a user has snapshot data in
-- rpc_get_user_performance_series → gains optional p_company_id (NULL = aggregate all)

-- ── 1. Company history ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_get_user_company_history(p_user_id uuid)
RETURNS TABLE(company_id uuid, company_name text, company_slug text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT c.id, c.name, c.slug
  FROM public.analytics_snapshots s
  JOIN public.companies c ON c.id = s.company_id
  WHERE s.snapshot_type = 'user_performance'
    AND s.subject_id    = p_user_id
  ORDER BY c.name;
$$;

-- ── 2. Updated performance series with optional company filter ────────────

CREATE OR REPLACE FUNCTION public.rpc_get_user_performance_series(
  p_user_id     uuid,
  p_period_type text,
  p_n_periods   integer  DEFAULT 12,
  p_company_id  uuid     DEFAULT NULL
)
RETURNS TABLE(
  period_label        text,
  period_start        timestamp with time zone,
  weight_points       bigint,
  active_seconds      bigint,
  completed_tasks     bigint,
  failed_tasks        bigint,
  on_time_tasks       bigint,
  revision_count      bigint,
  estimated_seconds   bigint,
  is_current_period   boolean,
  within_budget_tasks bigint,
  over_budget_tasks   bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_current_start  DATE;
  v_user_company   UUID;
  v_ps             DATE;
  v_snap_age       INTERVAL;
  i                INT;
BEGIN
  v_current_start := date_trunc(p_period_type, CURRENT_DATE)::DATE;
  SELECT company_id INTO v_user_company FROM public.users WHERE id = p_user_id;

  -- Lazy-flush: only for current company snapshots (can't re-compute historical ones)
  FOR i IN 0 .. p_n_periods - 1 LOOP
    v_ps       := (v_current_start - (i * ('1 ' || p_period_type)::INTERVAL))::DATE;
    v_snap_age := CASE WHEN i = 0 THEN INTERVAL '5 minutes' ELSE INTERVAL '9999 days' END;

    -- Only flush for the user's current company; skip if filtering to a different company
    IF v_user_company IS NOT NULL AND (p_company_id IS NULL OR p_company_id = v_user_company) THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.analytics_snapshots s
        WHERE s.snapshot_type = 'user_performance'
          AND s.subject_id    = p_user_id
          AND s.period_type   = p_period_type
          AND s.period_start  = v_ps
          AND s.company_id    = v_user_company
          AND s.computed_at   > NOW() - v_snap_age
      ) THEN
        PERFORM public.rpc_flush_user_snapshot(p_user_id, p_period_type, v_ps);
      END IF;
    END IF;
  END LOOP;

  RETURN QUERY
  SELECT
    CASE p_period_type
      WHEN 'week'  THEN 'W' || to_char(gs.ps, 'IW IYYY')
      WHEN 'month' THEN to_char(gs.ps, 'Mon YYYY')
      WHEN 'year'  THEN to_char(gs.ps, 'YYYY')
    END                                                                       AS period_label,
    gs.ps::TIMESTAMPTZ                                                        AS period_start,
    COALESCE(SUM((snap.data->>'weight_points')::NUMERIC),     0)::BIGINT     AS weight_points,
    COALESCE(SUM((snap.data->>'active_seconds')::NUMERIC),    0)::BIGINT     AS active_seconds,
    COALESCE(SUM((snap.data->>'completed_tasks')::NUMERIC),   0)::BIGINT     AS completed_tasks,
    COALESCE(SUM((snap.data->>'failed_tasks')::NUMERIC),      0)::BIGINT     AS failed_tasks,
    COALESCE(SUM((snap.data->>'on_time_tasks')::NUMERIC),     0)::BIGINT     AS on_time_tasks,
    COALESCE(SUM((snap.data->>'revision_count')::NUMERIC),    0)::BIGINT     AS revision_count,
    COALESCE(SUM((snap.data->>'estimated_seconds')::NUMERIC), 0)::BIGINT     AS estimated_seconds,
    gs.ps = v_current_start                                                   AS is_current_period,
    COALESCE(SUM((snap.data->>'within_budget_tasks')::NUMERIC), 0)::BIGINT   AS within_budget_tasks,
    COALESCE(SUM((snap.data->>'over_budget_tasks')::NUMERIC),   0)::BIGINT   AS over_budget_tasks
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
    AND (p_company_id IS NULL OR snap.company_id = p_company_id)
  GROUP BY gs_i.i, gs.ps, v_current_start
  ORDER BY gs_i.i;
END;
$function$;
