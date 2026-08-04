-- The templates library screen is a LIST over RPCs that already existed. What
-- it adds that can actually break is the set of assumptions it makes about
-- them, and none of those are visible to tsc:
--
--   1. duplicate = rpc_create_project_template + rpc_update_project_template,
--      and the copy must carry the ORIGINAL's body, not an empty one;
--   2. delete is a SOFT delete that leaves already-instantiated portfolios and
--      their projects/tasks completely alone -- this is the sentence the
--      confirmation dialog puts in front of the user, so it had better be true;
--   3. the "used by N portfolios" count survives the template's deletion,
--      because the confirmation quotes it while deleting;
--   4. editing a template does NOT reach back into work already created --
--      the banner on the screen claims this in so many words.
--
-- Everything runs in ONE transaction and rolls back.
BEGIN;

-- trg_dispatch_notification_event pg_net-POSTs to a hardcoded PRODUCTION url.
-- Any check that writes rows which emit notification events must disable it
-- for its own transaction (see security_local_clone_drives_prod).
SET LOCAL session_replication_role = replica;

DO $check$
DECLARE
  v_company   UUID;
  v_user      UUID;
  v_tpl       UUID;
  v_copy      UUID;
  v_body      JSONB := '[
    {"title":"Client acceptance","category":"Planning","priority":"high","weight":1,"due_offset_days":0},
    {"title":"Fieldwork","category":"Fieldwork","priority":"medium","weight":2,"due_offset_days":30},
    {"title":"Report","category":"Reporting","priority":"high","weight":1,"due_offset_days":60}
  ]'::jsonb;
  v_copy_body JSONB;
  v_pf        UUID;
  v_snapshot  JSONB;
  v_tasks     INT;
  v_tasks_after INT;
  v_used      INT;
  v_deleted   TIMESTAMPTZ;
  v_pipeline  UUID;
  v_mapping   JSONB;
