-- 20260731_project_hierarchy_5_gap_fixes.sql
-- Issue #171 — three gaps identified in docs/PROJECT_HIERARCHY_PLAN.md
-- §13.3-13.5, found after Phase 1 was built and load-tested. Additive on top
-- of 20260731_project_hierarchy_{1,2,3}_*.sql — those files are NOT rewritten.
-- Does not touch 20260731_project_hierarchy_4_rls_placeholder.sql.
--
-- Gap 1 (§13.3): clients.external_ref becomes a matchable, stable key instead
--                of just a storable column the bulk path never fills in.
-- Gap 2 (§13.4): portfolios record which template produced them, plus a
--                frozen snapshot of the template body at instantiate time —
--                a snapshot column, not a version table (mirrors §4's
--                reasoning for keeping project_templates.body a single jsonb).
-- Gap 3 (§13.5): tasks.portfolio_id can no longer drift from its project's
--                portfolio_id — enforced by trigger on every INSERT/UPDATE
--                of project_id, not left to caller discipline. Verified
--                empirically on the local stack that a BEFORE INSERT trigger
--                on tasks *can* see a sibling CTE's just-inserted projects
--                row within the same multi-CTE statement (Postgres runs
--                data-modifying WITH sub-statements with command-counter
--                increments between them), so this is safe to apply to the
--                same set-based INSERT rpc_instantiate_template already uses.

-- ── Gap 1: external_ref must be a usable matching key ───────────────────────
-- A plain UNIQUE index, not a partial one: NULLs never conflict with each
-- other in a Postgres unique constraint, so rows created via the pre-existing
-- name-only path (external_ref IS NULL) are completely unaffected — this only
-- constrains the rows that actually supply a ref. IF NOT EXISTS keeps this
-- idempotent for a shared local stack.
CREATE UNIQUE INDEX IF NOT EXISTS clients_company_external_ref_key
  ON public.clients (company_id, external_ref);

-- ── Gap 2: provenance on the batch ───────────────────────────────────────────
ALTER TABLE public.portfolios
  ADD COLUMN IF NOT EXISTS template_id             UUID REFERENCES public.project_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS template_body_snapshot  JSONB;

CREATE INDEX IF NOT EXISTS idx_portfolios_template ON public.portfolios (template_id) WHERE deleted_at IS NULL;

