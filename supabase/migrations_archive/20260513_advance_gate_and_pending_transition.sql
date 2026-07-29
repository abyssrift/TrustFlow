-- ============================================================
-- Advance Gate: Move timer check from submit_work to advance
-- ============================================================
-- Summary of changes:
-- 1. task_manual_time_entries: add pending_transition_id (the transition the
--    worker was trying to take when the timer gate blocked them)
-- 2. rpc_log_manual_time: accept + store p_transition_id; return approval_status
-- 3. rpc_review_manual_time: on approval, auto-advance stage when
--    pending_transition_id is set
-- 4. rpc_execute_stage_action: timer gate now fires ONLY for 'advance' action
--    type; also distinguishes pending vs rejected manual entry
-- 5. rpc_submit_work: timer gate removed entirely — submissions always save
-- ============================================================

-- ── 1. Schema ────────────────────────────────────────────────
ALTER TABLE public.task_manual_time_entries
    ADD COLUMN IF NOT EXISTS pending_transition_id UUID
    REFERENCES public.pipeline_stage_transitions(id) ON DELETE SET NULL;

-- ── 2. rpc_log_manual_time ───────────────────────────────────
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

    IF NOT EXISTS (
        SELECT 1 FROM public.task_assignments
        WHERE task_id = p_task_id
          AND (
            assignee_user_id = v_user_id
            OR assignee_team_id IN (
                SELECT team_id FROM public.team_members
                WHERE user_id = v_user_id AND removed_at IS NULL
            )
          )
    ) THEN
        RAISE EXCEPTION 'You are not assigned to this task' USING ERRCODE = '42501';
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
        JOIN public.tasks t ON t.id = s.task_id
        WHERE t.current_stage_id = p_stage_id
          AND s.status           = 'completed'
          AND s.total_seconds_spent IS NOT NULL
          AND s.total_seconds_spent > 60;

        IF v_stage_p95_minutes IS NOT NULL AND p_declared_minutes > (v_stage_p95_minutes * 2) THEN
            v_is_flagged  := true;
            v_flag_reason := format(
                'Declared time (%s min) exceeds 2× stage P95 average (%s min)',
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

    RETURN jsonb_build_object(
        'success',         true,
        'is_flagged',      v_is_flagged,
        'flag_reason',     v_flag_reason,
        'approval_status', CASE WHEN v_is_flagged THEN 'pending' ELSE 'approved' END
    );
END;
$$;

-- ── 3. rpc_review_manual_time ────────────────────────────────
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
            user_id, task_id, started_at, last_heartbeat_at, status
        )
        VALUES (
            v_entry.user_id, v_entry.task_id, v_session_start, v_session_end, 'completed'
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

-- ── 4. rpc_execute_stage_action ──────────────────────────────
-- Timer gate now fires ONLY for action_type = 'advance'.
-- Also distinguishes pending vs rejected manual time entry.
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
    v_user_id               UUID    := auth.uid();
    v_company_id            UUID;
    v_task                  RECORD;
    v_action                RECORD;
    v_is_owner              BOOLEAN;
    v_is_assigned           BOOLEAN;
    v_is_manager            BOOLEAN;
    v_is_creator            BOOLEAN;
    v_sub_id                UUID;
    v_assignment_id         UUID;
    v_stage_requires_timer  BOOLEAN;
    v_stage_is_initial      BOOLEAN;
    v_total_seconds         INTEGER;
    v_manual_entry_status   TEXT;
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

    -- Timer gate: advance actions only
    -- submit_work is deliberately excluded — submissions always save immediately.
    SELECT COALESCE(ps.requires_timer, false), COALESCE(ps.is_initial, false)
    INTO v_stage_requires_timer, v_stage_is_initial
    FROM public.pipeline_stages ps WHERE ps.id = v_task.current_stage_id;

    IF v_stage_requires_timer
       AND NOT v_stage_is_initial
       AND NOT v_is_owner
       AND v_action.action_type = 'advance'
    THEN
        SELECT COALESCE(SUM(
            CASE
                WHEN status = 'completed' THEN COALESCE(total_seconds_spent, 0)
                WHEN status = 'active'    THEN EXTRACT(EPOCH FROM (now() - started_at))::INTEGER
                ELSE 0
            END
        ), 0) INTO v_total_seconds
        FROM public.task_work_sessions WHERE task_id = p_task_id;

        IF v_total_seconds < 300 THEN
            SELECT approval_status INTO v_manual_entry_status
            FROM public.task_manual_time_entries
            WHERE task_id = p_task_id AND stage_id = v_task.current_stage_id AND user_id = v_user_id;

            IF v_manual_entry_status IS NULL OR v_manual_entry_status = 'rejected' THEN
                RAISE EXCEPTION 'LOW_TIMER_TIME: Less than 5 minutes logged for this stage. Please declare your actual work hours before proceeding.'
                USING ERRCODE = 'P0001';
            ELSIF v_manual_entry_status = 'pending' THEN
                RAISE EXCEPTION 'TIME_APPROVAL_PENDING: Your time declaration is awaiting manager approval. The stage will advance automatically once approved.'
                USING ERRCODE = 'P0001';
            END IF;
            -- 'approved' falls through and allows the advance
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
            INSERT INTO public.task_work_sessions (task_id, user_id, company_id, status)
            VALUES (p_task_id, v_user_id, v_company_id, 'active') ON CONFLICT DO NOTHING;
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

-- ── 5. rpc_submit_work ───────────────────────────────────────
-- Timer gate removed. Submissions always save immediately regardless of
-- tracked time. Stage advancement (if any) still fires via p_transition_id.
CREATE OR REPLACE FUNCTION public.rpc_submit_work(
    p_task_id        UUID,
    p_content        TEXT  DEFAULT NULL,
    p_assignment_id  UUID  DEFAULT NULL,
    p_transition_id  UUID  DEFAULT NULL,
    p_attachments    JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_submission_id   UUID;
    v_company_id      UUID;
    v_user_id         UUID    := auth.uid();
    v_current_stage   UUID;
    v_target_stage_id UUID;
    v_revision_count  INTEGER := 0;
    v_att             RECORD;
    v_is_owner        BOOLEAN;
    v_task_created_by UUID;
    v_task_manager_id UUID;
BEGIN
    SELECT company_id, current_stage_id, created_by, manager_id
    INTO   v_company_id, v_current_stage, v_task_created_by, v_task_manager_id
    FROM   public.tasks
    WHERE  id = p_task_id AND deleted_at IS NULL;

    IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
    IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

    v_is_owner := (SELECT COALESCE(is_owner, FALSE) FROM public.users WHERE id = v_user_id);

    IF p_assignment_id IS NULL THEN
        SELECT id INTO p_assignment_id
        FROM public.task_assignments
        WHERE task_id = p_task_id
          AND (
            assignee_user_id = v_user_id
            OR assignee_team_id IN (
                SELECT team_id FROM public.team_members WHERE user_id = v_user_id AND removed_at IS NULL
            )
          )
        LIMIT 1;
    END IF;

    IF p_assignment_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.task_assignments
            WHERE id = p_assignment_id AND task_id = p_task_id
              AND (
                assignee_user_id = v_user_id
                OR assignee_team_id IN (
                    SELECT team_id FROM public.team_members WHERE user_id = v_user_id AND removed_at IS NULL
                )
              )
        ) THEN
            RAISE EXCEPTION 'Forbidden: Assignment does not belong to user or task.' USING ERRCODE = '42501';
        END IF;
    ELSE
        IF NOT (v_is_owner OR v_task_manager_id = v_user_id OR v_task_created_by = v_user_id) THEN
            RAISE EXCEPTION 'Forbidden: You must be assigned to this task to submit work.' USING ERRCODE = '42501';
        END IF;
    END IF;

    SELECT COALESCE(MAX(revision_count), 0) + 1 INTO v_revision_count
    FROM public.task_submissions
    WHERE task_id = p_task_id
      AND (p_assignment_id IS NULL OR assignment_id = p_assignment_id);

    UPDATE public.task_work_sessions
    SET status = 'completed', last_heartbeat_at = now()
    WHERE task_id = p_task_id AND user_id = v_user_id AND status = 'active';

    INSERT INTO public.task_submissions (
        task_id, company_id, submitted_by, assignment_id,
        content, stage_id, status, revision_count
    )
    VALUES (
        p_task_id, v_company_id, v_user_id, p_assignment_id,
        p_content, v_current_stage, 'pending', v_revision_count
    )
    RETURNING id INTO v_submission_id;

    IF p_attachments IS NOT NULL AND jsonb_array_length(p_attachments) > 0 THEN
        FOR v_att IN SELECT * FROM jsonb_to_recordset(p_attachments) AS x(
            file_name text, file_url text, file_size bigint,
            mime_type text, category text, storage_path text
        )
        LOOP
            INSERT INTO public.submission_attachments (
                submission_id, company_id, uploaded_by,
                file_name, file_url, file_size, mime_type, category, storage_path
            )
            VALUES (
                v_submission_id, v_company_id, v_user_id,
                v_att.file_name, v_att.file_url, v_att.file_size,
                v_att.mime_type, v_att.category, v_att.storage_path
            );
        END LOOP;
    END IF;

    IF p_transition_id IS NOT NULL THEN
        SELECT to_stage_id INTO v_target_stage_id
        FROM public.pipeline_stage_transitions WHERE id = p_transition_id;
        IF v_target_stage_id IS NOT NULL THEN
            PERFORM public.rpc_advance_stage(p_task_id, v_target_stage_id, v_submission_id);
        END IF;
    END IF;

    RETURN v_submission_id;
END;
$$;
