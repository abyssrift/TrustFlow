-- Self-check for the archive/restore concurrency work: #156, #157, #158, #159,
-- #160, #161.
--
-- Creates its own fixtures and rolls back, so it leaves no rows behind:
--   psql "$DATABASE_URL" -f supabase/tests/archive_subtree_guard_test.sql
--
-- An ASSERT failure names the issue it regressed.

BEGIN;

DO $test$
DECLARE
    v_user    UUID;
    v_company UUID;
    v_stage   UUID;
    v_pipe    UUID;
    v_parent  UUID;
    v_child   UUID;
    v_grand   UUID;
    v_task    UUID;
    v_arch    UUID;
    v_victim  UUID;
    v_res     JSONB;
    v_blocked BOOLEAN;
    v_msg     TEXT;
BEGIN
    -- Act as a company owner: has_permission() short-circuits true for owners,
    -- so this exercises the guards rather than the RBAC lookup.
    -- Prefer the busiest company so the #161 multi-user case is exercised.
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

    -- ── #156 / #157: 3-level subtree, timer on the deepest node ────────────
    INSERT INTO public.tasks (company_id, title, created_by, current_stage_id)
    VALUES (v_company, 'ponytail parent', v_user, v_stage) RETURNING id INTO v_parent;
    INSERT INTO public.tasks (company_id, title, created_by, current_stage_id, parent_task_id)
    VALUES (v_company, 'ponytail child', v_user, v_stage, v_parent) RETURNING id INTO v_child;
    INSERT INTO public.tasks (company_id, title, created_by, current_stage_id, parent_task_id)
    VALUES (v_company, 'ponytail grandchild', v_user, v_stage, v_child) RETURNING id INTO v_grand;

    INSERT INTO public.task_manual_time_entries
        (task_id, stage_id, user_id, company_id, declared_minutes, reason, approval_status)
    VALUES (v_parent, v_stage, v_user, v_company, 45,  'probe parent', 'approved'),
           (v_grand,  v_stage, v_user, v_company, 120, 'probe grand',  'pending');

    -- Timer runs on the GRANDCHILD; the archive is issued against the PARENT.
    INSERT INTO public.task_work_sessions (task_id, user_id, company_id, status, started_at)
    VALUES (v_grand, v_user, v_company, 'active', now());

    v_blocked := false;
    BEGIN
        PERFORM public.rpc_archive_task(v_parent);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
        v_msg := SQLERRM;
    END;

    ASSERT v_blocked,
        '#156: archive succeeded while a subtask timer was running';
    ASSERT v_msg LIKE 'Concurrency Lock:%',
        '#156: blocked for the wrong reason: ' || v_msg;
    ASSERT v_msg LIKE '%ponytail grandchild%',
        '#156: error does not name the blocking subtask: ' || v_msg;

    -- A blocked archive must be all-or-nothing, not a half-consumed subtree.
    ASSERT (SELECT count(*) FROM public.tasks
             WHERE id IN (v_parent, v_child, v_grand)) = 3,
        '#156: partial delete after a blocked archive';
    ASSERT NOT EXISTS (SELECT 1 FROM public.archives
                       WHERE entity_id IN (v_parent, v_child, v_grand)),
        '#156: partial archive after a blocked archive';

    -- Timer stopped and past the 30s sync grace: the archive takes the subtree.
    UPDATE public.task_work_sessions
       SET status = 'completed', completed_at = now() - interval '5 minutes'
     WHERE task_id = v_grand;

    PERFORM public.rpc_archive_task(v_parent);

    ASSERT NOT EXISTS (SELECT 1 FROM public.tasks
                       WHERE id IN (v_parent, v_child, v_grand)),
        '#156: tasks were not removed from the operational table';
    ASSERT (SELECT count(*) FROM public.archives
             WHERE entity_type = 'task'
               AND entity_id IN (v_parent, v_child, v_grand)) = 3,
        '#156: SUBTREE HARD-DELETED WITHOUT AN ARCHIVE SNAPSHOT';
    ASSERT (SELECT jsonb_array_length(snapshot -> 'work_sessions')
              FROM public.archives WHERE entity_id = v_grand) = 1,
        '#156: subtask timer history was lost';
    ASSERT (SELECT snapshot -> 'manual_time_entries' -> 0 ->> 'declared_minutes'
              FROM public.archives WHERE entity_id = v_grand) = '120',
        '#157: manual time entries missing from the snapshot';

    -- ── #159: restoring the DEEPEST node rebuilds the whole chain ──────────
    SELECT id INTO v_arch FROM public.archives WHERE entity_id = v_grand;
    PERFORM public.rpc_restore_archive(v_arch);

    ASSERT (SELECT count(*) FROM public.tasks
             WHERE id IN (v_parent, v_child, v_grand)) = 3,
        '#159: restore did not rebuild the ancestor chain';
    ASSERT (SELECT count(*) FROM public.archives
             WHERE entity_id IN (v_parent, v_child, v_grand)
               AND restored_at IS NOT NULL) = 3,
        '#159: subtree archives left unrestored';
    ASSERT (SELECT sum(declared_minutes) FROM public.task_manual_time_entries
             WHERE task_id IN (v_parent, v_grand)) = 165,
        '#157: manual time not restored';
    ASSERT (SELECT approval_status FROM public.task_manual_time_entries
             WHERE task_id = v_grand) = 'pending',
        '#157: pending approval state lost across archive/restore';

    -- ── #160: the guard must be under a row lock ──────────────────────────
    -- The race itself needs two sessions; this only catches a future rewrite
    -- that drops the lock, which is how the guard silently regresses.
    ASSERT (SELECT pg_get_functiondef(oid) ~ 'FOR UPDATE'
              FROM pg_proc WHERE proname = 'rpc_archive_task'),
        '#160: rpc_archive_task no longer locks the task row';
    ASSERT (SELECT pg_get_functiondef(oid) ~ 'FOR UPDATE'
              FROM pg_proc WHERE proname = 'rpc_start_work'),
        '#160: rpc_start_work no longer locks the task row';
    ASSERT (SELECT pg_get_functiondef(oid) ~ 'FOR UPDATE'
              FROM pg_proc WHERE proname = 'rpc_resume_session'),
        '#160: rpc_resume_session no longer locks the task row';

    -- ── #158: board delete refuses while a timer runs on it ───────────────
    -- Clear any real in-flight sessions on this board first (rolled back with
    -- everything else) so the assertions below are deterministic.
    UPDATE public.task_work_sessions ws
       SET status = 'completed', completed_at = now()
      FROM public.tasks t
     WHERE t.id = ws.task_id AND t.pipeline_id = v_pipe AND ws.status = 'active';

    INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, current_stage_id)
    VALUES (v_company, 'ponytail board task', v_user, v_pipe, v_stage) RETURNING id INTO v_task;
    INSERT INTO public.task_work_sessions (task_id, user_id, company_id, status, started_at)
    VALUES (v_task, v_user, v_company, 'active', now());

    v_blocked := false;
    BEGIN
        PERFORM public.rpc_delete_pipeline(v_pipe);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
        v_msg := SQLERRM;
    END;

    ASSERT v_blocked,
        '#158: board deleted while a timer was running on it';
    ASSERT v_msg LIKE '%ponytail board task%',
        '#158: error does not name the blocking task: ' || v_msg;
    ASSERT (SELECT deleted_at IS NULL FROM public.tasks WHERE id = v_task),
        '#158: tasks soft-deleted despite the block';

    UPDATE public.task_work_sessions
       SET status = 'completed', completed_at = now() WHERE task_id = v_task;
    PERFORM public.rpc_delete_pipeline(v_pipe);
    ASSERT (SELECT deleted_at IS NOT NULL FROM public.pipelines WHERE id = v_pipe),
        '#158: board delete blocked even with no active timer';

    -- ── #161: removing a user closes THEIR timers only ────────────────────
    SELECT u.id INTO v_victim
    FROM public.users u
    WHERE u.company_id = v_company AND u.id <> v_user AND u.deleted_at IS NULL
    LIMIT 1;

    IF v_victim IS NULL THEN
        RAISE NOTICE '#161 skipped: company has no second user';
    ELSE
        INSERT INTO public.tasks (company_id, title, created_by)
        VALUES (v_company, 'ponytail removal task', v_user) RETURNING id INTO v_task;
        INSERT INTO public.task_work_sessions
            (task_id, user_id, company_id, status, started_at, last_heartbeat_at)
        VALUES (v_task, v_victim, v_company, 'active', now() - interval '30 minutes', now() - interval '1 minute'),
               (v_task, v_user,   v_company, 'active', now() - interval '30 minutes', now() - interval '1 minute');

        v_res := public.rpc_remove_user_from_company(v_victim);

        ASSERT (v_res->>'success') = 'true', '#161: removal failed: ' || v_res::text;
        ASSERT (SELECT status FROM public.task_work_sessions
                 WHERE task_id = v_task AND user_id = v_victim) = 'completed',
            '#161: removed user kept a running timer';
        ASSERT (SELECT status FROM public.task_work_sessions
                 WHERE task_id = v_task AND user_id = v_user) = 'active',
            '#161: a colleague''s timer was stopped too';
        -- Anchored to last_heartbeat_at (29 min), not now() (30 min).
        ASSERT (SELECT total_seconds_spent FROM public.task_work_sessions
                 WHERE task_id = v_task AND user_id = v_victim) = 1740,
            '#161: closed duration not anchored to the last heartbeat';
    END IF;

    RAISE NOTICE 'archive concurrency suite: all checks passed';
END;
$test$;

ROLLBACK;
