-- ============================================================
-- Per-stage timer gate, configurable minimum, manager bypass,
-- and pending-entry race fix.
--
-- Changes:
-- 1. pipeline_stages.min_timer_seconds (default 300; 0 = gate disabled)
-- 2. task_work_sessions.stage_id (stamped on insert; backfilled from history)
-- 3. rpc_start_work / rpc_stop_work: stamp stage_id on insert
-- 4. rpc_review_manual_time: stamp stage_id on backdated session
-- 5. rpc_execute_stage_action: time sum filtered to current stage; gate uses
--    pipeline_stages.min_timer_seconds; managers bypass; min=0 disables.
-- 6. rpc_log_manual_time: allow managers/owners; reject re-submit while a
--    pending entry exists; always return 'pending' approval_status (since the
--    DB row is always inserted as pending and requires manager review).
-- 7. rpc_add_stage / rpc_update_stage: persist min_timer_seconds; old
--    overloads dropped to keep one canonical signature.
-- 8. rpc_get_task_details: expose min_timer_seconds + work_session.stage_id
-- ============================================================

-- ── 1. Schema ────────────────────────────────────────────────
ALTER TABLE public.pipeline_stages
    ADD COLUMN IF NOT EXISTS min_timer_seconds INTEGER NOT NULL DEFAULT 300;

ALTER TABLE public.pipeline_stages
    DROP CONSTRAINT IF EXISTS pipeline_stages_min_timer_seconds_check;
ALTER TABLE public.pipeline_stages
    ADD CONSTRAINT pipeline_stages_min_timer_seconds_check
    CHECK (min_timer_seconds >= 0);

ALTER TABLE public.task_work_sessions
    ADD COLUMN IF NOT EXISTS stage_id UUID
    REFERENCES public.pipeline_stages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_work_sessions_task_stage
    ON public.task_work_sessions (task_id, stage_id);

-- ── 2. Backfill stage_id on existing sessions ────────────────
-- For each session, find the most recent stage_history transition at-or-before
-- started_at; fall back to the task's current_stage_id.
UPDATE public.task_work_sessions ws
SET stage_id = COALESCE(
    (
        SELECT h.to_stage_id
        FROM public.pipeline_stage_history h
        WHERE h.task_id = ws.task_id
          AND h.transitioned_at <= ws.started_at
        ORDER BY h.transitioned_at DESC
        LIMIT 1
    ),
    (SELECT t.current_stage_id FROM public.tasks t WHERE t.id = ws.task_id)
)
WHERE ws.stage_id IS NULL;

-- ── 3. rpc_start_work ────────────────────────────────────────
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

    UPDATE public.task_work_sessions
    SET status = 'completed', last_heartbeat_at = now()
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

-- ── 4. rpc_stop_work ─────────────────────────────────────────
-- Recreate the live 3-arg version, stamping stage_id on the recovery branch.
CREATE OR REPLACE FUNCTION public.rpc_stop_work(
    p_session_id UUID DEFAULT NULL,
    p_task_id UUID DEFAULT NULL,
    p_stopped_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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

    SELECT company_id, current_stage_id
    INTO v_company_id, v_stage_id
    FROM public.tasks WHERE id = COALESCE(p_task_id, v_session.task_id);

    -- Recovery beacon
    IF v_session.id IS NULL THEN
        INSERT INTO public.task_work_sessions (
            task_id, user_id, company_id, stage_id,
            started_at, last_heartbeat_at, completed_at,
            status, total_seconds_spent
        )
        VALUES (
            p_task_id, v_user_id, v_company_id, v_stage_id,
            v_final_stop_time - interval '1 second', v_final_stop_time, v_final_stop_time,
            'completed', 1
        )
        RETURNING id INTO p_session_id;

        RETURN jsonb_build_object('status', 'recovered', 'session_id', p_session_id, 'duration', 1);
    END IF;

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
$$;

-- ── 5. rpc_review_manual_time: stamp stage_id ────────────────
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
        e.id, e.task_id, e.stage_id, e.user_id, e.company_id,
        e.declared_minutes, e.logged_at, e.approval_status,
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
            user_id, task_id, company_id, stage_id,
            started_at, last_heartbeat_at, completed_at,
            status, total_seconds_spent
        )
        VALUES (
            v_entry.user_id, v_entry.task_id, v_entry.company_id, v_entry.stage_id,
            v_session_start, v_session_end, v_session_end,
            'completed', v_entry.declared_minutes * 60
        )
        RETURNING id INTO v_session_id;

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
            'success',         true,
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

