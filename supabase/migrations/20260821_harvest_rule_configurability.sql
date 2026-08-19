-- Issue #284, Phase 3: configurability -- stage_terminal_success condition,
-- rule CRUD RPCs, backfill, and the (currently inert) cron processor.
--
-- Full plan: C:\Users\j\.claude\plans\recursive-skipping-treasure.md
-- Depends on 20260821_harvest_rule_cascade_fix.sql landing first (rule
-- deletion must not cascade-delete already-delivered files).
--
-- Permission gate for all rule-authoring RPCs mirrors rpc_create_automation
-- / rpc_update_automation / rpc_delete_automation (own current bodies read
-- via pg_get_functiondef against local docker before writing this): is_owner
-- OR has_permission('pipeline.edit') -- the same gate the OLD
-- harvests_to_deliverable toggle used via rpc_update_stage.
--
-- rpc_delete_automation's real body (confirmed, not guessed) is a plain hard
-- DELETE FROM pipeline_automations -- no soft-disable. rpc_delete_harvest_rule
-- mirrors that exactly: a hard DELETE FROM harvest_rules. Safe now that
-- harvested_files.harvest_rule_id is ON DELETE SET NULL (previous migration)
-- -- already-delivered files survive with provenance cleared, not deleted.

-- ============================================================
-- Section 1: widen harvest_rules.condition_type CHECK
-- ============================================================
-- 'stage_terminal_success' = is_terminal AND terminal_type = 'success', the
-- exact idiom already used throughout this codebase (e.g.
-- 20260805_project_notifications.sql, 20260806_project_needs_attention.sql,
-- the SLA-risk views) for "this task/project is done". Per the plan's
-- Phase 0 decision, 'field_equals' is NOT added here -- it stays a
-- nonexistent value, not even a disabled UI placeholder (that distinction
-- is the UI layer's job in a later phase, not this CHECK's).
ALTER TABLE public.harvest_rules
  DROP CONSTRAINT ck_harvest_rules_condition_type;
ALTER TABLE public.harvest_rules
  ADD CONSTRAINT ck_harvest_rules_condition_type
  CHECK (condition_type IN ('stage_entry', 'stage_terminal_success'));

