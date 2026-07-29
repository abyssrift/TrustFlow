-- 20260728_archive_manual_time_subtree_restore_locks.sql
-- Fixes #157 (manual time destroyed on archive), #159 (restore cannot
-- reassemble a subtask tree) and #160 (no row lock around the archive guard).
--
-- #157  task_manual_time_entries is ON DELETE CASCADE on tasks but was absent
--       from the archive snapshot, so every archive silently destroyed all
--       manually declared time, including entries pending approval.
-- #159  Restore rebuilt exactly one task row. Since #156 the children survive
--       as their own archive rows, so restoring a child first hit a raw
--       tasks_parent_task_id_fkey violation and restoring a parent returned an
--       empty shell with the subtree left archived.
-- #160  The active-session guard was an unlocked read: a timer started between
--       the guard and the DELETE was cascade-deleted, and two concurrent
--       archives could both pass the guard and both insert an archives row.

-- ── rpc_archive_task: lock the row, snapshot manual time ────────────────────
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
    -- still syncing. ('completed' is the real stopped state -- the old code
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

    INSERT INTO public.archives
        (company_id, entity_type, entity_id, snapshot, metadata, archived_by)
    VALUES
        (v_caller_company_id, 'task', p_task_id, v_snapshot, v_metadata, auth.uid())
    RETURNING id INTO v_archive_id;

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

-- ── _internal_restore_task_archive: rebuild the whole subtree ───────────────
CREATE OR REPLACE FUNCTION public._internal_restore_task_archive(p_archive_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_archive   RECORD;
    v_task      JSONB;
    v_task_id   UUID;
    v_parent_id UUID;
    v_sub       JSONB;
    v_kin       UUID;
BEGIN
    SELECT * INTO v_archive
    FROM public.archives
    WHERE id = p_archive_id AND entity_type = 'task';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task archive not found: %', p_archive_id;
    END IF;

    v_task    := v_archive.snapshot->'task';
    v_task_id := (v_task->>'id')::UUID;

    IF v_archive.restored_at IS NOT NULL THEN
        RETURN v_task_id; -- already restored, skip
    END IF;

    IF EXISTS (SELECT 1 FROM public.tasks WHERE id = v_task_id) THEN
        RETURN v_task_id; -- already in active pipeline, skip
    END IF;

    -- #159: a subtask cannot be inserted before its parent exists, so walk up
    -- first. Read the parent from the snapshot rather than metadata so archives
    -- written before #156 (which have no parent_task_id key) work too.
    v_parent_id := NULLIF(v_task->>'parent_task_id', '')::UUID;
    IF v_parent_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = v_parent_id) THEN
        SELECT id INTO v_kin
        FROM public.archives
        WHERE entity_type = 'task'
          AND company_id = v_archive.company_id
          AND restored_at IS NULL
          AND (snapshot->'task'->>'id')::UUID = v_parent_id;

        IF v_kin IS NULL THEN
            RAISE EXCEPTION
                'Cannot restore "%": its parent task is neither active nor in the archive.',
                v_archive.metadata->>'title';
        END IF;

        PERFORM public._internal_restore_task_archive(v_kin);

        -- Restoring the ancestor sweeps its descendants, which includes us.
        -- Without this re-check the insert below is a duplicate-key error on
        -- any restore that starts below the top of the tree.
        IF EXISTS (SELECT 1 FROM public.tasks WHERE id = v_task_id) THEN
            RETURN v_task_id;
        END IF;
    END IF;

    INSERT INTO public.tasks
        SELECT (jsonb_populate_record(NULL::public.tasks, v_task)).*;

    INSERT INTO public.task_assignments
        SELECT (jsonb_populate_record(NULL::public.task_assignments, a)).*
        FROM jsonb_array_elements(v_archive.snapshot->'assignments') AS a;

    INSERT INTO public.task_comments
        SELECT (jsonb_populate_record(NULL::public.task_comments, c)).*
        FROM jsonb_array_elements(v_archive.snapshot->'comments') AS c;

    INSERT INTO public.task_attachments
        SELECT (jsonb_populate_record(NULL::public.task_attachments, at)).*
        FROM jsonb_array_elements(v_archive.snapshot->'attachments') AS at;

    INSERT INTO public.pipeline_stage_history
        SELECT (jsonb_populate_record(NULL::public.pipeline_stage_history, h)).*
        FROM jsonb_array_elements(v_archive.snapshot->'history') AS h;

    INSERT INTO public.task_work_sessions
        SELECT (jsonb_populate_record(NULL::public.task_work_sessions, ws)).*
        FROM jsonb_array_elements(v_archive.snapshot->'work_sessions') AS ws;

    -- #157. Sessions go in first: manual entries carry session_id.
    -- COALESCE keeps pre-#157 archives (no such key) restorable.
    INSERT INTO public.task_manual_time_entries
        SELECT (jsonb_populate_record(NULL::public.task_manual_time_entries, mt)).*
        FROM jsonb_array_elements(
            COALESCE(v_archive.snapshot->'manual_time_entries', '[]'::jsonb)) AS mt;

    FOR v_sub IN SELECT * FROM jsonb_array_elements(v_archive.snapshot->'submissions') LOOP
        INSERT INTO public.task_submissions
            SELECT (jsonb_populate_record(NULL::public.task_submissions, v_sub->'submission')).*;
        INSERT INTO public.submission_attachments
            SELECT (jsonb_populate_record(NULL::public.submission_attachments, sa)).*
            FROM jsonb_array_elements(v_sub->'attachments') AS sa;
    END LOOP;

    UPDATE public.archives
    SET restored_at = now(), restored_by = auth.uid()
    WHERE id = p_archive_id;

    PERFORM public.log_event(
        v_archive.company_id, auth.uid(), 'task', v_task_id, 'task.restored', v_archive.metadata
    );

    -- #159: bring the children back with the parent. Archiving a parent since
    -- #156 writes one archive row per descendant; restoring only the clicked
    -- row would hand back an empty shell.
    FOR v_kin IN
        SELECT id FROM public.archives
        WHERE entity_type = 'task'
          AND company_id = v_archive.company_id
          AND restored_at IS NULL
          AND (snapshot->'task'->>'parent_task_id')::UUID = v_task_id
    LOOP
        PERFORM public._internal_restore_task_archive(v_kin);
    END LOOP;

    RETURN v_task_id;
END;
$function$;

-- ── rpc_restore_archive: validate, then delegate ────────────────────────────
-- Was a byte-for-byte copy of the internal worker's insert block; now it only
-- owns the permission and already-restored checks, so the subtree logic above
-- can never drift between the two entry points.
CREATE OR REPLACE FUNCTION public.rpc_restore_archive(p_archive_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_archive    RECORD;
    v_task_id    UUID;
    v_company_id UUID;
BEGIN
    v_company_id := public.my_company_id();

    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = auth.uid()) = TRUE
        OR public.has_permission('archive.restore')
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions to restore from archive.';
    END IF;

    SELECT * INTO v_archive
    FROM public.archives
    WHERE id = p_archive_id AND company_id = v_company_id AND entity_type = 'task';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Archive not found or unauthorized.';
    END IF;

    IF v_archive.restored_at IS NOT NULL THEN
        RAISE EXCEPTION 'This snapshot has already been restored.';
    END IF;

    v_task_id := (v_archive.snapshot->'task'->>'id')::UUID;

    IF EXISTS (SELECT 1 FROM public.tasks WHERE id = v_task_id) THEN
        RAISE EXCEPTION 'A task with this ID already exists in the active pipeline.';
    END IF;

    RETURN public._internal_restore_task_archive(p_archive_id);
END;
$function$;

-- ── timer starts serialise against an in-flight archive (#160) ──────────────
CREATE OR REPLACE FUNCTION public.rpc_start_work(p_task_id uuid, p_start_time timestamp with time zone)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_session_id        UUID;
    v_company_id        UUID;
    v_stage_id          UUID;
    v_final_start_time  TIMESTAMPTZ := p_start_time;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::text));

    IF NOT EXISTS (
        SELECT 1 FROM public.task_participants
        WHERE task_id = p_task_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'User is not a participant' USING ERRCODE = '42501';
    END IF;

    -- #160: the per-user advisory lock above does not serialise against an
    -- archive of this task. Take the task row so we either start before the
    -- archive's guard sees us, or wait and find the task gone.
    SELECT company_id, current_stage_id
    INTO v_company_id, v_stage_id
    FROM public.tasks WHERE id = p_task_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'This task was archived or deleted. Refresh to see the current board.'
            USING ERRCODE = 'P0002';
    END IF;

    IF v_final_start_time > now() + interval '1 minute'
       OR v_final_start_time < now() - interval '5 minutes' THEN
        v_final_start_time := now();
    END IF;

    -- [ORPHAN CLEANUP] Close any session this user left dangling 'active'
    -- (stale tab, duplicate start, crash). Anchor to last_heartbeat_at:
    -- now() over-counts sessions abandoned hours ago, and last_heartbeat_at
    -- is the last proof of life so we keep it untouched.
    UPDATE public.task_work_sessions
    SET status = 'completed',
        completed_at = last_heartbeat_at,
        total_seconds_spent = GREATEST(1, EXTRACT(EPOCH FROM (last_heartbeat_at - started_at))::int)
    WHERE user_id = auth.uid() AND status = 'active';

    INSERT INTO public.task_work_sessions (
        task_id, user_id, company_id, stage_id, started_at, status
    )
    VALUES (
        p_task_id, auth.uid(), v_company_id, v_stage_id, v_final_start_time, 'active'
    )
    RETURNING id INTO v_session_id;

    RETURN v_session_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_resume_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_session public.task_work_sessions%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::text));

    SELECT * INTO v_session
    FROM public.task_work_sessions
    WHERE id = p_session_id AND user_id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

    -- #160: same task lock as rpc_start_work — resuming re-arms an active
    -- session, so it must not slip past an archive's guard either.
    PERFORM 1 FROM public.tasks WHERE id = v_session.task_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This task was archived or deleted. Refresh to see the current board.'
            USING ERRCODE = 'P0002';
    END IF;

    -- Only a just-beacon-stopped session may be resumed.
    IF v_session.status <> 'completed'
       OR COALESCE(v_session.completed_at, v_session.last_heartbeat_at) < now() - interval '2 minutes' THEN
        RAISE EXCEPTION 'Session is not resumable' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.task_participants
        WHERE task_id = v_session.task_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'User is not a participant' USING ERRCODE = '42501';
    END IF;

    -- Singleton invariant: one active session per user.
    IF EXISTS (
        SELECT 1 FROM public.task_work_sessions
        WHERE user_id = auth.uid() AND status = 'active' AND id <> p_session_id
    ) THEN
        RAISE EXCEPTION 'User already has an active session' USING ERRCODE = '42501';
    END IF;

    -- total_seconds_spent = 0 so the next close recomputes the FULL duration
    -- from the preserved started_at (backfill trigger keys off <= 0).
    UPDATE public.task_work_sessions
    SET status = 'active',
        completed_at = NULL,
        total_seconds_spent = 0,
        last_heartbeat_at = now()
    WHERE id = p_session_id;
END;
$function$;
