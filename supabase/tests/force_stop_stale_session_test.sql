-- Self-check for #162: force-stopping a stale session that blocks an archive.
--
-- Creates its own fixtures and rolls back, so it leaves no rows behind:
--   psql "$DATABASE_URL" -f supabase/tests/force_stop_stale_session_test.sql
--
-- An ASSERT failure names the case it regressed.

BEGIN;

DO $test$
DECLARE
    v_user     UUID;
    v_company  UUID;
    v_stage    UUID;
    v_task     UUID;
    v_session  UUID;
    v_res      JSONB;
    v_blocked  BOOLEAN;
    v_msg      TEXT;
    v_detail   TEXT;
BEGIN
    SELECT u.id, u.company_id INTO v_user, v_company
    FROM public.users u
    WHERE u.is_owner = true AND u.deleted_at IS NULL AND u.company_id IS NOT NULL
    LIMIT 1;
    PERFORM set_config('request.jwt.claims',
                       json_build_object('sub', v_user)::text, true);
    ASSERT auth.uid() = v_user, 'could not impersonate an owner';

    SELECT ps.id INTO v_stage
    FROM public.pipeline_stages ps
    JOIN public.pipelines p ON p.id = ps.pipeline_id
    WHERE p.company_id = v_company AND p.deleted_at IS NULL
    LIMIT 1;

    INSERT INTO public.tasks (company_id, title, created_by, current_stage_id)
    VALUES (v_company, 'ponytail force-stop task', v_user, v_stage) RETURNING id INTO v_task;

    -- ── A fresh (non-stale) session still blocks the archive, and force-stop
    -- must refuse it — this is the guard #162 explicitly must NOT weaken. ──
    INSERT INTO public.task_work_sessions
        (task_id, user_id, company_id, status, started_at, last_heartbeat_at)
    VALUES (v_task, v_user, v_company, 'active', now(), now())
    RETURNING id INTO v_session;

    v_blocked := false;
    BEGIN
        PERFORM public.rpc_archive_task(v_task);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
        v_msg := SQLERRM;
        GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    END;
    ASSERT v_blocked, '#162: archive succeeded while a timer was running';
    ASSERT (v_detail::jsonb ->> 'session_id') = v_session::text,
        '#162: archive block DETAIL missing/wrong session_id: ' || COALESCE(v_detail, '<null>');
    ASSERT (v_detail::jsonb ->> 'is_stale') = 'false',
        '#162: a fresh heartbeat was reported as stale: ' || v_detail;

    v_blocked := false;
    BEGIN
        PERFORM public.rpc_force_stop_session(v_session);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
        v_msg := SQLERRM;
    END;
    ASSERT v_blocked, '#162: force-stop closed a session that is still genuinely active';
    ASSERT v_msg LIKE 'Concurrency Lock:%',
        '#162: force-stop of a live session failed for the wrong reason: ' || v_msg;
    ASSERT (SELECT status FROM public.task_work_sessions WHERE id = v_session) = 'active',
        '#162: force-stop mutated a session it should have refused';

    -- ── A stale session (heartbeat well past IDLE_MS) may be force-stopped,
    -- and the archive then proceeds. ──
    UPDATE public.task_work_sessions
    SET started_at = now() - interval '20 minutes',
        last_heartbeat_at = now() - interval '5 minutes'
    WHERE id = v_session;

    v_blocked := false;
    BEGIN
        PERFORM public.rpc_archive_task(v_task);
    EXCEPTION WHEN OTHERS THEN
        v_blocked := true;
        GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
    END;
    ASSERT v_blocked, '#162: stale session no longer blocks the archive (guard must stay intact)';
    ASSERT (v_detail::jsonb ->> 'is_stale') = 'true',
        '#162: a 5-minute-stale heartbeat was not reported as stale: ' || v_detail;

    v_res := public.rpc_force_stop_session(v_session);
    ASSERT (v_res ->> 'status') = 'force_stopped',
        '#162: force-stop of a stale session did not report success: ' || v_res::text;
    ASSERT (SELECT status FROM public.task_work_sessions WHERE id = v_session) = 'completed',
        '#162: force-stopped session was not marked completed';
    ASSERT (SELECT total_seconds_spent FROM public.task_work_sessions WHERE id = v_session) = 900,
        '#162: force-stop duration not anchored to last_heartbeat_at (expected 900s)';

    -- Now that the blocker is gone, the archive that was refused twice above
    -- must succeed.
    PERFORM public.rpc_archive_task(v_task);
    ASSERT NOT EXISTS (SELECT 1 FROM public.tasks WHERE id = v_task),
        '#162: archive still blocked after the stale session was force-stopped';

    RAISE NOTICE 'force-stop stale session suite: all checks passed';
END;
$test$;

ROLLBACK;
