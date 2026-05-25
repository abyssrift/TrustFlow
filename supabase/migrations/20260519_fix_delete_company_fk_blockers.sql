-- Fix rpc_platform_delete_company: three FK chains blocked deletion for companies
-- with data:
--   1. task_manual_time_entries has company_id but no FK to companies (no cascade),
--      and approved_by → users NO ACTION → blocked cascade delete of users.
--   2. users.reports_to is a self-referential NO ACTION FK → blocked cascade delete
--      of users when multiple users in the same company reference each other.
--   3. teams.manager_id → users NO ACTION → could race with cascade order.

DROP FUNCTION IF EXISTS public.rpc_platform_delete_company(UUID);
CREATE FUNCTION public.rpc_platform_delete_company(p_company_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT;
BEGIN
  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = auth.uid();
  IF v_email IS NULL OR v_email NOT IN (
    'adamsamir2005@gmail.com','adam.samir@trustedgellc.com','adamsamir@hotmail.com'
  ) THEN
    RAISE EXCEPTION 'access denied' USING ERRCODE = '42501';
  END IF;

  -- Nullify self-referential and cross-entity NO ACTION refs before any deletes
  UPDATE public.users  SET reports_to     = NULL WHERE company_id = p_company_id;
  UPDATE public.teams  SET manager_id     = NULL WHERE company_id = p_company_id;
  UPDATE public.teams  SET parent_team_id = NULL WHERE company_id = p_company_id;

  -- Delete NO ACTION FK tables (no cascade from companies)
  DELETE FROM public.task_manual_time_entries WHERE company_id = p_company_id;
  DELETE FROM public.user_roles               WHERE company_id = p_company_id;
  DELETE FROM public.team_roles               WHERE company_id = p_company_id;
  DELETE FROM public.team_members             WHERE company_id = p_company_id;
  DELETE FROM public.task_comments            WHERE company_id = p_company_id;
  DELETE FROM public.task_work_sessions       WHERE company_id = p_company_id;
  DELETE FROM public.pipeline_stage_targets   WHERE company_id = p_company_id;
  DELETE FROM public.storage_archive_queue    WHERE company_id = p_company_id;
  DELETE FROM public.archives                 WHERE company_id = p_company_id;

  -- CASCADE handles the rest: activity_events, analytics_snapshots,
  -- automation_execution_log, invitations, pipeline_automations,
  -- pipeline_linked_outcomes, pipeline_stage_history, pipelines, projects,
  -- reporting_jobs, roles, submission_attachments, task_assignments,
  -- task_attachments, task_mention_acks, task_submissions, tasks, teams, users
  DELETE FROM public.companies WHERE id = p_company_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_platform_delete_company(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_platform_delete_company(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.rpc_platform_delete_company(UUID) TO authenticated;
