-- ============================================================
-- Fix: rpc_submit_work — replace rpc_stop_work(NULL, ...) crash
--
-- The previous version called rpc_stop_work(NULL, task_id, now()) as a
-- defensive "stop any active session" step. Passing NULL as p_session_id
-- caused the update to match 0 rows (WHERE id = NULL is never true), which
-- triggered the recovery INSERT with a NULL primary key → constraint violation.
--
-- Fix: replace with a direct UPDATE scoped to this user + task.
-- ============================================================

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

    -- Smart timer minimum time gate (only when transitioning stage)
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

    -- Stop any active session for this user+task.
    -- The frontend already calls stopWork() before submitting, so this is a defensive cleanup only.
    -- Using a direct UPDATE instead of rpc_stop_work(NULL, ...) to avoid the NULL-id crash path.
    UPDATE public.task_work_sessions
    SET status = 'completed',
        last_heartbeat_at = now()
    WHERE task_id = p_task_id
      AND user_id   = v_user_id
      AND status    = 'active';

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