-- ── 6. rpc_execute_stage_action: per-stage gate + dynamic min ─
CREATE OR REPLACE FUNCTION public.rpc_execute_stage_action(
    p_task_id   UUID,
    p_action_id UUID,
    p_payload   JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_user_id              UUID    := auth.uid();
    v_company_id           UUID;
    v_task                 RECORD;
    v_action               RECORD;
    v_is_owner             BOOLEAN;
    v_is_assigned          BOOLEAN;
    v_is_manager           BOOLEAN;
    v_is_creator           BOOLEAN;
    v_sub_id               UUID;
    v_assignment_id        UUID;
    v_stage_requires_timer BOOLEAN;
    v_stage_is_initial     BOOLEAN;
    v_min_timer_seconds    INTEGER;
    v_total_seconds        INTEGER;
    v_manual_entry_status  TEXT;
BEGIN
    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
    IF v_task IS NULL THEN RAISE EXCEPTION 'Task not found or deleted'; END IF;

    v_company_id := v_task.company_id;
    IF v_company_id != public.my_company_id() THEN
        RAISE EXCEPTION 'Unauthorized: task belongs to a different company';
    END IF;

    SELECT * INTO v_action FROM public.pipeline_stage_actions WHERE id = p_action_id AND is_active = TRUE;
    IF v_action IS NULL THEN RAISE EXCEPTION 'Action not found or inactive'; END IF;
    IF v_action.stage_id != v_task.current_stage_id THEN
        RAISE EXCEPTION 'Action does not belong to the task''s current stage';
    END IF;

    v_is_owner   := (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE;
    v_is_creator := v_task.created_by = v_user_id;
    v_is_manager := v_task.manager_id = v_user_id;

    SELECT id INTO v_assignment_id
    FROM public.task_assignments
    WHERE task_id = p_task_id
      AND (
        assignee_user_id = v_user_id
        OR assignee_team_id IN (
            SELECT team_id FROM public.team_members WHERE user_id = v_user_id AND removed_at IS NULL
        )
      )
    LIMIT 1;
    v_is_assigned := v_assignment_id IS NOT NULL;

    IF NOT v_is_owner THEN
        CASE v_action.required_role
            WHEN 'any'      THEN NULL;
            WHEN 'assignee' THEN IF NOT v_is_assigned THEN RAISE EXCEPTION 'Only assigned users can perform this action'; END IF;
            WHEN 'manager'  THEN IF NOT v_is_manager  THEN RAISE EXCEPTION 'Only the task manager can perform this action'; END IF;
            WHEN 'reviewer' THEN
                IF NOT (v_is_manager OR public.has_permission('submission.review')) THEN
                    RAISE EXCEPTION 'Only reviewers can perform this action';
                END IF;
            WHEN 'creator'  THEN IF NOT v_is_creator  THEN RAISE EXCEPTION 'Only the task creator can perform this action'; END IF;
            ELSE IF NOT public.has_permission(v_action.required_role) THEN
                RAISE EXCEPTION 'Missing required permission: %', v_action.required_role;
            END IF;
        END CASE;
    END IF;

    IF v_action.precondition IS NOT NULL THEN
        CASE v_action.precondition
            WHEN 'has_pending_submission' THEN
                IF NOT EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending') THEN
                    RAISE EXCEPTION 'Precondition failed: no pending submission exists';
                END IF;
            WHEN 'no_pending_submission' THEN
                IF EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending') THEN
                    RAISE EXCEPTION 'Precondition failed: a pending submission already exists';
                END IF;
            WHEN 'is_assigned' THEN
                IF NOT v_is_assigned THEN RAISE EXCEPTION 'Precondition failed: you must be assigned to this task'; END IF;
            WHEN 'has_approved_submission' THEN
                IF NOT EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'approved') THEN
                    RAISE EXCEPTION 'Precondition failed: no approved submission exists';
                END IF;
            WHEN 'has_attachment' THEN
                IF NOT EXISTS (SELECT 1 FROM public.task_attachments WHERE task_id = p_task_id) THEN
                    RAISE EXCEPTION 'Precondition failed: task has no attachments';
                END IF;
            WHEN 'all_subtasks_complete' THEN
                IF EXISTS (
                    SELECT 1 FROM public.tasks child
                    WHERE child.parent_task_id = p_task_id AND child.deleted_at IS NULL
                      AND NOT EXISTS (
                          SELECT 1 FROM public.pipeline_stages ps
                          WHERE ps.id = child.current_stage_id AND ps.is_terminal = TRUE AND ps.terminal_type = 'success'
                      )
                ) THEN
                    RAISE EXCEPTION 'Precondition failed: not all subtasks are completed';
                END IF;
            ELSE NULL;
        END CASE;
    END IF;

    -- Timer gate: advance actions only. Owners and managers bypass.
    SELECT COALESCE(ps.requires_timer, false),
           COALESCE(ps.is_initial, false),
           COALESCE(ps.min_timer_seconds, 300)
    INTO v_stage_requires_timer, v_stage_is_initial, v_min_timer_seconds
    FROM public.pipeline_stages ps WHERE ps.id = v_task.current_stage_id;

    IF v_stage_requires_timer
       AND NOT v_stage_is_initial
       AND NOT v_is_owner
       AND NOT v_is_manager
       AND v_min_timer_seconds > 0
       AND v_action.action_type = 'advance'
    THEN
        -- Per-stage time accumulation: sum sessions for this task in this stage only.
        SELECT COALESCE(SUM(
            CASE
                WHEN status = 'completed' THEN COALESCE(total_seconds_spent, 0)
                WHEN status = 'active'    THEN EXTRACT(EPOCH FROM (now() - started_at))::INTEGER
                ELSE 0
            END
        ), 0) INTO v_total_seconds
        FROM public.task_work_sessions
        WHERE task_id  = p_task_id
          AND stage_id = v_task.current_stage_id;

        IF v_total_seconds < v_min_timer_seconds THEN
            SELECT approval_status INTO v_manual_entry_status
            FROM public.task_manual_time_entries
            WHERE task_id = p_task_id AND stage_id = v_task.current_stage_id AND user_id = v_user_id;

            IF v_manual_entry_status IS NULL OR v_manual_entry_status = 'rejected' THEN
                RAISE EXCEPTION 'LOW_TIMER_TIME: Less than the required minimum time was logged for this stage. Please declare your actual work hours before proceeding.'
                USING ERRCODE = 'P0001';
            ELSIF v_manual_entry_status = 'pending' THEN
                RAISE EXCEPTION 'TIME_APPROVAL_PENDING: Your time declaration is awaiting manager approval. The stage will advance automatically once approved.'
                USING ERRCODE = 'P0001';
            END IF;
        END IF;
    END IF;

    CASE v_action.action_type
        WHEN 'start_task' THEN
            IF v_action.transition_id IS NOT NULL THEN
                PERFORM public.rpc_advance_stage(p_task_id,
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'start_task');

        WHEN 'submit_work' THEN
            v_sub_id := public.rpc_submit_work(p_task_id, COALESCE(p_payload->>'content', ''),
                v_assignment_id, v_action.transition_id, COALESCE(p_payload->'attachments', '[]'::jsonb));
            RETURN jsonb_build_object('success', true, 'action', 'submit_work', 'submission_id', v_sub_id);

        WHEN 'advance' THEN
            IF v_action.transition_id IS NOT NULL THEN
                PERFORM public.rpc_advance_stage(p_task_id,
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'advance');

        WHEN 'review_approve' THEN
            SELECT id INTO v_sub_id FROM public.task_submissions
            WHERE task_id = p_task_id AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1;
            IF v_sub_id IS NOT NULL THEN
                PERFORM public.rpc_review_submission(v_sub_id, 'approved', p_payload->>'notes',
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'review_approve');

        WHEN 'review_reject' THEN
            SELECT id INTO v_sub_id FROM public.task_submissions
            WHERE task_id = p_task_id AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1;
            IF v_sub_id IS NOT NULL THEN
                PERFORM public.rpc_review_submission(v_sub_id, 'rejected', p_payload->>'notes',
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'review_reject');

        WHEN 'review_revise' THEN
            SELECT id INTO v_sub_id FROM public.task_submissions
            WHERE task_id = p_task_id AND status = 'pending' ORDER BY submitted_at DESC LIMIT 1;
            IF v_sub_id IS NOT NULL THEN
                PERFORM public.rpc_review_submission(v_sub_id, 'needs_revision', p_payload->>'notes',
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'review_revise');

        WHEN 'start_timer' THEN
            INSERT INTO public.task_work_sessions (task_id, user_id, company_id, stage_id, status)
            VALUES (p_task_id, v_user_id, v_company_id, v_task.current_stage_id, 'active') ON CONFLICT DO NOTHING;
            PERFORM public.log_event(v_company_id, v_user_id, 'task', p_task_id, 'task.timer_started',
                jsonb_build_object('action_id', p_action_id));
            RETURN jsonb_build_object('success', true, 'action', 'start_timer');

        WHEN 'assign_user' THEN
            IF p_payload->>'assign_user_id' IS NOT NULL THEN
                INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
                VALUES (p_task_id, v_company_id, (p_payload->>'assign_user_id')::UUID, v_user_id)
                ON CONFLICT DO NOTHING;
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'assign_user');

        WHEN 'custom' THEN
            IF v_action.transition_id IS NOT NULL THEN
                PERFORM public.rpc_advance_stage(p_task_id,
                    (SELECT to_stage_id FROM public.pipeline_stage_transitions WHERE id = v_action.transition_id));
            END IF;
            RETURN jsonb_build_object('success', true, 'action', 'custom');

        ELSE RAISE EXCEPTION 'Unknown action type: %', v_action.action_type;
    END CASE;
