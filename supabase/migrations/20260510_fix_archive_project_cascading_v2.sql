-- 20260510_fix_archive_project_cascading_v2.sql
-- Fixes "Security Breach" error when archiving projects with nested tasks.
-- The error happens because ON DELETE CASCADE on parent_task_id deletes children 
-- automatically when a parent is archived, causing rpc_archive_task to fail on 
-- the children later in the loop.

CREATE OR REPLACE FUNCTION public.rpc_archive_project(p_project_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_record RECORD;
    v_task_id UUID;
    v_caller_company_id UUID;
    v_target_company_id UUID;
    v_archive_id UUID;
    v_snapshot JSONB;
    v_involved_users UUID[];
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

    -- 3. Fetch Project
    SELECT * INTO v_project_record FROM public.projects WHERE id = p_project_id;

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

    -- 5. Recursive Archival of Child Tasks (Bottom-Up)
    -- We MUST archive children before parents to avoid ON DELETE CASCADE deleting children 
    -- before they can be snapshotted.
    LOOP
        SELECT id INTO v_task_id
        FROM public.tasks
        WHERE project_id = p_project_id
          AND id NOT IN (
              SELECT parent_task_id 
              FROM public.tasks 
              WHERE parent_task_id IS NOT NULL AND project_id = p_project_id
          )
        LIMIT 1;
        
        EXIT WHEN v_task_id IS NULL;
        
        PERFORM public.rpc_archive_task(v_task_id);
    END LOOP;

    -- 6. Snapshot Project
    v_snapshot := jsonb_build_object(
        'project', to_jsonb(v_project_record)
    );

    -- 7. Insert into Archive Box
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

    -- 8. Remove from operation
    DELETE FROM public.projects WHERE id = p_project_id;

    -- 9. Audit Log
    PERFORM public.log_event(v_caller_company_id, auth.uid(), 'project', p_project_id, 'project.archived', v_snapshot);

    RETURN v_archive_id;
END;
$$;
