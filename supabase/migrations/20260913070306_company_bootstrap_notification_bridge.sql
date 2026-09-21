-- Issue #414: make the authoritative company bootstrap path cover the
-- company-owned notification defaults as well as roles and workflows.
--
-- The core bootstrap function predates the notification catalog. Keep it as
-- the implementation seam and wrap it so direct retries and fresh-company
-- creation share one idempotent entry point. A bootstrap called before the
-- owner user exists waits for the owner-insert trigger to seed notifications.

DO $rename$
BEGIN
  IF to_regprocedure('public.rpc_bootstrap_company_defaults(uuid,uuid)') IS NOT NULL
     AND to_regprocedure('public.rpc_bootstrap_company_defaults_core(uuid,uuid)') IS NULL THEN
    ALTER FUNCTION public.rpc_bootstrap_company_defaults(uuid, uuid)
      RENAME TO rpc_bootstrap_company_defaults_core;
  END IF;
END;
$rename$;

CREATE OR REPLACE FUNCTION public.rpc_bootstrap_company_defaults(
  p_company_id uuid,
  p_created_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_result jsonb;
  v_created_by uuid := p_created_by;
BEGIN
  v_result := public.rpc_bootstrap_company_defaults_core(p_company_id, p_created_by);

  IF v_created_by IS NULL THEN
    SELECT u.id INTO v_created_by
      FROM public.users u
     WHERE u.company_id = p_company_id
       AND u.is_owner
       AND u.is_active
     ORDER BY u.created_at
     LIMIT 1;
  END IF;

  IF v_created_by IS NOT NULL THEN
    PERFORM public.fn_seed_company_default_notification_rules(p_company_id, v_created_by);
  END IF;
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_bootstrap_company_defaults_core(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rpc_bootstrap_company_defaults(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_bootstrap_company_defaults(uuid,uuid) TO authenticated;
