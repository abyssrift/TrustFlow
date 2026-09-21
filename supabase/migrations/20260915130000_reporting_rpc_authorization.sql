-- Contain the reporting readers at the database boundary.
--
-- The existing implementations are retained under private names so this
-- migration does not duplicate or silently fork their metric semantics. The
-- public signatures remain the client contract; these wrappers provide the
-- caller/tenant/permission boundary before delegating.

DO $rename$
BEGIN
  IF to_regprocedure('public.rpc_get_organizational_audit(uuid,integer,uuid,uuid,text,uuid,timestamptz,timestamptz,uuid,boolean,boolean)') IS NOT NULL
     AND to_regprocedure('public._reporting_rpc_get_organizational_audit(uuid,integer,uuid,uuid,text,uuid,timestamptz,timestamptz,uuid,boolean,boolean)') IS NULL THEN
    ALTER FUNCTION public.rpc_get_organizational_audit(uuid,integer,uuid,uuid,text,uuid,timestamptz,timestamptz,uuid,boolean,boolean)
      RENAME TO _reporting_rpc_get_organizational_audit;
  END IF;

  IF to_regprocedure('public.rpc_get_user_company_history(uuid)') IS NOT NULL
     AND to_regprocedure('public._reporting_rpc_get_user_company_history(uuid)') IS NULL THEN
    ALTER FUNCTION public.rpc_get_user_company_history(uuid)
      RENAME TO _reporting_rpc_get_user_company_history;
  END IF;

  IF to_regprocedure('public.rpc_get_user_performance_series(uuid,text,integer,uuid)') IS NOT NULL
     AND to_regprocedure('public._reporting_rpc_get_user_performance_series(uuid,text,integer,uuid)') IS NULL THEN
    ALTER FUNCTION public.rpc_get_user_performance_series(uuid,text,integer,uuid)
      RENAME TO _reporting_rpc_get_user_performance_series;
  END IF;

  -- This older signature has the same defaultable call shape as the 4-arg
  -- client signature and is therefore ambiguous in PostgREST. All callers
  -- send p_company_id explicitly, so remove only this stale overload.
  -- Do not silently CASCADE dependants while removing the obsolete overload.
  -- A normal dependency is a migration-owner action: update that object to
  -- the canonical four-argument contract before rerunning this migration.
  IF to_regprocedure('public.rpc_get_user_performance_series(uuid,text,integer)') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_depend
      WHERE refobjid = to_regprocedure('public.rpc_get_user_performance_series(uuid,text,integer)')::oid
        AND deptype = 'n'
    ) THEN
      RAISE EXCEPTION 'Cannot remove stale performance-series overload: dependent objects exist';
    END IF;
    DROP FUNCTION public.rpc_get_user_performance_series(uuid,text,integer);
  END IF;

  IF to_regprocedure('public.rpc_get_user_performance_summary(uuid,date,date)') IS NOT NULL
     AND to_regprocedure('public._reporting_rpc_get_user_performance_summary(uuid,date,date)') IS NULL THEN
    ALTER FUNCTION public.rpc_get_user_performance_summary(uuid,date,date) RENAME TO _reporting_rpc_get_user_performance_summary;
  ELSIF to_regprocedure('public.rpc_get_user_performance_summary(uuid,timestamptz,timestamptz)') IS NOT NULL
     AND to_regprocedure('public._reporting_rpc_get_user_performance_summary(uuid,timestamptz,timestamptz)') IS NULL THEN
    ALTER FUNCTION public.rpc_get_user_performance_summary(uuid,timestamptz,timestamptz) RENAME TO _reporting_rpc_get_user_performance_summary;
  END IF;

  IF to_regprocedure('public.rpc_compare_personnel(uuid[],date,date,jsonb)') IS NOT NULL
     AND to_regprocedure('public._reporting_rpc_compare_personnel(uuid[],date,date,jsonb)') IS NULL THEN
    ALTER FUNCTION public.rpc_compare_personnel(uuid[],date,date,jsonb) RENAME TO _reporting_rpc_compare_personnel;
  ELSIF to_regprocedure('public.rpc_compare_personnel(uuid[],timestamptz,timestamptz,json)') IS NOT NULL
     AND to_regprocedure('public._reporting_rpc_compare_personnel(uuid[],timestamptz,timestamptz,json)') IS NULL THEN
    ALTER FUNCTION public.rpc_compare_personnel(uuid[],timestamptz,timestamptz,json) RENAME TO _reporting_rpc_compare_personnel;
  END IF;

  IF to_regprocedure('public.rpc_get_pipeline_stage_dwell(uuid,date,date)') IS NOT NULL
     AND to_regprocedure('public._reporting_rpc_get_pipeline_stage_dwell(uuid,date,date)') IS NULL THEN
    ALTER FUNCTION public.rpc_get_pipeline_stage_dwell(uuid,date,date)
      RENAME TO _reporting_rpc_get_pipeline_stage_dwell;
  END IF;

  IF to_regprocedure('public.rpc_get_pipeline_throughput(uuid,text,integer)') IS NOT NULL
     AND to_regprocedure('public._reporting_rpc_get_pipeline_throughput(uuid,text,integer)') IS NULL THEN
    ALTER FUNCTION public.rpc_get_pipeline_throughput(uuid,text,integer)
      RENAME TO _reporting_rpc_get_pipeline_throughput;
  END IF;

