-- 20260816_company_purge_unification.sql
-- #192: rpc_purge_company (owner self-service) and rpc_platform_delete_company
-- (platform-admin) had drifted independently and disagreed with both the
-- schema and each other:
--   - rpc_purge_company never nulled the self-ref FKs (users.reports_to,
--     teams.manager_id, teams.parent_team_id) — crashes on any company with
--     a manager hierarchy or nested teams.
--   - rpc_platform_delete_company was missing a delete for
--     filehub_file_versions (a NO ACTION FK) — crashes on any company with
--     file version history.
--   - BOTH were missing task_manual_time_entries, task_attachment_versions,
--     task_submission_versions — these have a company_id column but no FK
--     to companies at all, so today they're silently orphaned instead of
--     erroring.
--
-- Fix: pull the actual purge into one shared fn_purge_company_data(), and
-- have both RPCs (unchanged signatures/auth/return shapes) call through it.
-- Also adds the soft-delete/restore/authorize RPCs the platform-admin grace
-- period flow needs (companies.deleted_at already exists on the table).

-- ────────────────────────────────────────────────────────────────────────
-- 1. fn_purge_company_data — the one true purge body, service_role only.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_purge_company_data(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_name    text;
  v_stopped int;
BEGIN
  SELECT name INTO v_name FROM public.companies WHERE id = p_company_id;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  -- (a) Null self-referential FKs before anything downstream touches them —
  -- a manager hierarchy or nested team structure otherwise leaves dangling
  -- reports_to/manager_id/parent_team_id pointers mid-purge.
  UPDATE public.users
  SET reports_to = NULL
  WHERE company_id = p_company_id AND reports_to IS NOT NULL;

  UPDATE public.teams
  SET manager_id = NULL
  WHERE company_id = p_company_id AND manager_id IS NOT NULL;

  UPDATE public.teams
  SET parent_team_id = NULL
  WHERE company_id = p_company_id AND parent_team_id IS NOT NULL;

  -- (b) Stop any running timers gracefully (same pattern as #161's
  -- rpc_remove_user_from_company, scoped to the whole company here).
  WITH stopped AS (
    UPDATE public.task_work_sessions
    SET status = 'completed',
        completed_at = COALESCE(last_heartbeat_at, now()),
        total_seconds_spent = GREATEST(1, EXTRACT(EPOCH FROM (
            COALESCE(last_heartbeat_at, now()) - started_at))::int)
    WHERE company_id = p_company_id AND status = 'active'
    RETURNING id
  )
  SELECT count(*) INTO v_stopped FROM stopped;

  -- (c) The 9 tables with a NO ACTION FK to companies(id) — every other
  -- FK'd table CASCADEs on its own.
  DELETE FROM public.task_comments         WHERE company_id = p_company_id;
  DELETE FROM public.task_work_sessions     WHERE company_id = p_company_id;
  DELETE FROM public.team_members           WHERE company_id = p_company_id;
  DELETE FROM public.team_roles             WHERE company_id = p_company_id;
  DELETE FROM public.user_roles             WHERE company_id = p_company_id;
  DELETE FROM public.pipeline_stage_targets WHERE company_id = p_company_id;
  DELETE FROM public.storage_archive_queue  WHERE company_id = p_company_id;
  DELETE FROM public.filehub_file_versions  WHERE company_id = p_company_id;
  DELETE FROM public.archives               WHERE company_id = p_company_id;

  -- (d) These 3 have a company_id column but no FK at all — previously
  -- silently orphaned by both RPCs. files_index is a VIEW (over
  -- filehub_files/submission_attachments/task_attachments), not a table —
  -- it must NOT get a delete here, it would error.
  DELETE FROM public.task_manual_time_entries WHERE company_id = p_company_id;
  DELETE FROM public.task_attachment_versions WHERE company_id = p_company_id;
  DELETE FROM public.task_submission_versions WHERE company_id = p_company_id;

  -- (e) Everything else FK'd to companies(id) CASCADEs from here.
  DELETE FROM public.companies WHERE id = p_company_id;

  RETURN jsonb_build_object(
    'purged_company', p_company_id,
    'name', v_name,
    'sessions_stopped', v_stopped,
    'purged_at', now()
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.fn_purge_company_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_purge_company_data(uuid) TO service_role;

-- ────────────────────────────────────────────────────────────────────────
-- 2. rpc_purge_company — owner self-service, confirm-name gated. Same
--    signature/auth/confirm-name check as before; the purge body itself
--    now lives in fn_purge_company_data.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_purge_company(p_company_id uuid, p_confirm_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company uuid := public.my_company_id();
  v_name text;
  v_is_owner boolean;
BEGIN
  IF v_company IS NULL OR p_company_id IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION 'You can only purge your own workspace';
  END IF;

  SELECT COALESCE(is_owner, false) INTO v_is_owner FROM public.users WHERE id = auth.uid();
  IF NOT COALESCE(v_is_owner, false) THEN
    RAISE EXCEPTION 'Only the workspace owner can purge the company';
  END IF;

  SELECT name INTO v_name FROM public.companies WHERE id = p_company_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'Company not found'; END IF;
  IF p_confirm_name IS DISTINCT FROM v_name THEN
    RAISE EXCEPTION 'Confirmation text does not match the workspace name';
  END IF;

  RETURN public.fn_purge_company_data(p_company_id);
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────
-- 3. rpc_platform_delete_company — platform-admin only. Same signature/
--    return type (void) as before.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_platform_delete_company(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  PERFORM public.fn_purge_company_data(p_company_id);
END;
$function$;

-- ────────────────────────────────────────────────────────────────────────
-- 4. rpc_platform_soft_delete_company / rpc_platform_restore_company /
--    rpc_platform_purge_company_authorize — the grace-period flow around
--    the hard purge above. companies.deleted_at/is_active already exist.
-- ────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_platform_soft_delete_company(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted_at timestamptz;
  v_exists     boolean;
  v_stopped    int;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  SELECT deleted_at, true INTO v_deleted_at, v_exists FROM public.companies WHERE id = p_company_id;
  IF NOT COALESCE(v_exists, false) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;
  IF v_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Company is already deleted';
  END IF;

  WITH stopped AS (
    UPDATE public.task_work_sessions
    SET status = 'completed',
        completed_at = COALESCE(last_heartbeat_at, now()),
        total_seconds_spent = GREATEST(1, EXTRACT(EPOCH FROM (
            COALESCE(last_heartbeat_at, now()) - started_at))::int)
    WHERE company_id = p_company_id AND status = 'active'
    RETURNING id
  )
  SELECT count(*) INTO v_stopped FROM stopped;

  UPDATE public.companies
  SET deleted_at = now(), is_active = false
  WHERE id = p_company_id
  RETURNING deleted_at INTO v_deleted_at;

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'sessions_stopped', v_stopped,
    'deleted_at', v_deleted_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_platform_restore_company(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted_at timestamptz;
  v_exists     boolean;
  v_restored_at timestamptz;
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  SELECT deleted_at, true INTO v_deleted_at, v_exists FROM public.companies WHERE id = p_company_id;
  IF NOT COALESCE(v_exists, false) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;
  IF v_deleted_at IS NULL THEN
    RAISE EXCEPTION 'Company is not deleted';
  END IF;

  UPDATE public.companies
  SET deleted_at = NULL, is_active = true
  WHERE id = p_company_id;

  v_restored_at := now();

  RETURN jsonb_build_object(
    'company_id', p_company_id,
    'restored_at', v_restored_at
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_platform_purge_company_authorize(p_company_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public._is_platform_admin() THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'Company not found';
  END IF;

  RETURN p_company_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_purge_company(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_platform_delete_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_platform_soft_delete_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_platform_restore_company(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_platform_purge_company_authorize(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────
-- Overload guard — CREATE OR REPLACE with a changed argument list ADDS a
-- signature rather than replacing. Fail the migration rather than discover
-- it in the editor.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, count(*) AS n
    FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname IN ('fn_purge_company_data', 'rpc_purge_company',
                         'rpc_platform_delete_company', 'rpc_platform_soft_delete_company',
                         'rpc_platform_restore_company', 'rpc_platform_purge_company_authorize')
    GROUP BY p.proname
  LOOP
    IF r.n <> 1 THEN
      RAISE EXCEPTION 'MIGRATION FAILED: % has % signatures, expected exactly 1', r.proname, r.n;
    END IF;
  END LOOP;
END;
$$;
