-- 20260731_project_archive_soft_delete_guard.sql
-- Fixes #179 (critical, data loss) -- #156 one level up.
--
-- rpc_archive_project ended with `DELETE FROM public.projects`. Since #171/#172
-- a project owns tasks (tasks.project_id), carries portfolio_id (bulk-undo
-- linkage), and will carry deliverable_folder_id (plan Phase 4) -- a hard
-- DELETE destroys all of that with no recovery path once the archives row's
-- one-shot restore is exhausted.
--
-- The child-task handling was already correct: the bottom-up leaf-first loop
-- (see #156's own writeup: "rpc_archive_project is not affected -- its loop
-- deliberately picks leaf tasks first") already archives children via
-- rpc_archive_task, which since #156/#160 guards + locks + snapshots + hard
-- deletes each task itself. That part is untouched here.
--
-- What changes:
--   1. Soft-delete the project row (deleted_at) instead of DELETE. Every
--      projects_select/_update policy already filters deleted_at IS NULL, so
--      an archived project is invisible everywhere a live one is read, exactly
--      like rpc_undo_portfolio_instantiation's existing soft-delete.
--   2. An explicit up-front guard mirroring rpc_delete_pipeline's (#158): any
--      task in the project (subtasks included -- they carry project_id too)
--      holding a running session blocks the whole archive before any work
--      happens, naming the blocker. rpc_archive_task's own per-task guard would
--      also catch this mid-loop and roll the transaction back, but failing
--      fast here means we never start archiving leaves we'd have to undo.
--   3. Row lock (`FOR UPDATE`) on the project, same reasoning as #160 on tasks:
--      closes the gap between the guard read and the write.
--   4. rpc_restore_project adapted: the archived row now still exists (soft
--      deleted), so restore clears deleted_at instead of re-inserting. Older
--      archives rows written before this fix hard-deleted the project, so a
--      fallback INSERT-from-snapshot path is kept for those. The task-subtree
--      restore loop (#159's fix, already shipped) is untouched -- it already
--      walks archives for entity_type='task' under this project_id in
--      topological order regardless of how the project row itself is restored.

CREATE OR REPLACE FUNCTION public.rpc_archive_project(p_project_id UUID)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_project_record RECORD;
    v_task_id UUID;
    v_caller_company_id UUID;
    v_target_company_id UUID;
    v_archive_id UUID;
    v_snapshot JSONB;
    v_involved_users UUID[];
    v_blocker RECORD;
BEGIN
    -- 1. Security Check
    SELECT company_id INTO v_caller_company_id FROM public.users WHERE id = auth.uid();
    SELECT company_id INTO v_target_company_id FROM public.projects WHERE id = p_project_id;

    IF v_caller_company_id IS NULL OR v_target_company_id IS NULL OR v_caller_company_id != v_target_company_id THEN
        RAISE EXCEPTION 'Security Breach: Unauthorized archival attempt.' USING ERRCODE = '42501';
    END IF;

    -- 2. Permission Check
    IF NOT (SELECT is_owner FROM public.users WHERE id = auth.uid())
       AND NOT public.has_permission('archive:create')
       AND NOT public.has_permission('archive.restore') THEN
        RAISE EXCEPTION 'Access Denied: Insufficient permissions.';
    END IF;

    -- 3. Lock the project row for the rest of the transaction (mirrors #160's
    -- lock on tasks) so a session cannot start between the guard below and the
    -- soft-delete, and two concurrent archives of the same project serialise.
    SELECT * INTO v_project_record FROM public.projects WHERE id = p_project_id FOR UPDATE;
    IF NOT FOUND OR v_project_record.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
    END IF;

    -- #179: refuse up front while any child task -- at any depth, subtasks
    -- carry project_id too -- holds a running timer. Same guard shape as
    -- rpc_delete_pipeline (#158): name the blocking task and user.
    SELECT COALESCE(u.display_name, u.full_name, u.email, 'Someone') AS who,
           t.title AS task_title
      INTO v_blocker
      FROM public.task_work_sessions ws
      JOIN public.tasks t ON t.id = ws.task_id
      LEFT JOIN public.users u ON u.id = ws.user_id
     WHERE t.project_id = p_project_id
       AND t.deleted_at IS NULL
       AND ws.status = 'active'
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Concurrency Lock: % has an active timer on "%". Stop it before archiving this project.',
            v_blocker.who, v_blocker.task_title;
    END IF;

    -- 4. Aggregate Involved Users from all child tasks
    v_involved_users := ARRAY(
        SELECT DISTINCT user_id FROM (
            SELECT assignee_user_id AS user_id FROM public.task_assignments ta JOIN public.tasks t ON t.id = ta.task_id WHERE t.project_id = p_project_id AND assignee_user_id IS NOT NULL
            UNION
            SELECT author_id FROM public.task_comments tc JOIN public.tasks t ON t.id = tc.task_id WHERE t.project_id = p_project_id
            UNION
            SELECT submitted_by FROM public.task_submissions ts JOIN public.tasks t ON t.id = ts.task_id WHERE t.project_id = p_project_id
        ) u
    );

    -- 5. Archive child tasks bottom-up (unchanged shape since #156): pick a
    -- leaf (a task that is nobody's parent), archive it via rpc_archive_task
    -- -- which re-runs the session guard for that task, snapshots it, and hard
    -- deletes it -- which promotes its former parent to a leaf on the next
    -- pass. An active timer anywhere below aborts the whole transaction.
    LOOP
        SELECT id INTO v_task_id
        FROM public.tasks
        WHERE project_id = p_project_id
          AND deleted_at IS NULL
          AND id NOT IN (
              SELECT parent_task_id
              FROM public.tasks
              WHERE parent_task_id IS NOT NULL AND project_id = p_project_id AND deleted_at IS NULL
          )
        LIMIT 1;

        EXIT WHEN v_task_id IS NULL;

        PERFORM public.rpc_archive_task(v_task_id);
    END LOOP;

    -- 6. Snapshot Project (audit trail / Archives UI). Restore no longer
    -- re-inserts from this for new-style archives -- see rpc_restore_project --
    -- it just clears deleted_at, since the row below is soft-deleted rather
    -- than destroyed. Kept for history and for the legacy hard-delete fallback.
    v_snapshot := jsonb_build_object(
        'project', to_jsonb(v_project_record)
    );

    INSERT INTO public.archives (company_id, entity_type, entity_id, snapshot, metadata, archived_by)
    VALUES (
        v_caller_company_id,
        'project',
        p_project_id,
        v_snapshot,
        jsonb_build_object(
            'title', v_project_record.name,
            'involved_user_ids', v_involved_users
        ),
        auth.uid()
    )
    RETURNING id INTO v_archive_id;

    -- 7. #179: soft-delete instead of hard DELETE. A hard delete here destroys
    -- portfolio_id (bulk-undo linkage) and, once Phase 4 lands, orphans the
    -- deliverable folder -- exactly the #156 defect one level up.
    UPDATE public.projects SET deleted_at = now(), updated_at = now() WHERE id = p_project_id;

    -- 8. Audit Log
    PERFORM public.log_event(v_caller_company_id, auth.uid(), 'project', p_project_id, 'project.archived', v_snapshot);

    RETURN v_archive_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_restore_project(p_archive_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_archive          RECORD;
    v_project          JSONB;
    v_project_id       UUID;
    v_company_id       UUID;
    v_task_archive     RECORD;
    v_unrestored_count INT;
    v_previous_count   INT := -1;
BEGIN
    v_company_id := public.my_company_id();

    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = auth.uid()) = TRUE
        OR public.has_permission('archive:create')
        OR public.has_permission('archive.restore')
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions to restore from archive.';
    END IF;

    SELECT * INTO v_archive
    FROM public.archives
    WHERE id = p_archive_id AND company_id = v_company_id AND entity_type = 'project';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Archive not found or unauthorized.';
    END IF;

    IF v_archive.restored_at IS NOT NULL THEN
        RAISE EXCEPTION 'This snapshot has already been restored.';
    END IF;

    v_project    := v_archive.snapshot->'project';
    v_project_id := (v_project->>'id')::UUID;

    IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_project_id AND deleted_at IS NULL) THEN
        RAISE EXCEPTION 'A project with this ID is already active.';
    END IF;

    -- #179: since this fix, archiving soft-deletes the project -- the row
    -- survived, so bring it back by clearing deleted_at rather than inserting
    -- into a PK that's still occupied. Archives written before this fix hard
    -- deleted the row, so fall back to the original re-insert for those.
    IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_project_id) THEN
        UPDATE public.projects SET deleted_at = NULL, updated_at = now() WHERE id = v_project_id;
    ELSE
        INSERT INTO public.projects
            SELECT (jsonb_populate_record(NULL::public.projects, v_project)).*;
    END IF;

    -- Restore tasks in topological order (parents before children).
    -- Each loop pass processes all tasks whose parent is already restored.
    -- A deadlock guard exits if no progress is made.
    LOOP
        SELECT COUNT(*) INTO v_unrestored_count
        FROM public.archives
        WHERE company_id = v_company_id
          AND entity_type = 'task'
          AND restored_at IS NULL
          AND (snapshot->'task'->>'project_id') = v_project_id::text;

        EXIT WHEN v_unrestored_count = 0;

        -- Safety: if count didn't decrease, we're stuck (circular ref or orphaned parent)
        IF v_unrestored_count = v_previous_count THEN
            RAISE EXCEPTION
                'Cannot restore project: % task(s) have an unresolvable parent dependency.',
                v_unrestored_count;
        END IF;

        v_previous_count := v_unrestored_count;

        -- Process all tasks that are either top-level OR whose parent is already in tasks table
        FOR v_task_archive IN
            SELECT a.*
            FROM public.archives a
            WHERE a.company_id = v_company_id
              AND a.entity_type = 'task'
              AND a.restored_at IS NULL
              AND (a.snapshot->'task'->>'project_id') = v_project_id::text
              AND (
                  (a.snapshot->'task'->>'parent_task_id') IS NULL
                  OR (a.snapshot->'task'->>'parent_task_id') = ''
                  OR EXISTS (
                      SELECT 1 FROM public.tasks t
                      WHERE t.id = (a.snapshot->'task'->>'parent_task_id')::UUID
                  )
              )
        LOOP
            PERFORM public._internal_restore_task_archive(v_task_archive.id);
        END LOOP;
    END LOOP;

    -- Mark the project archive as restored
    UPDATE public.archives
    SET restored_at = now(), restored_by = auth.uid()
    WHERE id = p_archive_id;

    PERFORM public.log_event(
        v_company_id, auth.uid(), 'project', v_project_id, 'project.restored', v_archive.metadata
    );

    RETURN v_project_id;
END;
$function$;
