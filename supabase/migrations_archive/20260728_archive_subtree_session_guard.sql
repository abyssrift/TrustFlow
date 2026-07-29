-- 20260728_archive_subtree_session_guard.sql
-- Fixes #156 (critical, data loss).
--
-- rpc_archive_task guarded active timers on the target task only, then ran
-- DELETE FROM tasks — which fires trg_tasks_recursive_delete ->
-- cleanup_recursive_child_tasks(), hard-deleting the whole subtask subtree
-- with no session check and no archive snapshot. Every child table is
-- ON DELETE CASCADE, so running timers and all logged time on those subtasks
-- were destroyed unrecoverably.
--
-- Fix: archive direct children recursively before snapshotting the parent, so
-- each level runs its own permission + session guard and writes its own
-- archives row. By the time the parent is deleted the trigger has nothing left
-- to destroy. It is one transaction, so an active timer anywhere in the subtree
-- rolls the entire archive back — the same guarantee rpc_archive_project's
-- leaf-first loop already relies on.
--
-- Also: the guard's grace-period branch tested status = 'stopped', a value this
-- column never holds ('active' | 'completed' only), so it was dead code.

CREATE OR REPLACE FUNCTION public.rpc_archive_task(p_task_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_task_record       RECORD;
    v_snapshot          JSONB;
    v_metadata          JSONB;
    v_caller_company_id UUID;
    v_target_company_id UUID;
    v_involved_users    UUID[];
    v_archive_id        UUID;
    v_file              RECORD;
    v_assigned_user     UUID;
    v_completed_at      TIMESTAMPTZ;
    v_child_id          UUID;
    v_blocker           RECORD;
BEGIN
    SELECT company_id INTO v_caller_company_id FROM public.users WHERE id = auth.uid();
    SELECT company_id INTO v_target_company_id FROM public.tasks WHERE id = p_task_id;

    IF v_caller_company_id IS NULL OR v_target_company_id IS NULL
       OR v_caller_company_id != v_target_company_id THEN
        RAISE EXCEPTION 'Security Breach: Unauthorized archival attempt.' USING ERRCODE = '42501';
    END IF;

    IF NOT public.has_permission('archive:create')
       AND NOT public.has_permission('pipeline.edit') THEN
        RAISE EXCEPTION 'Access Denied: Insufficient permissions.';
    END IF;

    SELECT * INTO v_task_record FROM public.tasks WHERE id = p_task_id;

    -- Someone is actively working this task: refuse, and say who and where.
    -- The 30s grace window covers a timer stopped moments ago whose client is
    -- still syncing. ('completed' is the real stopped state — the old code
    -- tested 'stopped', which never matches.)
    SELECT COALESCE(u.display_name, u.full_name, u.email, 'Someone') AS who
      INTO v_blocker
      FROM public.task_work_sessions ws
      LEFT JOIN public.users u ON u.id = ws.user_id
     WHERE ws.task_id = p_task_id
       AND (ws.status = 'active'
            OR (ws.status = 'completed' AND ws.completed_at > now() - interval '30 seconds'))
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Concurrency Lock: % has an active timer on "%". Stop the timer before archiving.',
            v_blocker.who, v_task_record.title;
    END IF;

    -- Archive the subtree bottom-up FIRST. Without this the DELETE below fires
    -- trg_tasks_recursive_delete and hard-deletes these children unarchived.
    -- Recursion re-runs the guards above for every descendant, so an active
    -- timer anywhere below aborts the whole transaction.
    FOR v_child_id IN
        SELECT id FROM public.tasks WHERE parent_task_id = p_task_id
    LOOP
        PERFORM public.rpc_archive_task(v_child_id);
    END LOOP;

    v_snapshot := jsonb_build_object(
        'task',         to_jsonb(v_task_record),
        'assignments',  (SELECT COALESCE(jsonb_agg(to_jsonb(a)),  '[]'::jsonb)
                         FROM public.task_assignments a WHERE task_id = p_task_id),
        'comments',     (SELECT COALESCE(jsonb_agg(to_jsonb(c)),  '[]'::jsonb)
                         FROM public.task_comments c WHERE task_id = p_task_id),
        'attachments',  (SELECT COALESCE(jsonb_agg(to_jsonb(at)), '[]'::jsonb)
                         FROM public.task_attachments at WHERE task_id = p_task_id),
        'submissions',  (
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'submission',  to_jsonb(s),
                    'attachments', (SELECT COALESCE(jsonb_agg(to_jsonb(sa)), '[]'::jsonb)
                                    FROM public.submission_attachments sa
                                    WHERE submission_id = s.id)
                )
            ), '[]'::jsonb) FROM public.task_submissions s WHERE task_id = p_task_id
        ),
        'history',       (SELECT COALESCE(jsonb_agg(to_jsonb(h)),  '[]'::jsonb)
                          FROM public.pipeline_stage_history h WHERE task_id = p_task_id),
        'work_sessions', (SELECT COALESCE(jsonb_agg(to_jsonb(ws)), '[]'::jsonb)
                          FROM public.task_work_sessions ws WHERE task_id = p_task_id)
    );

    v_involved_users := ARRAY(
        SELECT DISTINCT user_id FROM (
            SELECT assignee_user_id AS user_id FROM public.task_assignments
            WHERE task_id = p_task_id AND assignee_user_id IS NOT NULL
            UNION
            SELECT author_id FROM public.task_comments WHERE task_id = p_task_id
            UNION
            SELECT submitted_by FROM public.task_submissions WHERE task_id = p_task_id
        ) u
    );

    v_metadata := jsonb_build_object(
        'title',            v_task_record.title,
        'original_id',      p_task_id,
        'pipeline_id',      v_task_record.pipeline_id,
        'project_id',       v_task_record.project_id,
        'parent_task_id',   v_task_record.parent_task_id,
        'involved_user_ids', v_involved_users
    );

    -- ── FLUSH ANALYTICS SNAPSHOTS (while task is still live in all tables) ──
    -- Use completed_at if terminal, else now() as the period anchor.
    v_completed_at := COALESCE(v_task_record.completed_at, now());

    FOR v_assigned_user IN
        SELECT DISTINCT assignee_user_id
        FROM public.task_assignments
        WHERE task_id = p_task_id AND assignee_user_id IS NOT NULL
    LOOP
        PERFORM public.rpc_flush_user_snapshot(
            v_assigned_user, 'week',  date_trunc('week',  v_completed_at)::date);
        PERFORM public.rpc_flush_user_snapshot(
            v_assigned_user, 'month', date_trunc('month', v_completed_at)::date);
        PERFORM public.rpc_flush_user_snapshot(
            v_assigned_user, 'year',  date_trunc('year',  v_completed_at)::date);
    END LOOP;

    IF v_task_record.pipeline_id IS NOT NULL THEN
        PERFORM public.rpc_flush_pipeline_snapshot(
            v_task_record.pipeline_id, 'week',  date_trunc('week',  v_completed_at)::date);
        PERFORM public.rpc_flush_pipeline_snapshot(
            v_task_record.pipeline_id, 'month', date_trunc('month', v_completed_at)::date);
        PERFORM public.rpc_flush_pipeline_snapshot(
            v_task_record.pipeline_id, 'year',  date_trunc('year',  v_completed_at)::date);
    END IF;
    -- ── END ANALYTICS FLUSH ──────────────────────────────────────────────────

    INSERT INTO public.archives
        (company_id, entity_type, entity_id, snapshot, metadata, archived_by)
    VALUES
        (v_caller_company_id, 'task', p_task_id, v_snapshot, v_metadata, auth.uid())
    RETURNING id INTO v_archive_id;

    -- Queue storage-backed files for archival
    FOR v_file IN (
        SELECT storage_path AS path FROM public.task_attachments
        WHERE task_id = p_task_id AND storage_path IS NOT NULL
        UNION
        SELECT sa.storage_path AS path
        FROM public.submission_attachments sa
        JOIN public.task_submissions s ON s.id = sa.submission_id
        WHERE s.task_id = p_task_id AND sa.storage_path IS NOT NULL
    ) LOOP
        INSERT INTO public.storage_archive_queue (company_id, file_path, action)
        VALUES (v_caller_company_id, v_file.path, 'archive');
    END LOOP;

    DELETE FROM public.tasks WHERE id = p_task_id;

    RETURN v_archive_id;
END;
$function$;
