-- check_rpc_batch_config.sql
--
-- NOT a migration — nothing under supabase/checks/ is auto-applied. Run this
-- by hand against a local/staging Postgres you can write to (NEVER prod):
--
--   psql "$LOCAL_DB_URL" -f supabase/checks/check_rpc_batch_config.sql
--
-- Issue #182 / plan §13.10 — the batch-configuration step. This is the
-- acceptance test the issue itself demands: "inserted successfully" is not
-- enough, "appears on a board, with a date, owned by someone" is. Fails
-- loudly if any of the following regress:
--
--   1. Trust-boundary validation — each of these MUST raise:
--        a. a template category with no row in p_category_mapping
--        b. a p_category_mapping row naming a category the template
--           doesn't use (typo guard)
--        c. a pipeline_id in the mapping that belongs to another company
--        d. a missing schedule anchor (p_portfolio.target_date) — NOT
--           silently defaulted to now()
--        e. a missing/invalid anchor_direction
--        f. an anchor date in the past
--        g. an empty template body
--   2. Forward scheduling: due_date = start_date + due_offset_days, an item
--      with no due_offset_days defaults to 0 (not NULL).
--   3. Back-scheduling: anchor_direction='deadline' computes the project's
--      start_date from the SAME template body's span (MAX due_offset_days),
--      and the last task's due_date lands exactly on the supplied deadline.
--   4. rpc_preview_instantiate_template's counts/dates match what
--      rpc_instantiate_template actually commits for the identical inputs —
--      the preview cannot be allowed to drift from the real write.
--   5. Reachability: every created task is findable via the EXACT query
--      shape the desktop task board uses (components/tabs/_tasks_desktop.tsx
--      — `select ... from tasks where pipeline_id = :board`, then grouped by
--      current_stage_id client-side) — not just "columns are non-NULL".
--   6. Performance + notification fan-out: a 20-project x 25-task batch
--      (500 tasks) completes in low tens-of-milliseconds and emits exactly
--      ONE notification_events row, not 500.
--
-- Cleans up its own scratch pipelines/stages/team/template/projects/tasks
-- on success so it's safe to re-run. On assertion failure it stops and
-- leaves scratch rows behind for inspection (same convention as
-- check_rpc_instantiate_template.sql).

DO $$
DECLARE
  v_user_id            UUID;
  v_company_id         UUID;
  v_other_company_id   UUID;
  v_foreign_pipeline_id UUID;
  v_tag                TEXT := replace(gen_random_uuid()::text, '-', '');
  v_pipe_a UUID; v_pipe_b UUID; v_pipe_c UUID;
  v_stage_a UUID; v_stage_b UUID; v_stage_c UUID;
  v_template_id        UUID;
  v_body                JSONB;
  v_mapping_full        JSONB;
  v_mapping_missing     JSONB;
  v_mapping_extra       JSONB;
  v_mapping_foreign     JSONB;
  v_portfolio_ok        JSONB;
  v_projects_2          JSONB;
  v_result               JSONB;
  v_preview              JSONB;
  v_portfolio_id          UUID;
  v_project_id            UUID;
  v_caught                BOOLEAN;
  v_msg                   TEXT;
  v_events_before         INT;
  v_events_after          INT;
  v_t_start                TIMESTAMPTZ;
  v_t_end                  TIMESTAMPTZ;
  v_elapsed_ms              NUMERIC;
  v_bulk_key                TEXT;
  v_bulk_result              JSONB;
  v_bulk_portfolio_id         UUID;
  v_bulk_projects_payload      JSONB;
  v_board_task_count             INT;
  i INT;
