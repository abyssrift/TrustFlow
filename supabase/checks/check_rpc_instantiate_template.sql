-- check_rpc_instantiate_template.sql
--
-- NOT a migration — nothing under supabase/checks/ is auto-applied. Run this
-- by hand against a local/staging Postgres you can write to (NEVER prod):
--
--   psql "$LOCAL_DB_URL" -f supabase/checks/check_rpc_instantiate_template.sql
--
-- Smallest thing that fails if any of these regress:
--   1. the set-based insert (jsonb_to_recordset, no loop) — 3 project lines x
--      a 2-item template body must yield exactly 3 projects and 6 tasks.
--   2. the idempotency key — calling again with the SAME key must be a no-op
--      (already_processed = true, row counts unchanged), not a second batch.
--   3. (issue #171 gap 1 / plan §13.3) client identity keys off external_ref
--      when supplied: two projects that supply the SAME client_external_ref
--      but DIFFERENT client_ref (name) text must resolve to one client, not
--      two — and the name-only path (no ref supplied) must still work.
--   4. (issue #171 gap 2 / plan §13.4) the portfolio produced by instantiate
--      records template_id and a frozen copy of the template body, and
--      editing the template afterward does not retroactively change it.
--   5. (issue #171 gap 3 / plan §13.5) moving a task to a different project
--      (UPDATE tasks SET project_id = ...) must re-derive portfolio_id from
--      the new project, not leave the old (now-stale) value in place — and
--      undo must then leave that moved task alone.
--   6. (issue #182 / plan §13.10) every task produced carries a real
--      pipeline_id AND current_stage_id AND due_date — see
--      check_rpc_batch_config.sql for the full batch-configuration
--      coverage (category mapping, back-scheduling, reachability, perf);
--      this file only asserts the signature it calls still exists and still
--      produces non-NULL rows, so it doesn't silently bitrot.
--
-- Cleans up after itself (undoes the batch, deletes the scratch template/
-- projects/clients/tasks it created) so it's safe to re-run.

DO $$
DECLARE
  v_user_id               UUID;
  v_company_id            UUID;
  v_template_id           UUID;
  v_key                   TEXT := 'selfcheck-' || gen_random_uuid();
  v_tag                   TEXT;
  v_projects_payload      JSONB;
  v_category_mapping      JSONB;
  v_pipeline_id           UUID;
  v_result1               JSONB;
  v_result2               JSONB;
  v_project_count         INT;
  v_task_count            INT;
  v_portfolio_id          UUID;
  v_client_count          INT;
  v_other_project_id      UUID;
  v_moved_task_id         UUID;
  v_portfolio_after_move  UUID;
  v_template_id_on_portfolio UUID;
  v_snapshot              JSONB;
  v_orig_body             JSONB := '[{"title":"Task A","priority":"medium","category":"General"},{"title":"Task B","priority":"low","category":"General"}]'::jsonb;
BEGIN
  SELECT id, company_id INTO v_user_id, v_company_id
  FROM public.users WHERE is_owner = true LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No owner user found — run this against a seeded dev DB, not prod.';
  END IF;

  -- Impersonate that owner so my_company_id()/has_permission()/auth.uid() resolve.
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  -- projects_company_id_name_key is UNIQUE (company_id, name) and NOT partial
  -- on deleted_at — rpc_undo_portfolio_instantiation only soft-deletes, so a
  -- fixed name used by any earlier run of this check (or another agent's) on
  -- this shared DB permanently reserves it. Tag every name/ref with a fresh
  -- suffix per run instead of relying on cleanup to free names back up.
  v_tag := replace(gen_random_uuid()::text, '-', '');

  -- issue #182: rpc_instantiate_template now requires a real, owned pipeline
  -- for every category the template body uses — reuse any pipeline that
  -- already has a stage rather than seed a scratch one.
  SELECT p.id INTO v_pipeline_id
  FROM public.pipelines p
  WHERE p.company_id = v_company_id AND p.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.pipeline_stages s WHERE s.pipeline_id = p.id)
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    RAISE EXCEPTION 'No pipeline with at least one stage found for this company — seed one before running this check.';
  END IF;

  v_category_mapping := jsonb_build_array(jsonb_build_object('category', 'General', 'pipeline_id', v_pipeline_id));

  INSERT INTO public.project_templates (company_id, name, body, created_by)
  VALUES (v_company_id, 'selfcheck-template-' || v_tag, v_orig_body, v_user_id)
  RETURNING id INTO v_template_id;

  -- Row 1: no ref, name-only path (must keep working — plan says most lines
  -- won't carry a ref). Row 2 and 3: SAME client_external_ref but DIFFERENT
  -- client_ref text ("Abdallah Group" vs "Abdallah Group LLC") — must
  -- collapse to one client (gap 1).
  v_projects_payload := jsonb_build_array(
    jsonb_build_object('name', 'Solo ' || v_tag, 'client_ref', 'Solo Client ' || v_tag),
    jsonb_build_object('name', 'Abdallah A ' || v_tag, 'client_ref', 'Abdallah Group', 'client_external_ref', 'CR-' || v_tag),
    jsonb_build_object('name', 'Abdallah B ' || v_tag, 'client_ref', 'Abdallah Group LLC', 'client_external_ref', 'CR-' || v_tag)
  );

  v_result1 := public.rpc_instantiate_template(
    v_template_id,
    jsonb_build_object('name', 'selfcheck-portfolio-' || v_tag, 'target_date', (CURRENT_DATE + 7)::text, 'anchor_direction', 'start'),
    v_projects_payload,
    v_category_mapping,
    v_key
  );

  v_project_count := (v_result1->>'projects_created')::int;
  v_task_count    := (v_result1->>'tasks_created')::int;
  v_portfolio_id  := (v_result1->>'portfolio_id')::uuid;

  ASSERT v_project_count = 3, format('expected 3 projects, got %s', v_project_count);
  ASSERT v_task_count = 6, format('expected 6 tasks (3 projects x 2 template items), got %s', v_task_count);

  ASSERT (SELECT COUNT(*) FROM public.clients WHERE name = 'Solo Client ' || v_tag AND company_id = v_company_id) = 1,
    'expected the name-only path to still upsert a client with no ref';

  -- Gap 1: same ref, different name text -> exactly ONE client, regardless of
  -- which row's insert won the ON CONFLICT (company_id, external_ref) race.
  SELECT COUNT(*) INTO v_client_count
  FROM public.clients WHERE external_ref = 'CR-' || v_tag AND company_id = v_company_id;
  ASSERT v_client_count = 1,
    format('expected exactly 1 client for external_ref CR-%s (name drift must not fork it), got %s', v_tag, v_client_count);

  ASSERT (
    SELECT COUNT(DISTINCT client_id) FROM public.projects
    WHERE portfolio_id = v_portfolio_id AND deleted_at IS NULL
      AND name IN ('Abdallah A ' || v_tag, 'Abdallah B ' || v_tag)
  ) = 1, 'expected both same-ref projects to point at the SAME client_id';

  -- issue #182: this is the whole point of the batch-config step. A task
  -- with NULL pipeline_id/current_stage_id/due_date is invisible — the bug
  -- this issue exists to close. See check_rpc_batch_config.sql for full
  -- coverage; this is the smoke-test slice for THIS RPC's default call shape.
  ASSERT (
    SELECT COUNT(*) FROM public.tasks
    WHERE portfolio_id = v_portfolio_id AND deleted_at IS NULL
      AND (pipeline_id IS NULL OR current_stage_id IS NULL OR due_date IS NULL)
  ) = 0, 'expected zero tasks with a NULL pipeline_id/current_stage_id/due_date';

  ASSERT (
    SELECT COUNT(*) FROM public.projects
    WHERE portfolio_id = v_portfolio_id AND deleted_at IS NULL
      AND (start_date IS NULL OR due_date IS NULL)
  ) = 0, 'expected zero projects with a NULL start_date/due_date';

  -- Gap 2: the portfolio records what produced it.
  SELECT template_id, template_body_snapshot INTO v_template_id_on_portfolio, v_snapshot
  FROM public.portfolios WHERE id = v_portfolio_id;
  ASSERT v_template_id_on_portfolio = v_template_id, 'expected portfolios.template_id to point at the source template';
  ASSERT v_snapshot = v_orig_body,
    'expected template_body_snapshot to be a frozen copy of the template body at instantiate time';

  -- Editing the template afterward must NOT retroactively change the
  -- snapshot already on this portfolio (that's the entire point of gap 2).
  UPDATE public.project_templates SET body = '[{"title":"Edited later","priority":"high"}]'::jsonb WHERE id = v_template_id;
  ASSERT (SELECT template_body_snapshot FROM public.portfolios WHERE id = v_portfolio_id) = v_orig_body,
    'template_body_snapshot must stay frozen after the template is edited';

  -- Idempotency: same key again must be a no-op, not a second batch.
  v_result2 := public.rpc_instantiate_template(
    v_template_id,
    jsonb_build_object('name', 'selfcheck-portfolio-' || v_tag, 'target_date', (CURRENT_DATE + 7)::text, 'anchor_direction', 'start'),
    v_projects_payload,
    v_category_mapping,
    v_key
  );
  ASSERT (v_result2->>'already_processed')::boolean = true, 'repeat call with the same idempotency_key must be a no-op';
  ASSERT (SELECT COUNT(*) FROM public.projects WHERE portfolio_id = v_portfolio_id AND deleted_at IS NULL) = 3,
    'a repeat call must not double the projects';

  -- Gap 3: portfolio_id must derive from project_id, enforced on write. Move
  -- one of the batch's tasks to a NEW project that has no portfolio, and its
  -- portfolio_id must follow (become NULL), not stay stuck at the old batch.
  INSERT INTO public.projects (company_id, name, status, created_by)
  VALUES (v_company_id, 'selfcheck-other-project-' || v_tag, 'active', v_user_id)
  RETURNING id INTO v_other_project_id;

  SELECT id INTO v_moved_task_id FROM public.tasks WHERE portfolio_id = v_portfolio_id LIMIT 1;
  ASSERT v_moved_task_id IS NOT NULL, 'expected at least one task in the batch to move';

  UPDATE public.tasks SET project_id = v_other_project_id WHERE id = v_moved_task_id;

  SELECT portfolio_id INTO v_portfolio_after_move FROM public.tasks WHERE id = v_moved_task_id;
  ASSERT v_portfolio_after_move IS NULL,
    format('expected moved task''s portfolio_id to follow its new (portfolio-less) project and become NULL, got %s', v_portfolio_after_move);

  -- Undo must now leave the moved task alone (it is no longer in the batch)
  -- and only remove what is still actually tagged with this portfolio.
  PERFORM public.rpc_undo_portfolio_instantiation(v_portfolio_id);
  ASSERT (SELECT deleted_at FROM public.tasks WHERE id = v_moved_task_id) IS NULL,
    'undo must not touch a task that moved out of the batch before undo ran';
  ASSERT (SELECT COUNT(*) FROM public.projects WHERE portfolio_id = v_portfolio_id AND deleted_at IS NULL) = 0,
    'undo must soft-delete every remaining project in the batch';

  RAISE NOTICE 'rpc_instantiate_template self-check PASSED (% projects, % tasks, idempotency held, external_ref matching held, template provenance held, portfolio_id-on-move guard held)',
    v_project_count, v_task_count;

  -- Cleanup.
  DELETE FROM public.tasks WHERE id = v_moved_task_id;
  DELETE FROM public.projects WHERE id = v_other_project_id;
  DELETE FROM public.project_templates WHERE id = v_template_id;
  DELETE FROM public.clients WHERE company_id = v_company_id
    AND (name = 'Solo Client ' || v_tag OR external_ref = 'CR-' || v_tag);
END $$;
