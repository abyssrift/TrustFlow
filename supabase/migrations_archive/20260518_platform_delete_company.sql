-- Platform admin: hard-delete a company and all its data.
-- Manually clears NO ACTION FK tables before the CASCADE delete.

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

  -- Delete NO ACTION FK tables first (they block the company DELETE)
  DELETE FROM public.user_roles             WHERE company_id = p_company_id;
  DELETE FROM public.team_roles             WHERE company_id = p_company_id;
  DELETE FROM public.team_members           WHERE company_id = p_company_id;
  DELETE FROM public.task_comments          WHERE company_id = p_company_id;
  DELETE FROM public.task_work_sessions     WHERE company_id = p_company_id;
  DELETE FROM public.pipeline_stage_targets WHERE company_id = p_company_id;
  DELETE FROM public.storage_archive_queue  WHERE company_id = p_company_id;
  DELETE FROM public.archives               WHERE company_id = p_company_id;

  -- CASCADE handles: activity_events, analytics_snapshots, automation_execution_log,
  -- invitations, pipeline_automations, pipeline_linked_outcomes, pipeline_stage_history,
  -- pipelines, projects, reporting_jobs, roles, submission_attachments, task_assignments,
  -- task_attachments, task_mention_acks, task_submissions, tasks, teams, users
  DELETE FROM public.companies WHERE id = p_company_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_platform_delete_company(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rpc_platform_delete_company(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.rpc_platform_delete_company(UUID) TO authenticated;
