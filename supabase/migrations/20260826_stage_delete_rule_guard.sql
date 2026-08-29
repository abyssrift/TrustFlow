-- Issue #284, Phase 5: rpc_delete_stage has no awareness that deleting an
-- otherwise-empty stage silently CASCADE-deletes any pipeline_automation or
-- harvest_rule that references it.
--
-- Confirmed via pg_get_functiondef/pg_constraint before writing anything
-- (not assumed from the ticket description):
--   - pipeline_automations.source_stage_id/target_stage_id and
--     harvest_rules.source_stage_id are all
--     REFERENCES pipeline_stages(id) ON DELETE CASCADE.
--   - rpc_delete_stage's live body (current definition, read via
--     pg_get_functiondef, reproduced below with one addition) already blocks
--     deletion when tasks currently sit in the stage ("Cannot delete stage
--     with % active tasks") but has NO equivalent guard for automations or
--     harvest rules -- deleting an empty-of-tasks stage that an automation or
--     harvest rule still points at silently destroys that rule's
--     configuration via FK cascade, with zero warning to the user.
--
-- Fix: a second guard, same style as the existing task-count block, placed
-- immediately before the DELETE FROM pipeline_stages line. Counts
-- pipeline_automations rows where this stage is EITHER the source or the
-- target (either reference makes deletion unsafe -- an automation with a
-- dangling target_stage_id is just as broken as one with a dangling
-- source_stage_id), and harvest_rules rows where this stage is specifically
-- the source_stage_id. harvest_rules.source_stage_id IS NULL means "any
-- stage" (see 20260821_harvest_rule_configurability.sql's
-- stage_terminal_success "any terminal-success stage" form) -- that is not a
-- reference to THIS stage, so it must not block deletion of an unrelated
-- stage (NULL never satisfies source_stage_id = p_stage_id, which the plain
-- equality check already gets right for free).
--
-- Same signature (p_stage_id uuid only), so CREATE OR REPLACE is safe --
-- verified below by the self-check re-reading pg_get_function_identity_arguments.
--
-- Also adds rpc_count_harvest_rule_backlog(p_rule_id uuid): a read-only
-- STABLE companion to rpc_backfill_harvest_rule that answers "how many tasks
-- would backfill touch right now" without mutating anything, for a frontend
-- hint on each rule card. Its qualifying-task query is copied verbatim from
-- rpc_backfill_harvest_rule's live body (both condition_type branches, same
-- NOT EXISTS idempotency check against harvested_files) with SELECT COUNT(*)
-- in place of the INSERT-via-loop, and deliberately WITHOUT backfill's
-- LIMIT 100 -- that LIMIT is backfill's own per-call batch bound, not part of
-- what "qualifies", so a true backlog count must not be capped at it.

-- ============================================================
-- Section 1: rpc_delete_stage -- add the automation/harvest-rule guard
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_delete_stage(p_stage_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id       UUID;
  v_pipeline_id      UUID;
  v_user_id          UUID := auth.uid();
  v_task_count       INTEGER;
  v_automation_count INTEGER;
  v_harvest_count    INTEGER;
  v_ref_parts        TEXT[] := ARRAY[]::TEXT[];
BEGIN
  SELECT p.company_id, ps.pipeline_id INTO v_company_id, v_pipeline_id
  FROM public.pipeline_stages ps
  JOIN public.pipelines p ON p.id = ps.pipeline_id
  WHERE ps.id = p_stage_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Stage not found';
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

  -- Block if tasks are in this stage
  SELECT COUNT(*) INTO v_task_count
  FROM public.tasks
  WHERE current_stage_id = p_stage_id AND deleted_at IS NULL;

  IF v_task_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete stage with % active tasks', v_task_count;
  END IF;

  -- Block if an automation or harvest rule still references this stage --
  -- ON DELETE CASCADE on both FKs means the DELETE below would otherwise
  -- silently destroy that rule's configuration with no warning.
  SELECT COUNT(*) INTO v_automation_count
  FROM public.pipeline_automations
  WHERE source_stage_id = p_stage_id OR target_stage_id = p_stage_id;

  -- source_stage_id IS NULL ("any stage") does not reference THIS stage --
  -- excluded for free by the plain equality check.
  SELECT COUNT(*) INTO v_harvest_count
  FROM public.harvest_rules
  WHERE source_stage_id = p_stage_id;

  IF v_automation_count > 0 THEN
    v_ref_parts := array_append(v_ref_parts,
      v_automation_count || ' automation' || CASE WHEN v_automation_count = 1 THEN '' ELSE 's' END);
  END IF;
  IF v_harvest_count > 0 THEN
    v_ref_parts := array_append(v_ref_parts,
      v_harvest_count || ' harvest rule' || CASE WHEN v_harvest_count = 1 THEN '' ELSE 's' END);
  END IF;

  IF array_length(v_ref_parts, 1) > 0 THEN
    RAISE EXCEPTION 'Cannot delete stage: referenced by %. Remove or repoint % first.',
      array_to_string(v_ref_parts, ' and '),
      CASE WHEN (v_automation_count + v_harvest_count) = 1 THEN 'it' ELSE 'them' END;
  END IF;

  -- Cascade deletes transitions via FK, then delete stage
  DELETE FROM public.pipeline_stages WHERE id = p_stage_id;

  -- Reorder remaining stages
  WITH ranked AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY position) AS new_pos
    FROM public.pipeline_stages
    WHERE pipeline_id = v_pipeline_id
  )
  UPDATE public.pipeline_stages ps
  SET position = r.new_pos
  FROM ranked r
  WHERE ps.id = r.id;
