-- Canonical analytics target reader.
--
-- Volume observed_value is a gross count of forward entries into the target
-- stage, from target.created_at through the target deadline (or now when
-- there is no deadline), capped at now. A later reversal does not erase an
-- earlier forward entry; the reversal event itself is excluded. If the
-- nullable created_at boundary is absent, both progress fields are NULL.
-- Performance targets expose their stored SLA budgets only. There is no
-- trustworthy aggregate for observed performance progress, so both
-- observed_value and progress_unit are NULL for those rows.
--
-- Apply this migration in a controlled rollout, then immediately run
-- supabase/checks/check_canonical_analytics_targets.sql. Do not release a
-- dependent client until that check passes. This file does not establish that
-- the migration has been applied or that a deployed database has been
-- validated.

CREATE OR REPLACE FUNCTION public.rpc_get_canonical_analytics_targets()
RETURNS TABLE (
  id uuid,
  stage_id uuid,
  stage_name text,
  pipeline_id uuid,
  pipeline_name text,
  target_type text,
  stored_status text,
  target_quantity integer,
  target_active_seconds integer,
  target_lifecycle_seconds integer,
  deadline timestamptz,
  created_at timestamptz,
  completed_at timestamptz,
  observed_value bigint,
  progress_unit text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_company_id uuid := public.my_company_id();
BEGIN
  IF auth.uid() IS NULL OR v_company_id IS NULL THEN
    RAISE EXCEPTION 'Access denied: authenticated company required.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(public.has_permission('target.view'), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Access denied: target.view required.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    pst.id,
    pst.stage_id,
    ps.name::text AS stage_name,
    p.id AS pipeline_id,
    p.name::text AS pipeline_name,
    pst.target_type::text AS target_type,
    pst.status::text AS stored_status,
    pst.target_quantity::integer AS target_quantity,
    pst.target_active_seconds::integer AS target_active_seconds,
    pst.target_lifecycle_seconds::integer AS target_lifecycle_seconds,
    pst.target_deadline AS deadline,
    pst.created_at,
    pst.completed_at,
    CASE
      WHEN pst.target_type = 'volume' AND pst.created_at IS NOT NULL
        THEN volume_progress.observed_value
      ELSE NULL::bigint
    END AS observed_value,
    CASE
      WHEN pst.target_type = 'volume' AND pst.created_at IS NOT NULL
        THEN 'tasks'::text
      ELSE NULL::text
    END AS progress_unit
  FROM public.pipeline_stage_targets AS pst
  JOIN public.pipeline_stages AS ps
    ON ps.id = pst.stage_id
  JOIN public.pipelines AS p
    ON p.id = ps.pipeline_id
   AND p.company_id = v_company_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::bigint AS observed_value
    FROM public.pipeline_stage_history AS psh
    JOIN public.tasks AS t
      ON t.id = psh.task_id
     AND t.company_id = v_company_id
     AND t.pipeline_id = p.id
     AND public.task_accessible(t.id)
     AND (t.project_id IS NULL OR public.fn_project_accessible(t.project_id))
    WHERE pst.target_type = 'volume'
      AND pst.created_at IS NOT NULL
      AND psh.company_id = v_company_id
      AND psh.pipeline_id = p.id
      AND psh.to_stage_id = pst.stage_id
      AND COALESCE(psh.is_reversal, false) = false
      AND psh.transitioned_at >= pst.created_at
      AND psh.transitioned_at <= LEAST(COALESCE(pst.target_deadline, now()), now())
  ) AS volume_progress ON true
  WHERE pst.company_id = v_company_id
  ORDER BY
    CASE WHEN pst.status = 'active' THEN 0 ELSE 1 END,
    pst.target_deadline ASC NULLS LAST,
    pst.created_at DESC,
    pst.id;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_get_canonical_analytics_targets()
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_canonical_analytics_targets()
  TO authenticated;
