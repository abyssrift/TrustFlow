-- Multi-factor SLA risk in rpc_get_organizational_audit.
--
-- Previously the SLA risk list was a single signal: how long a task had sat in
-- its CURRENT stage vs. 1.5x that stage's historical average dwell. That is
-- deadline-blind and effort-blind, so a task legitimately allocated a long time
-- (e.g. 3 months of work due in 3 months) got flagged purely for sitting.
--
-- This replaces it with three normalised signals (100 = "at the line"):
--   * stall      -> elapsed_in_stage / (stage_avg * 1.5) * 100        (unchanged math)
--   * deadline   -> projected remaining time / calendar time left     (uses due_date +
--                   the sum of avg dwell of ALL downstream stages, not just current)
--   * over_budget-> logged effort / estimated budget, scaled by pipeline progress
--
-- The headline risk_percent = max of the available signals (worst-risk-wins),
-- capped at 99, and `reason` names the winning signal so the UI can tag it.
-- Only tasks that carry at least a due_date OR an estimated_hours qualify; a task
-- with neither is excluded (it has no plan to measure against).
--
-- Rebased on the LIVE prod definition (includes the 20260518 pipeline_name /
-- all-pipelines changes), NOT the 20260517 migration file.

CREATE OR REPLACE FUNCTION public.rpc_get_organizational_audit(
  p_pipeline_id   uuid    DEFAULT NULL,
  p_days          integer DEFAULT 30,
  p_team_id       uuid    DEFAULT NULL,
  p_worker_id     uuid    DEFAULT NULL,
  p_priority      text    DEFAULT NULL,
  p_project_id    uuid    DEFAULT NULL,
  p_date_start    timestamptz DEFAULT NULL,
  p_date_end      timestamptz DEFAULT NULL,
  p_auth_user_id  uuid    DEFAULT NULL,
  p_include_time_metrics boolean DEFAULT true,
  p_include_advanced     boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_start_date TIMESTAMPTZ;
  v_end_date   TIMESTAMPTZ;
  v_prev_start TIMESTAMPTZ;
  v_result     JSONB;
BEGIN
  v_company_id := COALESCE(
    public.my_company_id(),
    (SELECT company_id FROM public.users WHERE id = p_auth_user_id)
  );
  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'User does not belong to any company';
  END IF;

  IF p_date_start IS NOT NULL AND p_date_end IS NOT NULL THEN
    v_start_date := p_date_start;
    v_end_date   := p_date_end;
  ELSE
    v_end_date   := NOW();
    v_start_date := v_end_date - (p_days || ' days')::INTERVAL;
  END IF;
  v_prev_start := v_start_date - (v_end_date - v_start_date);

  WITH
  base_tasks AS (
    SELECT
      t.id,
      t.title,
      t.pipeline_id,
      t.project_id,
      t.current_stage_id,
      t.created_at,
      t.completed_at,
      t.priority,
      t.due_date,
      t.estimated_hours,
      t.start_date,
      ps.name          AS stage_name,
      ps.position      AS stage_position,
      ps.terminal_type
    FROM public.tasks t
    JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
    WHERE t.company_id  = v_company_id
      AND t.deleted_at  IS NULL
      AND t.created_at  >= v_start_date
      AND t.created_at  <= v_end_date
      AND (p_pipeline_id IS NULL OR t.pipeline_id  = p_pipeline_id)
      AND (p_project_id  IS NULL OR t.project_id   = p_project_id)
      AND (p_priority    IS NULL OR t.priority      = p_priority)
      AND (p_team_id IS NULL OR EXISTS (
            SELECT 1 FROM public.task_assignments ta
            WHERE ta.task_id = t.id AND ta.assignee_team_id = p_team_id))
      AND (p_worker_id IS NULL OR EXISTS (
            SELECT 1 FROM public.task_assignments ta
            WHERE ta.task_id = t.id AND ta.assignee_user_id = p_worker_id))
  ),
  task_rev_flag AS (
    SELECT
      ts.task_id,
      MAX(CASE WHEN ts.status IN ('needs_revision', 'rejected') THEN 1 ELSE 0 END) AS had_revision
    FROM public.task_submissions ts
    WHERE ts.company_id = v_company_id
    GROUP BY ts.task_id
  ),
  cur_kpi AS (
    SELECT
      COUNT(bt.id)                                                                    AS throughput,
      COALESCE(ROUND(
        COUNT(CASE WHEN bt.terminal_type = 'success' THEN 1 END)::NUMERIC /
        NULLIF(COUNT(bt.id), 0) * 100, 2), 0)                                        AS success_rate,
      COALESCE(ROUND(
        AVG(
          CASE WHEN bt.terminal_type IS NOT NULL AND bt.completed_at IS NOT NULL
               THEN EXTRACT(EPOCH FROM (bt.completed_at - bt.created_at)) / 60
               ELSE NULL END
        )
      , 2), 0)                                                                        AS avg_lead_time_minutes,
      COALESCE(ROUND(
        SUM(COALESCE(trf.had_revision, 0))::NUMERIC /
        NULLIF(COUNT(bt.id), 0) * 100, 2), 0)                                        AS revision_rate
    FROM base_tasks bt
    LEFT JOIN task_rev_flag trf ON trf.task_id = bt.id
  ),
  prev_kpi AS (
    SELECT
      COUNT(DISTINCT t.id)                                                            AS throughput,
      COALESCE(ROUND(
        COUNT(DISTINCT CASE WHEN ps.terminal_type = 'success' THEN t.id END)::NUMERIC /
        NULLIF(COUNT(DISTINCT t.id), 0) * 100, 2), 0)                                AS success_rate,
      COALESCE(ROUND(
        AVG(
          CASE WHEN ps.terminal_type IS NOT NULL AND t.completed_at IS NOT NULL
               THEN EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 60
               ELSE NULL END
        )
      , 2), 0)                                                                        AS avg_lead_time_minutes,
      COALESCE(ROUND(
        COUNT(DISTINCT CASE WHEN ts.revision_count > 0 THEN t.id END)::NUMERIC /
        NULLIF(COUNT(DISTINCT t.id), 0) * 100, 2), 0)                                AS revision_rate
    FROM public.tasks t
    JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
    LEFT JOIN public.task_submissions ts ON ts.task_id = t.id
    WHERE t.company_id = v_company_id
      AND t.deleted_at IS NULL
      AND t.created_at >= v_prev_start
      AND t.created_at  < v_start_date
      AND (p_pipeline_id IS NULL OR t.pipeline_id = p_pipeline_id)
  ),
  adv_kpi AS (
    SELECT
      COALESCE(ROUND(
        COUNT(CASE WHEN bt.terminal_type = 'success' THEN 1 END)::NUMERIC /
        NULLIF(COUNT(bt.id), 0) * 100, 1), 0)                                        AS flow_ratio,
      COALESCE(ROUND(
        COUNT(DISTINCT CASE WHEN COALESCE(trf.had_revision, 0) = 0 THEN bt.id END)::NUMERIC /
        NULLIF(COUNT(bt.id), 0) * 100, 1), 0)                                        AS first_pass_yield
    FROM base_tasks bt
    LEFT JOIN task_rev_flag trf ON trf.task_id = bt.id
  ),
  stage_transitions AS (
    SELECT
      psh.task_id,
      psh.to_stage_id     AS stage_id,
      psh.to_stage_name   AS stage_name,
      psh.transitioned_at AS entered_at,
      LEAD(psh.transitioned_at) OVER (
        PARTITION BY psh.task_id ORDER BY psh.transitioned_at
      )                   AS exited_at
    FROM public.pipeline_stage_history psh
    WHERE psh.company_id = v_company_id
      AND (p_pipeline_id IS NULL OR psh.pipeline_id = p_pipeline_id)
  ),
  stage_dur_agg AS (
    SELECT
      ps.id            AS stage_id,
      ps.name          AS stage_name,
      ps.position,
      pip.name         AS pipeline_name,
      COALESCE(ROUND(
        AVG(EXTRACT(EPOCH FROM (COALESCE(st.exited_at, NOW()) - st.entered_at)) / 86400
      )::NUMERIC, 2), 0) AS avg_duration_days
    FROM public.pipeline_stages ps
    JOIN public.pipelines pip
      ON  pip.id         = ps.pipeline_id
      AND pip.company_id = v_company_id
      AND pip.deleted_at IS NULL
    LEFT JOIN stage_transitions st
      ON  st.stage_id   = ps.id
      AND st.entered_at >= v_start_date
      AND st.entered_at <= v_end_date
    WHERE (p_pipeline_id IS NULL OR ps.pipeline_id = p_pipeline_id)
    GROUP BY ps.id, ps.name, ps.position, pip.name
  ),
  funnel_counts AS (
    SELECT
      ps.id            AS stage_id,
      ps.name          AS stage_name,
      ps.position,
      pip.name         AS pipeline_name,
      COUNT(bt.id)     AS task_count
    FROM public.pipeline_stages ps
    JOIN public.pipelines pip
      ON  pip.id         = ps.pipeline_id
      AND pip.company_id = v_company_id
      AND pip.deleted_at IS NULL
    LEFT JOIN base_tasks bt ON bt.current_stage_id = ps.id
    WHERE (p_pipeline_id IS NULL OR ps.pipeline_id = p_pipeline_id)
    GROUP BY ps.id, ps.name, ps.position, pip.name
  ),
  funnel_final AS (
    SELECT
      fc.stage_name,
      fc.pipeline_name,
      fc.position,
      fc.task_count,
      COALESCE(ROUND(
        fc.task_count::NUMERIC / NULLIF((SELECT SUM(task_count) FROM funnel_counts), 0), 4
      ), 0) AS completion_rate
    FROM funnel_counts fc
  ),
  stage_avg_dwell AS (
    SELECT
      stage_id,
      AVG(EXTRACT(EPOCH FROM (exited_at - entered_at))) AS avg_seconds,
      COUNT(*)                                          AS n   -- sample size
    FROM stage_transitions
    WHERE exited_at IS NOT NULL
      AND EXTRACT(EPOCH FROM (exited_at - entered_at)) >= 300
    GROUP BY stage_id
  ),
  latest_stage_entry AS (
    SELECT DISTINCT ON (psh.task_id)
      psh.task_id,
      psh.to_stage_id     AS stage_id,
      psh.transitioned_at AS entered_at
    FROM public.pipeline_stage_history psh
    WHERE psh.company_id = v_company_id
    ORDER BY psh.task_id, psh.transitioned_at DESC
  ),
  -- Non-terminal stage counts per pipeline, for pipeline-progress fraction.
  pipeline_stage_counts AS (
    SELECT
      ps.pipeline_id,
      COUNT(*) AS total_stages
    FROM public.pipeline_stages ps
    WHERE ps.terminal_type IS NULL
    GROUP BY ps.pipeline_id
  ),
  -- Active tasks that have a plan to measure against (due_date OR estimate).
  sla_candidates AS (
    SELECT
      bt.id,
      bt.title            AS task_number,
      bt.pipeline_id,
      bt.stage_name,
      bt.stage_position,
      bt.due_date,
      bt.estimated_hours,
      le.entered_at       AS stage_entered_at,
      EXTRACT(EPOCH FROM (NOW() - le.entered_at)) AS elapsed_in_stage,
      sad.avg_seconds     AS cur_stage_avg,
      sad.n               AS cur_stage_n
    FROM base_tasks bt
    JOIN latest_stage_entry le
      ON  le.task_id  = bt.id
      AND le.stage_id = bt.current_stage_id
    LEFT JOIN stage_avg_dwell sad ON sad.stage_id = bt.current_stage_id
    WHERE bt.terminal_type IS NULL
      AND (bt.due_date IS NOT NULL OR bt.estimated_hours IS NOT NULL)
  ),
  -- Expected wall-clock time still ahead: sum of avg dwell across every
  -- non-terminal stage the task has not reached yet (stages with no learned
  -- baseline contribute 0). Also counts those stages for the progress fraction.
  downstream_remaining AS (
    SELECT
      sc.id AS task_id,
      COALESCE(SUM(COALESCE(sad.avg_seconds, 0)), 0) AS downstream_seconds,
      COUNT(ps_all.id)                               AS downstream_count
    FROM sla_candidates sc
    LEFT JOIN public.pipeline_stages ps_all
      ON  ps_all.pipeline_id   = sc.pipeline_id
      AND ps_all.position      > sc.stage_position
      AND ps_all.terminal_type IS NULL
    LEFT JOIN stage_avg_dwell sad ON sad.stage_id = ps_all.id
    GROUP BY sc.id
  ),
  -- Actual effort logged against each candidate task.
  task_logged AS (
    SELECT
      tws.task_id,
      SUM(tws.total_seconds_spent) AS logged_seconds
    FROM public.task_work_sessions tws
    JOIN sla_candidates sc ON sc.id = tws.task_id
    GROUP BY tws.task_id
  ),
  -- Each signal normalised so 100 = "at the line".
  sla_scored AS (
    SELECT
      sc.id,
      sc.task_number,
      sc.stage_name,
      sc.due_date,
      sc.cur_stage_avg,
      -- 1) Stage stall. Only trusted when the stage baseline has >= 5 samples
      --    (avoids noisy small-sample averages). Dampened by deadline slack:
      --    full weight at/near the due date, ramping to a 0.4 floor for tasks
      --    30+ days out; no due_date keeps full weight (no slack to credit).
      CASE
        WHEN sc.cur_stage_avg > 0 AND COALESCE(sc.cur_stage_n, 0) >= 5
        THEN sc.elapsed_in_stage / (sc.cur_stage_avg * 1.5) * 100
             * CASE
                 WHEN sc.due_date IS NULL OR sc.due_date <= NOW() THEN 1.0
                 ELSE GREATEST(0.4, LEAST(1.0,
                   1 - (EXTRACT(EPOCH FROM (sc.due_date - NOW())) / 86400) / 30.0))
               END
        ELSE NULL END AS stall_pct,
      -- 2) Deadline breach: projected remaining time vs calendar time left
      CASE
        WHEN sc.due_date IS NULL          THEN NULL
        WHEN sc.due_date <= NOW()         THEN 999          -- already overdue
        ELSE (
          COALESCE(dr.downstream_seconds, 0)
          + GREATEST(COALESCE(sc.cur_stage_avg, 0) - sc.elapsed_in_stage, 0)
        ) / NULLIF(EXTRACT(EPOCH FROM (sc.due_date - NOW())), 0) * 100
      END AS deadline_pct,
      -- 3) Effort / budget overrun, scaled by how far through the pipeline it is
      CASE
        WHEN sc.estimated_hours IS NULL OR sc.estimated_hours <= 0 THEN NULL
        ELSE (COALESCE(tl.logged_seconds, 0) / (sc.estimated_hours * 3600))
             / NULLIF(
                 (psc.total_stages - dr.downstream_count)::NUMERIC
                 / NULLIF(psc.total_stages, 0), 0)
             * 100
      END AS effort_pct
    FROM sla_candidates sc
    LEFT JOIN downstream_remaining   dr  ON dr.task_id      = sc.id
    LEFT JOIN task_logged            tl  ON tl.task_id      = sc.id
    LEFT JOIN pipeline_stage_counts  psc ON psc.pipeline_id = sc.pipeline_id
  ),
  -- Signals capped BEFORE comparison so past-the-line magnitudes don't fight.
  -- Deadline / over_budget cap at 99; stall caps LOWER (85) so a pure stall is
  -- a secondary, non-critical signal and the 90s band is reserved for genuine
  -- deadline/budget breaches. NULL signals use -1 so they can never win; sub-
  -- line values stay comparable by real magnitude.
  sla_capped AS (
    SELECT
      ss.*,
      LEAST(COALESCE(ss.stall_pct,    -1), 85) AS stall_c,
      LEAST(COALESCE(ss.deadline_pct, -1), 99) AS deadline_c,
      LEAST(COALESCE(ss.effort_pct,   -1), 99) AS effort_c
    FROM sla_scored ss
  ),
  sla_risks AS (
    SELECT
      sc.id,
      sc.task_number,
      sc.stage_name,
      sc.due_date,
      ROUND(GREATEST(sc.stall_c, sc.deadline_c, sc.effort_c))::bigint AS risk_percent,
      CASE
        WHEN sc.deadline_pct IS NOT NULL
         AND sc.deadline_c >= sc.stall_c
         AND sc.deadline_c >= sc.effort_c THEN 'deadline'
        WHEN sc.effort_pct IS NOT NULL
         AND sc.effort_c >= sc.stall_c    THEN 'over_budget'
        ELSE 'stalled'
      END AS reason,
      ROUND(sc.cur_stage_avg)::bigint AS avg_seconds
    FROM sla_capped sc
    WHERE GREATEST(sc.stall_c, sc.deadline_c, sc.effort_c) >= 75  -- within 75% of the line
    -- Headline % is capped at 99, so breached tasks tie there. Break the tie by
    -- the TRUE uncapped severity so the worst offenders rank first and always
    -- make the top-10, rather than being ordered arbitrarily among the 99s.
    ORDER BY
      risk_percent DESC,
      GREATEST(
        COALESCE(sc.stall_pct,    -1),
        COALESCE(sc.deadline_pct, -1),
        COALESCE(sc.effort_pct,   -1)
      ) DESC
    LIMIT 10
  ),
  worker_eng AS (
    SELECT
      u.full_name,
      u.avatar_url,
      COUNT(ae.id) AS action_count
    FROM public.users u
    JOIN public.activity_events ae
      ON  ae.user_id     = u.id
      AND ae.company_id  = v_company_id
      AND ae.created_at >= v_start_date
      AND ae.created_at <= v_end_date
    WHERE u.company_id = v_company_id
    GROUP BY u.id, u.full_name, u.avatar_url
    HAVING COUNT(ae.id) > 0
  ),
  quality_wkr AS (
    SELECT
      u.full_name,
      u.avatar_url,
      COUNT(DISTINCT bt.id)                                                          AS total_tasks,
      COALESCE(ROUND(
        COUNT(DISTINCT CASE WHEN trf.had_revision = 1 THEN bt.id END)::NUMERIC /
        NULLIF(COUNT(DISTINCT bt.id), 0) * 100, 1), 0)                              AS revision_rate
    FROM public.users u
    JOIN public.task_assignments ta
      ON  ta.assignee_user_id = u.id
      AND ta.company_id       = v_company_id
    JOIN base_tasks bt  ON bt.id  = ta.task_id
    LEFT JOIN task_rev_flag trf ON trf.task_id = bt.id
    WHERE u.company_id = v_company_id
    GROUP BY u.id, u.full_name, u.avatar_url
    HAVING COUNT(DISTINCT bt.id) > 0
  ),
  worker_time_agg AS (
    SELECT
      u.id         AS user_id,
      u.full_name,
      u.avatar_url,
      COUNT(DISTINCT bt.id)                                                          AS task_count,
      COALESCE(ROUND(SUM(tws.total_seconds_spent)::NUMERIC / 3600, 2), 0)           AS total_hours,
      COALESCE(ROUND(
        CASE WHEN COUNT(DISTINCT bt.id) > 0
          THEN SUM(tws.total_seconds_spent)::NUMERIC / 3600 / COUNT(DISTINCT bt.id)
          ELSE 0 END, 2), 0)                                                         AS avg_hours_per_task,
      COALESCE(ROUND(
        COUNT(DISTINCT CASE WHEN trf.had_revision = 1 THEN bt.id END)::NUMERIC /
        NULLIF(COUNT(DISTINCT bt.id), 0) * 100, 1), 0)                              AS revision_rate
    FROM public.users u
    JOIN public.task_assignments ta
      ON  u.id           = ta.assignee_user_id
      AND ta.company_id  = v_company_id
    JOIN base_tasks bt ON bt.id = ta.task_id
    LEFT JOIN public.task_work_sessions tws
      ON  tws.task_id = bt.id
      AND tws.user_id = u.id
    LEFT JOIN task_rev_flag trf ON trf.task_id = bt.id
    WHERE u.company_id = v_company_id
    GROUP BY u.id, u.full_name, u.avatar_url
    HAVING COUNT(DISTINCT bt.id) > 0
  )

  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'company_name',    (SELECT name FROM public.companies WHERE id = v_company_id),
      'report_period',   jsonb_build_object('start', v_start_date, 'end', v_end_date),
      'filters_applied', jsonb_build_object(
        'pipeline', p_pipeline_id, 'team',    p_team_id,
        'worker',   p_worker_id,  'priority', p_priority,
        'project',  p_project_id
      )
    ),
    'current', (
      SELECT jsonb_build_object(
        'throughput',            ck.throughput,
        'success_rate',          ck.success_rate,
        'avg_lead_time_minutes', ck.avg_lead_time_minutes,
        'revision_rate',         ck.revision_rate
      ) FROM cur_kpi ck
    ),
    'comparison', (
      SELECT jsonb_build_object(
        'throughput',            pk.throughput,
        'success_rate',          pk.success_rate,
        'avg_lead_time_minutes', pk.avg_lead_time_minutes,
        'revision_rate',         pk.revision_rate
      ) FROM prev_kpi pk
    ),
    'radar_advanced', (
      SELECT jsonb_build_object(
        'flow_ratio',              ak.flow_ratio,
        'first_pass_yield',        ak.first_pass_yield,
        'automation_offload_rate', 0
      ) FROM adv_kpi ak
    ),
    'stage_duration_analysis', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'stage_name',        sda.stage_name,
          'pipeline_name',     sda.pipeline_name,
          'avg_duration_days', sda.avg_duration_days
        ) ORDER BY sda.pipeline_name, sda.position
      ) FROM stage_dur_agg sda
    ),
    'conversion_by_stage', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'stage_name',      ff.stage_name,
          'pipeline_name',   ff.pipeline_name,
          'task_count',      ff.task_count,
          'completion_rate', ff.completion_rate
        ) ORDER BY ff.pipeline_name, ff.position
      ) FROM funnel_final ff
    ),
    'sla_risks', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',           sr.id,
          'task_number',  sr.task_number,
          'stage_name',   sr.stage_name,
          'risk_percent', sr.risk_percent,
          'reason',       sr.reason,
          'due_date',     sr.due_date,
          'avg_seconds',  sr.avg_seconds
        )
      ) FROM sla_risks sr
    ),
    'worker_engagement', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'full_name',    we.full_name,
          'avatar_url',   we.avatar_url,
          'action_count', we.action_count
        ) ORDER BY we.action_count DESC
      ) FROM worker_eng we
    ),
    'quality_by_worker', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'full_name',     qw.full_name,
          'avatar_url',    qw.avatar_url,
          'revision_rate', qw.revision_rate,
          'total_tasks',   qw.total_tasks
        ) ORDER BY qw.revision_rate ASC
      ) FROM quality_wkr qw
    ),
    'worker_time_metrics', CASE WHEN p_include_time_metrics THEN (
      SELECT jsonb_agg(
        jsonb_build_object(
          'user_id',            wta.user_id,
          'full_name',          wta.full_name,
          'avatar_url',         wta.avatar_url,
          'task_count',         wta.task_count,
          'total_hours',        wta.total_hours,
          'avg_hours_per_task', wta.avg_hours_per_task,
          'revision_rate',      wta.revision_rate
        ) ORDER BY wta.total_hours DESC
      ) FROM worker_time_agg wta
    ) ELSE NULL END,
    'cost_metrics', CASE WHEN p_include_advanced THEN (
      SELECT jsonb_build_object(
        'total_hours',       COALESCE(ROUND(SUM(tws.total_seconds_spent)::NUMERIC / 3600, 2), 0),
        'avg_cost_per_task', COALESCE(ROUND(
          SUM(tws.total_seconds_spent)::NUMERIC / 3600 /
          NULLIF(COUNT(DISTINCT t.id), 0) * 50, 2), 0),
        'task_count',        COUNT(DISTINCT t.id)
      )
      FROM public.tasks t
      LEFT JOIN public.task_work_sessions tws ON tws.task_id = t.id
      WHERE t.company_id  = v_company_id
        AND t.deleted_at  IS NULL
        AND t.created_at >= v_start_date
        AND t.created_at <= v_end_date
        AND (p_pipeline_id IS NULL OR t.pipeline_id = p_pipeline_id)
    ) ELSE NULL END
  ) INTO v_result;

  RETURN v_result;
END;
$function$;
