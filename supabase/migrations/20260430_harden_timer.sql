-- ====================================================================
-- Bunker-Grade Unified Timer System: HARDENED MIGRATION
-- ====================================================================

-- 1. Schema Refinement (Ensure table exists)
CREATE TABLE IF NOT EXISTS public.task_work_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL,
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL CHECK (status IN ('active', 'completed')) DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Security Hardening (RLS)
ALTER TABLE public.task_work_sessions ENABLE ROW LEVEL SECURITY;

-- DROP broad policies if they exist
DROP POLICY IF EXISTS "Users can update their own work sessions" ON public.task_work_sessions;
DROP POLICY IF EXISTS "Users can view their own work sessions" ON public.task_work_sessions;
DROP POLICY IF EXISTS "Users can create their own work sessions" ON public.task_work_sessions;

-- 2.1. SELECT: Users can only see their own work history.
CREATE POLICY "Users can view their own work sessions"
    ON public.task_work_sessions FOR SELECT
    USING (auth.uid() = user_id);

-- 2.2. INSERT: Restricted to participants only.
CREATE POLICY "Users can create their own work sessions"
    ON public.task_work_sessions FOR INSERT
    WITH CHECK (
        auth.uid() = user_id AND
        EXISTS (
            SELECT 1 FROM public.task_participants
            WHERE task_id = task_work_sessions.task_id
            AND user_id = auth.uid()
        )
    );

-- 2.3. UPDATE: DISABLED for public role. 
-- All updates MUST pass through the SECURITY DEFINER RPCs to prevent tampering with 'started_at'.
-- (No UPDATE policy = Default Deny)

-- 3. RPC: rpc_start_work (Hardened)
CREATE OR REPLACE FUNCTION public.rpc_start_work(
    p_task_id UUID,
    p_start_time TIMESTAMPTZ
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER -- Essential since we disabled public UPDATE
AS $$
DECLARE
    v_session_id UUID;
    v_final_start_time TIMESTAMPTZ := p_start_time;
BEGIN
    -- Validate participation
    IF NOT EXISTS (
        SELECT 1 FROM public.task_participants
        WHERE task_id = p_task_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'User is not a participant in this task' USING ERRCODE = '42501';
    END IF;

    -- Guardrail: Prevent extreme backdating or future-dating (max 5m drift)
    IF v_final_start_time > now() + interval '1 minute' OR v_final_start_time < now() - interval '5 minutes' THEN
        v_final_start_time := now();
    END IF;

    -- Bunker-Grade: Clean up ALL active sessions for this user (Global Singleton)
    -- This prevents double-dipping across different tasks or devices.
    UPDATE public.task_work_sessions
    SET status = 'completed',
        last_heartbeat_at = now()
    WHERE user_id = auth.uid()
      AND status = 'active';

    -- Insert new session
    INSERT INTO public.task_work_sessions (task_id, started_at, status)
    VALUES (p_task_id, v_final_start_time, 'active')
    RETURNING id INTO v_session_id;

    RETURN v_session_id;
END;
$$;

-- 4. RPC: rpc_heartbeat_work (Hardened)
CREATE OR REPLACE FUNCTION public.rpc_heartbeat_work(
    p_session_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_task_id UUID;
BEGIN
    -- Find the task_id for this session
    SELECT task_id INTO v_task_id 
    FROM public.task_work_sessions 
    WHERE id = p_session_id AND user_id = auth.uid();

    -- Mandatory Participation Check (FM-5: Prevent Ghost Heartbeats)
    IF NOT EXISTS (
        SELECT 1 FROM public.task_participants
        WHERE task_id = v_task_id AND user_id = auth.uid()
    ) THEN
        -- Force stop the session if membership was revoked
        UPDATE public.task_work_sessions SET status = 'completed' WHERE id = p_session_id;
        RAISE EXCEPTION 'Membership revoked. Session terminated.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.task_work_sessions
    SET last_heartbeat_at = now()
    WHERE id = p_session_id
      AND user_id = auth.uid()
      AND status = 'active';

    IF NOT FOUND THEN
        IF EXISTS (SELECT 1 FROM public.task_work_sessions WHERE id = p_session_id AND user_id = auth.uid() AND status = 'completed') THEN
            RAISE EXCEPTION 'Session already completed' USING ERRCODE = '23505';
        ELSE
            RAISE EXCEPTION 'Active session not found' USING ERRCODE = 'P0002';
        END IF;
    END IF;
END;
$$;

-- 5. RPC: rpc_stop_work (Hardened)
CREATE OR REPLACE FUNCTION public.rpc_stop_work(
    p_session_id UUID,
    p_task_id UUID,
    p_stopped_at TIMESTAMPTZ,
    p_started_at TIMESTAMPTZ DEFAULT NULL -- Optional fallback for better recovery
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Mandatory Participation Check
    IF NOT EXISTS (
        SELECT 1 FROM public.task_participants
        WHERE task_id = p_task_id AND user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Membership revoked.' USING ERRCODE = '42501';
    END IF;

    -- Try to update existing session
    UPDATE public.task_work_sessions
    SET status = 'completed',
        last_heartbeat_at = p_stopped_at
    WHERE id = p_session_id
      AND user_id = auth.uid();

    -- FM-6: Create-on-demand if not found (Crash Recovery)
    IF NOT FOUND THEN
        INSERT INTO public.task_work_sessions (id, user_id, task_id, started_at, last_heartbeat_at, status)
        VALUES (
            p_session_id, 
            auth.uid(), 
            p_task_id, 
            COALESCE(p_started_at, p_stopped_at - interval '1 second'), 
            p_stopped_at, 
            'completed'
        );
    END IF;
END;
$$;
