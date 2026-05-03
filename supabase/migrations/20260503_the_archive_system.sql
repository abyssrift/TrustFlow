-- 20260503_the_archive_system.sql
-- Implements the cold-storage archival system for TrustFlow

-- 1. Create Archive Table
CREATE TABLE IF NOT EXISTS public.archives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    snapshot JSONB NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    archived_at TIMESTAMPTZ DEFAULT now(),
    archived_by UUID REFERENCES public.users(id),
    
    CONSTRAINT archives_entity_type_check CHECK (entity_type IN ('task', 'project', 'report'))
);

-- 2. Enable RLS
ALTER TABLE public.archives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Archives are viewable by company members" ON public.archives
    FOR SELECT USING (
        company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid())
    );

CREATE POLICY "Archives can be created by company members" ON public.archives
    FOR INSERT WITH CHECK (
        company_id IN (SELECT company_id FROM public.users WHERE id = auth.uid())
    );

-- 3. Archive Task RPC
CREATE OR REPLACE FUNCTION public.rpc_archive_task(p_task_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_task_record RECORD;
    v_snapshot JSONB;
    v_metadata JSONB;
    v_company_id UUID;
    v_involved_users UUID[];
    v_archive_id UUID;
BEGIN
    -- Get current company context
    v_company_id := public.my_company_id();

    -- Check permissions (Owner or explicit archive permission)
    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = auth.uid()) = TRUE
        OR public.has_permission('archive:create')
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions to archive tactical data.';
    END IF;

    -- Fetch task record and verify ownership
    SELECT * INTO v_task_record FROM public.tasks WHERE id = p_task_id AND company_id = v_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found or unauthorized.';
    END IF;

    -- Block if there's an active work session
    IF EXISTS (SELECT 1 FROM public.task_work_sessions WHERE task_id = p_task_id AND status = 'active') THEN
        RAISE EXCEPTION 'Cannot archive task with an active work session. Please stop the timer first.';
    END IF;

    -- Aggregate Snapshot (Deep Clone)
    v_snapshot := jsonb_build_object(
        'task', to_jsonb(v_task_record),
        'assignments', (
            SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb) FROM public.task_assignments a WHERE task_id = p_task_id
        ),
        'comments', (
            SELECT COALESCE(jsonb_agg(to_jsonb(c)), '[]'::jsonb) FROM public.task_comments c WHERE task_id = p_task_id
        ),
        'attachments', (
            SELECT COALESCE(jsonb_agg(to_jsonb(at)), '[]'::jsonb) FROM public.task_attachments at WHERE task_id = p_task_id
        ),
        'submissions', (
            SELECT COALESCE(jsonb_agg(
                jsonb_build_object(
                    'submission', to_jsonb(s),
                    'attachments', (SELECT COALESCE(jsonb_agg(to_jsonb(sa)), '[]'::jsonb) FROM public.submission_attachments sa WHERE submission_id = s.id)
                )
            ), '[]'::jsonb) FROM public.task_submissions s WHERE task_id = p_task_id
        ),
        'history', (
            SELECT COALESCE(jsonb_agg(to_jsonb(h)), '[]'::jsonb) FROM public.pipeline_stage_history h WHERE task_id = p_task_id
        ),
        'work_sessions', (
            SELECT COALESCE(jsonb_agg(to_jsonb(ws)), '[]'::jsonb) FROM public.task_work_sessions ws WHERE task_id = p_task_id
        )
    );

    -- Extract involved users for metadata indexing
    v_involved_users := ARRAY(
        SELECT DISTINCT user_id FROM (
            SELECT assignee_user_id AS user_id FROM public.task_assignments WHERE task_id = p_task_id AND assignee_user_id IS NOT NULL
            UNION
            SELECT author_id FROM public.task_comments WHERE task_id = p_task_id
            UNION
            SELECT submitted_by FROM public.task_submissions WHERE task_id = p_task_id
            UNION
            SELECT transitioned_by FROM public.pipeline_stage_history WHERE task_id = p_task_id AND transitioned_by IS NOT NULL
        ) AS users
    );

    -- Build Metadata
    v_metadata := jsonb_build_object(
        'title', v_task_record.title,
        'original_id', p_task_id,
        'pipeline_id', v_task_record.pipeline_id,
        'involved_user_ids', v_involved_users
    );

    -- Insert into Archive Box
    INSERT INTO public.archives (company_id, entity_type, entity_id, snapshot, metadata, archived_by)
    VALUES (v_company_id, 'task', p_task_id, v_snapshot, v_metadata, auth.uid())
    RETURNING id INTO v_archive_id;

    -- Remove from operational pipeline (Trigger Cascades handle sub-tables)
    DELETE FROM public.tasks WHERE id = p_task_id;

    -- Audit Log
    PERFORM public.log_event(v_company_id, auth.uid(), 'task', p_task_id, 'task.archived', v_metadata);

    RETURN v_archive_id;
END;
$$;

-- 4. Archive Project RPC
CREATE OR REPLACE FUNCTION public.rpc_archive_project(p_project_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_project_record RECORD;
    v_task_id UUID;
    v_company_id UUID;
    v_archive_id UUID;
    v_snapshot JSONB;
BEGIN
    v_company_id := public.my_company_id();

    -- Permission Check
    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = auth.uid()) = TRUE
        OR public.has_permission('archive:create')
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions to archive tactical data.';
    END IF;

    -- Fetch Project
    SELECT * INTO v_project_record FROM public.projects WHERE id = p_project_id AND company_id = v_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project not found or unauthorized.';
    END IF;

    -- Recursive Archival of Child Tasks
    FOR v_task_id IN (SELECT id FROM public.tasks WHERE project_id = p_project_id) LOOP
        PERFORM public.rpc_archive_task(v_task_id);
    END LOOP;

    -- Snapshot Project
    v_snapshot := jsonb_build_object(
        'project', to_jsonb(v_project_record)
    );

    -- Insert into Archive Box
    INSERT INTO public.archives (company_id, entity_type, entity_id, snapshot, metadata, archived_by)
    VALUES (v_company_id, 'project', p_project_id, v_snapshot, jsonb_build_object('title', v_project_record.name), auth.uid())
    RETURNING id INTO v_archive_id;

    -- Remove from operation
    DELETE FROM public.projects WHERE id = p_project_id;

    -- Audit Log
    PERFORM public.log_event(v_company_id, auth.uid(), 'project', p_project_id, 'project.archived', v_snapshot);

    RETURN v_archive_id;
END;
$$;

-- 5. Search Archive RPC
CREATE OR REPLACE FUNCTION public.rpc_get_archives(p_entity_type TEXT DEFAULT NULL, p_search TEXT DEFAULT NULL)
RETURNS SETOF public.archives
LANGUAGE sql
SECURITY DEFINER
AS $$
    SELECT * FROM public.archives
    WHERE company_id = public.my_company_id()
    AND (p_entity_type IS NULL OR entity_type = p_entity_type)
    AND (p_search IS NULL OR (metadata->>'title' ILIKE '%' || p_search || '%'));
$$;
