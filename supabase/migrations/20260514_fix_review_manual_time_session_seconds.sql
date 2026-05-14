-- ============================================================
-- Fix: rpc_review_manual_time — populate total_seconds_spent
--
-- The previous version inserted the backdated work session without
-- total_seconds_spent, so it counted as 0 seconds in all timer
-- sums. This means:
--   • The backend gate still sees v_total_seconds < 300 even after
--     approval and has to fall through on the 'approved' status check.
--   • Analytics and timer displays do not reflect the declared time.
--
-- Fix: set total_seconds_spent = declared_minutes * 60 on insert.
-- ============================================================

CREATE OR REPLACE FUNCTION public.rpc_review_manual_time(
    p_entry_id         UUID,
    p_approve          BOOLEAN,
    p_rejection_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_user_id           UUID := auth.uid();
    v_is_owner          BOOLEAN := COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE);
    v_entry             RECORD;
    v_session_id        UUID;
    v_session_start     TIMESTAMPTZ;
    v_session_end       TIMESTAMPTZ;
    v_target_stage_id   UUID;
BEGIN
    SELECT
        e.id,
        e.task_id,
        e.stage_id,
        e.user_id,
        e.company_id,
        e.declared_minutes,
        e.logged_at,
        e.approval_status,
        e.pending_transition_id,
        t.created_by AS task_created_by,
        t.manager_id AS task_manager_id,
        t.title      AS task_title
    INTO v_entry
    FROM public.task_manual_time_entries e
    JOIN public.tasks t ON t.id = e.task_id AND t.deleted_at IS NULL
    WHERE e.id = p_entry_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manual time entry not found' USING ERRCODE = 'P0002';
    END IF;

    IF v_entry.company_id != public.my_company_id() THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    IF NOT (
        v_is_owner
        OR v_entry.task_manager_id = v_user_id
        OR v_entry.task_created_by = v_user_id
        OR public.has_permission('task.manage')
    ) THEN
        RAISE EXCEPTION 'Forbidden: only the task manager or company owners can review manual time.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtext(v_entry.id::text));

    IF p_approve THEN
        IF v_entry.approval_status = 'approved' THEN
            RETURN jsonb_build_object('success', true, 'approval_status', 'approved', 'session_created', false);
        END IF;

        IF v_entry.approval_status = 'rejected' THEN
            RAISE EXCEPTION 'This manual time entry has already been rejected.' USING ERRCODE = 'P0001';
        END IF;

        v_session_end   := v_entry.logged_at;
        v_session_start := v_session_end - make_interval(mins => v_entry.declared_minutes);

        UPDATE public.task_manual_time_entries
        SET approval_status  = 'approved',
            rejection_reason = NULL,
            reviewed_at      = now(),
            reviewed_by      = v_user_id
        WHERE id = p_entry_id;

        INSERT INTO public.task_work_sessions (
            user_id, task_id, started_at, last_heartbeat_at, status, total_seconds_spent
        )
        VALUES (
            v_entry.user_id, v_entry.task_id, v_session_start, v_session_end, 'completed',
            v_entry.declared_minutes * 60
        )
        RETURNING id INTO v_session_id;

        -- Auto-advance stage if the worker was blocked on an advance action
        IF v_entry.pending_transition_id IS NOT NULL THEN
            SELECT to_stage_id INTO v_target_stage_id
            FROM public.pipeline_stage_transitions
            WHERE id = v_entry.pending_transition_id;

            IF v_target_stage_id IS NOT NULL THEN
                PERFORM public.rpc_advance_stage(v_entry.task_id, v_target_stage_id);
            END IF;
        END IF;

        PERFORM public.fn_emit_notification_event(
            'task.manual_time_approved', 'task', v_entry.task_id, v_user_id,
            jsonb_build_object(
                'task_id',          v_entry.task_id,
                'stage_id',         v_entry.stage_id,
                'entry_id',         v_entry.id,
                'worker_id',        v_entry.user_id,
                'declared_minutes', v_entry.declared_minutes,
                'session_id',       v_session_id,
                'stage_advanced',   v_entry.pending_transition_id IS NOT NULL
            )
        );

        RETURN jsonb_build_object(
            'success',        true,
            'approval_status', 'approved',
            'session_created', true,
            'session_id',      v_session_id,
            'stage_advanced',  v_entry.pending_transition_id IS NOT NULL
        );
    END IF;

    -- Reject path
    IF v_entry.approval_status = 'rejected' THEN
        RETURN jsonb_build_object('success', true, 'approval_status', 'rejected', 'session_created', false);
    END IF;

    UPDATE public.task_manual_time_entries
    SET approval_status  = 'rejected',
        rejection_reason = p_rejection_reason,
        reviewed_at      = now(),
        reviewed_by      = v_user_id
    WHERE id = p_entry_id;

    PERFORM public.fn_emit_notification_event(
        'task.manual_time_rejected', 'task', v_entry.task_id, v_user_id,
        jsonb_build_object(
            'task_id',          v_entry.task_id,
            'stage_id',         v_entry.stage_id,
            'entry_id',         v_entry.id,
            'worker_id',        v_entry.user_id,
            'rejection_reason', p_rejection_reason
        )
    );

    RETURN jsonb_build_object('success', true, 'approval_status', 'rejected', 'session_created', false);
END;
$$;
