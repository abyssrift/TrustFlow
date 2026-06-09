CREATE OR REPLACE FUNCTION public.rpc_advance_stage(p_task_id uuid, p_to_stage_id uuid, p_submission_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id                UUID;
  v_user_id                   UUID := auth.uid();
  v_current_stage             UUID;
  v_from_stage_name           TEXT;
  v_to_stage_name             TEXT;
  v_pipeline_id               UUID;
  v_target_pipe_id            UUID;
  v_requires_sub              BOOLEAN;
  v_requires_att              BOOLEAN;
  v_is_terminal               BOOLEAN;
  v_linked_pipe               UUID;
  v_child_inherits_submission BOOLEAN;
  v_sub_content               TEXT;
  v_att_count                 INTEGER;
  v_child_id                  UUID;
  v_src_sub_id                UUID;
  v_new_sub_id                UUID;
  v_child_initial_stage       UUID;
BEGIN
  -- 1. Context & Authorization
  SELECT company_id, current_stage_id, pipeline_id
  INTO   v_company_id, v_current_stage, v_pipeline_id
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;
  
  -- Only enforce authorization check if v_user_id is not null (system operations are allowed)
  IF v_user_id IS NOT NULL AND v_company_id != public.my_company_id() THEN 
    RAISE EXCEPTION 'Unauthorized'; 
  END IF;

  -- 2. Requirement Enforcement
  -- Scope the requirement to the current stage, not the target stage.
  -- Skip enforcement for system/cron operations (where v_user_id IS NULL)
  SELECT requires_submission, requires_attachments INTO v_requires_sub, v_requires_att
  FROM public.pipeline_stages WHERE id = v_current_stage;

  IF v_user_id IS NOT NULL AND (COALESCE(v_requires_sub, FALSE) = TRUE OR COALESCE(v_requires_att, FALSE) = TRUE) THEN
    SELECT content INTO v_sub_content
    FROM public.task_submissions
    WHERE task_id = p_task_id
      AND stage_id = v_current_stage
      AND status IN ('pending', 'approved')
    ORDER BY submitted_at DESC LIMIT 1;

    SELECT COUNT(*) INTO v_att_count
    FROM public.submission_attachments
    WHERE submission_id IN (
      SELECT id FROM public.task_submissions
      WHERE task_id = p_task_id
        AND stage_id = v_current_stage
        AND status IN ('pending', 'approved')
    );

    IF COALESCE(v_requires_sub, FALSE) = TRUE AND (v_sub_content IS NULL OR btrim(v_sub_content) = '') AND v_att_count = 0 THEN
      RAISE EXCEPTION 'Stage advancement blocked: Mandatory evidence missing (Text or Attachments required).';
    END IF;

    IF COALESCE(v_requires_att, FALSE) = TRUE AND v_att_count = 0 THEN
      RAISE EXCEPTION 'Stage advancement blocked: Mandatory attachments missing.';
    END IF;
  END IF;

  -- 3. Transition path validation
  SELECT pipeline_id INTO v_target_pipe_id FROM public.pipeline_stages WHERE id = p_to_stage_id;

  -- Only validate transition paths for non-owner users. Skip for system/cron context.
  IF v_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND is_owner = TRUE) THEN
    IF v_pipeline_id = v_target_pipe_id THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.pipeline_stage_transitions
        WHERE from_stage_id = v_current_stage AND to_stage_id = p_to_stage_id
      ) THEN
        RAISE EXCEPTION 'Invalid stage transition path';
      END IF;
    END IF;
  END IF;

  -- 4. Update Task
  UPDATE public.tasks
  SET    current_stage_id = p_to_stage_id,
         pipeline_id      = v_target_pipe_id,
         updated_at       = NOW()
  WHERE  id = p_task_id;

  -- 5. History
  SELECT name INTO v_from_stage_name FROM public.pipeline_stages WHERE id = v_current_stage;
  SELECT name INTO v_to_stage_name   FROM public.pipeline_stages WHERE id = p_to_stage_id;

  INSERT INTO public.pipeline_stage_history (
    task_id, company_id, pipeline_id, from_stage_id, to_stage_id,
    transitioned_by, from_stage_name, to_stage_name, submission_id
  )
  VALUES (
    p_task_id, v_company_id, v_target_pipe_id, v_current_stage, p_to_stage_id,
    v_user_id, v_from_stage_name, v_to_stage_name, p_submission_id
  );

  -- 6. Post-Transition Hooks
  SELECT linked_pipeline_id, child_inherits_submission
  INTO   v_linked_pipe, v_child_inherits_submission
  FROM   public.pipeline_stages
  WHERE  id = p_to_stage_id;

  IF v_linked_pipe IS NOT NULL THEN
    SELECT public.spawn_recursive_task(p_task_id, v_linked_pipe) INTO v_child_id;

    -- Inherit parent submission into child if flag is set
    IF v_child_inherits_submission = TRUE AND v_child_id IS NOT NULL THEN
      -- Resolve source submission: explicit > most recent for this task
      v_src_sub_id := p_submission_id;
      IF v_src_sub_id IS NULL THEN
        SELECT id INTO v_src_sub_id
        FROM   public.task_submissions
        WHERE  task_id = p_task_id
          AND  status IN ('pending', 'approved')
        ORDER  BY submitted_at DESC
        LIMIT  1;
      END IF;

      IF v_src_sub_id IS NOT NULL THEN
        -- Resolve the child's initial stage
        SELECT id INTO v_child_initial_stage
        FROM   public.pipeline_stages
        WHERE  pipeline_id = v_linked_pipe AND is_initial = TRUE
        LIMIT  1;

        -- Copy submission to child
        INSERT INTO public.task_submissions (
          task_id, company_id, submitted_by,
          content, stage_id, status, revision_count
        )
        SELECT
          v_child_id,
          company_id,
          submitted_by,
          content,
          COALESCE(v_child_initial_stage, stage_id),
          'pending',
          1
        FROM public.task_submissions
        WHERE id = v_src_sub_id
        RETURNING id INTO v_new_sub_id;

        -- Copy attachments
        IF v_new_sub_id IS NOT NULL THEN
          INSERT INTO public.submission_attachments (
            submission_id, company_id, uploaded_by,
            file_name, file_url, file_size, mime_type, category, storage_path
          )
          SELECT
            v_new_sub_id,
            company_id,
            uploaded_by,
            file_name, file_url, file_size, mime_type, category, storage_path
          FROM public.submission_attachments
          WHERE submission_id = v_src_sub_id;
        END IF;
      END IF;
    END IF;
  END IF;

  SELECT is_terminal INTO v_is_terminal FROM public.pipeline_stages WHERE id = p_to_stage_id;
  IF v_is_terminal = TRUE THEN
    PERFORM public.fn_handle_task_handshake(p_task_id, p_to_stage_id);
  END IF;
END;
$function$;
