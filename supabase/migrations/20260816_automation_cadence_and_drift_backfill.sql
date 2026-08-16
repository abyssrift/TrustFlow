-- Issue #193 (corrected): rpc_process_automations() has actually been
-- scheduled and running since 2026-04-14 via a `pipeline-heartbeat` cron
-- job — but that job, and rpc_create_automation/rpc_update_automation,
-- were only ever created directly against prod, never captured in a
-- tracked migration (same class of gap as #200). Sections 1-2 backfill
-- those three objects verbatim (confirmed via pg_get_functiondef / cron.job
-- against prod) so a fresh environment actually has them — no behavior
-- change there.
--
-- Section 3 is the real fix: two per-automation UI controls
-- (check_interval_minutes = "Check Every", buffer_minutes = "Buffer
-- (minutes)") are saved by rpc_create_automation/rpc_update_automation and
-- shown in AutomationEditor.tsx, but rpc_process_automations() ignored
-- both — every automation was evaluated every cron tick (1 minute)
-- regardless of its configured interval, and an 'overdue' automation fired
-- the instant due_date < NOW() regardless of its configured buffer.

-- ─────────────────────────────────────────────────────────────
-- 1. Backfill: rpc_create_automation / rpc_update_automation
--    (verbatim from prod — pipeline_automation_params side table for
--    condition-specific params like buffer_minutes/idle_hours)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_create_automation(
  p_pipeline_id uuid,
  p_source_stage_id uuid,
  p_target_stage_id uuid,
  p_condition_type text,
  p_check_interval_minutes integer DEFAULT 60,
  p_priority integer DEFAULT 0,
  p_params jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id    UUID;
  v_user_id       UUID := auth.uid();
  v_automation_id UUID;
  v_key           TEXT;
  v_value         TEXT;
BEGIN
  SELECT company_id INTO v_company_id
  FROM public.pipelines WHERE id = p_pipeline_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Pipeline not found'; END IF;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  IF p_condition_type NOT IN ('overdue', 'idle', 'due_soon') THEN
    RAISE EXCEPTION 'Invalid condition type: %', p_condition_type;
  END IF;

  INSERT INTO public.pipeline_automations (
    pipeline_id, source_stage_id, target_stage_id,
    condition_type, check_interval_minutes, priority, is_active,
    company_id
  )
  VALUES (
    p_pipeline_id, p_source_stage_id, p_target_stage_id,
    p_condition_type, p_check_interval_minutes, p_priority, TRUE,
    v_company_id
  )
  RETURNING id INTO v_automation_id;

  FOR v_key, v_value IN SELECT * FROM jsonb_each_text(p_params)
  LOOP
    INSERT INTO public.pipeline_automation_params (automation_id, key, value)
    VALUES (v_automation_id, v_key, v_value);
  END LOOP;

  RETURN v_automation_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_update_automation(
  p_automation_id uuid,
  p_condition_type text DEFAULT NULL::text,
  p_check_interval_minutes integer DEFAULT NULL::integer,
  p_priority integer DEFAULT NULL::integer,
  p_is_active boolean DEFAULT NULL::boolean,
  p_params jsonb DEFAULT NULL::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_key        TEXT;
  v_value      TEXT;
BEGIN
  SELECT p.company_id INTO v_company_id
  FROM public.pipeline_automations a
  JOIN public.pipelines p ON p.id = a.pipeline_id
  WHERE a.id = p_automation_id;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Automation not found'; END IF;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  UPDATE public.pipeline_automations
  SET
    condition_type         = COALESCE(p_condition_type, condition_type),
    check_interval_minutes = COALESCE(p_check_interval_minutes, check_interval_minutes),
    priority                = COALESCE(p_priority, priority),
    is_active               = COALESCE(p_is_active, is_active),
    failure_count           = CASE WHEN p_is_active = TRUE THEN 0 ELSE failure_count END,
    updated_at              = NOW()
  WHERE id = p_automation_id;

  -- Replace params if provided
  IF p_params IS NOT NULL THEN
    DELETE FROM public.pipeline_automation_params WHERE automation_id = p_automation_id;
    FOR v_key, v_value IN SELECT * FROM jsonb_each_text(p_params)
    LOOP
      INSERT INTO public.pipeline_automation_params (automation_id, key, value)
      VALUES (p_automation_id, v_key, v_value);
    END LOOP;
  END IF;
END;
$function$;

-- ─────────────────────────────────────────────────────────────
-- 2. Backfill: pipeline-heartbeat cron job (same pattern as
--    20260701_rate_limits.sql / 20260715_stale_session_sweep.sql)
-- ─────────────────────────────────────────────────────────────
SELECT cron.unschedule('pipeline-heartbeat') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'pipeline-heartbeat'
);
SELECT cron.schedule(
  'pipeline-heartbeat',
  '* * * * *',
  $$SELECT public.rpc_process_automations()$$
);

-- ─────────────────────────────────────────────────────────────
-- 3. Fix: rpc_process_automations() now honours check_interval_minutes
--    (skip a rule until its own interval has elapsed since last_run_at,
--    then stamp last_run_at) and buffer_minutes (an 'overdue' automation
--    waits the configured buffer past due_date, not just due_date < NOW()).
--    Same signature — no new overload.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_process_automations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule           RECORD;
  v_task           RECORD;
  v_project        RECORD;
  v_buffer_minutes INTEGER;
BEGIN
  FOR v_rule IN
    SELECT a.*, p.subject_kind
    FROM   public.pipeline_automations a
    JOIN   public.pipelines p ON p.id = a.pipeline_id
    WHERE  a.is_active = TRUE
      AND  p.deleted_at IS NULL
    ORDER BY a.priority DESC, a.created_at ASC
  LOOP
    IF v_rule.last_run_at IS NOT NULL
       AND v_rule.last_run_at > NOW() - (v_rule.check_interval_minutes || ' minutes')::interval
    THEN
      CONTINUE;
    END IF;

    SELECT value::int INTO v_buffer_minutes
    FROM public.pipeline_automation_params
    WHERE automation_id = v_rule.id AND key = 'buffer_minutes';
    v_buffer_minutes := COALESCE(v_buffer_minutes, 0);

    IF v_rule.subject_kind = 'project' THEN
      FOR v_project IN
        SELECT pr.id, pr.company_id, pr.due_date
        FROM   public.projects pr
        WHERE  pr.current_stage_id = v_rule.source_stage_id
          AND  pr.deleted_at IS NULL
        LIMIT 100
      LOOP
        IF v_rule.condition_type = 'overdue'
           AND v_project.due_date < NOW() - (v_buffer_minutes || ' minutes')::interval
        THEN

          IF (SELECT COUNT(*) FROM public.automation_execution_log
              WHERE project_id = v_project.id AND automation_id = v_rule.id
                AND executed_at > NOW() - INTERVAL '1 hour') >= 3
          THEN
            UPDATE public.pipeline_automations SET is_active = FALSE WHERE id = v_rule.id;
            CONTINUE;
          END IF;

          INSERT INTO public.automation_execution_log(project_id, automation_id, stage_id, company_id)
          VALUES (v_project.id, v_rule.id, v_rule.target_stage_id, v_project.company_id);

          PERFORM public.rpc_advance_project_stage(v_project.id, v_rule.target_stage_id);
        END IF;
      END LOOP;

    ELSE
      -- Unchanged task branch, now with the same interval/buffer gating.
      FOR v_task IN
        SELECT t.id, t.company_id, t.due_date, t.updated_at
        FROM   public.tasks t
        WHERE  t.current_stage_id = v_rule.source_stage_id
          AND  t.deleted_at IS NULL
        LIMIT 100
      LOOP
        IF v_rule.condition_type = 'overdue'
           AND v_task.due_date < NOW() - (v_buffer_minutes || ' minutes')::interval
        THEN

          IF (SELECT COUNT(*) FROM public.automation_execution_log
              WHERE task_id = v_task.id AND automation_id = v_rule.id
                AND executed_at > NOW() - INTERVAL '1 hour') >= 3
          THEN
            UPDATE public.pipeline_automations SET is_active = FALSE WHERE id = v_rule.id;
            CONTINUE;
          END IF;

          INSERT INTO public.automation_execution_log(task_id, automation_id, stage_id, company_id)
          VALUES (v_task.id, v_rule.id, v_rule.target_stage_id, v_task.company_id);

          PERFORM public.rpc_advance_stage(v_task.id, v_rule.target_stage_id);
        END IF;
      END LOOP;
    END IF;

    UPDATE public.pipeline_automations SET last_run_at = NOW() WHERE id = v_rule.id;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 4. Overload guard — CREATE OR REPLACE with a changed argument list
--    ADDS a signature rather than replacing (20260802_drop_stale_stage_rpc_overloads.sql).
--    Fail the migration rather than discover it in the editor.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, count(*) AS n
    FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname IN ('rpc_process_automations', 'rpc_create_automation', 'rpc_update_automation')
    GROUP BY p.proname
  LOOP
    IF r.n <> 1 THEN
      RAISE EXCEPTION 'MIGRATION FAILED: % has % signatures, expected exactly 1', r.proname, r.n;
    END IF;
  END LOOP;
END;
$$;
