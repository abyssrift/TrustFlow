-- Harden the two bucketed pipeline analytics entry points against
-- cross-company pipeline IDs while preserving their existing calculations.
-- The original implementations are retained under private delegation names.

DO $migration_guard$
BEGIN
  IF to_regprocedure('public.rpc_get_pipeline_throughput_range(uuid,date,date,integer)') IS NULL THEN
    RAISE EXCEPTION 'Expected source function public.rpc_get_pipeline_throughput_range(uuid,date,date,integer) is missing';
  END IF;

  IF to_regprocedure('public.rpc_get_pipeline_points_range(uuid,date,date,integer)') IS NULL THEN
    RAISE EXCEPTION 'Expected source function public.rpc_get_pipeline_points_range(uuid,date,date,integer) is missing';
  END IF;

  IF to_regprocedure('public._reporting_rpc_get_pipeline_throughput_range(uuid,date,date,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Private function name collision: public._reporting_rpc_get_pipeline_throughput_range(uuid,date,date,integer)';
  END IF;

  IF to_regprocedure('public._reporting_rpc_get_pipeline_points_range(uuid,date,date,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Private function name collision: public._reporting_rpc_get_pipeline_points_range(uuid,date,date,integer)';
  END IF;
END;
$migration_guard$;

ALTER FUNCTION public.rpc_get_pipeline_throughput_range(uuid, date, date, integer)
  RENAME TO _reporting_rpc_get_pipeline_throughput_range;

ALTER FUNCTION public.rpc_get_pipeline_points_range(uuid, date, date, integer)
  RENAME TO _reporting_rpc_get_pipeline_points_range;

-- The public wrappers are the only callable entry points. Each fails closed
-- unless the caller is authenticated, belongs to a company, has analytics.view,
-- and the requested pipeline is active and belongs to that company.
CREATE FUNCTION public.rpc_get_pipeline_throughput_range(
  p_pipeline_id uuid,
  p_from date,
  p_to date,
  p_buckets integer DEFAULT 12
)
RETURNS TABLE (
  bucket_start timestamptz,
  bucket_end timestamptz,
  tasks_succeeded bigint,
  tasks_failed bigint,
  success_rate numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR public.my_company_id() IS NULL
     OR NOT public.has_permission('analytics.view')
     OR NOT EXISTS (
       SELECT 1
       FROM public.pipelines p
       WHERE p.id = p_pipeline_id
         AND p.company_id = public.my_company_id()
         AND p.deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT *
    FROM public._reporting_rpc_get_pipeline_throughput_range(
      p_pipeline_id, p_from, p_to, p_buckets
    );
END;
$function$;

CREATE FUNCTION public.rpc_get_pipeline_points_range(
  p_pipeline_id uuid,
  p_from date,
  p_to date,
  p_buckets integer DEFAULT 12
)
RETURNS TABLE (
  bucket_start timestamptz,
  bucket_end timestamptz,
  weight_points bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL
     OR public.my_company_id() IS NULL
     OR NOT public.has_permission('analytics.view')
     OR NOT EXISTS (
       SELECT 1
       FROM public.pipelines p
       WHERE p.id = p_pipeline_id
         AND p.company_id = public.my_company_id()
         AND p.deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT *
    FROM public._reporting_rpc_get_pipeline_points_range(
      p_pipeline_id, p_from, p_to, p_buckets
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_get_pipeline_throughput_range(uuid, date, date, integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_pipeline_throughput_range(uuid, date, date, integer)
  TO authenticated;

REVOKE ALL ON FUNCTION public.rpc_get_pipeline_points_range(uuid, date, date, integer)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.rpc_get_pipeline_points_range(uuid, date, date, integer)
  TO authenticated;

REVOKE ALL ON FUNCTION public._reporting_rpc_get_pipeline_throughput_range(uuid, date, date, integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._reporting_rpc_get_pipeline_points_range(uuid, date, date, integer)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.rpc_get_pipeline_throughput_range(uuid, date, date, integer) IS
  'Company-scoped analytics.view wrapper for bucketed pipeline throughput.';
COMMENT ON FUNCTION public.rpc_get_pipeline_points_range(uuid, date, date, integer) IS
  'Company-scoped analytics.view wrapper for bucketed pipeline points.';
COMMENT ON FUNCTION public._reporting_rpc_get_pipeline_throughput_range(uuid, date, date, integer) IS
  'Private unchanged implementation for rpc_get_pipeline_throughput_range; invoke through the authorized wrapper.';
COMMENT ON FUNCTION public._reporting_rpc_get_pipeline_points_range(uuid, date, date, integer) IS
  'Private unchanged implementation for rpc_get_pipeline_points_range; invoke through the authorized wrapper.';

