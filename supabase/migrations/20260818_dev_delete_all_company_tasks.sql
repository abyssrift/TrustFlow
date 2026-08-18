-- Issue #215: Dev Tools "Delete All Tasks for this Company" button.
--
-- The existing "Clear All Tasks" dev-tool button runs a raw client-side
-- `supabase.from('tasks').delete()` with no company scope. The tasks table
-- has RLS enabled with no DELETE policy at all, so that call silently
-- deletes zero rows for any normal (non-superuser) session -- it reports
-- "Success" regardless. This RPC is the real, working, company-scoped
-- replacement: SECURITY DEFINER, gated to the caller's own company and to
-- company owners only (same elevated-action gate as rpc_delete_task_comment).
--
-- Every FK referencing tasks(id) -- activity_log, task_comments,
-- task_assignments, task_attachments, task_submissions, task_work_sessions,
-- filehub_files, pipeline_stage_history, automation_execution_log,
-- task_mention_acks, task_ping_targets, task_pipeline_links,
-- task_manual_time_entries, and tasks.parent_task_id itself -- is already
-- ON DELETE CASCADE (verified against the live schema), so a single DELETE
-- on tasks is sufficient; no manual per-table ordering is needed.

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

  IF NOT COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE) THEN
    RAISE EXCEPTION 'Only the company owner can delete all tasks';
  END IF;

  DELETE FROM public.tasks WHERE company_id = v_company_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  PERFORM public.log_event(v_company_id, v_user_id, 'company', v_company_id, 'dev.all_tasks_deleted', jsonb_build_object('count', v_deleted));

  RETURN v_deleted;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_dev_delete_all_company_tasks() TO authenticated;