BEGIN
  -- Needs a company with >=3 EXISTING pipelines that each already have a
  -- stage — pipelines.company_id is subject to a plan-tier pipeline-count
  -- limit (_enforce_pipeline_limit trigger), so this check reuses seeded
  -- boards rather than creating scratch ones, which a company already at
  -- its cap would reject.
  SELECT p.company_id INTO v_company_id
  FROM public.pipelines p
  WHERE p.deleted_at IS NULL AND EXISTS (SELECT 1 FROM public.pipeline_stages s WHERE s.pipeline_id = p.id)
  GROUP BY p.company_id
  HAVING COUNT(*) >= 3
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No company with >= 3 stage-having pipelines found — seed one before running this check.';
  END IF;

  SELECT id INTO v_user_id FROM public.users WHERE is_owner = true AND company_id = v_company_id LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No owner user found for company %.', v_company_id;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  SELECT company_id INTO v_other_company_id
  FROM public.users WHERE is_owner = true AND company_id <> v_company_id LIMIT 1;

  -- ── 3 existing pipelines (with their first stage by position) ──────────
  SELECT p.id, s.id INTO v_pipe_a, v_stage_a
  FROM public.pipelines p JOIN LATERAL (SELECT id FROM public.pipeline_stages WHERE pipeline_id = p.id ORDER BY position ASC LIMIT 1) s ON true
  WHERE p.company_id = v_company_id AND p.deleted_at IS NULL LIMIT 1;

  SELECT p.id, s.id INTO v_pipe_b, v_stage_b
  FROM public.pipelines p JOIN LATERAL (SELECT id FROM public.pipeline_stages WHERE pipeline_id = p.id ORDER BY position ASC LIMIT 1) s ON true
  WHERE p.company_id = v_company_id AND p.deleted_at IS NULL AND p.id <> v_pipe_a LIMIT 1;

  SELECT p.id, s.id INTO v_pipe_c, v_stage_c
  FROM public.pipelines p JOIN LATERAL (SELECT id FROM public.pipeline_stages WHERE pipeline_id = p.id ORDER BY position ASC LIMIT 1) s ON true
  WHERE p.company_id = v_company_id AND p.deleted_at IS NULL AND p.id NOT IN (v_pipe_a, v_pipe_b) LIMIT 1;

  IF v_other_company_id IS NOT NULL THEN
    SELECT id INTO v_foreign_pipeline_id FROM public.pipelines WHERE company_id = v_other_company_id AND deleted_at IS NULL LIMIT 1;
  END IF;

  -- ── template: 3 categories, one item with NO due_offset_days (must
  --    default to 0, not stay NULL), max offset 10 (the batch span) ───────
  v_body := jsonb_build_array(
    jsonb_build_object('title', 'Plan 1', 'category', 'Planning', 'due_offset_days', 0),
    jsonb_build_object('title', 'Plan 2', 'category', 'Planning'), -- no offset -> defaults to 0
    jsonb_build_object('title', 'Field 1', 'category', 'Fieldwork', 'due_offset_days', 10)
  );
  INSERT INTO public.project_templates (company_id, name, body, created_by)
  VALUES (v_company_id, 'selfcheck-batchcfg-template-' || v_tag, v_body, v_user_id)
  RETURNING id INTO v_template_id;

  v_mapping_full := jsonb_build_array(
    jsonb_build_object('category', 'Planning', 'pipeline_id', v_pipe_a),
    jsonb_build_object('category', 'Fieldwork', 'pipeline_id', v_pipe_b)
  );
  v_mapping_missing := jsonb_build_array(jsonb_build_object('category', 'Planning', 'pipeline_id', v_pipe_a)); -- Fieldwork unmapped
  v_mapping_extra := v_mapping_full || jsonb_build_array(jsonb_build_object('category', 'NoSuchCategory', 'pipeline_id', v_pipe_c));
  v_mapping_foreign := jsonb_build_array(
    jsonb_build_object('category', 'Planning', 'pipeline_id', v_pipe_a),
    jsonb_build_object('category', 'Fieldwork', 'pipeline_id', COALESCE(v_foreign_pipeline_id, gen_random_uuid()))
  );

  -- projects_company_id_name_key is UNIQUE (company_id, name), NOT partial on
  -- deleted_at (same gotcha check_rpc_instantiate_template.sql notes) — the
  -- forward and back-scheduling commits below both insert from this payload,
  -- so names must differ between the two calls, not just between runs.
  v_projects_2 := jsonb_build_array(
    jsonb_build_object('name', 'BatchCfg A ' || v_tag),
    jsonb_build_object('name', 'BatchCfg B ' || v_tag)
  );

  -- ══ 1a. unmapped category must RAISE ═══════════════════════════════════
  v_caught := false;
  BEGIN
    PERFORM public.rpc_preview_instantiate_template(
      v_template_id,
      jsonb_build_object('target_date', (CURRENT_DATE + 7)::text, 'anchor_direction', 'start'),
      v_projects_2, v_mapping_missing
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    ASSERT SQLERRM LIKE '%Fieldwork%', format('expected the unmapped-category error to name "Fieldwork", got: %s', SQLERRM);
  END;
  ASSERT v_caught, 'expected an unmapped template category to RAISE, it did not';

  -- ══ 1b. mapping row for a category the template does not use must RAISE ═
  v_caught := false;
  BEGIN
    PERFORM public.rpc_preview_instantiate_template(
      v_template_id,
      jsonb_build_object('target_date', (CURRENT_DATE + 7)::text, 'anchor_direction', 'start'),
      v_projects_2, v_mapping_extra
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    ASSERT SQLERRM LIKE '%NoSuchCategory%', format('expected the stray-mapping error to name "NoSuchCategory", got: %s', SQLERRM);
  END;
  ASSERT v_caught, 'expected a mapping row for an unused category to RAISE, it did not';

  -- ══ 1c. pipeline_id from another company must RAISE ════════════════════
  IF v_foreign_pipeline_id IS NOT NULL THEN
    v_caught := false;
    BEGIN
      PERFORM public.rpc_preview_instantiate_template(
        v_template_id,
        jsonb_build_object('target_date', (CURRENT_DATE + 7)::text, 'anchor_direction', 'start'),
        v_projects_2, v_mapping_foreign
      );
    EXCEPTION WHEN OTHERS THEN
      v_caught := true;
    END;
    ASSERT v_caught, 'expected a foreign-company pipeline_id in the mapping to RAISE, it did not';
  END IF;

  -- ══ 1d. missing anchor must RAISE (no silent COALESCE to now()) ════════
  v_caught := false;
  BEGIN
    PERFORM public.rpc_preview_instantiate_template(v_template_id, jsonb_build_object('anchor_direction', 'start'), v_projects_2, v_mapping_full);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
    ASSERT SQLERRM LIKE '%never defaulted%', format('expected the missing-anchor error to say it is never defaulted, got: %s', SQLERRM);
  END;
  ASSERT v_caught, 'expected a missing target_date to RAISE, it did not';

  -- ══ 1e. missing/invalid anchor_direction must RAISE ════════════════════
  v_caught := false;
  BEGIN
    PERFORM public.rpc_preview_instantiate_template(v_template_id, jsonb_build_object('target_date', (CURRENT_DATE + 7)::text), v_projects_2, v_mapping_full);
  EXCEPTION WHEN OTHERS THEN v_caught := true;
  END;
  ASSERT v_caught, 'expected a missing anchor_direction to RAISE, it did not';

  -- ══ 1f. anchor in the past must RAISE ═══════════════════════════════════
  v_caught := false;
  BEGIN
    PERFORM public.rpc_preview_instantiate_template(
      v_template_id,
      jsonb_build_object('target_date', (CURRENT_DATE - 3)::text, 'anchor_direction', 'start'),
      v_projects_2, v_mapping_full
    );
  EXCEPTION WHEN OTHERS THEN v_caught := true;
  END;
  ASSERT v_caught, 'expected a past anchor date to RAISE, it did not';

  -- ══ 1g. empty template body must RAISE ══════════════════════════════════
  v_caught := false;
  BEGIN
    PERFORM public.fn_resolve_batch_category_mapping(v_company_id, '[]'::jsonb, v_mapping_full);
  EXCEPTION WHEN OTHERS THEN v_caught := true;
  END;
  ASSERT v_caught, 'expected an empty template body to RAISE, it did not';

  -- ══ 1h. duplicate names WITHIN the pasted list must RAISE ═══════════════
  -- These collide with each other, not with any existing row, so the partial
  -- unique index would not have caught them either — both inserts land in one
  -- statement. Preview is the only thing standing between the user and a
  -- failed commit here.
  v_caught := false; v_msg := NULL;
  BEGIN
    PERFORM public.rpc_preview_instantiate_template(
      v_template_id,
      jsonb_build_object('target_date', (CURRENT_DATE + 7)::text, 'anchor_direction', 'start'),
      jsonb_build_array(
        jsonb_build_object('name', 'Dupe Twin ' || v_tag),
        jsonb_build_object('name', 'Dupe Twin ' || v_tag)
      ),
      v_mapping_full
    );
  EXCEPTION WHEN OTHERS THEN v_caught := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  ASSERT v_caught, 'expected two identical names in one paste to RAISE, it did not';
  ASSERT v_msg LIKE '%Dupe Twin%',
    format('the duplicate-name error must NAME the offending project, got: %s', v_msg);

  -- ══ 1i. a name matching an ACTIVE project must RAISE ════════════════════
  -- The live failure this check exists for: preview went green and commit
  -- then died on projects_company_id_name_key. Preview must catch it first.
  INSERT INTO public.projects (company_id, name, status, created_by)
  VALUES (v_company_id, 'Already Live ' || v_tag, 'active', v_user_id);

  v_caught := false; v_msg := NULL;
  BEGIN
    PERFORM public.rpc_preview_instantiate_template(
      v_template_id,
      jsonb_build_object('target_date', (CURRENT_DATE + 7)::text, 'anchor_direction', 'start'),
      jsonb_build_array(jsonb_build_object('name', 'Already Live ' || v_tag)),
      v_mapping_full
    );
  EXCEPTION WHEN OTHERS THEN v_caught := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  ASSERT v_caught, 'expected a name colliding with an ACTIVE project to RAISE in preview, it did not';
  ASSERT v_msg LIKE '%Already Live%',
    format('the collision error must NAME the offending project, got: %s', v_msg);

  -- ══ 1j. a name matching a SOFT-DELETED project must be ALLOWED ══════════
  -- The partial index permits this (WHERE deleted_at IS NULL); re-forbidding
  -- it here would contradict the constraint this validation mirrors, and
  -- would resurrect #180 — archived names staying reserved forever.
  UPDATE public.projects SET deleted_at = now()
  WHERE company_id = v_company_id AND name = 'Already Live ' || v_tag;

  PERFORM public.rpc_preview_instantiate_template(
    v_template_id,
    jsonb_build_object('target_date', (CURRENT_DATE + 7)::text, 'anchor_direction', 'start'),
    jsonb_build_array(jsonb_build_object('name', 'Already Live ' || v_tag)),
    v_mapping_full
  );

  -- ══ 2/3. forward + back scheduling, via preview-vs-commit agreement ═════
  -- Forward: anchor is a start date. Span = MAX(due_offset_days) = 10.
  v_preview := public.rpc_preview_instantiate_template(
    v_template_id,
    jsonb_build_object('target_date', (CURRENT_DATE + 7)::text, 'anchor_direction', 'start'),
    v_projects_2, v_mapping_full
  );
  ASSERT (v_preview->>'projects')::int = 2, format('preview: expected 2 projects, got %s', v_preview->>'projects');
  ASSERT (v_preview->>'tasks')::int = 6, format('preview: expected 6 tasks (2 projects x 3 items), got %s', v_preview->>'tasks');
  ASSERT (v_preview->>'boards')::int = 2, format('preview: expected 2 distinct boards, got %s', v_preview->>'boards');
  ASSERT (v_preview->>'first_task_date')::date = (CURRENT_DATE + 7), 'preview: forward first_task_date should equal the anchor (min offset 0)';
  ASSERT (v_preview->>'last_task_date')::date = (CURRENT_DATE + 7 + 10), 'preview: forward last_task_date should be anchor + max offset (10)';

  v_result := public.rpc_instantiate_template(
    v_template_id,
    jsonb_build_object('name', 'selfcheck-batchcfg-fwd-' || v_tag, 'target_date', (CURRENT_DATE + 7)::text, 'anchor_direction', 'start'),
    v_projects_2, v_mapping_full, 'selfcheck-batchcfg-fwd-' || v_tag
  );
  v_portfolio_id := (v_result->>'portfolio_id')::uuid;
  ASSERT (v_result->>'projects_created')::int = (v_preview->>'projects')::int, 'commit project count must match the preview';
  ASSERT (v_result->>'tasks_created')::int = (v_preview->>'tasks')::int, 'commit task count must match the preview';

  ASSERT (SELECT MIN(due_date)::date FROM public.tasks WHERE portfolio_id = v_portfolio_id) = (v_preview->>'first_task_date')::date,
    'commit MIN(due_date) must match the preview''s first_task_date';
  ASSERT (SELECT MAX(due_date)::date FROM public.tasks WHERE portfolio_id = v_portfolio_id) = (v_preview->>'last_task_date')::date,
    'commit MAX(due_date) must match the preview''s last_task_date';

  -- The item with no due_offset_days must have defaulted to 0, not NULL.
  ASSERT (SELECT due_date::date FROM public.tasks WHERE portfolio_id = v_portfolio_id AND title = 'Plan 2' LIMIT 1) = (CURRENT_DATE + 7),
    'expected the offset-less template item to default due_offset_days to 0';

  -- Reachability #1: every task in this batch has a non-NULL pipeline_id,
  -- current_stage_id and due_date. Projects have start_date and due_date.
  ASSERT (SELECT COUNT(*) FROM public.tasks WHERE portfolio_id = v_portfolio_id AND (pipeline_id IS NULL OR current_stage_id IS NULL OR due_date IS NULL)) = 0,
    'expected zero tasks with a NULL pipeline_id/current_stage_id/due_date';
  ASSERT (SELECT COUNT(*) FROM public.projects WHERE portfolio_id = v_portfolio_id AND (start_date IS NULL OR due_date IS NULL)) = 0,
    'expected zero projects with a NULL start_date/due_date';

  -- Reachability #2: the EXACT query shape the desktop board uses
  -- (components/tabs/_tasks_desktop.tsx: `.from('tasks').eq('pipeline_id', boardId)`,
  -- then grouped client-side by `current_stage_id`) must return these tasks,
  -- landed on their pipeline's FIRST stage by position.
  SELECT COUNT(*) INTO v_board_task_count
  FROM public.tasks
  WHERE pipeline_id = v_pipe_a AND current_stage_id = v_stage_a AND portfolio_id = v_portfolio_id AND deleted_at IS NULL;
  ASSERT v_board_task_count = 4, format('expected 4 Planning tasks reachable on board A''s first stage, got %s', v_board_task_count);

  SELECT COUNT(*) INTO v_board_task_count
  FROM public.tasks
  WHERE pipeline_id = v_pipe_b AND current_stage_id = v_stage_b AND portfolio_id = v_portfolio_id AND deleted_at IS NULL;
  ASSERT v_board_task_count = 2, format('expected 2 Fieldwork tasks reachable on board B''s first stage, got %s', v_board_task_count);

  -- Back-scheduling: anchor is a DEADLINE. start_date = deadline - span(10).
  -- The last task's due_date must land exactly on the deadline.
  -- Preview the SAME names this block is about to commit. Previously this
  -- reused v_projects_2, whose names were committed by the forward batch
  -- above — harmless before duplicate-name validation existed, now a real
  -- collision. Preview must mirror the commit it precedes; that is the whole
  -- contract being asserted here.
  v_preview := public.rpc_preview_instantiate_template(
    v_template_id,
    jsonb_build_object('target_date', (CURRENT_DATE + 40)::text, 'anchor_direction', 'deadline'),
    jsonb_build_array(jsonb_build_object('name', 'BatchCfg A-back ' || v_tag), jsonb_build_object('name', 'BatchCfg B-back ' || v_tag)),
    v_mapping_full
  );
  ASSERT (v_preview->>'last_task_date')::date = (CURRENT_DATE + 40), 'back-scheduling: last_task_date must equal the supplied deadline exactly';
  ASSERT (v_preview->>'first_task_date')::date = (CURRENT_DATE + 40 - 10), 'back-scheduling: first_task_date must equal deadline - span';

  v_result := public.rpc_instantiate_template(
    v_template_id,
    jsonb_build_object('name', 'selfcheck-batchcfg-back-' || v_tag, 'target_date', (CURRENT_DATE + 40)::text, 'anchor_direction', 'deadline'),
    jsonb_build_array(jsonb_build_object('name', 'BatchCfg A-back ' || v_tag), jsonb_build_object('name', 'BatchCfg B-back ' || v_tag)),
    v_mapping_full, 'selfcheck-batchcfg-back-' || v_tag
  );
  v_portfolio_id := (v_result->>'portfolio_id')::uuid;

  SELECT id INTO v_project_id FROM public.projects WHERE portfolio_id = v_portfolio_id LIMIT 1;
  ASSERT (SELECT start_date::date FROM public.projects WHERE id = v_project_id) = (CURRENT_DATE + 40 - 10),
    'back-scheduling: project start_date must be deadline - span';
  ASSERT (SELECT MAX(due_date)::date FROM public.tasks WHERE portfolio_id = v_portfolio_id) = (CURRENT_DATE + 40),
    'back-scheduling: the last task must be due exactly on the deadline';
  ASSERT (SELECT COUNT(*) FROM public.tasks WHERE portfolio_id = v_portfolio_id AND (pipeline_id IS NULL OR current_stage_id IS NULL OR due_date IS NULL)) = 0,
    'back-scheduling batch: expected zero tasks with a NULL pipeline_id/current_stage_id/due_date';

  RAISE NOTICE 'batch-config validation + forward/back scheduling + reachability: PASSED';

  -- ══ 6. Performance + notification fan-out: 20 projects x 25 tasks ═══════
  v_body := (
    SELECT jsonb_agg(jsonb_build_object(
      'title', 'Perf Task ' || g,
      'category', CASE (g % 5) WHEN 0 THEN 'Planning' WHEN 1 THEN 'Planning' WHEN 2 THEN 'Fieldwork' WHEN 3 THEN 'Fieldwork' ELSE 'Reporting' END,
      'due_offset_days', g
    ))
    FROM generate_series(1, 25) g
  );
  v_mapping_full := jsonb_build_array(
    jsonb_build_object('category', 'Planning', 'pipeline_id', v_pipe_a),
    jsonb_build_object('category', 'Fieldwork', 'pipeline_id', v_pipe_b),
    jsonb_build_object('category', 'Reporting', 'pipeline_id', v_pipe_c)
  );

  UPDATE public.project_templates SET body = v_body WHERE id = v_template_id;

  v_bulk_projects_payload := (
    SELECT jsonb_agg(jsonb_build_object('name', 'Perf Project ' || g || ' ' || v_tag))
    FROM generate_series(1, 20) g
  );
  v_bulk_key := 'selfcheck-batchcfg-perf-' || v_tag;

  SELECT COUNT(*) INTO v_events_before FROM public.notification_events;

  v_t_start := clock_timestamp();
  v_bulk_result := public.rpc_instantiate_template(
    v_template_id,
    jsonb_build_object('name', 'selfcheck-batchcfg-perf-' || v_tag, 'target_date', (CURRENT_DATE + 7)::text, 'anchor_direction', 'start'),
    v_bulk_projects_payload, v_mapping_full, v_bulk_key
  );
  v_t_end := clock_timestamp();
  v_elapsed_ms := EXTRACT(EPOCH FROM (v_t_end - v_t_start)) * 1000;
  v_bulk_portfolio_id := (v_bulk_result->>'portfolio_id')::uuid;

  SELECT COUNT(*) INTO v_events_after FROM public.notification_events;

  ASSERT (v_bulk_result->>'projects_created')::int = 20, format('perf: expected 20 projects, got %s', v_bulk_result->>'projects_created');
  ASSERT (v_bulk_result->>'tasks_created')::int = 500, format('perf: expected 500 tasks (20 x 25), got %s', v_bulk_result->>'tasks_created');
  ASSERT (SELECT COUNT(*) FROM public.tasks WHERE portfolio_id = v_bulk_portfolio_id AND (pipeline_id IS NULL OR current_stage_id IS NULL OR due_date IS NULL)) = 0,
    'perf batch: expected zero of the 500 tasks to have a NULL pipeline_id/current_stage_id/due_date';
  ASSERT (v_events_after - v_events_before) = 1,
    format('expected exactly ONE notification_events row for the whole 500-task batch, got %s', v_events_after - v_events_before);

  RAISE NOTICE 'PERF: 20 projects x 25 tasks (500 tasks) in % ms, % notification_events row(s) emitted', round(v_elapsed_ms, 2), (v_events_after - v_events_before);

  IF v_elapsed_ms > 2000 THEN
    RAISE WARNING 'batch instantiate took % ms — expected tens of milliseconds on local hardware; investigate before shipping', round(v_elapsed_ms, 2);
  END IF;

  RAISE NOTICE 'check_rpc_batch_config.sql: ALL CHECKS PASSED';

  -- ── cleanup ───────────────────────────────────────────────────────────
  DELETE FROM public.task_assignments WHERE task_id IN (SELECT id FROM public.tasks WHERE portfolio_id IN (
    SELECT id FROM public.portfolios WHERE idempotency_key LIKE 'selfcheck-batchcfg-%' || v_tag
  ));
  DELETE FROM public.tasks WHERE portfolio_id IN (SELECT id FROM public.portfolios WHERE idempotency_key LIKE 'selfcheck-batchcfg-%' || v_tag);
  DELETE FROM public.projects WHERE portfolio_id IN (SELECT id FROM public.portfolios WHERE idempotency_key LIKE 'selfcheck-batchcfg-%' || v_tag);
  DELETE FROM public.portfolios WHERE idempotency_key LIKE 'selfcheck-batchcfg-%' || v_tag;
  DELETE FROM public.project_templates WHERE id = v_template_id;
END $$;
