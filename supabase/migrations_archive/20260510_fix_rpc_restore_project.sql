-- 20260510_fix_rpc_restore_project.sql
-- Fixes foreign key violations when restoring projects with nested tasks by restoring parents before children.

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
    -- To satisfy foreign keys (tasks_parent_task_id_fkey), we must restore parent tasks before their children.
    LOOP
        SELECT COUNT(*) INTO v_unrestored_count
        FROM public.archives
        WHERE company_id = v_company_id
          AND entity_type = 'task'
          AND restored_at IS NULL
          AND (snapshot->'task'->>'project_id') = v_project_id::text;
          
        EXIT WHEN v_unrestored_count = 0;
        
        IF v_unrestored_count = v_previous_count THEN
            RAISE EXCEPTION 'Circular dependency or missing parent task detected during project restore. Unrestored count: %', v_unrestored_count;
        END IF;
        
        v_previous_count := v_unrestored_count;
        
        FOR v_task_archive IN
            SELECT * FROM public.archives a
            WHERE company_id = v_company_id
              AND entity_type = 'task'
              AND restored_at IS NULL
              AND (snapshot->'task'->>'project_id') = v_project_id::text
              AND (
                  (snapshot->'task'->>'parent_task_id') IS NULL
                  OR (snapshot->'task'->>'parent_task_id') = ''
                  OR EXISTS (
                      SELECT 1 FROM public.tasks
                      WHERE id = (a.snapshot->'task'->>'parent_task_id')::UUID
                  )
              )
        LOOP
            PERFORM public.rpc_restore_archive(v_task_archive.id);
        END LOOP;
    END LOOP;

    UPDATE public.archives
    SET restored_at = now(), restored_by = auth.uid()
    WHERE id = p_archive_id;

    PERFORM public.log_event(v_company_id, auth.uid(), 'project', v_project_id, 'project.restored', v_archive.metadata);

    RETURN v_project_id;
END;
$$;
