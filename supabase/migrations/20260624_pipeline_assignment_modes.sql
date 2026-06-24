-- Pipeline Assignment Modes: Round Robin & Smart auto-assignment.
-- Opt-in per pipeline via pipelines.assignment_mode (default 'manual' = today's behavior, unchanged).

-- ============================================================
-- Section 1: pipelines columns
-- ============================================================
ALTER TABLE public.pipelines
  ADD COLUMN assignment_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (assignment_mode IN ('manual', 'round_robin', 'smart')),
  ADD COLUMN assignment_pool_type TEXT NOT NULL DEFAULT 'users'
    CHECK (assignment_pool_type IN ('users', 'teams'));

-- ============================================================
-- Section 2: pipeline_stages column
-- ============================================================
ALTER TABLE public.pipeline_stages
  ADD COLUMN reassign_on_entry BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- Section 3: pipeline_assignment_pool table
-- ============================================================
CREATE TABLE public.pipeline_assignment_pool (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id      UUID NOT NULL REFERENCES public.pipelines(id) ON DELETE CASCADE,
  company_id       UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  member_user_id   UUID REFERENCES public.users(id) ON DELETE CASCADE,
  member_team_id   UUID REFERENCES public.teams(id) ON DELETE CASCADE,
  is_withdrawn     BOOLEAN NOT NULL DEFAULT false,
  last_assigned_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_assignment_pool_member_xor
    CHECK ((member_user_id IS NOT NULL) <> (member_team_id IS NOT NULL))
);
-- Both FKs CASCADE off pipelines/companies, so rpc_platform_delete_company needs no edit --
-- this table sweeps automatically on company/pipeline deletion, same as pipeline_stage_history.

CREATE UNIQUE INDEX pipeline_assignment_pool_user_uq
  ON public.pipeline_assignment_pool (pipeline_id, member_user_id)
  WHERE member_user_id IS NOT NULL;
CREATE UNIQUE INDEX pipeline_assignment_pool_team_uq
  ON public.pipeline_assignment_pool (pipeline_id, member_team_id)
  WHERE member_team_id IS NOT NULL;
CREATE INDEX pipeline_assignment_pool_pipeline_idx
  ON public.pipeline_assignment_pool (pipeline_id);

ALTER TABLE public.pipeline_assignment_pool ENABLE ROW LEVEL SECURITY;

CREATE POLICY "AssignmentPool: select by company" ON public.pipeline_assignment_pool
  FOR SELECT USING (company_id = public.my_company_id());
-- No INSERT/UPDATE/DELETE policy -- all writes go through SECURITY DEFINER RPCs below,
-- same convention as task_assignments.

-- ============================================================
-- Section 4: rpc_set_assignment_pool -- full replace of one member type's pool
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_set_assignment_pool(
  p_pipeline_id UUID,
  p_member_type TEXT,
  p_member_ids  UUID[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
BEGIN
  IF p_member_type NOT IN ('user', 'team') THEN
    RAISE EXCEPTION 'p_member_type must be ''user'' or ''team''';
  END IF;

  SELECT company_id INTO v_company_id
  FROM public.pipelines
  WHERE id = p_pipeline_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline not found';
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  IF p_member_type = 'user' THEN
    INSERT INTO public.pipeline_assignment_pool (pipeline_id, company_id, member_user_id)
    SELECT p_pipeline_id, v_company_id, uid
    FROM unnest(p_member_ids) AS uid
    ON CONFLICT (pipeline_id, member_user_id) WHERE member_user_id IS NOT NULL DO NOTHING;

    DELETE FROM public.pipeline_assignment_pool
    WHERE pipeline_id = p_pipeline_id
      AND member_user_id IS NOT NULL
      AND NOT (member_user_id = ANY(p_member_ids));
  ELSE
    INSERT INTO public.pipeline_assignment_pool (pipeline_id, company_id, member_team_id)
    SELECT p_pipeline_id, v_company_id, tid
    FROM unnest(p_member_ids) AS tid
    ON CONFLICT (pipeline_id, member_team_id) WHERE member_team_id IS NOT NULL DO NOTHING;

    DELETE FROM public.pipeline_assignment_pool
    WHERE pipeline_id = p_pipeline_id
      AND member_team_id IS NOT NULL
      AND NOT (member_team_id = ANY(p_member_ids));
  END IF;

  PERFORM public.log_event(
    v_company_id, v_user_id, 'pipeline', p_pipeline_id, 'pipeline.assignment_pool_updated',
    jsonb_build_object('member_type', p_member_type, 'count', COALESCE(array_length(p_member_ids, 1), 0))
  );
END;
$function$;

-- ============================================================
-- Section 5: rpc_set_pool_member_withdrawn -- withdraw/reinstate a single pool member
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_set_pool_member_withdrawn(
  p_pipeline_id  UUID,
  p_member_type  TEXT,
  p_member_id    UUID,
  p_is_withdrawn BOOLEAN
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_rows       INT;
BEGIN
  IF p_member_type NOT IN ('user', 'team') THEN
    RAISE EXCEPTION 'p_member_type must be ''user'' or ''team''';
  END IF;

  SELECT company_id INTO v_company_id
  FROM public.pipelines
  WHERE id = p_pipeline_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Pipeline not found';
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  IF p_member_type = 'user' THEN
    UPDATE public.pipeline_assignment_pool
    SET is_withdrawn = p_is_withdrawn
    WHERE pipeline_id = p_pipeline_id AND member_user_id = p_member_id;
  ELSE
    UPDATE public.pipeline_assignment_pool
    SET is_withdrawn = p_is_withdrawn
    WHERE pipeline_id = p_pipeline_id AND member_team_id = p_member_id;
  END IF;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'Pool member not found';
  END IF;

  PERFORM public.log_event(
    v_company_id, v_user_id, 'pipeline', p_pipeline_id,
    CASE WHEN p_is_withdrawn THEN 'pipeline.assignment_pool_member_withdrawn'
         ELSE 'pipeline.assignment_pool_member_reinstated' END,
    jsonb_build_object('member_type', p_member_type, 'member_id', p_member_id)
  );
END;
$function$;

-- ============================================================
-- Section 6: rpc_auto_assign_task -- the assignment engine
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_auto_assign_task(
  p_task_id UUID,
  p_mode    TEXT DEFAULT 'fill_if_empty'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_task            RECORD;
  v_assignment_mode TEXT;
  v_pool_type       TEXT;
  v_actor           UUID;
  v_margin          CONSTANT NUMERIC := 1.15;
  v_winner_pool_id  UUID;
  v_winner_user_id  UUID;
  v_winner_team_id  UUID;
BEGIN
  IF p_mode NOT IN ('fill_if_empty', 'reassign') THEN
    RAISE EXCEPTION 'p_mode must be ''fill_if_empty'' or ''reassign''';
  END IF;

  SELECT t.id, t.company_id, t.pipeline_id, t.created_by
  INTO v_task
  FROM public.tasks t
  WHERE t.id = p_task_id AND t.deleted_at IS NULL;

  IF v_task.id IS NULL THEN
    RETURN; -- task not found, nothing to do
  END IF;

  -- Mirrors rpc_advance_stage's pattern: only enforce the company check for real (non-system) callers.
  IF auth.uid() IS NOT NULL AND v_task.company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT p.assignment_mode, p.assignment_pool_type
  INTO v_assignment_mode, v_pool_type
  FROM public.pipelines p
  WHERE p.id = v_task.pipeline_id;

  IF v_assignment_mode IS NULL OR v_assignment_mode = 'manual' THEN
    RETURN; -- pipeline hasn't opted in
  END IF;

  IF p_mode = 'fill_if_empty' AND EXISTS (
    SELECT 1 FROM public.task_assignments WHERE task_id = p_task_id
  ) THEN
    RETURN; -- never clobber a manual pick made at creation time
  END IF;

  IF p_mode = 'reassign' THEN
    DELETE FROM public.task_assignments WHERE task_id = p_task_id;
  END IF;

  v_actor := COALESCE(auth.uid(), v_task.created_by);

  IF v_assignment_mode = 'round_robin' THEN
    WITH pool AS (
      SELECT pap.id AS pool_id, pap.member_user_id, pap.member_team_id, pap.last_assigned_at
      FROM public.pipeline_assignment_pool pap
      LEFT JOIN public.users u  ON u.id  = pap.member_user_id
      LEFT JOIN public.teams tm ON tm.id = pap.member_team_id
      WHERE pap.pipeline_id = v_task.pipeline_id
        AND pap.is_withdrawn = false
        AND ((v_pool_type = 'users' AND pap.member_user_id IS NOT NULL AND u.deleted_at IS NULL)
          OR (v_pool_type = 'teams' AND pap.member_team_id IS NOT NULL AND tm.deleted_at IS NULL))
    )
    SELECT pool_id, member_user_id, member_team_id
    INTO v_winner_pool_id, v_winner_user_id, v_winner_team_id
    FROM pool
    ORDER BY last_assigned_at ASC NULLS FIRST,
             member_user_id ASC NULLS LAST, member_team_id ASC NULLS LAST
    LIMIT 1;

  ELSIF v_assignment_mode = 'smart' THEN
    -- Tier 1: below-average points AND productivity clearing the pool average by v_margin.
    WITH pool AS (
      SELECT pap.id AS pool_id, pap.member_user_id, pap.member_team_id, pap.last_assigned_at
      FROM public.pipeline_assignment_pool pap
      LEFT JOIN public.users u  ON u.id  = pap.member_user_id
      LEFT JOIN public.teams tm ON tm.id = pap.member_team_id
      WHERE pap.pipeline_id = v_task.pipeline_id
        AND pap.is_withdrawn = false
        AND ((v_pool_type = 'users' AND pap.member_user_id IS NOT NULL AND u.deleted_at IS NULL)
          OR (v_pool_type = 'teams' AND pap.member_team_id IS NOT NULL AND tm.deleted_at IS NULL))
    ),
    points AS (
      SELECT pool.pool_id,
        COALESCE(SUM(CASE WHEN ps2.id IS NOT NULL THEN t2.weight ELSE 0 END), 0) AS weight_points
      FROM pool
      LEFT JOIN public.task_assignments ta2
        ON (pool.member_user_id IS NOT NULL AND ta2.assignee_user_id = pool.member_user_id)
        OR (pool.member_team_id IS NOT NULL AND ta2.assignee_team_id = pool.member_team_id)
      LEFT JOIN public.tasks t2
        ON t2.id = ta2.task_id AND t2.completed_at >= now() - interval '30 days'
      LEFT JOIN public.pipeline_stages ps2
        ON ps2.id = t2.current_stage_id AND ps2.terminal_type = 'success'
      GROUP BY pool.pool_id
    ),
    hours AS (
      SELECT pool.pool_id,
        COALESCE(SUM(ws.total_seconds_spent), 0) / 3600.0 AS active_hours
      FROM pool
      LEFT JOIN public.task_work_sessions ws
        ON ws.status = 'completed'
        AND ws.started_at >= now() - interval '30 days'
        AND (
          (pool.member_user_id IS NOT NULL AND ws.user_id = pool.member_user_id)
          OR (pool.member_team_id IS NOT NULL AND ws.user_id IN (
                SELECT tm2.user_id FROM public.team_members tm2
                WHERE tm2.team_id = pool.member_team_id AND tm2.removed_at IS NULL))
        )
      GROUP BY pool.pool_id
    ),
    scored AS (
      SELECT pool.pool_id, pool.member_user_id, pool.member_team_id, pool.last_assigned_at,
        COALESCE(points.weight_points, 0) AS weight_points,
        CASE WHEN COALESCE(hours.active_hours, 0) > 0
             THEN COALESCE(points.weight_points, 0) / hours.active_hours
             ELSE NULL END AS productivity
      FROM pool
      LEFT JOIN points ON points.pool_id = pool.pool_id
      LEFT JOIN hours  ON hours.pool_id  = pool.pool_id
    ),
    pool_avgs AS (
      SELECT AVG(weight_points) AS avg_points, AVG(productivity) AS avg_prod FROM scored
    )
    SELECT s.pool_id, s.member_user_id, s.member_team_id
    INTO v_winner_pool_id, v_winner_user_id, v_winner_team_id
    FROM scored s, pool_avgs a
    WHERE s.weight_points < a.avg_points
      AND s.productivity IS NOT NULL
      AND s.productivity >= a.avg_prod * v_margin
    ORDER BY s.productivity DESC, s.weight_points ASC, s.last_assigned_at ASC NULLS FIRST,
             s.member_user_id ASC NULLS LAST, s.member_team_id ASC NULLS LAST
    LIMIT 1;

    -- Tier 2/3 fallback: most-free candidate; ties broken by oldest last_assigned_at
    -- (i.e. plain round robin) -- one ORDER BY covers both fallback steps at once.
    IF v_winner_pool_id IS NULL THEN
      WITH pool AS (
        SELECT pap.id AS pool_id, pap.member_user_id, pap.member_team_id, pap.last_assigned_at
        FROM public.pipeline_assignment_pool pap
        LEFT JOIN public.users u  ON u.id  = pap.member_user_id
        LEFT JOIN public.teams tm ON tm.id = pap.member_team_id
        WHERE pap.pipeline_id = v_task.pipeline_id
          AND pap.is_withdrawn = false
          AND ((v_pool_type = 'users' AND pap.member_user_id IS NOT NULL AND u.deleted_at IS NULL)
            OR (v_pool_type = 'teams' AND pap.member_team_id IS NOT NULL AND tm.deleted_at IS NULL))
      ),
      active_counts AS (
        SELECT pool.pool_id, pool.member_user_id, pool.member_team_id, pool.last_assigned_at,
          COUNT(s3.id) AS active_count
        FROM pool
        LEFT JOIN public.task_assignments ta3
          ON (pool.member_user_id IS NOT NULL AND ta3.assignee_user_id = pool.member_user_id)
          OR (pool.member_team_id IS NOT NULL AND ta3.assignee_team_id = pool.member_team_id)
        LEFT JOIN public.tasks ts
          ON ts.id = ta3.task_id AND ts.pipeline_id = v_task.pipeline_id
          AND ts.deleted_at IS NULL AND ts.id != p_task_id
        LEFT JOIN public.pipeline_stages s3
          ON s3.id = ts.current_stage_id AND s3.is_terminal = false
        GROUP BY pool.pool_id, pool.member_user_id, pool.member_team_id, pool.last_assigned_at
      )
      SELECT pool_id, member_user_id, member_team_id
      INTO v_winner_pool_id, v_winner_user_id, v_winner_team_id
      FROM active_counts
      ORDER BY active_count ASC, last_assigned_at ASC NULLS FIRST,
               member_user_id ASC NULLS LAST, member_team_id ASC NULLS LAST
      LIMIT 1;
    END IF;
  END IF;

  IF v_winner_pool_id IS NULL THEN
    RETURN; -- empty pool, nothing to assign
  END IF;

  INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assignee_team_id, assigned_by)
  VALUES (p_task_id, v_task.company_id, v_winner_user_id, v_winner_team_id, v_actor);

  UPDATE public.pipeline_assignment_pool
  SET last_assigned_at = now()
  WHERE id = v_winner_pool_id;

  PERFORM public.log_event(
    v_task.company_id, v_actor, 'task', p_task_id, 'task.auto_assigned',
    jsonb_build_object(
      'mode', v_assignment_mode, 'pool_type', v_pool_type,
      'assignee_user_id', v_winner_user_id, 'assignee_team_id', v_winner_team_id,
      'trigger', p_mode
    )
  );
END;
$function$;

-- ============================================================
-- Section 7: rpc_advance_stage -- hook reassign_on_entry
-- Same signature/body as production (20260609170000_allow_system_stage_advancement.sql),
-- with reassign_on_entry added to the existing destination-stage lookup and one new
-- final step. No DROP needed -- signature is unchanged.
-- ============================================================
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
  v_pipeline_id                UUID;
  v_target_pipe_id            UUID;
  v_requires_sub              BOOLEAN;
  v_requires_att              BOOLEAN;
  v_is_terminal               BOOLEAN;
  v_linked_pipe                UUID;
  v_child_inherits_submission BOOLEAN;
  v_reassign_on_entry          BOOLEAN;
  v_sub_content                TEXT;
  v_att_count                  INTEGER;
  v_child_id                   UUID;
  v_src_sub_id                 UUID;
  v_new_sub_id                 UUID;
  v_child_initial_stage        UUID;
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
  SELECT linked_pipeline_id, child_inherits_submission, reassign_on_entry
  INTO   v_linked_pipe, v_child_inherits_submission, v_reassign_on_entry
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

  -- 7. Assignment automation: re-route this task if the destination stage opted in.
  IF v_reassign_on_entry = TRUE THEN
    PERFORM public.rpc_auto_assign_task(p_task_id, 'reassign');
  END IF;
END;
$function$;

-- ============================================================
-- Section 8: rpc_update_pipeline -- extend the active 7-param overload to 9 params.
-- DROP first to avoid overload ambiguity (PostgREST resolves by exact signature).
-- Leaves the legacy 4-param overload untouched.
-- ============================================================
DROP FUNCTION IF EXISTS public.rpc_update_pipeline(uuid, text, text, boolean, text[], text, boolean);

CREATE OR REPLACE FUNCTION public.rpc_update_pipeline(
  p_pipeline_id            UUID,
  p_name                   TEXT    DEFAULT NULL,
  p_description            TEXT    DEFAULT NULL,
  p_is_default             BOOLEAN DEFAULT NULL,
  p_visibility_permissions TEXT[]  DEFAULT NULL,
  p_task_visibility_mode   TEXT    DEFAULT NULL,
  p_require_time_approval  BOOLEAN DEFAULT NULL,
  p_assignment_mode        TEXT    DEFAULT NULL,
  p_assignment_pool_type   TEXT    DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_company_id UUID;
    v_user_id    UUID := auth.uid();
BEGIN
    SELECT company_id INTO v_company_id
    FROM public.pipelines
    WHERE id = p_pipeline_id AND deleted_at IS NULL;

    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'Pipeline not found';
    END IF;

    IF v_company_id != public.my_company_id() THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    IF NOT (
        (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
        OR public.has_permission('pipeline.edit')
    ) THEN
        RAISE EXCEPTION 'Insufficient permissions to update pipelines';
    END IF;

    IF p_assignment_mode IS NOT NULL AND p_assignment_mode NOT IN ('manual', 'round_robin', 'smart') THEN
        RAISE EXCEPTION 'Invalid assignment_mode';
    END IF;

    IF p_assignment_pool_type IS NOT NULL AND p_assignment_pool_type NOT IN ('users', 'teams') THEN
        RAISE EXCEPTION 'Invalid assignment_pool_type';
    END IF;

    UPDATE public.pipelines
    SET
        name                   = COALESCE(p_name, name),
        description            = COALESCE(p_description, description),
        is_default             = COALESCE(p_is_default, is_default),
        visibility_permissions = COALESCE(p_visibility_permissions, visibility_permissions),
        task_visibility_mode   = COALESCE(p_task_visibility_mode, task_visibility_mode),
        require_time_approval  = COALESCE(p_require_time_approval, require_time_approval),
        assignment_mode        = COALESCE(p_assignment_mode, assignment_mode),
        assignment_pool_type   = COALESCE(p_assignment_pool_type, assignment_pool_type),
        updated_at             = NOW()
    WHERE id = p_pipeline_id;

    PERFORM public.log_event(
        v_company_id, v_user_id, 'pipeline', p_pipeline_id, 'pipeline.updated',
        jsonb_build_object(
            'name', p_name,
            'is_default', p_is_default,
            'require_time_approval', p_require_time_approval,
            'assignment_mode', p_assignment_mode,
            'assignment_pool_type', p_assignment_pool_type
        )
    );
END;
$function$;

-- ============================================================
-- Section 9: rpc_update_stage -- extend with p_reassign_on_entry (14th param).
-- ============================================================
DROP FUNCTION IF EXISTS public.rpc_update_stage(uuid, text, text, text, boolean, boolean, text, boolean, boolean, boolean, uuid, jsonb, integer);

CREATE OR REPLACE FUNCTION public.rpc_update_stage(
  p_stage_id           UUID,
  p_name               TEXT    DEFAULT NULL,
  p_color              TEXT    DEFAULT NULL,
  p_description        TEXT    DEFAULT NULL,
  p_is_initial         BOOLEAN DEFAULT NULL,
  p_is_terminal        BOOLEAN DEFAULT NULL,
  p_terminal_type      TEXT    DEFAULT NULL,
  p_requires_submission BOOLEAN DEFAULT NULL,
  p_requires_timer     BOOLEAN DEFAULT NULL,
  p_use_business_hours BOOLEAN DEFAULT NULL,
  p_linked_pipeline_id UUID    DEFAULT NULL,
  p_ui_metadata        JSONB   DEFAULT NULL,
  p_min_timer_seconds  INTEGER DEFAULT NULL,
  p_reassign_on_entry  BOOLEAN DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
        reassign_on_entry   = COALESCE(p_reassign_on_entry, reassign_on_entry),
        updated_at          = NOW()
    WHERE id = p_stage_id;
END;
$function$;
