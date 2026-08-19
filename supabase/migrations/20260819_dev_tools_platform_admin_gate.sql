-- rpc_dev_delete_all_company_tasks (20260818_dev_delete_all_company_tasks.sql,
-- issue #215) gated on `is_owner` -- ANY company owner on the platform, not
-- just TrustFlow platform staff. Dev Tools is an internal debugging screen
-- (app/admin/dev-tools.tsx); it has no client-side gate at all today, so any
-- real customer who is their own company's owner and navigates to
-- /admin/dev-tools could permanently delete every task in their company with
-- one tap. Found auditing dev-tools before deciding whether its branch could
-- be merged toward production.
--
-- Fix: require public._is_platform_admin() (public.platform_admins, the
-- existing mechanism behind /platform-admin and rpc_am_i_platform_admin) --
-- not company ownership. Scope stays the caller's own company (my_company_id())
-- -- broadening to an arbitrary p_company_id is a bigger feature this fix does
-- not add.

CREATE OR REPLACE FUNCTION public.rpc_dev_delete_all_company_tasks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id    UUID := auth.uid();
  v_company_id UUID := public.my_company_id();
  v_deleted    INTEGER;
BEGIN
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'Platform admin required.';
  END IF;

  DELETE FROM public.tasks WHERE company_id = v_company_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  PERFORM public.log_event(v_company_id, v_user_id, 'company', v_company_id, 'dev.all_tasks_deleted', jsonb_build_object('count', v_deleted));

  RETURN v_deleted;
END;
$function$;

DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'rpc_dev_delete_all_company_tasks' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'MIGRATION FAILED: rpc_dev_delete_all_company_tasks must have exactly 1 signature (overload trap)';
  END IF;
END;
$$;