END
$rename$;

CREATE OR REPLACE FUNCTION public.rpc_get_organizational_audit(
  p_pipeline_id uuid DEFAULT NULL,
  p_days integer DEFAULT 30,
  p_team_id uuid DEFAULT NULL,
  p_worker_id uuid DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_date_start timestamptz DEFAULT NULL,
  p_date_end timestamptz DEFAULT NULL,
  p_auth_user_id uuid DEFAULT NULL,
  p_include_time_metrics boolean DEFAULT true,
  p_include_advanced boolean DEFAULT true
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company_id uuid := public.my_company_id();
BEGIN
  IF auth.uid() IS NULL OR v_company_id IS NULL OR NOT public.has_permission('analytics.view') THEN
    RAISE EXCEPTION 'Access denied: authenticated analytics.view required' USING ERRCODE = '42501';
  END IF;
  IF p_auth_user_id IS NOT NULL AND p_auth_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Access denied: caller identity cannot be overridden' USING ERRCODE = '42501';
  END IF;
  IF p_pipeline_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pipelines p
    WHERE p.id = p_pipeline_id AND p.company_id = v_company_id AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Access denied: pipeline is outside the caller company' USING ERRCODE = '42501';
  END IF;
  RETURN public._reporting_rpc_get_organizational_audit(
    p_pipeline_id, p_days, p_team_id, p_worker_id, p_priority, p_project_id,
    p_date_start, p_date_end, auth.uid(), p_include_time_metrics, p_include_advanced
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_get_user_company_history(p_user_id uuid)
RETURNS TABLE(company_id uuid, company_name text, company_slug text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company_id uuid := public.my_company_id();
BEGIN
  IF auth.uid() IS NULL OR v_company_id IS NULL OR NOT public.has_permission('analytics.view')
     OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.company_id = v_company_id AND u.deleted_at IS NULL AND u.is_active) THEN
    RAISE EXCEPTION 'Access denied: target user is outside the caller company or analytics.view is missing' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT c.id, c.name, c.slug
  FROM public.analytics_snapshots s
  JOIN public.companies c ON c.id = s.company_id
  WHERE s.snapshot_type = 'user_performance'
    AND s.subject_id = p_user_id
    AND s.company_id = v_company_id
  GROUP BY c.id, c.name, c.slug
  ORDER BY c.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_get_user_performance_series(
  p_user_id uuid, p_period_type text, p_n_periods integer DEFAULT 12, p_company_id uuid DEFAULT NULL
)
RETURNS TABLE(
  period_label text, period_start timestamptz, weight_points bigint, active_seconds bigint,
  completed_tasks bigint, failed_tasks bigint, on_time_tasks bigint, revision_count bigint,
  estimated_seconds bigint, is_current_period boolean, within_budget_tasks bigint, over_budget_tasks bigint
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.my_company_id() IS NULL OR NOT public.has_permission('analytics.view')
     OR p_company_id IS NOT NULL AND p_company_id IS DISTINCT FROM public.my_company_id()
     OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_user_id AND u.company_id = public.my_company_id() AND u.deleted_at IS NULL AND u.is_active) THEN
    RAISE EXCEPTION 'Access denied: target user/company is outside the caller scope or analytics.view is missing' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public._reporting_rpc_get_user_performance_series(p_user_id, p_period_type, p_n_periods, public.my_company_id());
END;
$$;

-- Recreate wrappers from catalog metadata so either deployed signature family
-- retains its exact argument and return shape. No return columns are inferred.
DO $compat$
DECLARE f record; arg_types text; args text;
BEGIN
  SELECT p.*, pg_get_function_arguments(p.oid) AS argdecl,
         pg_get_function_result(p.oid) AS resultdecl,
         pg_get_function_identity_arguments(p.oid) AS identityargs
    INTO f FROM pg_proc p
   WHERE p.oid IN (to_regprocedure('public._reporting_rpc_get_user_performance_summary(uuid,date,date)'),
                   to_regprocedure('public._reporting_rpc_get_user_performance_summary(uuid,timestamptz,timestamptz)'));
  IF FOUND THEN
    EXECUTE format('CREATE OR REPLACE FUNCTION public.rpc_get_user_performance_summary(%s) RETURNS %s LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $b$ BEGIN IF auth.uid() IS NULL OR public.my_company_id() IS NULL OR NOT public.has_permission(''analytics.view'') OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id=p_user_id AND u.company_id=public.my_company_id() AND u.deleted_at IS NULL AND u.is_active) THEN RAISE EXCEPTION ''Access denied'' USING ERRCODE=''42501''; END IF; RETURN public._reporting_rpc_get_user_performance_summary(p_user_id,p_from,p_to); END $b$', f.argdecl, f.resultdecl);
  END IF;

  SELECT p.*, pg_get_function_arguments(p.oid) AS argdecl,
         pg_get_function_result(p.oid) AS resultdecl,
         pg_get_function_identity_arguments(p.oid) AS identityargs
    INTO f FROM pg_proc p
   WHERE p.oid IN (to_regprocedure('public._reporting_rpc_compare_personnel(uuid[],date,date,jsonb)'),
                   to_regprocedure('public._reporting_rpc_compare_personnel(uuid[],timestamptz,timestamptz,json)'));
  IF FOUND THEN
    EXECUTE format('CREATE OR REPLACE FUNCTION public.rpc_compare_personnel(%s) RETURNS %s LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $b$ BEGIN IF auth.uid() IS NULL OR public.my_company_id() IS NULL OR NOT public.has_permission(''analytics.compare'') THEN RAISE EXCEPTION ''Access denied'' USING ERRCODE=''42501''; END IF; IF EXISTS (SELECT 1 FROM unnest(p_user_ids) x(id) WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id=x.id AND u.company_id=public.my_company_id() AND u.deleted_at IS NULL AND u.is_active)) THEN RAISE EXCEPTION ''Comparison target is outside caller company'' USING ERRCODE=''42501''; END IF; RETURN QUERY SELECT * FROM public._reporting_rpc_compare_personnel(p_user_ids,p_from,p_to,p_salaries); END $b$', f.argdecl, f.resultdecl);
  END IF;
END
$compat$;

CREATE OR REPLACE FUNCTION public.rpc_get_pipeline_stage_dwell(p_pipeline_id uuid, p_from date, p_to date)
RETURNS TABLE(
  stage_id uuid, stage_name text, stage_position integer, is_terminal boolean, terminal_type text,
  avg_seconds bigint, median_seconds bigint, p75_seconds bigint, sample_count bigint,
  reversal_count bigint, is_bottleneck boolean
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.my_company_id() IS NULL OR NOT public.has_permission('analytics.view')
     OR NOT EXISTS (SELECT 1 FROM public.pipelines p WHERE p.id = p_pipeline_id AND p.company_id = public.my_company_id() AND p.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Access denied: pipeline is outside the caller company or analytics.view is missing' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM public._reporting_rpc_get_pipeline_stage_dwell(p_pipeline_id, p_from, p_to);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_get_pipeline_throughput(
  p_pipeline_id uuid, p_period_type text, p_n_periods integer DEFAULT 12
)
RETURNS TABLE(
  period_label text, period_start date, tasks_entered bigint,
  tasks_succeeded bigint, tasks_failed bigint, success_rate numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.my_company_id() IS NULL OR NOT public.has_permission('analytics.view')
     OR NOT EXISTS (
       SELECT 1 FROM public.pipelines p
       WHERE p.id = p_pipeline_id
         AND p.company_id = public.my_company_id()
         AND p.deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'Access denied: pipeline is outside the caller company or analytics.view is missing' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT * FROM public._reporting_rpc_get_pipeline_throughput(p_pipeline_id, p_period_type, p_n_periods);
END;
$$;

-- Personnel comparison retains its existing company-scoped implementation.
-- Throughput is wrapped above because its prior permission check did not
-- reject a pipeline identifier from another company.
DO $acl$
DECLARE v_summary regprocedure; v_compare regprocedure;
BEGIN
  v_summary := COALESCE(to_regprocedure('public.rpc_get_user_performance_summary(uuid,date,date)'), to_regprocedure('public.rpc_get_user_performance_summary(uuid,timestamptz,timestamptz)'));
  v_compare := COALESCE(to_regprocedure('public.rpc_compare_personnel(uuid[],date,date,jsonb)'), to_regprocedure('public.rpc_compare_personnel(uuid[],timestamptz,timestamptz,json)'));
  IF v_summary IS NULL OR v_compare IS NULL THEN RAISE EXCEPTION 'Known reporting signature family not found'; END IF;
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, service_role', v_summary);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_summary);
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, service_role', v_compare);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', v_compare);
END
$acl$;
REVOKE ALL ON FUNCTION public.rpc_get_pipeline_throughput(uuid,text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_get_pipeline_throughput(uuid,text,integer) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_pipeline_throughput(uuid,text,integer) TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_get_organizational_audit(uuid,integer,uuid,uuid,text,uuid,timestamptz,timestamptz,uuid,boolean,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_get_organizational_audit(uuid,integer,uuid,uuid,text,uuid,timestamptz,timestamptz,uuid,boolean,boolean) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_organizational_audit(uuid,integer,uuid,uuid,text,uuid,timestamptz,timestamptz,uuid,boolean,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.rpc_get_user_company_history(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_get_user_company_history(uuid) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_user_company_history(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.rpc_get_user_performance_series(uuid,text,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_get_user_performance_series(uuid,text,integer,uuid) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_user_performance_series(uuid,text,integer,uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.rpc_get_pipeline_stage_dwell(uuid,date,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_get_pipeline_stage_dwell(uuid,date,date) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_pipeline_stage_dwell(uuid,date,date) TO authenticated;

-- The renamed implementations are delegation targets, not an alternate RPC
-- surface. Remove their inherited/default PUBLIC execution explicitly.
REVOKE ALL ON FUNCTION public._reporting_rpc_get_organizational_audit(uuid,integer,uuid,uuid,text,uuid,timestamptz,timestamptz,uuid,boolean,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._reporting_rpc_get_organizational_audit(uuid,integer,uuid,uuid,text,uuid,timestamptz,timestamptz,uuid,boolean,boolean) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._reporting_rpc_get_user_company_history(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._reporting_rpc_get_user_company_history(uuid) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._reporting_rpc_get_user_performance_series(uuid,text,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._reporting_rpc_get_user_performance_series(uuid,text,integer,uuid) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._reporting_rpc_get_pipeline_stage_dwell(uuid,date,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._reporting_rpc_get_pipeline_stage_dwell(uuid,date,date) FROM anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._reporting_rpc_get_pipeline_throughput(uuid,text,integer) FROM PUBLIC, anon, authenticated, service_role;

DO $private_acl$
DECLARE p regprocedure;
BEGIN
  p := COALESCE(to_regprocedure('public._reporting_rpc_get_user_performance_summary(uuid,date,date)'), to_regprocedure('public._reporting_rpc_get_user_performance_summary(uuid,timestamptz,timestamptz)'));
  IF p IS NOT NULL THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', p); END IF;
  p := COALESCE(to_regprocedure('public._reporting_rpc_compare_personnel(uuid[],date,date,jsonb)'), to_regprocedure('public._reporting_rpc_compare_personnel(uuid[],timestamptz,timestamptz,json)'));
  IF p IS NOT NULL THEN EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', p); END IF;
END
$private_acl$;

DO $verify$
DECLARE
  v_name text;
  v_expected regprocedure;
  v_count integer;
BEGIN
  FOREACH v_expected IN ARRAY ARRAY[
    'public.rpc_get_organizational_audit(uuid,integer,uuid,uuid,text,uuid,timestamptz,timestamptz,uuid,boolean,boolean)'::regprocedure,
    'public.rpc_get_user_company_history(uuid)'::regprocedure,
    'public.rpc_get_user_performance_series(uuid,text,integer,uuid)'::regprocedure,
    'public.rpc_get_pipeline_stage_dwell(uuid,date,date)'::regprocedure,
    'public.rpc_get_pipeline_throughput(uuid,text,integer)'::regprocedure
  ] LOOP
    SELECT count(*) INTO v_count FROM pg_proc WHERE oid = v_expected;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Reporting RPC missing or duplicated: %', v_expected; END IF;
  END LOOP;
  FOREACH v_name IN ARRAY ARRAY[
    'rpc_get_organizational_audit', 'rpc_get_user_company_history',
    'rpc_get_user_performance_series', 'rpc_get_user_performance_summary',
    'rpc_get_pipeline_stage_dwell',
    'rpc_get_pipeline_throughput'
  ] LOOP
    SELECT count(*) INTO v_count FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = v_name;
    IF v_count <> 1 THEN RAISE EXCEPTION 'Unexpected public overload count for %: %', v_name, v_count; END IF;
  END LOOP;
  IF to_regprocedure('public.rpc_get_user_performance_series(uuid,text,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy 3-argument performance-series overload remains';
  END IF;
  IF to_regprocedure('public._reporting_rpc_get_organizational_audit(uuid,integer,uuid,uuid,text,uuid,timestamptz,timestamptz,uuid,boolean,boolean)') IS NULL
     OR to_regprocedure('public._reporting_rpc_get_user_company_history(uuid)') IS NULL
     OR to_regprocedure('public._reporting_rpc_get_user_performance_series(uuid,text,integer,uuid)') IS NULL
     OR (to_regprocedure('public._reporting_rpc_get_user_performance_summary(uuid,date,date)') IS NULL AND to_regprocedure('public._reporting_rpc_get_user_performance_summary(uuid,timestamptz,timestamptz)') IS NULL)
     OR (to_regprocedure('public._reporting_rpc_compare_personnel(uuid[],date,date,jsonb)') IS NULL AND to_regprocedure('public._reporting_rpc_compare_personnel(uuid[],timestamptz,timestamptz,json)') IS NULL)
     OR to_regprocedure('public._reporting_rpc_get_pipeline_stage_dwell(uuid,date,date)') IS NULL
     OR to_regprocedure('public._reporting_rpc_get_pipeline_throughput(uuid,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'A reporting delegation target is missing';
  END IF;
END
$verify$;
