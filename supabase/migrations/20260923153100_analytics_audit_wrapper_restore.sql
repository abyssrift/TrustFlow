-- Restore the canonical authorization wrapper for the organizational audit RPC.
-- The implementation remains under the private delegate created by the
-- reporting authorization migration; this public signature is the client
-- contract and the only supported execution surface.

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
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    SELECT 1
    FROM public.pipelines p
    WHERE p.id = p_pipeline_id
      AND p.company_id = v_company_id
      AND p.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Access denied: pipeline is outside the caller company' USING ERRCODE = '42501';
  END IF;
  RETURN public._reporting_rpc_get_organizational_audit(
    p_pipeline_id, p_days, p_team_id, p_worker_id, p_priority, p_project_id,
    p_date_start, p_date_end, auth.uid(), p_include_time_metrics, p_include_advanced
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_get_organizational_audit(
  uuid, integer, uuid, uuid, text, uuid, timestamptz, timestamptz, uuid, boolean, boolean
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_organizational_audit(
  uuid, integer, uuid, uuid, text, uuid, timestamptz, timestamptz, uuid, boolean, boolean
) TO authenticated;

REVOKE ALL ON FUNCTION public._reporting_rpc_get_organizational_audit(
  uuid, integer, uuid, uuid, text, uuid, timestamptz, timestamptz, uuid, boolean, boolean
) FROM PUBLIC, anon, authenticated, service_role;
