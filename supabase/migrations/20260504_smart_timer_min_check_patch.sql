-- ============================================================
-- Patch: Smart Timer Gate Fixes
-- 1. rpc_execute_stage_action — remove overly broad v_is_manager bypass
-- 2. rpc_submit_work — add LOW_TIMER_TIME gate (submit path bypassed entirely before)
-- ============================================================

-- ── Fix 1: rpc_execute_stage_action ──────────────────────────
-- Only change: remove "AND NOT v_is_manager" from the timer gate condition.
-- Managers acting as workers on timer-required stages must also declare time.
-- Review stages (REVIEWING, REVIEWING STAGE) have requires_timer=false so
-- managers performing review actions are unaffected.
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
    v_total_seconds        INTEGER;
    v_has_manual_entry     BOOLEAN;
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

    -- Smart timer minimum time gate
    -- Owners bypass. Managers and assignees do NOT bypass (fix: removed AND NOT v_is_manager).
    SELECT COALESCE(ps.requires_timer, false), COALESCE(ps.is_initial, false)
    INTO v_stage_requires_timer, v_stage_is_initial
    FROM public.pipeline_stages ps WHERE ps.id = v_task.current_stage_id;

    IF v_stage_requires_timer
       AND NOT v_stage_is_initial
       AND NOT v_is_owner
       AND (v_action.transition_id IS NOT NULL OR v_action.action_type = 'submit_work')
    THEN
        SELECT COALESCE(SUM(
            CASE
                WHEN status = 'completed' THEN COALESCE(total_seconds_spent, 0)
                WHEN status = 'active'    THEN EXTRACT(EPOCH FROM (now() - started_at))::INTEGER
                ELSE 0
            END
        ), 0) INTO v_total_seconds
        FROM public.task_work_sessions WHERE task_id = p_task_id;

        SELECT EXISTS(
            SELECT 1 FROM public.task_manual_time_entries
            WHERE task_id = p_task_id AND stage_id = v_task.current_stage_id AND user_id = v_user_id
        ) INTO v_has_manual_entry;

        IF v_total_seconds < 300 AND NOT v_has_manual_entry THEN
            RAISE EXCEPTION 'LOW_TIMER_TIME: Less than 5 minutes logged for this stage. Please declare your actual work hours before proceeding.'
            USING ERRCODE = 'P0001';
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

-- ── Fix 2: rpc_submit_work — add LOW_TIMER_TIME gate ─────────
-- The task detail page calls rpc_submit_work directly (bypassing
-- rpc_execute_stage_action), so the timer check must live here too.
-- Gate fires only when p_transition_id IS NOT NULL (actual stage move).
-- Only org owners bypass; managers no longer bypass.
CREATE OR REPLACE FUNCTION public.rpc_submit_work(
    p_task_id        UUID,
    p_content        TEXT         DEFAULT NULL,
    p_assignment_id  UUID         DEFAULT NULL,
    p_transition_id  UUID         DEFAULT NULL,
    p_attachments    JSONB        DEFAULT '[]'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_submission_id        UUID;
    v_company_id           UUID;
    v_user_id              UUID    := auth.uid();
    v_current_stage        UUID;
    v_target_stage_id      UUID;
    v_revision_count       INTEGER := 0;
    v_att                  RECORD;
    v_is_owner             BOOLEAN;
    v_task_created_by      UUID;
    v_task_manager_id      UUID;
    v_stage_requires_timer BOOLEAN;
    v_stage_is_initial     BOOLEAN;
    v_total_seconds        INTEGER;
    v_has_manual_entry     BOOLEAN;
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

    -- 1.5. Smart timer minimum time gate (only when transitioning stage)
    IF p_transition_id IS NOT NULL AND NOT v_is_owner THEN
        SELECT COALESCE(ps.requires_timer, FALSE), COALESCE(ps.is_initial, FALSE)
        INTO v_stage_requires_timer, v_stage_is_initial
        FROM public.pipeline_stages ps WHERE ps.id = v_current_stage;

        IF v_stage_requires_timer AND NOT v_stage_is_initial THEN
            SELECT COALESCE(SUM(
                CASE
                    WHEN status = 'completed' THEN COALESCE(total_seconds_spent, 0)
                    WHEN status = 'active'    THEN EXTRACT(EPOCH FROM (now() - started_at))::INTEGER
                    ELSE 0
                END
            ), 0) INTO v_total_seconds
            FROM public.task_work_sessions WHERE task_id = p_task_id;

            SELECT EXISTS(
                SELECT 1 FROM public.task_manual_time_entries
                WHERE task_id = p_task_id AND stage_id = v_current_stage AND user_id = v_user_id
            ) INTO v_has_manual_entry;

            IF v_total_seconds < 300 AND NOT v_has_manual_entry THEN
                RAISE EXCEPTION 'LOW_TIMER_TIME: Less than 5 minutes logged for this stage. Please declare your actual work hours before proceeding.'
                USING ERRCODE = 'P0001';
            END IF;
        END IF;
    END IF;

    SELECT COALESCE(MAX(revision_count), 0) + 1 INTO v_revision_count
    FROM public.task_submissions
    WHERE task_id = p_task_id
      AND (p_assignment_id IS NULL OR assignment_id = p_assignment_id);

    PERFORM public.rpc_stop_work(NULL, p_task_id, now());

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
