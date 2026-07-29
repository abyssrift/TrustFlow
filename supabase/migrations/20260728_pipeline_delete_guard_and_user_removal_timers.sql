-- 20260728_pipeline_delete_guard_and_user_removal_timers.sql
-- Fixes #158 (rpc_delete_pipeline wiped every task on the board with no
-- active-timer guard) and #161 (rpc_remove_user_from_company left the removed
-- user's timers running).

-- ── #158 ───────────────────────────────────────────────────────────────────
-- Same guard rpc_archive_task uses since #156, applied board-wide. Without it
-- a board delete soft-deleted tasks out from under anyone mid-work, leaving
-- their session 'active' against a task gone from every surface until the
-- 8h stale sweep reclaimed it.
CREATE OR REPLACE FUNCTION public.rpc_delete_pipeline(p_pipeline_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_blocker    RECORD;
BEGIN
  SELECT company_id INTO v_company_id
  FROM public.pipelines
  WHERE id = p_pipeline_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline not found';
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.delete')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  SELECT COALESCE(u.display_name, u.full_name, u.email, 'Someone') AS who,
         t.title AS task_title
    INTO v_blocker
    FROM public.task_work_sessions ws
    JOIN public.tasks t  ON t.id = ws.task_id
    LEFT JOIN public.users u ON u.id = ws.user_id
   WHERE t.pipeline_id = p_pipeline_id
     AND t.deleted_at IS NULL
     AND ws.status = 'active'
   LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Concurrency Lock: % has an active timer on "%". Stop it before deleting this board.',
      v_blocker.who, v_blocker.task_title;
  END IF;

  UPDATE public.tasks
  SET deleted_at = NOW()
  WHERE pipeline_id = p_pipeline_id AND deleted_at IS NULL;

  UPDATE public.pipelines
  SET deleted_at = NOW(), is_default = FALSE, updated_at = NOW()
  WHERE id = p_pipeline_id;

  PERFORM public.log_event(
    v_company_id, v_user_id, 'pipeline', p_pipeline_id, 'pipeline.deleted',
    jsonb_build_object('pipeline_id', p_pipeline_id)
  );
END;
$function$;

-- ── #161 ───────────────────────────────────────────────────────────────────
-- Close the removed user's own running timers. Deliberately NOT
-- internal_stop_task_sessions(task_id): that is task-scoped and would also
-- stop colleagues still working the same task. Duration anchors to
-- last_heartbeat_at, matching rpc_start_work's orphan cleanup — now() would
-- over-count a session abandoned hours ago.
CREATE OR REPLACE FUNCTION public.rpc_remove_user_from_company(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_target_user_company_id UUID;
  v_closed INT;
BEGIN
  IF NOT public.has_permission('role.manage') THEN
    RETURN jsonb_build_object('error', 'Permission denied: role.manage required');
  END IF;

  SELECT company_id INTO v_company_id FROM public.users WHERE id = auth.uid();
  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No company context found');
  END IF;

  SELECT company_id INTO v_target_user_company_id FROM public.users WHERE id = p_user_id;
  IF v_target_user_company_id IS NULL OR v_target_user_company_id != v_company_id THEN
    RETURN jsonb_build_object('error', 'User not found in this company');
  END IF;

  IF p_user_id = auth.uid() THEN
    RETURN jsonb_build_object('error', 'Cannot remove yourself from the company');
  END IF;

  WITH stopped AS (
    UPDATE public.task_work_sessions
    SET status = 'completed',
        completed_at = COALESCE(last_heartbeat_at, now()),
        total_seconds_spent = GREATEST(1, EXTRACT(EPOCH FROM (
            COALESCE(last_heartbeat_at, now()) - started_at))::int)
    WHERE user_id = p_user_id AND status = 'active'
    RETURNING id
  )
  SELECT count(*) INTO v_closed FROM stopped;

  UPDATE public.users
  SET company_id = NULL, updated_at = NOW()
  WHERE id = p_user_id AND company_id = v_company_id;

  RETURN jsonb_build_object('success', true, 'sessions_closed', v_closed);
END;
$function$;