-- ── Gap 3: portfolio_id on a task is derived, never trusted ─────────────────
-- Fires on INSERT (covers rpc_instantiate_template's bulk insert — redundant
-- there today since that RPC already sets the matching value by construction,
-- but the guard now holds even if a future insert path forgets to) and on
-- UPDATE OF project_id (covers moving a task to a different project, which is
-- the specific failure mode §13.5 names: "move a task between projects and
-- undo takes the wrong rows"). A task with no project has no portfolio via
-- this path, matching every pre-Phase-1 task.
CREATE OR REPLACE FUNCTION public.fn_tasks_sync_portfolio_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.project_id IS NULL THEN
    NEW.portfolio_id := NULL;
  ELSE
    SELECT p.portfolio_id INTO NEW.portfolio_id
    FROM public.projects p
    WHERE p.id = NEW.project_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Fires on portfolio_id as well as project_id. With `OF project_id` alone the
-- trigger never sees a direct `UPDATE tasks SET portfolio_id = ...`, so a
-- caller could point a task at a batch it is not part of and undo on that
-- portfolio would sweep it — the exact drift gap 3 exists to prevent.
-- Verified: with the narrower clause the forged value stuck.
-- Listing both columns rather than dropping OF entirely keeps this off the
-- hot path — `tasks` is written constantly and every other column update
-- would otherwise pay for a lookup on `projects`.
DROP TRIGGER IF EXISTS trg_tasks_sync_portfolio_id ON public.tasks;
CREATE TRIGGER trg_tasks_sync_portfolio_id
  BEFORE INSERT OR UPDATE OF project_id, portfolio_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.fn_tasks_sync_portfolio_id();

-- ── rpc_instantiate_template — extended, not rewritten from scratch ─────────
-- Same set-based shape (jsonb_to_recordset, single transaction, no loop) and
-- all three §7 hazards (transaction-local trustflow.bulk_instantiate GUC,
-- UNIQUE (company_id, idempotency_key), portfolio-scoped undo) untouched.
-- Two changes only:
--   1. p_projects rows may now carry an optional client_external_ref. When
--      present, the client is matched/created on that ref instead of on
--      name — Gap 1. Rows with no ref keep the exact old behavior (matched
--      on client_ref-as-name), so most lines (which won't carry a ref) are
--      unaffected.
--   2. The portfolio row now stores template_id and a frozen copy of the
--      template body — Gap 2.
-- Judgment call: if a ref is supplied but no client with that ref exists yet,
-- a NEW client is created rather than fuzzy-merged into any name-similar
-- existing row — matching on name once a ref is in play would reintroduce
-- exactly the silent-merge risk this gap exists to remove.
CREATE OR REPLACE FUNCTION public.rpc_instantiate_template(
  p_template_id     UUID,
  p_portfolio       JSONB,
  p_projects        JSONB,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id        UUID := public.my_company_id();
  v_user_id           UUID := auth.uid();
  v_template          public.project_templates;
  v_portfolio_id      UUID;
  v_existing_id       UUID;
  v_project_count     INT;
  v_task_count        INT;
BEGIN
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('project.create')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to instantiate templates.';
  END IF;

  IF p_idempotency_key IS NULL OR TRIM(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'Idempotency key is required.';
  END IF;

  IF p_projects IS NULL OR jsonb_typeof(p_projects) <> 'array' OR jsonb_array_length(p_projects) = 0 THEN
    RAISE EXCEPTION 'At least one project is required.';
  END IF;

  -- Hazard 2: a repeat call with the same key is a no-op, returning the
  -- original batch's counts instead of creating a second copy.
  SELECT id INTO v_existing_id
  FROM public.portfolios
  WHERE company_id = v_company_id AND idempotency_key = p_idempotency_key;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'portfolio_id', v_existing_id,
      'already_processed', true,
      'projects_created', (SELECT COUNT(*) FROM public.projects WHERE portfolio_id = v_existing_id AND deleted_at IS NULL),
      'tasks_created', (SELECT COUNT(*) FROM public.tasks WHERE portfolio_id = v_existing_id AND deleted_at IS NULL)
    );
  END IF;

  SELECT * INTO v_template
  FROM public.project_templates
  WHERE id = p_template_id AND company_id = v_company_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found.';
  END IF;

  -- 1. The portfolio row IS the undo batch (plan §7). Gap 2: record which
  -- template produced it and freeze a copy of its body as of right now, so
  -- editing the template later cannot retroactively change what this batch
  -- appears to have been built from.
  INSERT INTO public.portfolios (
    company_id, name, source, received_at, target_date, manifest,
    idempotency_key, created_by, template_id, template_body_snapshot
  )
  VALUES (
    v_company_id,
    COALESCE(NULLIF(TRIM(p_portfolio->>'name'), ''), v_template.name || ' batch'),
    p_portfolio->>'source',
    COALESCE((p_portfolio->>'received_at')::timestamptz, now()),
    (p_portfolio->>'target_date')::timestamptz,
    COALESCE(p_portfolio->'manifest', '[]'::jsonb),
    p_idempotency_key,
    v_user_id,
    v_template.id,
    v_template.body
  )
  RETURNING id INTO v_portfolio_id;

  -- 2a. Upsert clients that carry a stable external_ref — matched/created on
  -- that ref, not on name (Gap 1 / plan §13.3).
  INSERT INTO public.clients (company_id, name, external_ref)
  SELECT DISTINCT v_company_id, NULLIF(TRIM(x.client_ref), ''), NULLIF(TRIM(x.client_external_ref), '')
  FROM jsonb_to_recordset(p_projects) AS x(name TEXT, client_ref TEXT, client_external_ref TEXT, start_date TIMESTAMPTZ)
  WHERE NULLIF(TRIM(COALESCE(x.client_external_ref, '')), '') IS NOT NULL
  -- The WHERE matches the partial index predicate from _6_ (issue #180) so
  -- ON CONFLICT can still infer it. Without it: "no unique or exclusion
  -- constraint matching the ON CONFLICT specification".
  ON CONFLICT (company_id, external_ref) WHERE deleted_at IS NULL DO NOTHING;

  -- 2b. Existing name-only path, unchanged, for every row that did NOT
  -- supply a ref — this is still most lines (plan §13.3: "most lines will
  -- not carry a ref").
  INSERT INTO public.clients (company_id, name, external_ref)
  SELECT DISTINCT v_company_id, NULLIF(TRIM(x.client_ref), ''), NULL
  FROM jsonb_to_recordset(p_projects) AS x(name TEXT, client_ref TEXT, client_external_ref TEXT, start_date TIMESTAMPTZ)
  WHERE NULLIF(TRIM(COALESCE(x.client_ref, '')), '') IS NOT NULL
    AND NULLIF(TRIM(COALESCE(x.client_external_ref, '')), '') IS NULL
  -- Predicate matches the partial index from _6_ (issue #180), as above.
  ON CONFLICT (company_id, name) WHERE deleted_at IS NULL DO NOTHING;

  -- 3. Skip per-row notification fan-out for the whole bulk insert below
  -- (Hazard 1). is_local = true: scoped to this transaction, auto-clears.
  PERFORM set_config('trustflow.bulk_instantiate', 'on', true);

  -- 4. Set-based insert: projects, then tasks, then team assignments — all
  -- from one WITH block, no loop. task_items pre-generates each task's id so
  -- new_tasks and new_assignments can both key off it (a CTE referenced more
  -- than once is materialized once in Postgres, so the ids line up).
  -- new_projects resolves each row's client by external_ref first (Gap 1),
  -- falling back to name when no ref was supplied — trg_tasks_sync_portfolio_id
  -- (Gap 3) independently re-derives new_tasks.portfolio_id from project_id,
  -- so the explicit v_portfolio_id passed into the INSERT below is now a
  -- belt-and-braces value, not the only source of truth.
  WITH incoming AS (
    SELECT
      NULLIF(TRIM(x.name), '')                 AS name,
      NULLIF(TRIM(x.client_ref), '')            AS client_ref,
      NULLIF(TRIM(x.client_external_ref), '')   AS client_external_ref,
      x.start_date                               AS start_date
    FROM jsonb_to_recordset(p_projects) AS x(name TEXT, client_ref TEXT, client_external_ref TEXT, start_date TIMESTAMPTZ)
  ),
  new_projects AS (
    INSERT INTO public.projects (company_id, name, description, color, status, start_date, portfolio_id, client_id, created_by)
    SELECT v_company_id, i.name, v_template.description, v_template.color, 'active', i.start_date, v_portfolio_id, c.id, v_user_id
    FROM incoming i
    LEFT JOIN public.clients c
      ON c.company_id = v_company_id
      AND (
        (i.client_external_ref IS NOT NULL AND c.external_ref = i.client_external_ref)
        OR (i.client_external_ref IS NULL AND c.name = i.client_ref)
      )
    WHERE i.name IS NOT NULL
    RETURNING id, start_date
  ),
  task_items AS (
    SELECT
      gen_random_uuid() AS task_id,
      np.id              AS project_id,
      np.start_date      AS project_start_date,
      item->>'title'                                  AS title,
      item->>'description'                            AS description,
      (SELECT p.id FROM public.pipelines p
        WHERE p.id = NULLIF(item->>'pipeline_id', '')::uuid
          AND p.company_id = v_company_id AND p.deleted_at IS NULL)  AS pipeline_id,
      item->>'category'                               AS category,
      COALESCE(item->>'priority', 'medium')           AS priority,
      COALESCE((item->>'weight')::bigint, 1)          AS weight,
      NULLIF(item->>'estimated_hours', '')::numeric   AS estimated_hours,
      NULLIF(item->>'due_offset_days', '')::int       AS due_offset_days,
      NULLIF(item->>'assignee_team_id', '')::uuid     AS assignee_team_id
    FROM new_projects np
    CROSS JOIN LATERAL jsonb_array_elements(v_template.body) AS item
  ),
  new_tasks AS (
    INSERT INTO public.tasks (
      id, company_id, title, description, pipeline_id, category, priority, weight,
      estimated_hours, due_date, project_id, portfolio_id, created_by, manager_id
    )
    SELECT
      ti.task_id, v_company_id, ti.title, ti.description, ti.pipeline_id, ti.category, ti.priority, ti.weight,
      ti.estimated_hours,
      CASE WHEN ti.due_offset_days IS NOT NULL AND ti.project_start_date IS NOT NULL
           THEN ti.project_start_date + (ti.due_offset_days || ' days')::interval
           ELSE NULL END,
      ti.project_id, v_portfolio_id, v_user_id, v_user_id
    FROM task_items ti
    RETURNING id
  ),
  new_assignments AS (
    INSERT INTO public.task_assignments (task_id, company_id, assignee_team_id, assigned_by)
    SELECT ti.task_id, v_company_id, ti.assignee_team_id, v_user_id
    FROM task_items ti
    WHERE ti.assignee_team_id IS NOT NULL
    RETURNING id
  )
  SELECT (SELECT COUNT(*) FROM new_projects), (SELECT COUNT(*) FROM new_tasks)
  INTO v_project_count, v_task_count;

  IF v_project_count = 0 THEN
    RAISE EXCEPTION 'No valid project rows (every line was blank).';
  END IF;

  -- 5. One event for the whole batch instead of one per task (Hazard 1).
  PERFORM public.fn_emit_notification_event(
    'project.created_from_template',
    'portfolio',
    v_portfolio_id,
    v_user_id,
    jsonb_build_object(
      'portfolio_id', v_portfolio_id,
      'template_id', p_template_id,
      'projects_created', v_project_count,
      'tasks_created', v_task_count
    )
  );

  PERFORM public.log_event(v_company_id, v_user_id, 'portfolio', v_portfolio_id, 'portfolio.instantiated',
    jsonb_build_object('template_id', p_template_id, 'projects_created', v_project_count, 'tasks_created', v_task_count));

  RETURN jsonb_build_object(
    'portfolio_id', v_portfolio_id,
    'already_processed', false,
    'projects_created', v_project_count,
    'tasks_created', v_task_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_instantiate_template TO authenticated;
