-- Resume a session that the pagehide beacon just stopped during a page reload.
-- RLS on task_work_sessions is SELECT-only by design; all mutations go through
-- SECURITY DEFINER RPCs like this one.
CREATE OR REPLACE FUNCTION public.rpc_resume_session(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_session public.task_work_sessions%ROWTYPE;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext(auth.uid()::text));

    SELECT * INTO v_session
    FROM public.task_work_sessions
    WHERE id = p_session_id AND user_id = auth.uid();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found' USING ERRCODE = 'P0002';
    END IF;

    -- Only a just-beacon-stopped session may be resumed.
    IF v_session.status <> 'completed'
       OR COALESCE(v_session.completed_at, v_session.last_heartbeat_at) < now() - interval '2 minutes' THEN
        RAISE EXCEPTION 'Session is not resumable' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.task_participants
        WHERE task_id = v_session.task_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'User is not a participant' USING ERRCODE = '42501';
    END IF;

    -- Singleton invariant: one active session per user.
    IF EXISTS (
        SELECT 1 FROM public.task_work_sessions
        WHERE user_id = auth.uid() AND status = 'active' AND id <> p_session_id
    ) THEN
        RAISE EXCEPTION 'User already has an active session' USING ERRCODE = '42501';
    END IF;

    -- total_seconds_spent = 0 so the next close recomputes the FULL duration
    -- from the preserved started_at (backfill trigger keys off <= 0).
    UPDATE public.task_work_sessions
    SET status = 'active',
        completed_at = NULL,
        total_seconds_spent = 0,
        last_heartbeat_at = now()
    WHERE id = p_session_id;
END;
$function$;
