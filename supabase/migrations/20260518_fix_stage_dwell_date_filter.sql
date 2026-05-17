-- ====================================================================
-- Fix rpc_get_pipeline_stage_dwell — include in-progress dwells.
--
-- Previous approach used LAG on exits: only tasks that had LEFT a stage
-- within the window were counted. Tasks still sitting in a stage (the
-- majority) were invisible entirely.
--
-- New approach: LEAD on entries. For each row where to_stage_id IS NOT
-- NULL the task entered that stage at transitioned_at and left at the
-- next transition (next_at). If next_at IS NULL the task is still there,
-- so we use NOW(). A dwell is included if it overlaps the window
-- (entered <= p_to AND effective_exit >= p_from).
--
-- Also fixed:
--   - is_bottleneck was hardcoded FALSE (now: avg > 1.5x pipeline avg)
--   - is_terminal / terminal_type were missing from return columns
-- ====================================================================

DROP FUNCTION IF EXISTS public.rpc_get_pipeline_stage_dwell(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.rpc_get_pipeline_stage_dwell(uuid, date, date);

CREATE FUNCTION public.rpc_get_pipeline_stage_dwell(
  p_pipeline_id UUID,
  p_from        DATE,
  p_to          DATE
)
RETURNS TABLE (
  stage_id       UUID,
  stage_name     TEXT,
  stage_position INT,
  is_terminal    BOOLEAN,
  terminal_type  TEXT,
  avg_seconds    BIGINT,
  median_seconds BIGINT,
  p75_seconds    BIGINT,
  sample_count   BIGINT,
  reversal_count BIGINT,
  is_bottleneck  BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH transitions AS (
    SELECT
      psh.task_id,
      psh.to_stage_id,
      psh.transitioned_at,
      LEAD(psh.transitioned_at) OVER (
        PARTITION BY psh.task_id ORDER BY psh.transitioned_at
      ) AS next_at
    FROM public.pipeline_stage_history psh
    WHERE psh.pipeline_id = p_pipeline_id
  ),
  dwell_times AS (
    -- Each entry into a stage: duration ends at next transition or NOW().
    -- Include if the dwell overlaps the requested window.
    SELECT
      to_stage_id                                                             AS s_id,
      EXTRACT(EPOCH FROM (COALESCE(next_at, NOW()) - transitioned_at))::NUMERIC AS duration
    FROM transitions
    WHERE to_stage_id IS NOT NULL
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
$$;