END;
$$;

-- ── 7. rpc_log_manual_time: managers/owners + pending guard ──
CREATE OR REPLACE FUNCTION public.rpc_log_manual_time(
    p_task_id          UUID,
    p_stage_id         UUID,
    p_declared_minutes INTEGER,
    p_reason           TEXT DEFAULT NULL,
    p_transition_id    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_user_id               UUID    := auth.uid();
    v_task                  RECORD;
    v_company_id            UUID;
    v_is_owner              BOOLEAN;
    v_is_manager            BOOLEAN;
    v_is_assigned           BOOLEAN;
    v_existing_status       TEXT;
    v_is_flagged            BOOLEAN := false;
    v_flag_reason           TEXT    := NULL;
    v_estimated_minutes     NUMERIC;
    v_stage_p95_minutes     NUMERIC;
    v_minutes_since_created NUMERIC;
BEGIN
    IF p_declared_minutes IS NULL OR p_declared_minutes <= 0 THEN
        RAISE EXCEPTION 'Declared time must be greater than 0 minutes' USING ERRCODE = 'P0001';
    END IF;
    IF p_declared_minutes > 1440 THEN
        RAISE EXCEPTION 'Declared time cannot exceed 24 hours (1440 minutes)' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id AND deleted_at IS NULL;
    IF v_task IS NULL THEN
        RAISE EXCEPTION 'Task not found' USING ERRCODE = 'P0002';
    END IF;

    v_company_id := v_task.company_id;
    IF v_company_id != public.my_company_id() THEN
        RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
    END IF;

    v_is_owner   := COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE);
    v_is_manager := v_task.manager_id = v_user_id;
    v_is_assigned := EXISTS (
        SELECT 1 FROM public.task_assignments
        WHERE task_id = p_task_id
          AND (
            assignee_user_id = v_user_id
            OR assignee_team_id IN (
                SELECT team_id FROM public.team_members
                WHERE user_id = v_user_id AND removed_at IS NULL
            )
          )
    );

    IF NOT (v_is_assigned OR v_is_manager OR v_is_owner) THEN
        RAISE EXCEPTION 'You are not assigned to this task' USING ERRCODE = '42501';
    END IF;

    -- Race guard: if a pending entry already exists, do not let the same user
    -- overwrite it with a different transition while the manager is reviewing.
    SELECT approval_status INTO v_existing_status
    FROM public.task_manual_time_entries
    WHERE task_id = p_task_id AND stage_id = p_stage_id AND user_id = v_user_id;

    IF v_existing_status = 'pending' THEN
        RAISE EXCEPTION 'A time declaration is already awaiting manager approval for this stage.'
            USING ERRCODE = 'P0001';
    END IF;

    -- Fraud check 1: task estimated_hours
    IF v_task.estimated_hours IS NOT NULL THEN
        v_estimated_minutes := v_task.estimated_hours * 60;
        IF p_declared_minutes > v_estimated_minutes THEN
            v_is_flagged  := true;
            v_flag_reason := format(
                'Declared time (%s min) exceeds task estimate (%s min)',
                p_declared_minutes, v_estimated_minutes::integer
            );
        END IF;
    END IF;

    -- Fraud check 2: stage P95
    IF NOT v_is_flagged THEN
        SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY s.total_seconds_spent) / 60.0
        INTO v_stage_p95_minutes
        FROM public.task_work_sessions s
        WHERE s.stage_id          = p_stage_id
          AND s.status            = 'completed'
          AND s.total_seconds_spent IS NOT NULL
          AND s.total_seconds_spent > 60;

        IF v_stage_p95_minutes IS NOT NULL AND p_declared_minutes > (v_stage_p95_minutes * 2) THEN
            v_is_flagged  := true;
            v_flag_reason := format(
                'Declared time (%s min) exceeds 2x stage P95 average (%s min)',
                p_declared_minutes, v_stage_p95_minutes::integer
            );
        END IF;
    END IF;

    -- Fraud check 3: temporal plausibility
    v_minutes_since_created := EXTRACT(EPOCH FROM (now() - v_task.created_at)) / 60.0;
    IF p_declared_minutes > v_minutes_since_created THEN
        v_is_flagged  := true;
        v_flag_reason := format(
            'Declared time (%s min) exceeds time since task creation (%s min)',
            p_declared_minutes, v_minutes_since_created::integer
        );
    END IF;

    INSERT INTO public.task_manual_time_entries
        (task_id, stage_id, user_id, company_id, declared_minutes, reason,
         is_flagged, flag_reason, pending_transition_id)
    VALUES
        (p_task_id, p_stage_id, v_user_id, v_company_id, p_declared_minutes, p_reason,
         v_is_flagged, v_flag_reason, p_transition_id)
    ON CONFLICT (task_id, stage_id, user_id) DO UPDATE
        SET declared_minutes      = EXCLUDED.declared_minutes,
            reason                = EXCLUDED.reason,
            is_flagged            = EXCLUDED.is_flagged,
            flag_reason           = EXCLUDED.flag_reason,
            pending_transition_id = EXCLUDED.pending_transition_id,
            logged_at             = now();

    IF v_is_flagged AND v_task.manager_id IS NOT NULL THEN
        PERFORM public.fn_emit_notification_event(
            'task.manual_time_flagged', 'task', p_task_id, v_user_id,
            jsonb_build_object(
                'declared_minutes', p_declared_minutes,
                'flag_reason',      v_flag_reason,
                'stage_id',         p_stage_id,
                'manager_id',       v_task.manager_id
            )
        );
    END IF;

    PERFORM public.log_event(
        v_company_id, v_user_id, 'task', p_task_id, 'task.manual_time_logged',
        jsonb_build_object(
            'declared_minutes', p_declared_minutes,
            'is_flagged',       v_is_flagged,
            'stage_id',         p_stage_id
        )
    );

    -- Approval is always required from the manager — return 'pending'.
    RETURN jsonb_build_object(
        'success',         true,
        'is_flagged',      v_is_flagged,
        'flag_reason',     v_flag_reason,
        'approval_status', 'pending'
    );