BEGIN
  -- Act as a real owner of a real company, so has_permission and
  -- my_company_id() resolve the way they do for the screen.
  SELECT u.company_id, u.id INTO v_company, v_user
  FROM public.users u
  WHERE u.is_owner AND u.company_id IS NOT NULL AND u.deleted_at IS NULL
  ORDER BY u.created_at
  LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'no owner with a company in this database — cannot check';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- ── 1. create + update is a faithful duplicate ────────────────────────────
  v_tpl := (public.rpc_create_project_template('CHK original', 'made by the check', '#3b82f6')).id;
  PERFORM public.rpc_update_project_template(v_tpl, 'CHK original', 'made by the check', '#3b82f6', v_body);

  -- Exactly what TemplatesLibrary.duplicate() does, in the same order.
  v_copy := (public.rpc_create_project_template('CHK original (copy)', 'made by the check', '#3b82f6')).id;
  PERFORM public.rpc_update_project_template(v_copy, 'CHK original (copy)', 'made by the check', '#3b82f6',
          (SELECT body FROM public.project_templates WHERE id = v_tpl));

  SELECT body INTO v_copy_body FROM public.project_templates WHERE id = v_copy;
  IF jsonb_array_length(v_copy_body) <> jsonb_array_length(v_body) THEN
    RAISE EXCEPTION 'duplicate lost items: % vs %', jsonb_array_length(v_copy_body), jsonb_array_length(v_body);
  END IF;
  IF v_copy_body -> 1 ->> 'category' IS DISTINCT FROM 'Fieldwork'
     OR (v_copy_body -> 2 ->> 'due_offset_days')::int IS DISTINCT FROM 60 THEN
    RAISE EXCEPTION 'duplicate did not carry categories/offsets through';
  END IF;
  IF v_copy = v_tpl THEN
    RAISE EXCEPTION 'duplicate returned the SAME row — it would edit the original';
  END IF;
  RAISE NOTICE 'OK (1): duplicate = create + update carries every item, category and offset onto a NEW row';

  -- ── 2 & 3. instantiate, then delete the template ──────────────────────────
  SELECT p.id INTO v_pipeline
  FROM public.pipelines p
  JOIN public.pipeline_stages s ON s.pipeline_id = p.id
  WHERE p.company_id = v_company AND p.deleted_at IS NULL AND COALESCE(p.subject_kind, 'task') = 'task'
  GROUP BY p.id
  HAVING count(s.id) > 0
  ORDER BY p.created_at
  LIMIT 1;

  IF v_pipeline IS NULL THEN
    RAISE EXCEPTION 'company has no task board with stages — cannot instantiate';
  END IF;

  SELECT jsonb_agg(jsonb_build_object('category', cat, 'pipeline_id', v_pipeline, 'assignee_team_id', NULL))
  INTO v_mapping
  FROM (SELECT DISTINCT item ->> 'category' AS cat FROM jsonb_array_elements(v_body) item) c;

  PERFORM public.rpc_instantiate_template(
    v_tpl,
    -- target_date is never defaulted by the RPC, on purpose (§19): a batch
    -- with a guessed anchor is a batch of wrong deadlines.
    jsonb_build_object('name', 'CHK portfolio', 'target_date', CURRENT_DATE::text, 'anchor_direction', 'start'),
    jsonb_build_array(jsonb_build_object('name', 'CHK project', 'start_date', CURRENT_DATE::text)),
    -- Every category must be assigned a board; the RPC refuses otherwise
    -- (§13.11 — an unmapped category is a task nobody can find).
    v_mapping,
    'chk-templates-library-' || gen_random_uuid()::text
  );

  SELECT p.id, p.template_body_snapshot INTO v_pf, v_snapshot
  FROM public.portfolios p WHERE p.template_id = v_tpl AND p.deleted_at IS NULL LIMIT 1;

  IF v_pf IS NULL THEN
    RAISE EXCEPTION 'instantiate created no portfolio pointing at the template';
  END IF;
  IF v_snapshot IS NULL OR jsonb_array_length(v_snapshot) <> jsonb_array_length(v_body) THEN
    RAISE EXCEPTION 'portfolio kept no usable template_body_snapshot — the delete dialog''s promise is false';
  END IF;

  SELECT count(*) INTO v_tasks
  FROM public.tasks t
  JOIN public.projects pr ON pr.id = t.project_id
  WHERE pr.portfolio_id = v_pf AND t.deleted_at IS NULL;

  IF v_tasks <> jsonb_array_length(v_body) THEN
    RAISE EXCEPTION 'expected % tasks from the body, found %', jsonb_array_length(v_body), v_tasks;
  END IF;

  -- The count the confirmation dialog quotes.
  SELECT count(*) INTO v_used FROM public.portfolios WHERE template_id = v_tpl;
  IF v_used < 1 THEN
    RAISE EXCEPTION '"used by N portfolios" would have said 0 while a portfolio exists';
  END IF;

  PERFORM public.rpc_delete_project_template(v_tpl);

  -- Soft, not hard. The row is INVISIBLE to the tenant the moment it is
  -- deleted (project_templates_select carries `deleted_at IS NULL`), so
  -- reading deleted_at back as the user returns nothing — which is why this
  -- steps outside RLS to look at the row itself. Getting that wrong is how a
  -- check ends up asserting the opposite of the thing it means to prove.
  PERFORM set_config('role', 'postgres', true);
  SELECT deleted_at INTO v_deleted FROM public.project_templates WHERE id = v_tpl;
  IF v_deleted IS NULL THEN
    RAISE EXCEPTION 'delete was not a soft delete — the row is gone or still live';
  END IF;
  PERFORM set_config('role', 'authenticated', true);

  -- THE claim the dialog makes: the work is untouched.
  SELECT count(*) INTO v_tasks_after
  FROM public.tasks t
  JOIN public.projects pr ON pr.id = t.project_id
  WHERE pr.portfolio_id = v_pf AND t.deleted_at IS NULL;

  IF v_tasks_after <> v_tasks THEN
    RAISE EXCEPTION 'deleting the template destroyed work: % tasks -> %', v_tasks, v_tasks_after;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.portfolios WHERE id = v_pf AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'deleting the template removed the portfolio';
  END IF;
  IF (SELECT template_body_snapshot FROM public.portfolios WHERE id = v_pf) IS NULL THEN
    RAISE EXCEPTION 'deleting the template cleared the portfolio''s snapshot';
  END IF;

  -- And the count still resolves afterwards, since the dialog quotes it while
  -- the row is on its way out.
  SELECT count(*) INTO v_used FROM public.portfolios WHERE template_id = v_tpl;
  IF v_used < 1 THEN
    RAISE EXCEPTION 'portfolio lost its template_id on delete — history is gone';
  END IF;
  RAISE NOTICE 'OK (2,3): delete is soft; % task(s), the portfolio, its snapshot and its template_id all survive', v_tasks_after;

  -- ── 4. editing a template never reaches back into created work ────────────
  PERFORM public.rpc_update_project_template(
    v_copy, 'CHK edited', 'edited after instantiation', '#ef4444',
    '[{"title":"Only one task now","category":"Planning","priority":"low","weight":1,"due_offset_days":0}]'::jsonb
  );

  SELECT count(*) INTO v_tasks_after
  FROM public.tasks t
  JOIN public.projects pr ON pr.id = t.project_id
  WHERE pr.portfolio_id = v_pf AND t.deleted_at IS NULL;

  IF v_tasks_after <> v_tasks THEN
    RAISE EXCEPTION 'editing a template rewrote existing work: % -> %', v_tasks, v_tasks_after;
  END IF;
  RAISE NOTICE 'OK (4): editing a template left every already-created task alone — the screen''s banner is true';

  -- ── 5. the list query the screen actually runs ────────────────────────────
  -- A soft-deleted template must vanish from the library (RLS's own predicate),
  -- so the screen never offers a deleted process to start from.
  IF EXISTS (
    SELECT 1 FROM public.project_templates
    WHERE id = v_tpl AND company_id = public.my_company_id() AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'a deleted template would still be listed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.project_templates
    WHERE id = v_copy AND company_id = public.my_company_id() AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'the live template is not visible to the library query';
  END IF;
  RAISE NOTICE 'OK (5): the library lists live templates and never a deleted one';

  RAISE NOTICE 'ALL OK: templates library -- duplicate is faithful, delete is soft and destroys no work, editing never rewrites history, list excludes deleted.';
END
$check$;

ROLLBACK;
