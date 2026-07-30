-- Follow-up to 20260730_rpc_move_task_pipeline: three things a cross-pipeline
-- move broke that a same-pipeline stage advance never could.
--
-- 1. Active-timer guard. A session split across two boards mid-run is
--    unattributable, so refuse the move instead. Mirrors the board-delete
--    guard in 20260728_pipeline_delete_guard_and_user_removal_timers.
-- 2. The move's history row now has from_stage_id = NULL (from_stage_name is
--    kept for the audit text). The old value was a stage of the OLD board,
--    and rpc_get_pipeline_stage_dwell's reversal subquery compares
--    ps_from.position vs ps_to.position — since the destination is an initial
--    stage (position 0), every incoming move was being counted as a stage
--    reversal on the receiving board.
-- 3. rpc_get_pipeline_stage_dwell computed LEAD over history ALREADY filtered
--    to one pipeline_id. The move row is filed under the destination board, so
--    on the source board the task's last stage had no successor and
--    COALESCE(next_at, NOW()) kept that dwell growing forever — inflating the
--    source board's avg dwell and its is_bottleneck flag. LEAD now runs over
--    each task's full history; the pipeline filter moved to dwell_times, so a
--    departure closes the dwell without contributing an entry of its own.

CREATE OR REPLACE FUNCTION public.rpc_move_task_pipeline(
  p_task_id     uuid,
  p_pipeline_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID    := public.my_company_id();
  v_user_id    UUID    := auth.uid();
  v_is_owner   BOOLEAN := COALESCE((SELECT is_owner FROM public.users WHERE id = v_user_id), FALSE);
  v_task       RECORD;
  v_stage      RECORD;
  v_from_name  TEXT;
  v_timer_by   TEXT;
BEGIN
  SELECT id, company_id, pipeline_id, current_stage_id, created_by, manager_id, title
  INTO   v_task
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF v_task.id IS NULL OR v_task.company_id <> v_company_id THEN
    RAISE EXCEPTION 'Task not found';
  END IF;

  -- mirrors tasks_update_editable
  IF NOT (
    v_is_owner
    OR v_task.created_by = v_user_id
    OR v_task.manager_id = v_user_id
    OR public.has_permission('task.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to edit this task';
  END IF;

  -- mirrors pipelines_select
  IF NOT EXISTS (
    SELECT 1 FROM public.pipelines p
    WHERE  p.id = p_pipeline_id
      AND  p.company_id = v_company_id
      AND  p.deleted_at IS NULL
      AND (
        v_is_owner
        OR public.has_permission('system.view_all_data')
        OR p.visibility_permissions = '{}'::text[]
        OR EXISTS (
          SELECT 1 FROM public.user_roles ur
          WHERE ur.user_id    = v_user_id
            AND ur.company_id = v_company_id
            AND ur.revoked_at IS NULL
            AND (ur.role_id)::text = ANY (p.visibility_permissions)
        )
      )
  ) THEN
    RAISE EXCEPTION 'No access to that pipeline';
  END IF;

  IF v_task.pipeline_id IS NOT DISTINCT FROM p_pipeline_id THEN RETURN; END IF;

  -- Someone is timing this task right now: their session would end up banked
  -- against a stage on a board the task no longer sits in.
  SELECT COALESCE(u.full_name, 'Someone')
  INTO   v_timer_by
  FROM   public.task_work_sessions ws
  LEFT   JOIN public.users u ON u.id = ws.user_id
  WHERE  ws.task_id = p_task_id AND ws.status = 'active'
  LIMIT  1;

  IF v_timer_by IS NOT NULL THEN
    RAISE EXCEPTION 'Concurrency Lock: % has an active timer on "%". Stop it before moving this task.',
      v_timer_by, v_task.title;
  END IF;

  SELECT id, name INTO v_stage
  FROM   public.pipeline_stages
  WHERE  pipeline_id = p_pipeline_id
  ORDER  BY is_initial DESC NULLS LAST, position ASC
  LIMIT  1;

  IF v_stage.id IS NULL THEN
    RAISE EXCEPTION 'Target pipeline has no stages';
  END IF;

  SELECT name INTO v_from_name FROM public.pipeline_stages WHERE id = v_task.current_stage_id;

  UPDATE public.tasks
  SET    pipeline_id = p_pipeline_id, current_stage_id = v_stage.id, status = v_stage.name
  WHERE  id = p_task_id;

  INSERT INTO public.pipeline_stage_history (
    task_id, company_id, pipeline_id,
    from_stage_id, to_stage_id,
    transitioned_by, from_stage_name, to_stage_name
  )
  VALUES (
    p_task_id, v_company_id, p_pipeline_id,
    NULL, v_stage.id,   -- from_stage_id NULL: the prior stage is on another board
    v_user_id, v_from_name, v_stage.name
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_move_task_pipeline(uuid, uuid) TO authenticated;


CREATE OR REPLACE FUNCTION public.rpc_get_pipeline_stage_dwell(p_pipeline_id uuid, p_from date, p_to date)
 RETURNS TABLE(stage_id uuid, stage_name text, stage_position integer, is_terminal boolean, terminal_type text, avg_seconds bigint, median_seconds bigint, p75_seconds bigint, sample_count bigint, reversal_count bigint, is_bottleneck boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH transitions AS (
    -- LEAD spans the task's WHOLE history, not just this pipeline's slice, so a
    -- task moving to another board closes its dwell here instead of accruing
    -- against this board forever. Restricted to tasks that touched this board.
    SELECT
      psh.task_id,
      psh.pipeline_id,
      psh.to_stage_id,
      psh.transitioned_at,
      LEAD(psh.transitioned_at) OVER (
        PARTITION BY psh.task_id ORDER BY psh.transitioned_at
      ) AS next_at
    FROM public.pipeline_stage_history psh
    WHERE psh.task_id IN (
      SELECT h.task_id FROM public.pipeline_stage_history h WHERE h.pipeline_id = p_pipeline_id
    )
  ),
  dwell_times AS (
    -- Each entry into a stage: duration ends at next transition or NOW().
    -- Include if the dwell overlaps the requested window.
    SELECT
      to_stage_id                                                             AS s_id,
      EXTRACT(EPOCH FROM (COALESCE(next_at, NOW()) - transitioned_at))::NUMERIC AS duration
    FROM transitions
    WHERE pipeline_id = p_pipeline_id
      AND to_stage_id IS NOT NULL
      AND transitioned_at::DATE <= p_to
      AND COALESCE(next_at, NOW())::DATE >= p_from
      AND EXTRACT(EPOCH FROM (COALESCE(next_at, NOW()) - transitioned_at)) > 0
  ),
  stage_stats AS (
    SELECT
      ps.id,
      ps.name,
      ps.position,
      ps.is_terminal,
      ps.terminal_type,
      COALESCE(AVG(dt.duration), 0)::BIGINT                                           AS avg_sec,
      COALESCE(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY dt.duration), 0)::BIGINT  AS median_sec,
      COALESCE(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY dt.duration), 0)::BIGINT AS p75_sec,
      COUNT(dt.duration)::BIGINT                                                       AS sample_cnt,
      (SELECT COUNT(*)
       FROM   public.pipeline_stage_history psh2
       JOIN   public.pipeline_stages ps_from ON ps_from.id = psh2.from_stage_id
       JOIN   public.pipeline_stages ps_to   ON ps_to.id   = psh2.to_stage_id
       WHERE  psh2.pipeline_id  = p_pipeline_id
         AND  psh2.to_stage_id  = ps.id
         AND  ps_to.position    < ps_from.position
         AND  psh2.transitioned_at::DATE BETWEEN p_from AND p_to
      )::BIGINT                                                                        AS reversal_cnt
    FROM public.pipeline_stages ps
    LEFT JOIN dwell_times dt ON dt.s_id = ps.id
    WHERE ps.pipeline_id = p_pipeline_id
    GROUP BY ps.id, ps.name, ps.position, ps.is_terminal, ps.terminal_type
  ),
  pipeline_avg AS (
    SELECT AVG(NULLIF(avg_sec, 0)) AS avg_all
    FROM   stage_stats
  )
  SELECT
    ss.id,
    ss.name,
    ss.position,
    ss.is_terminal,
    ss.terminal_type,
    ss.avg_sec,
    ss.median_sec,
    ss.p75_sec,
    ss.sample_cnt,
    ss.reversal_cnt,
    (ss.avg_sec > 0
      AND pa.avg_all IS NOT NULL
      AND ss.avg_sec > pa.avg_all * 1.5
    )::BOOLEAN AS is_bottleneck
  FROM stage_stats ss
  CROSS JOIN pipeline_avg pa
  ORDER BY ss.position ASC;
END;
$function$;