END;
$function$;

-- ============================================================
-- Section 2: rpc_count_harvest_rule_backlog -- read-only backlog count
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_count_harvest_rule_backlog(p_rule_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id UUID;
  v_user_id    UUID := auth.uid();
  v_rule       RECORD;
  v_count      INTEGER;
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
    SELECT COUNT(*) INTO v_count
    FROM public.tasks t
    WHERE t.pipeline_id = v_rule.pipeline_id
      AND t.current_stage_id = v_rule.source_stage_id
      AND t.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.harvested_files hf
        WHERE hf.harvest_rule_id = p_rule_id AND hf.source_task_id = t.id
      );

  ELSIF v_rule.condition_type = 'stage_terminal_success' THEN
    SELECT COUNT(*) INTO v_count
    FROM public.tasks t
    JOIN public.pipeline_stages ps ON ps.id = t.current_stage_id
    WHERE t.pipeline_id = v_rule.pipeline_id
      AND (v_rule.source_stage_id IS NULL OR t.current_stage_id = v_rule.source_stage_id)
      AND ps.is_terminal AND ps.terminal_type = 'success'
      AND t.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.harvested_files hf
        WHERE hf.harvest_rule_id = p_rule_id AND hf.source_task_id = t.id
      );
  ELSE
    v_count := 0;
  END IF;

  RETURN COALESCE(v_count, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_count_harvest_rule_backlog(uuid) TO authenticated;

-- ============================================================
-- Migration self-check -- fail loudly, not silently
-- ============================================================
DO $$
DECLARE
  v_identity   TEXT;
  v_volatility CHAR;
  v_rettype    TEXT;
BEGIN
  -- rpc_delete_stage: same signature as before (p_stage_id uuid only) --
  -- CREATE OR REPLACE was safe, no lingering old-signature overload.
  SELECT pg_get_function_identity_arguments('public.rpc_delete_stage'::regproc) INTO v_identity;
  IF v_identity <> 'p_stage_id uuid' THEN
    RAISE EXCEPTION 'MIGRATION FAILED: rpc_delete_stage signature changed to ''%'' -- expected ''p_stage_id uuid''', v_identity;
  END IF;

  IF (SELECT count(*) FROM pg_proc WHERE proname = 'rpc_delete_stage' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'MIGRATION FAILED: rpc_delete_stage has more than 1 signature (overload footgun)';
  END IF;

  -- rpc_count_harvest_rule_backlog: exists exactly once, returns integer,
  -- and is actually marked STABLE (not VOLATILE) -- it reads only, this
  -- matters for anyone reasoning about it later.
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'rpc_count_harvest_rule_backlog' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'MIGRATION FAILED: rpc_count_harvest_rule_backlog has more than 1 signature (overload footgun)';
  END IF;

  SELECT provolatile, pg_get_function_result('public.rpc_count_harvest_rule_backlog(uuid)'::regprocedure)
    INTO v_volatility, v_rettype
  FROM pg_proc WHERE proname = 'rpc_count_harvest_rule_backlog' AND pronamespace = 'public'::regnamespace;

  IF v_volatility <> 's' THEN
    RAISE EXCEPTION 'MIGRATION FAILED: rpc_count_harvest_rule_backlog must be STABLE, found volatility ''%''', v_volatility;
  END IF;
  IF v_rettype <> 'integer' THEN
    RAISE EXCEPTION 'MIGRATION FAILED: rpc_count_harvest_rule_backlog must RETURN integer, found ''%''', v_rettype;
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.rpc_count_harvest_rule_backlog(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'MIGRATION FAILED: authenticated role is not granted EXECUTE on rpc_count_harvest_rule_backlog';
  END IF;

  RAISE NOTICE 'ALL CHECKS PASSED: 20260826_stage_delete_rule_guard.sql -- rpc_delete_stage now guards automations/harvest rules, rpc_count_harvest_rule_backlog added.';
END $$;
