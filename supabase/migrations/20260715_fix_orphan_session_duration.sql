-- Fix: rpc_start_work's orphan-cleanup step marks stale 'active' sessions
-- as 'completed' but never computed total_seconds_spent (left at column
-- default 0), even though started_at/last_heartbeat_at were correct.
-- total_seconds_spent is the field the UI and all reporting RPCs actually
-- read, so orphaned sessions silently reported as 0 duration.
-- See Features.md: "timer somehow breaking, recorded time discarded".

CREATE OR REPLACE FUNCTION public.rpc_start_work(
    p_task_id UUID,
    p_start_time TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_session_id        UUID;
    v_company_id        UUID;
    v_stage_id          UUID;
    v_final_start_time  TIMESTAMPTZ := p_start_time;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::text));

    IF NOT EXISTS (
        SELECT 1 FROM public.task_participants
        WHERE task_id = p_task_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'User is not a participant' USING ERRCODE = '42501';
    END IF;

    SELECT company_id, current_stage_id
    INTO v_company_id, v_stage_id
    FROM public.tasks WHERE id = p_task_id;

    IF v_final_start_time > now() + interval '1 minute'
       OR v_final_start_time < now() - interval '5 minutes' THEN
        v_final_start_time := now();
    END IF;

    -- [ORPHAN CLEANUP] Close any session this user left dangling 'active'
    -- (stale tab, duplicate start, crash) and backfill its real duration.
    UPDATE public.task_work_sessions
    SET status = 'completed',
        completed_at = now(),
        last_heartbeat_at = now(),
        total_seconds_spent = GREATEST(EXTRACT(EPOCH FROM (now() - started_at))::INTEGER, 1)
    WHERE user_id = auth.uid() AND status = 'active';

    INSERT INTO public.task_work_sessions (
        task_id, user_id, company_id, stage_id, started_at, status
    )
    VALUES (
        p_task_id, auth.uid(), v_company_id, v_stage_id, v_final_start_time, 'active'
    )
    RETURNING id INTO v_session_id;

    RETURN v_session_id;
END;
$$;
