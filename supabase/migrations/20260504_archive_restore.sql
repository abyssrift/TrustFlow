-- 20260504_archive_restore.sql
-- Adds restored_at/restored_by columns and restore RPCs for the archive system

-- 0. Seed archive permission keys so they can be assigned to roles
INSERT INTO public.permissions (key, label, category) VALUES
    ('archive:create',  'Archive Tasks & Projects', 'archives'),
    ('archive.view',    'View Cold Storage Archives', 'archives'),
    ('archive.restore', 'Restore from Archives', 'archives')
ON CONFLICT (key) DO NOTHING;

-- 1. Add restoration tracking columns
ALTER TABLE public.archives
    ADD COLUMN IF NOT EXISTS restored_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS restored_by UUID REFERENCES public.users(id);

-- 2. Restore Task RPC
CREATE OR REPLACE FUNCTION public.rpc_restore_archive(p_archive_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_archive    RECORD;
    v_task       JSONB;
    v_task_id    UUID;
    v_company_id UUID;
    v_sub        JSONB;
BEGIN
    v_company_id := public.my_company_id();

    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = auth.uid()) = TRUE
        OR public.has_permission('archive:create')
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

    v_task    := v_archive.snapshot->'task';
    v_task_id := (v_task->>'id')::UUID;

    IF EXISTS (SELECT 1 FROM public.tasks WHERE id = v_task_id) THEN
        RAISE EXCEPTION 'A task with this ID already exists in the active pipeline.';
    END IF;

    -- Restore core task row
    INSERT INTO public.tasks
        SELECT (jsonb_populate_record(NULL::public.tasks, v_task)).*;

    -- Restore assignments
    INSERT INTO public.task_assignments
        SELECT (jsonb_populate_record(NULL::public.task_assignments, a)).*
        FROM jsonb_array_elements(v_archive.snapshot->'assignments') AS a;

    -- Restore comments
    INSERT INTO public.task_comments
        SELECT (jsonb_populate_record(NULL::public.task_comments, c)).*
        FROM jsonb_array_elements(v_archive.snapshot->'comments') AS c;

    -- Restore task-level attachments
    INSERT INTO public.task_attachments
        SELECT (jsonb_populate_record(NULL::public.task_attachments, at)).*
        FROM jsonb_array_elements(v_archive.snapshot->'attachments') AS at;

    -- Restore stage history
    INSERT INTO public.pipeline_stage_history
        SELECT (jsonb_populate_record(NULL::public.pipeline_stage_history, h)).*
        FROM jsonb_array_elements(v_archive.snapshot->'history') AS h;

    -- Restore work sessions
    INSERT INTO public.task_work_sessions
        SELECT (jsonb_populate_record(NULL::public.task_work_sessions, ws)).*
        FROM jsonb_array_elements(v_archive.snapshot->'work_sessions') AS ws;

    -- Restore submissions with their attachments
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

    PERFORM public.log_event(v_company_id, auth.uid(), 'task', v_task_id, 'task.restored', v_archive.metadata);

    RETURN v_task_id;
END;
$$;

-- 3. Restore Project RPC
CREATE OR REPLACE FUNCTION public.rpc_restore_project(p_archive_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_archive      RECORD;
    v_project      JSONB;
    v_project_id   UUID;
    v_company_id   UUID;
    v_task_archive RECORD;
BEGIN
    v_company_id := public.my_company_id();

    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = auth.uid()) = TRUE
        OR public.has_permission('archive:create')
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

    -- Restore project record
    INSERT INTO public.projects
        SELECT (jsonb_populate_record(NULL::public.projects, v_project)).*;

    -- Restore all unrestored task archives that belonged to this project
    FOR v_task_archive IN
        SELECT * FROM public.archives
        WHERE company_id = v_company_id
          AND entity_type = 'task'
          AND restored_at IS NULL
          AND (snapshot->'task'->>'project_id') = v_project_id::text
    LOOP
        PERFORM public.rpc_restore_archive(v_task_archive.id);
    END LOOP;

    UPDATE public.archives
    SET restored_at = now(), restored_by = auth.uid()
    WHERE id = p_archive_id;

    PERFORM public.log_event(v_company_id, auth.uid(), 'project', v_project_id, 'project.restored', v_archive.metadata);

    RETURN v_project_id;
END;
$$;
