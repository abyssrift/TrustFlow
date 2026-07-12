-- Assignment preview: surface a pipeline's auto-assignment mode and who it would
-- pick, at task-creation time. Extracts the selection logic out of
-- rpc_auto_assign_task into fn_pick_assignee so the preview and the real assign
-- share one algorithm (no drift), then adds the read-only preview RPC.

-- ============================================================
-- Section 1: fn_pick_assignee -- the shared selector (read-only)
-- Verbatim move of rpc_auto_assign_task's round_robin + smart selection.
-- p_exclude_task_id lets the caller exclude a task from the tier-2 active-load
-- count (the real assign passes its own task; preview passes NULL).
-- Private: callable only from the SECURITY DEFINER functions below.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_pick_assignee(
  p_pipeline_id     UUID,
  p_exclude_task_id UUID DEFAULT NULL
)
RETURNS TABLE (pool_id UUID, user_id UUID, team_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_assignment_mode TEXT;
  v_pool_type       TEXT;
  v_margin          CONSTANT NUMERIC := 1.15;
BEGIN
  SELECT p.assignment_mode, p.assignment_pool_type
  INTO v_assignment_mode, v_pool_type
  FROM public.pipelines p
  WHERE p.id = p_pipeline_id;

  IF v_assignment_mode IS NULL OR v_assignment_mode = 'manual' THEN
    RETURN; -- pipeline hasn't opted in
  END IF;

  IF v_assignment_mode = 'round_robin' THEN
    RETURN QUERY
    WITH pool AS (
      SELECT pap.id AS pool_id, pap.member_user_id, pap.member_team_id, pap.last_assigned_at
      FROM public.pipeline_assignment_pool pap
      LEFT JOIN public.users u  ON u.id  = pap.member_user_id
      LEFT JOIN public.teams tm ON tm.id = pap.member_team_id
      WHERE pap.pipeline_id = p_pipeline_id
        AND pap.is_withdrawn = false
        AND ((v_pool_type = 'users' AND pap.member_user_id IS NOT NULL AND u.deleted_at IS NULL)
          OR (v_pool_type = 'teams' AND pap.member_team_id IS NOT NULL AND tm.deleted_at IS NULL))
    )
    SELECT pool.pool_id, pool.member_user_id, pool.member_team_id
    FROM pool
    ORDER BY last_assigned_at ASC NULLS FIRST,
             member_user_id ASC NULLS LAST, member_team_id ASC NULLS LAST
    LIMIT 1;
    RETURN;
  END IF;

  -- smart -- Tier 1: below-average points AND productivity clearing the pool average by v_margin.
  RETURN QUERY
  WITH pool AS (
    SELECT pap.id AS pool_id, pap.member_user_id, pap.member_team_id, pap.last_assigned_at
    FROM public.pipeline_assignment_pool pap
    LEFT JOIN public.users u  ON u.id  = pap.member_user_id
    LEFT JOIN public.teams tm ON tm.id = pap.member_team_id
    WHERE pap.pipeline_id = p_pipeline_id
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
  FROM scored s, pool_avgs a
  WHERE s.weight_points < a.avg_points
    AND s.productivity IS NOT NULL
    AND s.productivity >= a.avg_prod * v_margin
  ORDER BY s.productivity DESC, s.weight_points ASC, s.last_assigned_at ASC NULLS FIRST,
           s.member_user_id ASC NULLS LAST, s.member_team_id ASC NULLS LAST
  LIMIT 1;

  IF FOUND THEN
    RETURN;
  END IF;

  -- Tier 2/3 fallback: most-free candidate; ties broken by oldest last_assigned_at
  -- (i.e. plain round robin) -- one ORDER BY covers both fallback steps at once.
  RETURN QUERY
  WITH pool AS (
    SELECT pap.id AS pool_id, pap.member_user_id, pap.member_team_id, pap.last_assigned_at
    FROM public.pipeline_assignment_pool pap
    LEFT JOIN public.users u  ON u.id  = pap.member_user_id
    LEFT JOIN public.teams tm ON tm.id = pap.member_team_id
    WHERE pap.pipeline_id = p_pipeline_id
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
      ON ts.id = ta3.task_id AND ts.pipeline_id = p_pipeline_id
      AND ts.deleted_at IS NULL AND (p_exclude_task_id IS NULL OR ts.id != p_exclude_task_id)
    LEFT JOIN public.pipeline_stages s3
      ON s3.id = ts.current_stage_id AND s3.is_terminal = false
    GROUP BY pool.pool_id, pool.member_user_id, pool.member_team_id, pool.last_assigned_at
  )
  SELECT active_counts.pool_id, active_counts.member_user_id, active_counts.member_team_id
  FROM active_counts
  ORDER BY active_count ASC, last_assigned_at ASC NULLS FIRST,
           member_user_id ASC NULLS LAST, member_team_id ASC NULLS LAST
  LIMIT 1;
END;
$function$;

-- Private helper: keep it off PostgREST. The SECURITY DEFINER callers below run
-- as the owner and can still call it; direct API access is blocked.
REVOKE EXECUTE ON FUNCTION public.fn_pick_assignee(UUID, UUID) FROM PUBLIC;

-- ============================================================
-- Section 2: rpc_auto_assign_task -- now delegates selection to fn_pick_assignee.
-- Identical behavior; only the two inline CTE blocks are replaced by the call.
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

  SELECT fp.pool_id, fp.user_id, fp.team_id
  INTO v_winner_pool_id, v_winner_user_id, v_winner_team_id
  FROM public.fn_pick_assignee(v_task.pipeline_id, p_task_id) fp;

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
-- Section 3: rpc_preview_task_assignee -- read-only preview for the create-task UI.
-- Returns the pipeline's mode and, for round_robin/smart, who is next in line.
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_preview_task_assignee(p_pipeline_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_mode       TEXT;
  v_pool_type  TEXT;
  v_pool_size  INT;
  v_user_id    UUID;
  v_team_id    UUID;
  v_name       TEXT;
BEGIN
  SELECT company_id, assignment_mode, assignment_pool_type
  INTO v_company_id, v_mode, v_pool_type
  FROM public.pipelines
  WHERE id = p_pipeline_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN
    RETURN jsonb_build_object('mode', 'manual');
  END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF v_mode IS NULL OR v_mode = 'manual' THEN
    RETURN jsonb_build_object('mode', 'manual');
  END IF;

  SELECT COUNT(*) INTO v_pool_size
  FROM public.pipeline_assignment_pool pap
  LEFT JOIN public.users u  ON u.id  = pap.member_user_id
  LEFT JOIN public.teams tm ON tm.id = pap.member_team_id
  WHERE pap.pipeline_id = p_pipeline_id
    AND pap.is_withdrawn = false
    AND ((v_pool_type = 'users' AND pap.member_user_id IS NOT NULL AND u.deleted_at IS NULL)
      OR (v_pool_type = 'teams' AND pap.member_team_id IS NOT NULL AND tm.deleted_at IS NULL));

  SELECT fp.user_id, fp.team_id INTO v_user_id, v_team_id
  FROM public.fn_pick_assignee(p_pipeline_id, NULL) fp;

  IF v_user_id IS NOT NULL THEN
    SELECT full_name INTO v_name FROM public.users WHERE id = v_user_id;
  ELSIF v_team_id IS NOT NULL THEN
    SELECT name INTO v_name FROM public.teams WHERE id = v_team_id;
  END IF;

  RETURN jsonb_build_object(
    'mode', v_mode,
    'pool_type', v_pool_type,
    'pool_size', v_pool_size,
    'assignee_user_id', v_user_id,
    'assignee_team_id', v_team_id,
    'assignee_name', v_name
  );
END;
$function$;