-- ============================================================
-- Section 2: stage-entry trigger -- also fire on stage_terminal_success
-- ============================================================
-- Same trigger definition (AFTER UPDATE OF current_stage_id, same WHEN
-- clause on tasks) -- only the function body changes. Was: match
-- condition_type = 'stage_entry' AND source_stage_id = NEW.current_stage_id
-- only. Now: OR a second branch matching condition_type =
-- 'stage_terminal_success' whose source_stage_id is either NULL ("any
-- terminal-success stage on this pipeline") or pinned to this exact stage,
-- AND the stage actually entered is terminal-success. Both branches can
-- match the same trigger invocation (a task can satisfy a stage_entry rule
-- and a stage_terminal_success rule at once if the entered stage is both a
-- specifically-targeted stage_entry source AND terminal-success) -- this is
-- one OR'd condition in the same rule-matching query, not a second trigger,
-- and Phase 2's fan-out (every matching active rule fires, not one winner)
-- applies unchanged.
CREATE OR REPLACE FUNCTION public.fn_trg_harvest_task_on_stage_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    r                     RECORD;
    v_is_terminal_success BOOLEAN;
BEGIN
    SELECT COALESCE(is_terminal, FALSE) AND terminal_type = 'success'
      INTO v_is_terminal_success
    FROM public.pipeline_stages
    WHERE id = NEW.current_stage_id;

    FOR r IN
        SELECT hr.id
        FROM public.harvest_rules hr
        WHERE hr.is_active = TRUE
          AND hr.pipeline_id = NEW.pipeline_id
          AND (
            (hr.condition_type = 'stage_entry' AND hr.source_stage_id = NEW.current_stage_id)
            OR (
              hr.condition_type = 'stage_terminal_success'
              AND (hr.source_stage_id IS NULL OR hr.source_stage_id = NEW.current_stage_id)
              AND COALESCE(v_is_terminal_success, FALSE)
            )
          )
    LOOP
        PERFORM public.fn_harvest_task_output(NEW.id, r.id);
    END LOOP;
    RETURN NEW;
END;
$$;

-- ============================================================
-- Section 3: rule CRUD RPCs
-- ============================================================

-- rpc_create_harvest_rule -- validates condition_type against the same
-- allowlist the CHECK enforces (a clean RAISE EXCEPTION instead of a raw
-- constraint-violation for a decent UI error), validates source_stage_id
-- belongs to the pipeline when given, and validates destination_folder_id
-- belongs to the same company when given (trust-boundary check: nothing
-- above this RPC has confirmed that yet). stage_entry requires a
-- source_stage_id (there is no DB CHECK for this -- harvest_rules has no
-- direct INSERT policy, all writes route through this RPC, so the
-- validation belongs here, matching how condition_type itself is enforced).
CREATE OR REPLACE FUNCTION public.rpc_create_harvest_rule(
  p_pipeline_id uuid,
  p_condition_type text,
  p_source_stage_id uuid DEFAULT NULL,
  p_destination_folder_id uuid DEFAULT NULL,
  p_check_interval_minutes int DEFAULT 60
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_rule_id    UUID;
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

  IF p_condition_type NOT IN ('stage_entry', 'stage_terminal_success') THEN
    RAISE EXCEPTION 'Invalid condition type: %', p_condition_type;
  END IF;

  IF p_condition_type = 'stage_entry' AND p_source_stage_id IS NULL THEN
    RAISE EXCEPTION 'stage_entry rules require a source stage';
  END IF;

  IF p_source_stage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE id = p_source_stage_id AND pipeline_id = p_pipeline_id
  ) THEN
    RAISE EXCEPTION 'Stage does not belong to this pipeline';
  END IF;

  IF p_destination_folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.filehub_folders
    WHERE id = p_destination_folder_id AND company_id = v_company_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Destination folder not found';
  END IF;

  INSERT INTO public.harvest_rules (
    company_id, pipeline_id, source_stage_id, condition_type,
    destination_folder_id, check_interval_minutes, created_by
  )
  VALUES (
    v_company_id, p_pipeline_id, p_source_stage_id, p_condition_type,
    p_destination_folder_id, p_check_interval_minutes, v_user_id
  )
  RETURNING id INTO v_rule_id;

  RETURN v_rule_id;
END;
$$;

-- rpc_update_harvest_rule -- COALESCE-based partial update, same pattern as
-- rpc_update_automation. Same caveat that pattern already has for
-- pipeline_automations.target_stage_id: a NULL argument means "leave
-- unchanged", so this cannot be used to CLEAR destination_folder_id back to
-- the dynamic-fallback default or to null out source_stage_id -- delete and
-- recreate the rule for that today. Flagged as a judgment call, not silently
-- shipped as a hidden gap.
CREATE OR REPLACE FUNCTION public.rpc_update_harvest_rule(
  p_rule_id uuid,
  p_condition_type text DEFAULT NULL,
  p_source_stage_id uuid DEFAULT NULL,
  p_destination_folder_id uuid DEFAULT NULL,
  p_check_interval_minutes int DEFAULT NULL,
  p_is_active boolean DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id  UUID;
  v_user_id     UUID := auth.uid();
  v_pipeline_id UUID;
  v_final_type  TEXT;
  v_final_stage UUID;
BEGIN
  SELECT p.company_id, hr.pipeline_id INTO v_company_id, v_pipeline_id
  FROM public.harvest_rules hr
  JOIN public.pipelines p ON p.id = hr.pipeline_id
  WHERE hr.id = p_rule_id;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Harvest rule not found'; END IF;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  IF p_condition_type IS NOT NULL AND p_condition_type NOT IN ('stage_entry', 'stage_terminal_success') THEN
    RAISE EXCEPTION 'Invalid condition type: %', p_condition_type;
  END IF;

  IF p_source_stage_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.pipeline_stages
    WHERE id = p_source_stage_id AND pipeline_id = v_pipeline_id
  ) THEN
    RAISE EXCEPTION 'Stage does not belong to this pipeline';
  END IF;

  IF p_destination_folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.filehub_folders
    WHERE id = p_destination_folder_id AND company_id = v_company_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Destination folder not found';
  END IF;

  -- Resolve what condition_type/source_stage_id will be AFTER this update
  -- to guard the same stage_entry-requires-a-stage invariant create enforces.
  SELECT COALESCE(p_condition_type, condition_type), COALESCE(p_source_stage_id, source_stage_id)
    INTO v_final_type, v_final_stage
  FROM public.harvest_rules WHERE id = p_rule_id;

  IF v_final_type = 'stage_entry' AND v_final_stage IS NULL THEN
    RAISE EXCEPTION 'stage_entry rules require a source stage';
  END IF;

  UPDATE public.harvest_rules
  SET
    condition_type          = COALESCE(p_condition_type, condition_type),
    source_stage_id         = COALESCE(p_source_stage_id, source_stage_id),
    destination_folder_id   = COALESCE(p_destination_folder_id, destination_folder_id),
    check_interval_minutes  = COALESCE(p_check_interval_minutes, check_interval_minutes),
    is_active                = COALESCE(p_is_active, is_active),
    updated_at               = NOW()
  WHERE id = p_rule_id;
END;
$$;

-- rpc_delete_harvest_rule -- mirrors rpc_delete_automation's actual body
-- verbatim in shape: a hard DELETE, no soft-disable. harvested_files rows
-- this rule produced survive (harvest_rule_id -> NULL via the cascade fix
-- migration); automation_execution_log rows for this rule DO cascade-delete
-- (that FK was left as ON DELETE CASCADE -- it's an audit trail entry about
-- the rule's own execution, not delivered content, so losing it alongside
-- the rule is correct and outside this issue's cascade-correction scope).
CREATE OR REPLACE FUNCTION public.rpc_delete_harvest_rule(p_rule_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
BEGIN
  SELECT p.company_id INTO v_company_id
  FROM public.harvest_rules hr
  JOIN public.pipelines p ON p.id = hr.pipeline_id
  WHERE hr.id = p_rule_id;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Harvest rule not found'; END IF;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  DELETE FROM public.harvest_rules WHERE id = p_rule_id;
END;
$$;

-- ============================================================
-- Section 4: rpc_backfill_harvest_rule -- bounded, explicit, user-invoked
-- ============================================================
-- Per the plan: a single BOUNDED pass (LIMIT 100, mirroring
-- rpc_process_automations' own LIMIT-per-loop convention) over tasks
-- currently satisfying the rule's condition that haven't already been
-- harvested BY THIS RULE, calling fn_harvest_task_output for each. Returns
-- the count of tasks it touched (processed within the bound -- NOT
-- necessarily the count that produced a new harvested_files row, since a
-- task with no attachments on its latest submission is a harmless no-op
-- inside fn_harvest_task_output, same as the trigger path).
--
-- "Not already harvested by this rule": harvested_files.harvest_rule_id +
-- source_task_id is the exact pair fn_harvest_task_output stamps together,
-- so a NOT EXISTS on that pair is idempotent across repeated calls without
-- needing to re-resolve each task's destination folder just to check.
CREATE OR REPLACE FUNCTION public.rpc_backfill_harvest_rule(p_rule_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_rule       RECORD;
  v_task       RECORD;
  v_touched    INTEGER := 0;
BEGIN
  SELECT hr.*, p.company_id AS pipeline_company_id INTO v_rule
  FROM public.harvest_rules hr
  JOIN public.pipelines p ON p.id = hr.pipeline_id
  WHERE hr.id = p_rule_id;

  IF v_rule.id IS NULL THEN RAISE EXCEPTION 'Harvest rule not found'; END IF;
  v_company_id := v_rule.pipeline_company_id;
  IF v_company_id != public.my_company_id() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.edit')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  IF v_rule.condition_type = 'stage_entry' THEN
    FOR v_task IN
      SELECT t.id
      FROM public.tasks t
      WHERE t.pipeline_id = v_rule.pipeline_id
        AND t.current_stage_id = v_rule.source_stage_id
        AND t.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.harvested_files hf
          WHERE hf.harvest_rule_id = p_rule_id AND hf.source_task_id = t.id
        )
      LIMIT 100
    LOOP
      PERFORM public.fn_harvest_task_output(v_task.id, p_rule_id);
      v_touched := v_touched + 1;
    END LOOP;

  ELSIF v_rule.condition_type = 'stage_terminal_success' THEN
    FOR v_task IN
      SELECT t.id
      FROM public.tasks t
      JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
      WHERE t.pipeline_id = v_rule.pipeline_id
        AND (v_rule.source_stage_id IS NULL OR t.current_stage_id = v_rule.source_stage_id)
        AND ps.is_terminal AND ps.terminal_type = 'success'
        AND t.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.harvested_files hf
          WHERE hf.harvest_rule_id = p_rule_id AND hf.source_task_id = t.id
        )
      LIMIT 100
    LOOP
      PERFORM public.fn_harvest_task_output(v_task.id, p_rule_id);
      v_touched := v_touched + 1;
    END LOOP;
  END IF;

  RETURN v_touched;
END;
$$;

-- ============================================================
-- Section 5: rpc_process_harvest_rules -- INERT groundwork, cron-only
-- ============================================================
-- Modeled on rpc_process_automations' shape (per-rule cadence gate via
-- last_run_at/check_interval_minutes, the same 3-failures-in-an-hour
-- circuit breaker convention read from automation_execution_log, now keyed
-- off harvest_rule_id instead of automation_id). Genuinely inert for v1:
-- 'stage_entry' and 'stage_terminal_success' -- the only two condition_types
-- the CHECK constraint allows -- are both trigger-fired
-- (fn_trg_harvest_task_on_stage_entry), not time-based, so neither needs
-- cron polling. The WHERE clause below matches condition_type against a
-- currently-EMPTY cron-eligible allowlist, so this loop runs every minute
-- (registered on pipeline-heartbeat, Section 6) and always processes zero
-- rows. It exists, written and registered now, purely so a FUTURE
-- time-based condition_type needs no new scheduling infrastructure -- just
-- a branch inside this loop and an entry in the ARRAY[] below.
CREATE OR REPLACE FUNCTION public.rpc_process_harvest_rules()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rule RECORD;
BEGIN
  FOR v_rule IN
    SELECT hr.*
    FROM public.harvest_rules hr
    JOIN public.pipelines p ON p.id = hr.pipeline_id
    WHERE hr.is_active = TRUE
      AND p.deleted_at IS NULL
      -- No condition_type is cron-eligible yet -- see header comment.
      AND hr.condition_type = ANY (ARRAY[]::text[])
    ORDER BY hr.priority DESC, hr.created_at ASC
  LOOP
    IF v_rule.last_run_at IS NOT NULL
       AND v_rule.last_run_at > NOW() - (v_rule.check_interval_minutes || ' minutes')::interval
    THEN
      CONTINUE;
    END IF;

    IF (SELECT COUNT(*) FROM public.automation_execution_log
        WHERE harvest_rule_id = v_rule.id AND executed_at > NOW() - INTERVAL '1 hour') >= 3
    THEN
      UPDATE public.harvest_rules SET is_active = FALSE WHERE id = v_rule.id;
      CONTINUE;
    END IF;

    -- A future time-based condition_type's evaluation branch goes here.

    UPDATE public.harvest_rules SET last_run_at = NOW() WHERE id = v_rule.id;
  END LOOP;
END;
$$;

-- ============================================================
-- Section 6: register on the existing pipeline-heartbeat cron job
-- ============================================================
-- Second SELECT in the same job command -- smaller diff than a second job,
-- and both processors are meant to share one heartbeat per the plan's
-- "share the heartbeat, not the code" decision.
SELECT cron.unschedule('pipeline-heartbeat') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'pipeline-heartbeat'
);
SELECT cron.schedule(
  'pipeline-heartbeat',
  '* * * * *',
  $$SELECT public.rpc_process_automations(); SELECT public.rpc_process_harvest_rules();$$
);

-- ============================================================
-- Section 7: grants
-- ============================================================
-- rpc_process_harvest_rules is cron-only, same convention as
-- rpc_process_automations -- NOT granted to authenticated.
GRANT EXECUTE ON FUNCTION public.rpc_create_harvest_rule(uuid, text, uuid, uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_update_harvest_rule(uuid, text, uuid, uuid, int, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_delete_harvest_rule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_backfill_harvest_rule(uuid) TO authenticated;

-- ============================================================
-- Section 8: migration self-check -- fail loudly, not silently
-- ============================================================
DO $$
DECLARE
  v_n INT;
BEGIN
  ASSERT (
    SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'ck_harvest_rules_condition_type'
  ) = $x$CHECK ((condition_type = ANY (ARRAY['stage_entry'::text, 'stage_terminal_success'::text])))$x$,
  'ck_harvest_rules_condition_type does not match the expected widened definition';

  FOR v_n IN
    SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'rpc_create_harvest_rule', 'rpc_update_harvest_rule', 'rpc_delete_harvest_rule',
      'rpc_backfill_harvest_rule', 'rpc_process_harvest_rules', 'fn_trg_harvest_task_on_stage_entry'
    )
    GROUP BY p.proname
    HAVING count(*) <> 1
  LOOP
    RAISE EXCEPTION 'MIGRATION FAILED: a harvest rule RPC has more than 1 signature (overload footgun)';
  END LOOP;

  SELECT count(*) INTO v_n FROM cron.job WHERE jobname = 'pipeline-heartbeat';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'MIGRATION FAILED: pipeline-heartbeat cron job must exist exactly once, found %', v_n;
  END IF;

  -- rpc_process_automations carries no explicit GRANT ... TO authenticated
  -- either -- like every function here, it only has Postgres' default
  -- PUBLIC EXECUTE grant (proacl '=X/postgres'), never revoked codebase-wide.
  -- "NOT directly callable" means this migration adds no EXPLICIT grant
  -- (Section 7 above has none for it) -- confirm rpc_process_harvest_rules'
  -- ACL matches rpc_process_automations' own ACL shape exactly, rather than
  -- asserting a stricter restriction this codebase doesn't actually apply
  -- to its cron-only functions.
  IF (SELECT proacl FROM pg_proc WHERE proname = 'rpc_process_harvest_rules' AND pronamespace = 'public'::regnamespace)
     IS DISTINCT FROM
     (SELECT proacl FROM pg_proc WHERE proname = 'rpc_process_automations' AND pronamespace = 'public'::regnamespace)
  THEN
    RAISE EXCEPTION 'MIGRATION FAILED: rpc_process_harvest_rules'' ACL must match rpc_process_automations'' (no explicit authenticated grant beyond the default)';
  END IF;

  RAISE NOTICE '20260821_harvest_rule_configurability.sql wiring assertions passed';
END $$;
