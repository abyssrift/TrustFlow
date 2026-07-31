-- check_rpc_instantiate_template.sql
--
-- NOT a migration — nothing under supabase/checks/ is auto-applied. Run this
-- by hand against a local/staging Postgres you can write to (NEVER prod):
--
--   psql "$LOCAL_DB_URL" -f supabase/checks/check_rpc_instantiate_template.sql
--
-- Smallest thing that fails if either of the two riskiest pieces of
-- rpc_instantiate_template regresses:
--   1. the set-based insert (jsonb_to_recordset, no loop) — 2 project lines x
--      a 2-item template body must yield exactly 2 projects and 4 tasks.
--   2. the idempotency key — calling again with the SAME key must be a no-op
--      (already_processed = true, row counts unchanged), not a second batch.
--
-- Cleans up after itself (undoes the batch, deletes the scratch template) so
-- it's safe to re-run.

DO $$
DECLARE
  v_user_id       UUID;
  v_company_id    UUID;
  v_template_id   UUID;
  v_key           TEXT := 'selfcheck-' || gen_random_uuid();
  v_result1       JSONB;
  v_result2       JSONB;
  v_project_count INT;
  v_task_count    INT;
BEGIN
  SELECT id, company_id INTO v_user_id, v_company_id
  FROM public.users WHERE is_owner = true LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No owner user found — run this against a seeded dev DB, not prod.';
  END IF;

  -- Impersonate that owner so my_company_id()/has_permission()/auth.uid() resolve.
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  INSERT INTO public.project_templates (company_id, name, body, created_by)
  VALUES (
    v_company_id,
    'selfcheck-template',
    '[{"title":"Task A","priority":"medium"},{"title":"Task B","priority":"low"}]'::jsonb,
    v_user_id
  )
  RETURNING id INTO v_template_id;

  v_result1 := public.rpc_instantiate_template(
    v_template_id,
    jsonb_build_object('name', 'selfcheck-portfolio'),
    '[{"name":"Selfcheck Client One"},{"name":"Selfcheck Client Two"}]'::jsonb,
    v_key
  );

  v_project_count := (v_result1->>'projects_created')::int;
  v_task_count    := (v_result1->>'tasks_created')::int;

  ASSERT v_project_count = 2, format('expected 2 projects, got %s', v_project_count);
  ASSERT v_task_count = 4, format('expected 4 tasks (2 projects x 2 template items), got %s', v_task_count);
  ASSERT (SELECT COUNT(*) FROM public.clients WHERE name IN ('Selfcheck Client One', 'Selfcheck Client Two') AND company_id = v_company_id) = 2,
    'expected clients to be upserted by name';

  -- Idempotency: same key again must be a no-op, not a second batch.
  v_result2 := public.rpc_instantiate_template(
    v_template_id,
    jsonb_build_object('name', 'selfcheck-portfolio'),
    '[{"name":"Selfcheck Client One"},{"name":"Selfcheck Client Two"}]'::jsonb,
    v_key
  );
  ASSERT (v_result2->>'already_processed')::boolean = true, 'repeat call with the same idempotency_key must be a no-op';
  ASSERT (SELECT COUNT(*) FROM public.projects WHERE portfolio_id = (v_result1->>'portfolio_id')::uuid AND deleted_at IS NULL) = 2,
    'a repeat call must not double the projects';

  RAISE NOTICE 'rpc_instantiate_template self-check PASSED (% projects, % tasks, idempotency held)', v_project_count, v_task_count;

  -- Cleanup.
  PERFORM public.rpc_undo_portfolio_instantiation((v_result1->>'portfolio_id')::uuid);
  DELETE FROM public.project_templates WHERE id = v_template_id;
  DELETE FROM public.clients WHERE name IN ('Selfcheck Client One', 'Selfcheck Client Two') AND company_id = v_company_id;
END $$;
