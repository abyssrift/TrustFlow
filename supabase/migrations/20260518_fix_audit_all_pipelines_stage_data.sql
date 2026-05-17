-- Fix: stage_dur_agg and funnel_counts in rpc_get_organizational_audit fell back
-- to the default pipeline when p_pipeline_id was NULL instead of spanning all pipelines.
-- Replace COALESCE(p_pipeline_id, <default_pipeline>) with an IS NULL OR equality check
-- plus an explicit JOIN to pipelines to keep company scoping correct.

CREATE OR REPLACE FUNCTION public.rpc_get_organizational_audit(
  p_pipeline_id          uuid    DEFAULT NULL,
  p_days                 integer DEFAULT 30,
  p_team_id              uuid    DEFAULT NULL,
  p_worker_id            uuid    DEFAULT NULL,
  p_priority             text    DEFAULT NULL,
  p_project_id           uuid    DEFAULT NULL,
  p_date_start           timestamptz DEFAULT NULL,
  p_date_end             timestamptz DEFAULT NULL,
  p_auth_user_id         uuid    DEFAULT NULL,
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
      ps.id   AS stage_id,
      ps.name AS stage_name,
      ps.position,
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
    GROUP BY ps.id, ps.name, ps.position
  ),
  funnel_counts AS (
    SELECT
      ps.id   AS stage_id,
      ps.name AS stage_name,
      ps.position,
      COUNT(bt.id) AS task_count
    FROM public.pipeline_stages ps
    JOIN public.pipelines pip
      ON  pip.id         = ps.pipeline_id
      AND pip.company_id = v_company_id
      AND pip.deleted_at IS NULL
    LEFT JOIN base_tasks bt ON bt.current_stage_id = ps.id
    WHERE (p_pipeline_id IS NULL OR ps.pipeline_id = p_pipeline_id)
    GROUP BY ps.id, ps.name, ps.position
  ),
  funnel_final AS (
    SELECT
      fc.stage_name,
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
      AVG(EXTRACT(EPOCH FROM (exited_at - entered_at))) AS avg_seconds
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
  sla_risks AS (
    SELECT
      bt.id,
      bt.title            AS task_number,
      bt.stage_name,
      LEAST(
        ROUND(
          EXTRACT(EPOCH FROM (NOW() - le.entered_at)) /
          NULLIF(sad.avg_seconds * 1.5, 0) * 100
        )::NUMERIC, 99
      ) AS risk_percent,
      ROUND(sad.avg_seconds)::bigint AS avg_seconds
    FROM base_tasks bt
    JOIN latest_stage_entry le
      ON  le.task_id  = bt.id
      AND le.stage_id = bt.current_stage_id
    JOIN stage_avg_dwell sad ON sad.stage_id = bt.current_stage_id
    WHERE bt.terminal_type IS NULL
      AND sad.avg_seconds > 0
      AND EXTRACT(EPOCH FROM (NOW() - le.entered_at)) > sad.avg_seconds * 1.5
    ORDER BY risk_percent DESC
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
          'avg_duration_days', sda.avg_duration_days
        ) ORDER BY sda.position
      ) FROM stage_dur_agg sda
    ),
    'conversion_by_stage', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'stage_name',      ff.stage_name,
          'task_count',      ff.task_count,
          'completion_rate', ff.completion_rate
        ) ORDER BY ff.position
      ) FROM funnel_final ff
    ),
    'sla_risks', (
      SELECT jsonb_agg(
        jsonb_build_object(
          'id',           sr.id,
          'task_number',  sr.task_number,
          'stage_name',   sr.stage_name,
          'risk_percent', sr.risk_percent,
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
