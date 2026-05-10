-- 20260510_fix_restore_project_ordering_v2.sql
-- Fix rpc_restore_project: topological ordering + internal task restore bypass
-- Problem 1: tasks with parent_task_id were being inserted before their parent existed → FK violation
-- Problem 2: rpc_restore_archive checks has_permission('archive.restore') which fails when called
--            internally from rpc_restore_project (which already validated auth)

-- Internal helper: restores a single task archive row WITHOUT a permission check.
-- Called only from rpc_restore_project after auth is already confirmed.
CREATE OR REPLACE FUNCTION public._internal_restore_task_archive(p_archive_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_archive RECORD;
    v_task    JSONB;
    v_task_id UUID;
    v_sub     JSONB;
BEGIN
    SELECT * INTO v_archive
    FROM public.archives
    WHERE id = p_archive_id AND entity_type = 'task';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task archive not found: %', p_archive_id;
    END IF;

    IF v_archive.restored_at IS NOT NULL THEN
        RETURN (v_archive.snapshot->'task'->>'id')::UUID; -- already restored, skip
    END IF;

    v_task    := v_archive.snapshot->'task';
    v_task_id := (v_task->>'id')::UUID;

    IF EXISTS (SELECT 1 FROM public.tasks WHERE id = v_task_id) THEN
        RETURN v_task_id; -- already in active pipeline, skip
    END IF;

    -- Restore core task row
    INSERT INTO public.tasks
        SELECT (jsonb_populate_record(NULL::public.tasks, v_task)).*;

    -- Restore related rows
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

    RETURN v_task_id;
END;
$$;

-- Revoke direct public access to the internal helper
REVOKE ALL ON FUNCTION public._internal_restore_task_archive(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._internal_restore_task_archive(UUID) FROM anon, authenticated;

-- Updated rpc_restore_project: uses the internal helper and processes in topological order
CREATE OR REPLACE FUNCTION public.rpc_restore_project(p_archive_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
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

    IF EXISTS (SELECT 1 FROM public.projects WHERE id = v_project_id) THEN
        RAISE EXCEPTION 'A project with this ID already exists.';
    END IF;

    -- Restore the project record first
    INSERT INTO public.projects
        SELECT (jsonb_populate_record(NULL::public.projects, v_project)).*;

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
$$;
