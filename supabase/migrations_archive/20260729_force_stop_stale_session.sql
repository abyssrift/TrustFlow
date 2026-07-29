-- 20260729_force_stop_stale_session.sql
-- Fixes #162: the #156 archive guard correctly blocks archiving while a
-- timer is active, but a dead session (laptop closed mid-timer) has no exit
-- short of the 8h sweep — the error just names the holder with no action.
--
-- 1. rpc_archive_task's block now attaches a machine-readable DETAIL (session
--    id, task, holder, staleness) so the client can offer a real action
--    instead of parsing the message string.
-- 2. rpc_force_stop_session lets a user with archive:create/pipeline.edit
--    close a session whose heartbeat has gone stale (> IDLE_MS, matching
--    lib/sessionPresence.ts) — and only a stale one, so this can't be used
--    to cut off someone genuinely still working.
--
-- rpc_archive_task is restated whole (not just the exception block) because
-- this is a plain CREATE OR REPLACE of the same function signature that
-- last got its full body from 20260728_archive_manual_time_subtree_restore_locks
-- (the FOR UPDATE lock + manual_time_entries snapshot key from #157/#160) —
-- carrying that body forward here keeps it a single source of truth instead
-- of a diff against a function defined three migrations back.

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

    -- #160: hold the task row for the rest of the transaction. rpc_start_work
    -- and rpc_resume_session take the same lock, so a timer cannot appear
    -- between the guard below and the DELETE at the end, and two concurrent
    -- archives of the same task serialise instead of both writing an archive.
    PERFORM 1 FROM public.tasks WHERE id = p_task_id FOR UPDATE;

    SELECT * INTO v_task_record FROM public.tasks WHERE id = p_task_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task no longer exists.' USING ERRCODE = 'P0002';
    END IF;

    -- Someone is actively working this task: refuse, and say who and where.
    -- The 30s grace window covers a timer stopped moments ago whose client is
    -- still syncing. ('completed' is the real stopped state — the old code
    -- tested 'stopped', which never matches.)
    SELECT ws.id AS session_id, ws.last_heartbeat_at,
           COALESCE(u.display_name, u.full_name, u.email, 'Someone') AS who
      INTO v_blocker
      FROM public.task_work_sessions ws
      LEFT JOIN public.users u ON u.id = ws.user_id
     WHERE ws.task_id = p_task_id
       AND (ws.status = 'active'
            OR (ws.status = 'completed' AND ws.completed_at > now() - interval '30 seconds'))
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Concurrency Lock: % has an active timer on "%". Stop the timer before archiving.',
            v_blocker.who, v_task_record.title
            USING ERRCODE = '55006',
                  DETAIL = jsonb_build_object(
                      'session_id',  v_blocker.session_id,
                      'task_id',     p_task_id,
                      'task_title',  v_task_record.title,
                      'holder',      v_blocker.who,
                      -- Keep in sync with IDLE_MS in lib/sessionPresence.ts.
                      'is_stale',    v_blocker.last_heartbeat_at < now() - interval '90 seconds'
                  )::text;
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
                          FROM public.task_work_sessions ws WHERE task_id = p_task_id),
        -- #157: cascade-deleted with the task and unrecoverable without this.
        'manual_time_entries', (SELECT COALESCE(jsonb_agg(to_jsonb(mt)), '[]'::jsonb)
                          FROM public.task_manual_time_entries mt WHERE task_id = p_task_id)
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

CREATE OR REPLACE FUNCTION public.rpc_force_stop_session(p_session_id uuid)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_session            RECORD;
    v_caller_company_id  UUID;
    v_use_bus            BOOLEAN;
    v_duration_sec       INTEGER;
BEGIN
    SELECT company_id INTO v_caller_company_id FROM public.users WHERE id = auth.uid();

    IF NOT public.has_permission('archive:create')
       AND NOT public.has_permission('pipeline.edit') THEN
        RAISE EXCEPTION 'Access Denied: Insufficient permissions.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_session FROM public.task_work_sessions
    WHERE id = p_session_id AND status = 'active'
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found or already stopped.' USING ERRCODE = 'P0002';
    END IF;

    IF v_session.company_id != v_caller_company_id THEN
        RAISE EXCEPTION 'Security Breach: cross-company force-stop attempt.' USING ERRCODE = '42501';
    END IF;

    -- Only a stale heartbeat may be force-stopped — never a session that's
    -- still genuinely pulsing. Keep in sync with IDLE_MS in lib/sessionPresence.ts.
    IF v_session.last_heartbeat_at >= now() - interval '90 seconds' THEN
        RAISE EXCEPTION 'Concurrency Lock: this timer is still active — cannot force-stop a live session.'
            USING ERRCODE = '55006';
    END IF;

    SELECT s.use_business_hours INTO v_use_bus
    FROM public.tasks t
    JOIN public.pipeline_stages s ON t.current_stage_id = s.id
    WHERE t.id = v_session.task_id;

    IF COALESCE(v_use_bus, FALSE) THEN
        v_duration_sec := COALESCE(EXTRACT(EPOCH FROM public.fn_calculate_business_duration(
            v_session.started_at, v_session.last_heartbeat_at))::INTEGER, 0);
    ELSE
        v_duration_sec := COALESCE(EXTRACT(EPOCH FROM
            (v_session.last_heartbeat_at - v_session.started_at))::INTEGER, 0);
    END IF;
    v_duration_sec := GREATEST(v_duration_sec, 1);

    UPDATE public.task_work_sessions
    SET status              = 'completed',
        completed_at        = v_session.last_heartbeat_at,
        total_seconds_spent = v_duration_sec,
        notes = CASE
                    WHEN notes LIKE '%[force-stopped]%' THEN notes
                    ELSE COALESCE(notes, '') || ' [force-stopped]'
                END
    WHERE id = v_session.id;

    -- Same notification the 8h sweep sends on an inactivity close — this is
    -- the same thing happening sooner, by a person instead of the timer.
    PERFORM public.rpc_notify_timer_auto_stopped(
        v_session.task_id,
        (SELECT title FROM public.tasks WHERE id = v_session.task_id),
        v_duration_sec,
        v_session.user_id
    );

    RETURN jsonb_build_object(
        'status',     'force_stopped',
        'session_id', v_session.id,
        'task_id',    v_session.task_id,
        'duration',   v_duration_sec
    );
END;
$function$;
