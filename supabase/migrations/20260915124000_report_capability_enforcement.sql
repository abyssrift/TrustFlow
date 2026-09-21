-- Enforce report entitlements at the database boundary.
-- UI capability checks are for discoverability only; this RPC is authoritative.

-- Compensation inputs are supplied only in-memory until an approved durable
-- compensation source/policy exists. Strip salary keys at arbitrary depth so
-- direct RPC callers cannot persist them in jobs or event metadata.
CREATE OR REPLACE FUNCTION public.rpc_redact_report_parameters(p_value jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF p_value IS NULL OR jsonb_typeof(p_value) = 'null' THEN
    RETURN p_value;
  ELSIF jsonb_typeof(p_value) = 'object' THEN
    SELECT COALESCE(jsonb_object_agg(e.key, public.rpc_redact_report_parameters(e.value)), '{}'::jsonb)
      INTO v_result
      FROM jsonb_each(p_value) AS e
     WHERE lower(e.key) NOT IN ('salary', 'salaries');
    RETURN v_result;
  ELSIF jsonb_typeof(p_value) = 'array' THEN
    SELECT COALESCE(jsonb_agg(public.rpc_redact_report_parameters(e.value)), '[]'::jsonb)
      INTO v_result
      FROM jsonb_array_elements(p_value) AS e(value);
    RETURN v_result;
  END IF;
  RETURN p_value;
END;
$$;
REVOKE ALL ON FUNCTION public.rpc_redact_report_parameters(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_redact_report_parameters(jsonb) FROM anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rpc_has_capability(p_capability text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_entitled boolean;
  v_has_permission boolean;
BEGIN
  IF auth.uid() IS NULL OR p_capability IS DISTINCT FROM 'report.generate' THEN
    RETURN false;
  END IF;

  v_company_id := public.my_company_id();
  IF v_company_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE(
    cb.status = 'active'
      AND (bp.limits ->> 'analytics_reports') = 'true',
    false
  )
  INTO v_entitled
  FROM public.company_billing cb
  JOIN public.billing_plans bp ON bp.code = cb.plan_code AND bp.is_active
  WHERE cb.company_id = v_company_id;

  IF NOT COALESCE(v_entitled, false) THEN
    RETURN false;
  END IF;

  SELECT COALESCE(
    (u.is_owner = true) OR public.has_permission('report.generate'),
    false
  )
  INTO v_has_permission
  FROM public.users u
  WHERE u.id = auth.uid()
    AND u.company_id = v_company_id
    AND u.deleted_at IS NULL
    AND u.is_active;

  RETURN COALESCE(v_has_permission, false);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_has_capability(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_has_capability(text) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_has_capability(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_request_report(
  p_report_type text,
  p_parameters jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_job_id uuid;
  v_company_id uuid;
  v_safe_parameters jsonb;
  v_valid_types text[] := ARRAY[
    'general', 'performance_audit', 'worker_comparison', 'team_comparison',
    'workflow_analysis', 'user_performance_series', 'user_performance_summary',
    'pipeline_stage_dwell', 'pipeline_throughput', 'personnel_comparison',
    'targets_status', 'personal_pulse', 'multi_report', 'projects'
  ];
BEGIN
  IF NOT (p_report_type = ANY(v_valid_types)) THEN
    RAISE EXCEPTION 'Unknown report type: %. Valid types: %', p_report_type, array_to_string(v_valid_types, ', ');
  END IF;

  v_company_id := public.my_company_id();
  IF v_company_id IS NULL OR NOT public.rpc_has_capability('report.generate') THEN
    RAISE EXCEPTION 'Report generation is not available for this user or plan';
  END IF;

  v_safe_parameters := public.rpc_redact_report_parameters(COALESCE(p_parameters, '{}'::jsonb));

  INSERT INTO public.reporting_jobs (company_id, requested_by, report_type, parameters)
  VALUES (v_company_id, auth.uid(), p_report_type, v_safe_parameters)
  RETURNING id INTO v_job_id;

  PERFORM public.log_event(v_company_id, auth.uid(), 'report', v_job_id, 'report.requested', v_safe_parameters);
  RETURN v_job_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_request_report(text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_request_report(text, jsonb) FROM anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_request_report(text, jsonb) TO authenticated;
