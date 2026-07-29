-- Re-syncs rpc_request_report with the deployed prod definition AND adds 'projects' to the valid types allowlist.
-- The deployed function had drifted from earlier migrations (permission check + multi_report were hand-edited
-- via the Supabase dashboard). This migration is the source of truth going forward.

CREATE OR REPLACE FUNCTION public.rpc_request_report(
  p_report_type text,
  p_parameters  jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_job_id     UUID;
  v_company_id UUID;
  v_valid_types TEXT[] := ARRAY[
    'general',
    'performance_audit',
    'worker_comparison',
    'team_comparison',
    'workflow_analysis',
    'user_performance_series',
    'user_performance_summary',
    'pipeline_stage_dwell',
    'pipeline_throughput',
    'personnel_comparison',
    'targets_status',
    'personal_pulse',
    'multi_report',
    'projects'
  ];
BEGIN
  IF NOT (p_report_type = ANY(v_valid_types)) THEN
    RAISE EXCEPTION 'Unknown report type: %. Valid types: %', p_report_type, array_to_string(v_valid_types, ', ');
  END IF;

  v_company_id := public.my_company_id();

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = auth.uid()) = TRUE
    OR public.has_permission('report.generate')
    OR public.has_permission('report.view')
    OR public.has_permission('report.export')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to generate reports. Requires report.view or higher.';
  END IF;

  INSERT INTO public.reporting_jobs (company_id, requested_by, report_type, parameters)
  VALUES (v_company_id, auth.uid(), p_report_type, p_parameters)
  RETURNING id INTO v_job_id;

  PERFORM public.log_event(v_company_id, auth.uid(), 'report', v_job_id, 'report.requested', p_parameters);
  RETURN v_job_id;
END;
$function$;
