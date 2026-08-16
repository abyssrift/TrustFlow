-- #168 follow-up: 20260729_orphan_session_delete_under_15s.sql fixed the
-- orphan-cleanup path in rpc_start_work, but a sibling artifact source in
-- rpc_stop_work was never touched and kept producing junk rows after that
-- deploy. Found while re-verifying #168 on prod -- 5 completed sessions with
-- total_seconds_spent = 1 appeared between 2026-07-29 and 2026-08-10, all
-- with completed_at - started_at exactly '00:00:01', which is not something
-- a real timer produces organically five times across five different tasks.
--
-- rpc_stop_work's "Recovery beacon" branch fires whenever the caller's
-- session_id no longer matches an ACTIVE row -- e.g. stopWorkBeacon (page
-- unload) racing the normal stopWork() call, or the session already having
-- been auto-closed by rpc_start_work's own orphan cleanup or a stage-
-- transition auto-stop. Rather than acknowledging that there is nothing left
-- to record, it INSERTed a brand-new row with started_at hardcoded to
-- stopped_at - 1 second and total_seconds_spent = 1 -- fabricating time that
-- was never tracked, the same "misleading artifact" #168 already ruled out
-- for the orphan-close path, just via a different function.
--
-- Client-side: contexts/TimerContext.tsx only reads `{ error }` off this
-- RPC's response in both call sites (stopWork, stopWorkBeacon) -- nothing
-- inspects the returned status/duration -- so returning without inserting a
-- row is a safe, non-breaking change.

CREATE OR REPLACE FUNCTION public.rpc_stop_work(p_session_id uuid DEFAULT NULL::uuid, p_task_id uuid DEFAULT NULL::uuid, p_stopped_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_session         RECORD;
    v_final_stop_time TIMESTAMPTZ;
    v_duration_sec    INTEGER;
    v_company_id      UUID;
    v_stage_id        UUID;
    v_user_id         UUID := auth.uid();
    v_use_bus         BOOLEAN;
BEGIN
    v_final_stop_time := COALESCE(p_stopped_at, now());

    IF p_session_id IS NOT NULL THEN
        SELECT * INTO v_session FROM public.task_work_sessions
        WHERE id = p_session_id AND user_id = v_user_id AND status = 'active'
        LIMIT 1;
    ELSE
        SELECT * INTO v_session FROM public.task_work_sessions
        WHERE task_id = p_task_id AND user_id = v_user_id AND status = 'active'
        ORDER BY started_at DESC LIMIT 1;
    END IF;

    -- #168: nothing active under this session_id/task_id -- it was already
    -- closed by another path (orphan cleanup, auto-stop, a raced duplicate
    -- stop call). There is no real duration to report, so acknowledge
    -- without fabricating a session row.
    IF v_session.id IS NULL THEN
        RETURN jsonb_build_object('status', 'already_stopped', 'session_id', p_session_id);
    END IF;

    SELECT company_id, current_stage_id
    INTO v_company_id, v_stage_id
    FROM public.tasks WHERE id = COALESCE(p_task_id, v_session.task_id);

    SELECT s.use_business_hours INTO v_use_bus
    FROM public.tasks t
    JOIN public.pipeline_stages s ON t.current_stage_id = s.id
    WHERE t.id = v_session.task_id;

    IF COALESCE(v_use_bus, FALSE) = TRUE THEN
        v_duration_sec := COALESCE(EXTRACT(EPOCH FROM public.fn_calculate_business_duration(v_session.started_at, v_final_stop_time))::INTEGER, 0);
    ELSE
        v_duration_sec := COALESCE(EXTRACT(EPOCH FROM (v_final_stop_time - v_session.started_at))::INTEGER, 0);
    END IF;

    v_duration_sec := GREATEST(v_duration_sec, 1);

    UPDATE public.task_work_sessions
    SET completed_at        = v_final_stop_time,
        last_heartbeat_at   = v_final_stop_time,
        status              = 'completed',
        total_seconds_spent = v_duration_sec
    WHERE id = v_session.id;

    RETURN jsonb_build_object(
        'status',     'success',
        'session_id', v_session.id,
        'duration',   v_duration_sec,
        'stopped_at', v_final_stop_time
    );
END;
$function$;

-- Remove the 5 fabricated rows this branch produced between the #168 deploy
-- and this fix (exactly 1s, exactly 1s wall-clock diff -- the fabrication's
-- signature, not organic user behaviour).
DELETE FROM public.task_work_sessions
WHERE status = 'completed'
  AND total_seconds_spent = 1
  AND completed_at - started_at = interval '1 second';
