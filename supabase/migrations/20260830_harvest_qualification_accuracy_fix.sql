-- Issue #284: harvest "qualification" was a lie for project-less tasks.
--
-- Found live during manual testing: a pipeline whose tasks have no
-- project_id (never assigned to a project) showed "4 tasks already qualify"
-- on a harvest rule with the default (no override) destination, and running
-- backfill reported "4 tasks processed" -- but harvested_files stayed at 0
-- rows. Two compounding bugs:
--
-- 1. fn_harvest_task_output's `project_id IS NULL -> RETURN` gate fires
--    BEFORE the destination-override branch is even reached. The function's
--    own comment on that branch says the explicit override path is
--    "implemented correctly for when one exists" (written in Phase 2, ahead
--    of Phase 3's RPC) -- clearly intended to let a rule funnel into ONE
--    shared folder regardless of which project (or no project) the task
--    belongs to. The gate ordering silently defeats that: even a rule with
--    an explicit destination_folder_id can never harvest a project-less
--    task today. Fix: only require project_id on the DYNAMIC (no override)
--    resolution path, where it's actually needed to look up a deliverable
--    folder.
--
-- 2. rpc_backfill_harvest_rule and rpc_count_harvest_rule_backlog (Phase 5)
--    both determine "qualifies" purely from stage/condition_type, with zero
--    awareness of the two OTHER conditions fn_harvest_task_output silently
--    no-ops on: no project (fixed above, but a rule with no override STILL
--    can't harvest a project-less task) and no submission yet. Backfill's
--    v_touched counts every task it ITERATED, not every task that actually
--    produced a harvested_files row -- so it happily reports "N processed"
--    for tasks that were always going to no-op. Fix: both queries gain the
--    same two conditions fn_harvest_task_output itself enforces, so a task
--    only counts as "qualifying" if harvesting it would actually do
--    something: (destination is an explicit override OR the task has a
--    project) AND the task has a submission.

-- ============================================================
-- Section 1: fn_harvest_task_output -- override path no longer requires
-- a project; only the dynamic per-project resolution does.
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_harvest_task_output(p_task_id UUID, p_harvest_rule_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_task          RECORD;
    v_rule_dest     UUID;
    v_folder_id     UUID;
    v_submission    UUID;
    v_actor         UUID := auth.uid();
    v_harvested_at  TIMESTAMPTZ := clock_timestamp();
    r               RECORD;
BEGIN
    SELECT id, company_id, project_id INTO v_task
    FROM public.tasks
    WHERE id = p_task_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RETURN; -- task vanished
    END IF;

    SELECT destination_folder_id INTO v_rule_dest
    FROM public.harvest_rules
    WHERE id = p_harvest_rule_id;

    IF NOT FOUND THEN
        RETURN; -- rule vanished/bad id -- nothing to harvest to
    END IF;

    IF v_rule_dest IS NOT NULL THEN
        -- Explicit override -- works regardless of whether the task has a
        -- project. This is the whole point of an override: funnel into ONE
        -- shared folder no matter what (or whether) project the task
        -- belongs to.
        v_folder_id := v_rule_dest;
    ELSE
        -- Dynamic per-project resolution is the only path that actually
        -- NEEDS a project -- there is nothing to look up without one.
        IF v_task.project_id IS NULL THEN
            RETURN; -- not attached to a project and no override destination
        END IF;
        v_folder_id := public.fn_project_ensure_deliverable_folder(v_task.project_id);
    END IF;

    IF v_folder_id IS NULL THEN
        RETURN;
    END IF;

    -- Output = the task's most recent submission. task_attachments (the
    -- brief) is input, deliberately not harvested.
    SELECT id INTO v_submission
    FROM public.task_submissions
    WHERE task_id = p_task_id AND deleted_at IS NULL
    ORDER BY submitted_at DESC
    LIMIT 1;

    IF v_submission IS NULL THEN
        RETURN; -- nothing submitted yet -- silent no-op
    END IF;

    FOR r IN
        SELECT sf.current_version_id AS version_id
        FROM public.submission_attachments sa
        JOIN public.filehub_files sf ON sf.id = sa.filehub_file_id
        WHERE sa.submission_id = v_submission
          AND sf.deleted_at IS NULL
          AND sf.current_version_id IS NOT NULL
    LOOP
        INSERT INTO public.harvested_files (
            harvest_rule_id, source_file_version_id, destination_folder_id,
            source_task_id, company_id, harvested_by, harvested_at
        ) VALUES (
            p_harvest_rule_id, r.version_id, v_folder_id,
            p_task_id, v_task.company_id, v_actor, v_harvested_at
        )
        ON CONFLICT (destination_folder_id, source_file_version_id) DO NOTHING;
    END LOOP;
END;
$$;

-- ============================================================
-- Section 2: rpc_backfill_harvest_rule -- only count/touch tasks that will
-- actually produce a harvest (matches fn_harvest_task_output's real gates).
-- ============================================================
CREATE OR REPLACE FUNCTION public.rpc_backfill_harvest_rule(p_rule_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
        AND (v_rule.destination_folder_id IS NOT NULL OR t.project_id IS NOT NULL)
        AND EXISTS (
          SELECT 1 FROM public.task_submissions ts
          WHERE ts.task_id = t.id AND ts.deleted_at IS NULL
        )
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
        AND (v_rule.destination_folder_id IS NOT NULL OR t.project_id IS NOT NULL)
        AND EXISTS (
          SELECT 1 FROM public.task_submissions ts
          WHERE ts.task_id = t.id AND ts.deleted_at IS NULL
        )
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
$function$;

-- ============================================================
-- Section 3: rpc_count_harvest_rule_backlog -- same two extra conditions,
-- kept in lockstep with backfill's query (a dry-run must predict exactly
-- what the real run will do).
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
      AND (v_rule.destination_folder_id IS NOT NULL OR t.project_id IS NOT NULL)
      AND EXISTS (
        SELECT 1 FROM public.task_submissions ts
        WHERE ts.task_id = t.id AND ts.deleted_at IS NULL
      )
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
      AND (v_rule.destination_folder_id IS NOT NULL OR t.project_id IS NOT NULL)
      AND EXISTS (
        SELECT 1 FROM public.task_submissions ts
        WHERE ts.task_id = t.id AND ts.deleted_at IS NULL
      )
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

-- ============================================================
-- Migration self-check
-- ============================================================
DO $$
DECLARE
  v_identity TEXT;
BEGIN
  SELECT pg_get_function_identity_arguments('public.fn_harvest_task_output'::regproc) INTO v_identity;
  IF v_identity <> 'p_task_id uuid, p_harvest_rule_id uuid' THEN
    RAISE EXCEPTION 'MIGRATION FAILED: fn_harvest_task_output signature changed to ''%''', v_identity;
  END IF;

  IF (SELECT count(*) FROM pg_proc WHERE proname = 'rpc_backfill_harvest_rule' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'MIGRATION FAILED: rpc_backfill_harvest_rule overload count wrong';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'rpc_count_harvest_rule_backlog' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'MIGRATION FAILED: rpc_count_harvest_rule_backlog overload count wrong';
  END IF;

  RAISE NOTICE 'ALL CHECKS PASSED: 20260830_harvest_qualification_accuracy_fix.sql -- override path no longer requires a project, backfill/backlog-count no longer overcount project-less or submission-less tasks.';
END $$;