END;
$$;

-- ── 8. rpc_add_stage / rpc_update_stage: persist min_timer_seconds ──
DROP FUNCTION IF EXISTS public.rpc_add_stage(uuid, text, text, text, boolean, boolean, text, boolean);
DROP FUNCTION IF EXISTS public.rpc_add_stage(uuid, text, text, text, boolean, boolean, text, boolean, boolean, boolean);
DROP FUNCTION IF EXISTS public.rpc_add_stage(uuid, text, text, text, boolean, boolean, text, boolean, boolean, boolean, jsonb);

CREATE OR REPLACE FUNCTION public.rpc_add_stage(
    p_pipeline_id         UUID,
    p_name                TEXT,
    p_color               TEXT    DEFAULT '#6B7280',
    p_description         TEXT    DEFAULT NULL,
    p_is_initial          BOOLEAN DEFAULT FALSE,
    p_is_terminal         BOOLEAN DEFAULT FALSE,
    p_terminal_type       TEXT    DEFAULT NULL,
    p_requires_submission BOOLEAN DEFAULT FALSE,
    p_requires_timer      BOOLEAN DEFAULT FALSE,
    p_use_business_hours  BOOLEAN DEFAULT FALSE,
    p_ui_metadata         JSONB   DEFAULT '{"x": 0, "y": 0}'::jsonb,
    p_min_timer_seconds   INTEGER DEFAULT 300
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_company_id UUID;
    v_user_id    UUID := auth.uid();
    v_pos        INTEGER;
    v_new_id     UUID;
BEGIN
    SELECT p.company_id INTO v_company_id
    FROM public.pipelines p
    WHERE p.id = p_pipeline_id AND p.deleted_at IS NULL;

    IF v_company_id IS NULL THEN RAISE EXCEPTION 'Pipeline not found'; END IF;
    IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
        OR public.has_permission('pipeline.edit')
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions';
    END IF;

    IF p_min_timer_seconds < 0 THEN
        RAISE EXCEPTION 'min_timer_seconds must be >= 0';
    END IF;

    IF p_is_initial = TRUE THEN
        UPDATE public.pipeline_stages SET is_initial = FALSE
        WHERE pipeline_id = p_pipeline_id AND is_initial = TRUE;
    END IF;

    SELECT COALESCE(MAX(position), 0) + 1 INTO v_pos
    FROM public.pipeline_stages WHERE pipeline_id = p_pipeline_id;

    INSERT INTO public.pipeline_stages (
        pipeline_id, name, color, description, position,
        is_initial, is_terminal, terminal_type,
        requires_submission, requires_timer, use_business_hours,
        ui_metadata, min_timer_seconds
    )
    VALUES (
        p_pipeline_id, p_name, p_color, p_description, v_pos,
        p_is_initial, p_is_terminal, p_terminal_type,
        p_requires_submission, p_requires_timer, p_use_business_hours,
        p_ui_metadata, p_min_timer_seconds
    )
    RETURNING id INTO v_new_id;

    RETURN v_new_id;
END;
$$;

DROP FUNCTION IF EXISTS public.rpc_update_stage(uuid, text, text, text, boolean, boolean, text, boolean);
DROP FUNCTION IF EXISTS public.rpc_update_stage(uuid, text, text, text, boolean, boolean, text, boolean, uuid);
DROP FUNCTION IF EXISTS public.rpc_update_stage(uuid, text, text, text, boolean, boolean, text, boolean, boolean, boolean, uuid);
DROP FUNCTION IF EXISTS public.rpc_update_stage(uuid, text, text, text, boolean, boolean, text, boolean, boolean, boolean, uuid, jsonb);

CREATE OR REPLACE FUNCTION public.rpc_update_stage(
    p_stage_id            UUID,
    p_name                TEXT    DEFAULT NULL,
    p_color               TEXT    DEFAULT NULL,
    p_description         TEXT    DEFAULT NULL,
    p_is_initial          BOOLEAN DEFAULT NULL,
    p_is_terminal         BOOLEAN DEFAULT NULL,
    p_terminal_type       TEXT    DEFAULT NULL,
    p_requires_submission BOOLEAN DEFAULT NULL,
    p_requires_timer      BOOLEAN DEFAULT NULL,
    p_use_business_hours  BOOLEAN DEFAULT NULL,
    p_linked_pipeline_id  UUID    DEFAULT NULL,
    p_ui_metadata         JSONB   DEFAULT NULL,
    p_min_timer_seconds   INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_company_id  UUID;
    v_pipeline_id UUID;
    v_user_id     UUID := auth.uid();
BEGIN
    SELECT p.company_id, ps.pipeline_id
    INTO v_company_id, v_pipeline_id
    FROM public.pipeline_stages ps
    JOIN public.pipelines p ON p.id = ps.pipeline_id
    WHERE ps.id = p_stage_id;

    IF v_company_id IS NULL THEN RAISE EXCEPTION 'Stage not found'; END IF;
    IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
        OR public.has_permission('pipeline.edit')
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions';
    END IF;

    IF p_min_timer_seconds IS NOT NULL AND p_min_timer_seconds < 0 THEN
        RAISE EXCEPTION 'min_timer_seconds must be >= 0';
    END IF;

    IF p_is_initial = TRUE THEN
        UPDATE public.pipeline_stages SET is_initial = FALSE
        WHERE pipeline_id = v_pipeline_id AND is_initial = TRUE AND id != p_stage_id;
    END IF;

    UPDATE public.pipeline_stages
    SET
        name                = COALESCE(p_name, name),
        color               = COALESCE(p_color, color),
        description         = COALESCE(p_description, description),
        is_initial          = COALESCE(p_is_initial, is_initial),
        is_terminal         = COALESCE(p_is_terminal, is_terminal),
        terminal_type       = COALESCE(p_terminal_type, terminal_type),
        requires_submission = COALESCE(p_requires_submission, requires_submission),
        requires_timer      = COALESCE(p_requires_timer, requires_timer),
        use_business_hours  = COALESCE(p_use_business_hours, use_business_hours),
        linked_pipeline_id  = COALESCE(p_linked_pipeline_id, linked_pipeline_id),
        ui_metadata         = COALESCE(p_ui_metadata, ui_metadata),
        min_timer_seconds   = COALESCE(p_min_timer_seconds, min_timer_seconds),
        updated_at          = NOW()
    WHERE id = p_stage_id;
END;
$$;

-- ── 9. rpc_get_task_details: expose new fields ───────────────
-- The full function is large; patch only the two JSONB builders that need
-- min_timer_seconds (current_stage / all_stages) and stage_id (work_sessions).
CREATE OR REPLACE FUNCTION public.rpc_get_task_details(p_task_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_task                   RECORD;
  v_user_id                UUID := auth.uid();
  v_pipeline               JSONB;
  v_current_stage          JSONB;
  v_all_stages             JSONB;
  v_transitions            JSONB;
  v_creator                JSONB;
  v_manager                JSONB;
  v_assignments            JSONB;
  v_stage_history          JSONB;
  v_submissions            JSONB;
  v_comments               JSONB;
  v_work_sessions          JSONB;
  v_activity               JSONB;
  v_stats                  JSONB;
  v_permissions            JSONB;
  v_can_view_hist          BOOLEAN;
  v_stage_actions          JSONB;
  v_task_attachments       JSONB;
  v_pending_time_approvals JSONB;
  v_my_manual_time_entry   JSONB;
  v_is_owner               BOOLEAN;
  v_is_assigned            BOOLEAN;
  v_is_manager             BOOLEAN;
  v_is_creator             BOOLEAN;
BEGIN
  SELECT * INTO v_task
  FROM public.tasks
  WHERE id = p_task_id AND deleted_at IS NULL;

  IF v_task IS NULL THEN RETURN NULL; END IF;
  IF v_task.company_id != public.my_company_id() THEN RETURN NULL; END IF;

  v_is_owner   := COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE);
  v_is_creator := v_task.created_by = v_user_id;
  v_is_manager := v_task.manager_id = v_user_id;
  v_is_assigned := EXISTS (
    SELECT 1 FROM public.task_assignments ta
    WHERE ta.task_id = p_task_id
      AND (
        ta.assignee_user_id = v_user_id
        OR ta.assignee_team_id IN (
            SELECT team_id FROM public.team_members WHERE user_id = v_user_id AND removed_at IS NULL
        )
      )
  );

  IF NOT (
    v_is_owner OR v_is_creator OR v_is_manager OR v_is_assigned
    OR public.has_permission('task.view_detail')
  ) THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object('id', p.id, 'name', p.name, 'description', p.description)
  INTO v_pipeline
  FROM public.pipelines p WHERE p.id = v_task.pipeline_id;

  SELECT jsonb_build_object(
    'id', ps.id, 'name', ps.name, 'color', ps.color,
    'position', ps.position, 'is_initial', ps.is_initial,
    'is_terminal', ps.is_terminal, 'terminal_type', ps.terminal_type,
    'requires_submission', ps.requires_submission,
    'requires_timer', ps.requires_timer,
    'requires_attachments', ps.requires_attachments,
    'min_timer_seconds', ps.min_timer_seconds,
    'linked_pipeline_id', ps.linked_pipeline_id,
    'linked_pipeline', CASE WHEN ps.linked_pipeline_id IS NOT NULL THEN
      (SELECT jsonb_build_object('id', lp.id, 'name', lp.name) FROM public.pipelines lp WHERE lp.id = ps.linked_pipeline_id)
    ELSE NULL END
  )
  INTO v_current_stage
  FROM public.pipeline_stages ps WHERE ps.id = v_task.current_stage_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object('id', ps.id, 'name', ps.name, 'color', ps.color, 'position', ps.position,
                       'is_initial', ps.is_initial, 'is_terminal', ps.is_terminal, 'terminal_type', ps.terminal_type,
                       'requires_submission', ps.requires_submission, 'requires_attachments', ps.requires_attachments,
                       'requires_timer', ps.requires_timer, 'min_timer_seconds', ps.min_timer_seconds,
                       'linked_pipeline_id', ps.linked_pipeline_id)
    ORDER BY ps.position
  ), '[]'::jsonb)
  INTO v_all_stages
  FROM public.pipeline_stages ps WHERE ps.pipeline_id = v_task.pipeline_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', t.id, 'to_stage_id', t.to_stage_id,
      'to_stage_name', ps.name, 'to_stage_color', ps.color,
      'label', t.label, 'transition_type', t.transition_type,
      'required_permission', t.required_permission
    )
  ), '[]'::jsonb)
  INTO v_transitions
  FROM public.pipeline_stage_transitions t
  JOIN public.pipeline_stages ps ON ps.id = t.to_stage_id
  WHERE t.from_stage_id = v_task.current_stage_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id,
      'action_type', a.action_type,
      'label', a.label,
      'icon', a.icon,
      'style', a.style,
      'required_role', a.required_role,
      'precondition', a.precondition,
      'transition_id', a.transition_id,
      'position', a.position,
      'requires_timer', a.requires_timer,
      'can_perform', CASE
        WHEN v_is_owner THEN TRUE
        WHEN a.required_role = 'any' THEN TRUE
        WHEN a.required_role = 'assignee' AND v_is_assigned THEN TRUE
        WHEN a.required_role = 'manager' AND v_is_manager THEN TRUE
        WHEN a.required_role = 'reviewer' AND (v_is_manager OR public.has_permission('submission.review')) THEN TRUE
        WHEN a.required_role = 'creator' AND v_is_creator THEN TRUE
        WHEN public.has_permission(a.required_role) THEN TRUE
        ELSE FALSE
      END,
      'precondition_met', CASE
        WHEN a.precondition IS NULL THEN TRUE
        WHEN a.precondition = 'has_pending_submission' THEN EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending')
        WHEN a.precondition = 'no_pending_submission' THEN NOT EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending')
        WHEN a.precondition = 'is_assigned' THEN v_is_assigned
        WHEN a.precondition = 'has_approved_submission' THEN EXISTS (SELECT 1 FROM public.task_submissions WHERE task_id = p_task_id AND status = 'approved')
        WHEN a.precondition = 'has_attachment' THEN EXISTS (SELECT 1 FROM public.task_attachments WHERE task_id = p_task_id)
        WHEN a.precondition = 'all_subtasks_complete' THEN NOT EXISTS (
          SELECT 1 FROM public.tasks child
          WHERE child.parent_task_id = p_task_id
            AND child.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM public.pipeline_stages ps
              WHERE ps.id = child.current_stage_id
                AND ps.is_terminal = TRUE
                AND ps.terminal_type = 'success'
            )
        )
        ELSE FALSE
      END
    ) ORDER BY a.position
  ), '[]'::jsonb)
  INTO v_stage_actions
  FROM public.pipeline_stage_actions a
  WHERE a.stage_id = v_task.current_stage_id AND a.is_active = TRUE;

  SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url, 'email', u.email)
  INTO v_creator
  FROM public.users u WHERE u.id = v_task.created_by;

  IF v_task.manager_id IS NOT NULL THEN
    SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url, 'email', u.email)
    INTO v_manager
    FROM public.users u WHERE u.id = v_task.manager_id;
  ELSE
    v_manager := 'null'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ta.id,
      'user', CASE WHEN ta.assignee_user_id IS NOT NULL THEN
        (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = ta.assignee_user_id)
      ELSE NULL END,
      'team', CASE WHEN ta.assignee_team_id IS NOT NULL THEN
        (SELECT jsonb_build_object(
          'id', t.id, 'name', t.name, 'color', t.color,
          'members', (SELECT jsonb_agg(jsonb_build_object('user_id', tm.user_id)) FROM public.team_members tm WHERE tm.team_id = t.id AND tm.removed_at IS NULL)
        ) FROM public.teams t WHERE t.id = ta.assignee_team_id)
      ELSE NULL END,
      'assigned_at', ta.assigned_at
    )
  ), '[]'::jsonb)
  INTO v_assignments
  FROM public.task_assignments ta WHERE ta.task_id = p_task_id;

  v_can_view_hist := v_is_owner OR v_is_creator OR v_is_manager OR v_is_assigned OR public.has_permission('task.view_history');

  IF v_can_view_hist THEN
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', h.id,
        'from_stage_name', (SELECT name FROM public.pipeline_stages WHERE id = h.from_stage_id),
        'to_stage_name', (SELECT name FROM public.pipeline_stages WHERE id = h.to_stage_id),
        'transitioned_by', (SELECT jsonb_build_object('full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = h.transitioned_by),
        'transitioned_at', h.transitioned_at,
        'is_reversal', h.is_reversal,
        'submission_id', h.submission_id
      ) ORDER BY h.transitioned_at DESC
    ), '[]'::jsonb)
    INTO v_stage_history
    FROM public.pipeline_stage_history h WHERE h.task_id = p_task_id;
  ELSE
    v_stage_history := '[]'::jsonb;
  END IF;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', s.id,
      'content', s.content,
      'status', s.status,
      'revision_count', s.revision_count,
      'submitted_at', s.submitted_at,
      'reviewed_at', s.reviewed_at,
      'review_notes', s.review_notes,
      'submitted_by', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = s.submitted_by),
      'reviewed_by', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = s.reviewed_by),
      'stage_name', (SELECT name FROM public.pipeline_stages WHERE id = s.stage_id),
      'attachments', COALESCE(
        (SELECT jsonb_agg(
          jsonb_build_object(
            'id', a.id, 'file_name', a.file_name, 'file_url', a.file_url,
            'mime_type', a.mime_type, 'category', a.category, 'file_size', a.file_size,
            'storage_path', a.storage_path
          )
        ) FROM public.submission_attachments a WHERE a.submission_id = s.id),
        '[]'::jsonb
      )
    ) ORDER BY s.submitted_at DESC
  ), '[]'::jsonb)
  INTO v_submissions
  FROM public.task_submissions s WHERE s.task_id = p_task_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', a.id, 'file_name', a.file_name, 'file_url', a.file_url,
      'storage_path', a.storage_path, 'file_size', a.file_size,
      'mime_type', a.mime_type, 'category', a.category,
      'uploaded_by', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = a.uploaded_by),
      'created_at', a.created_at
    ) ORDER BY a.created_at DESC
  ), '[]'::jsonb)
  INTO v_task_attachments
  FROM public.task_attachments a WHERE a.task_id = p_task_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', c.id, 'content', c.content, 'parent_id', c.parent_id, 'is_system', c.is_system,
      'author', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = c.author_id),
      'created_at', c.created_at
    ) ORDER BY c.created_at ASC
  ), '[]'::jsonb)
  INTO v_comments
  FROM public.task_comments c
  WHERE c.task_id = p_task_id AND c.deleted_at IS NULL;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ws.id,
      'user_name', (SELECT u.full_name FROM public.users u WHERE u.id = ws.user_id),
      'user_id', ws.user_id,
      'stage_id', ws.stage_id,
      'status', ws.status,
      'total_seconds_spent', ws.total_seconds_spent,
      'started_at', ws.started_at
    )
  ), '[]'::jsonb)
  INTO v_work_sessions
  FROM public.task_work_sessions ws WHERE ws.task_id = p_task_id;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', ae.id,
      'event_type', ae.event_type,
      'user_name', (SELECT u.full_name FROM public.users u WHERE u.id = ae.user_id),
      'metadata', ae.metadata,
      'created_at', ae.created_at
    ) ORDER BY ae.created_at DESC
  ), '[]'::jsonb)
  INTO v_activity
  FROM public.activity_events ae WHERE ae.entity_type = 'task' AND ae.entity_id = p_task_id;

  SELECT jsonb_build_object(
    'total_transitions', (SELECT COUNT(*) FROM public.pipeline_stage_history WHERE task_id = p_task_id),
    'approval_count', (SELECT COUNT(*) FROM public.task_submissions WHERE task_id = p_task_id AND status = 'approved'),
    'revision_count', (SELECT COUNT(*) FROM public.task_submissions WHERE task_id = p_task_id AND status = 'needs_revision'),
    'rejection_count', (SELECT COUNT(*) FROM public.task_submissions WHERE task_id = p_task_id AND status = 'rejected'),
    'pending_count', (SELECT COUNT(*) FROM public.task_submissions WHERE task_id = p_task_id AND status = 'pending'),
    'total_time_spent_seconds', COALESCE((SELECT SUM(total_seconds_spent) FROM public.task_work_sessions WHERE task_id = p_task_id), 0),
    'days_in_pipeline', EXTRACT(DAY FROM (now() - v_task.created_at))::INT
  ) INTO v_stats;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', e.id,
      'declared_minutes', e.declared_minutes,
      'reason', e.reason,
      'flag_reason', e.flag_reason,
      'logged_at', e.logged_at,
      'approval_status', e.approval_status,
      'rejection_reason', e.rejection_reason,
      'user', (SELECT jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) FROM public.users u WHERE u.id = e.user_id)
    )
  ), '[]'::jsonb)
  INTO v_pending_time_approvals
  FROM public.task_manual_time_entries e
  WHERE e.task_id  = p_task_id
    AND e.stage_id = v_task.current_stage_id
    AND e.approval_status = 'pending'
    AND (v_is_owner OR v_is_manager OR v_is_creator OR public.has_permission('task.manage'));

  SELECT jsonb_build_object(
    'id',               e.id,
    'declared_minutes', e.declared_minutes,
    'is_flagged',       e.is_flagged,
    'approval_status',  e.approval_status,
    'rejection_reason', e.rejection_reason
  )
  INTO v_my_manual_time_entry
  FROM public.task_manual_time_entries e
  WHERE e.task_id  = p_task_id
    AND e.stage_id = v_task.current_stage_id
    AND e.user_id  = v_user_id;

  v_permissions := jsonb_build_object(
    'can_edit',         v_is_owner OR v_is_creator OR v_is_manager OR public.has_permission('task.edit'),
    'can_assign',       v_is_owner OR v_is_manager OR public.has_permission('task.assign'),
    'can_submit',       v_is_assigned,
    'can_review',       v_is_owner OR v_is_manager OR public.has_permission('submission.review'),
    'can_view_history', v_can_view_hist,
    'can_comment',      TRUE,
    'can_advance',      v_is_owner OR v_is_manager OR v_is_assigned OR public.has_permission('task.advance'),
    'can_delete',       v_is_owner OR public.has_permission('task.delete'),
    'is_owner',         v_is_owner,
    'is_assigned',      v_is_assigned,
    'is_manager',       v_is_manager,
    'is_creator',       v_is_creator
  );

  RETURN jsonb_build_object(
    'task',                   to_jsonb(v_task),
    'pipeline',               v_pipeline,
    'current_stage',          v_current_stage,
    'all_stages',             v_all_stages,
    'available_transitions',  v_transitions,
    'stage_actions',          v_stage_actions,
    'creator',                v_creator,
    'manager',                v_manager,
    'assignments',            v_assignments,
    'stage_history',          v_stage_history,
    'submissions',            v_submissions,
    'comments',               v_comments,
    'work_sessions',          v_work_sessions,
    'activity',               v_activity,
    'stats',                  v_stats,
    'permissions',            v_permissions,
    'task_attachments',       v_task_attachments,
    'pending_time_approvals', COALESCE(v_pending_time_approvals, '[]'::jsonb),
    'my_manual_time_entry',   COALESCE(v_my_manual_time_entry, 'null'::jsonb)
  );
END;
$function$;
