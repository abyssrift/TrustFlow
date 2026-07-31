-- Self-check for #179: rpc_archive_project hard-deleted the project row.
--
-- Creates its own fixtures and rolls back, so it leaves no rows behind:
--   psql "$DATABASE_URL" -f supabase/checks/project_archive_soft_delete_guard_check.sql
--
-- An ASSERT failure names what regressed.

BEGIN;

DO $check$
DECLARE
    v_user     UUID;
    v_company  UUID;
    v_stage    UUID;
    v_pipe     UUID;
    v_project  UUID;
    v_parent   UUID;
    v_child    UUID;
    v_arch     UUID;
    v_res      UUID;
    v_blocked  BOOLEAN;
    v_msg      TEXT;
BEGIN
    -- Act as a company owner: has_permission() short-circuits true for owners.
    SELECT u.id, u.company_id INTO v_user, v_company
    FROM public.users u
    WHERE u.is_owner = true AND u.deleted_at IS NULL AND u.company_id IS NOT NULL
    ORDER BY (SELECT count(*) FROM public.users x
               WHERE x.company_id = u.company_id AND x.deleted_at IS NULL) DESC
    LIMIT 1;
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_user)::text, true);
    ASSERT auth.uid() = v_user, 'could not impersonate an owner';

    SELECT p.id, ps.id INTO v_pipe, v_stage
    FROM public.pipelines p
    JOIN public.pipeline_stages ps ON ps.pipeline_id = p.id
    WHERE p.company_id = v_company AND p.deleted_at IS NULL
    LIMIT 1;

    INSERT INTO public.projects (company_id, name, created_by)
    VALUES (v_company, 'ponytail project', v_user) RETURNING id INTO v_project;

    -- parent/child task pair under the project -- the timer runs on the CHILD,
    -- the archive is issued against the PROJECT.
    INSERT INTO public.tasks (company_id, title, created_by, current_stage_id, project_id)
    VALUES (v_company, 'ponytail proj parent', v_user, v_stage, v_project) RETURNING id INTO v_parent;
    INSERT INTO public.tasks (company_id, title, created_by, current_stage_id, project_id, parent_task_id)
    VALUES (v_company, 'ponytail proj child', v_user, v_stage, v_project, v_parent) RETURNING id INTO v_child;

    INSERT INTO public.task_work_sessions (task_id, user_id, company_id, status, started_at)
    VALUES (v_child, v_user, v_company, 'active', now());

    -- ── #179 guard: refuse while a child holds a running timer ─────────────
    v_blocked := false;
    BEGIN
        PERFORM public.rpc_archive_project(v_project);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
        v_msg := SQLERRM;
    END;

    ASSERT v_blocked,
        '#179: project archived while a child task timer was running';
    ASSERT v_msg LIKE 'Concurrency Lock:%',
        '#179: blocked for the wrong reason: ' || v_msg;
    ASSERT v_msg LIKE '%ponytail proj child%',
        '#179: error does not name the blocking task: ' || v_msg;
    ASSERT (SELECT deleted_at IS NULL FROM public.projects WHERE id = v_project),
        '#179: project soft-deleted despite the block';
    ASSERT (SELECT count(*) FROM public.tasks
             WHERE id IN (v_parent, v_child) AND deleted_at IS NULL) = 2,
        '#179: tasks removed despite the block (not all-or-nothing)';

    -- Timer stopped and past the 30s sync grace: the archive proceeds.
    UPDATE public.task_work_sessions
       SET status = 'completed', completed_at = now() - interval '5 minutes'
     WHERE task_id = v_child;

    v_arch := public.rpc_archive_project(v_project);

    -- ── #179 fix 1: soft-delete, not hard delete ────────────────────────────
    ASSERT EXISTS (SELECT 1 FROM public.projects WHERE id = v_project),
        '#179: PROJECT ROW HARD-DELETED -- the defect is back';
    ASSERT (SELECT deleted_at IS NOT NULL FROM public.projects WHERE id = v_project),
        '#179: project archived but deleted_at was not set';

    -- ── #179 fix 3: children archived explicitly, bottom-up ─────────────────
    ASSERT NOT EXISTS (SELECT 1 FROM public.tasks WHERE id IN (v_parent, v_child)),
        '#179: child tasks were not archived out of the operational table';
    ASSERT (SELECT count(*) FROM public.archives
             WHERE entity_type = 'task' AND entity_id IN (v_parent, v_child)) = 2,
        '#179: child tasks vanished with no archive snapshot (the #156 defect)';
    ASSERT (SELECT count(*) FROM public.archives
             WHERE entity_type = 'project' AND entity_id = v_project
               AND id = v_arch) = 1,
        '#179: no project archive row written';

    -- ── #179 fix 4: restore reassembles the project with its tasks ─────────
    v_res := public.rpc_restore_project(v_arch);
    ASSERT v_res = v_project, '#179: restore returned the wrong project id';

    ASSERT (SELECT deleted_at IS NULL FROM public.projects WHERE id = v_project),
        '#179: restore did not clear deleted_at';
    ASSERT (SELECT count(*) FROM public.tasks WHERE id IN (v_parent, v_child)) = 2,
        '#179: restore did not bring the child tasks back';
    ASSERT (SELECT count(*) FROM public.archives
             WHERE entity_id IN (v_parent, v_child) AND restored_at IS NOT NULL) = 2,
        '#179: child task archives left unrestored';
    ASSERT (SELECT restored_at IS NOT NULL FROM public.archives WHERE id = v_arch),
        '#179: project archive left unrestored';

    -- Restoring twice, or archiving twice, must not silently double-apply.
    v_blocked := false;
    BEGIN
        PERFORM public.rpc_restore_project(v_arch);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
    END;
    ASSERT v_blocked, '#179: restoring an already-restored project archive did not error';

    -- ── static guard: the row lock must survive future edits ───────────────
    ASSERT (SELECT pg_get_functiondef(oid) ~ 'FOR UPDATE'
              FROM pg_proc WHERE proname = 'rpc_archive_project'),
        '#179: rpc_archive_project no longer locks the project row';
    ASSERT NOT (SELECT pg_get_functiondef(oid) ~ 'DELETE FROM public\.projects'
              FROM pg_proc WHERE proname = 'rpc_archive_project'),
        '#179: rpc_archive_project hard-deletes the project row again';

    RAISE NOTICE 'project archive soft-delete guard: all checks passed';
END;
$check$;

ROLLBACK;
