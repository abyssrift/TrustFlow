-- 20260801_batch_duplicate_name_check.sql
-- Issue #182 follow-up — running the shipped batch-config wizard live produced
-- a green preview ("4 projects · 56 tasks · 1 board · first task Sep 13, last
-- Sep 30") and then a raw Postgres error on commit:
--   duplicate key value violates unique constraint "projects_company_id_name_key"
-- That constraint is a partial unique index — UNIQUE (company_id, name) WHERE
-- deleted_at IS NULL — working exactly as designed (verified live). The bug is
-- that nothing upstream of it ever checked for this. Two things were wrong:
--   1. §13.10's contract is "a successful preview is a promise the commit will
--      also succeed." rpc_preview_instantiate_template never looked at
--      existing project names, so it could go green on a batch guaranteed to
--      fail on commit. Fixed here, in the RPC — not the client — for the same
--      reason fn_resolve_batch_category_mapping lives server-side: preview and
--      commit share the exact resolver, so they cannot drift. A client-side
--      pre-check would need its own query and its own copy of "what counts as
--      a collision" (active vs soft-deleted), which is precisely the kind of
--      duplicated validation this design has avoided everywhere else.
--   2. The raw constraint-violation message ("duplicate key value violates...")
--      reached the user verbatim. It names no project. Every other failure mode
--      in this feature (unmapped category, foreign pipeline_id, no stages) is a
--      RAISE that names the offender explicitly — this is the same treatment,
--      extended to duplicate names.
--
-- fn_check_batch_duplicate_names covers BOTH duplicate shapes:
--   a) two identical names within the SAME paste — these collide with each
--      other, not with any existing row, so the unique index alone would
--      never have caught this one either (both inserts are in one statement).
--   b) a pasted name that matches an ACTIVE (deleted_at IS NULL) project
--      already in the company — the exact case that broke commit live.
-- A name matching a SOFT-DELETED project is not a collision — the partial
-- index already allows it, and re-forbidding it here would contradict the
-- constraint it exists to mirror.
--
-- CREATE OR REPLACE on both RPCs below: same signatures as
-- 20260801_batch_configuration_step.sql, only the bodies gain one PERFORM
-- each. That migration is already applied — this one is additive, not an edit
-- to it.

CREATE OR REPLACE FUNCTION public.fn_check_batch_duplicate_names(
  p_company_id UUID,
  p_projects   JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_dupe_in_paste TEXT;
  v_dupe_existing TEXT;
BEGIN
  -- (a) Duplicates within the pasted list itself. Grouped first so each
  -- repeated name is named once in the message, not once per occurrence.
  SELECT string_agg(d.name, ', ') INTO v_dupe_in_paste
  FROM (
    SELECT NULLIF(TRIM(x.name), '') AS name
    FROM jsonb_to_recordset(p_projects) AS x(name TEXT)
    GROUP BY NULLIF(TRIM(x.name), '')
    HAVING COUNT(*) > 1
  ) d
  WHERE d.name IS NOT NULL;

  IF v_dupe_in_paste IS NOT NULL THEN
    RAISE EXCEPTION 'Project name(s) [%] appear more than once in the pasted list — each project needs a unique name.', v_dupe_in_paste;
  END IF;

  -- (b) A pasted name that collides with an existing ACTIVE project — the
  -- same scope as projects_company_id_name_key (WHERE deleted_at IS NULL).
  SELECT string_agg(n.name, ', ') INTO v_dupe_existing
  FROM (
    SELECT DISTINCT NULLIF(TRIM(x.name), '') AS name
    FROM jsonb_to_recordset(p_projects) AS x(name TEXT)
  ) n
  WHERE n.name IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.company_id = p_company_id AND p.name = n.name AND p.deleted_at IS NULL
    );

  IF v_dupe_existing IS NOT NULL THEN
    RAISE EXCEPTION 'Project name(s) [%] already exist and are active — rename them or archive the existing project first.', v_dupe_existing;
  END IF;
END;
$$;

-- rpc_preview_instantiate_template: same signature/body as
-- 20260801_batch_configuration_step.sql, +1 PERFORM right after the
-- empty-payload check and before the category-mapping resolver.
CREATE OR REPLACE FUNCTION public.rpc_preview_instantiate_template(
  p_template_id      UUID,
  p_portfolio        JSONB,
  p_projects         JSONB,
  p_category_mapping JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id       UUID := public.my_company_id();
  v_user_id          UUID := auth.uid();
  v_template         public.project_templates;
  v_anchor_date      TIMESTAMPTZ := (p_portfolio->>'target_date')::timestamptz;
  v_anchor_direction TEXT := p_portfolio->>'anchor_direction';
  v_min_offset       INT;
  v_max_offset       INT;
  v_batch_start_date TIMESTAMPTZ;
  v_project_count    INT;
  v_board_count      INT;
  v_first_task_date  TIMESTAMPTZ;
  v_last_task_date   TIMESTAMPTZ;
BEGIN
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('project.create')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to preview a bulk instantiation.';
  END IF;

  SELECT * INTO v_template
  FROM public.project_templates
  WHERE id = p_template_id AND company_id = v_company_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found.';
  END IF;

  IF p_projects IS NULL OR jsonb_typeof(p_projects) <> 'array' OR jsonb_array_length(p_projects) = 0 THEN
    RAISE EXCEPTION 'At least one project is required.';
  END IF;

  -- NEW: catch both duplicate shapes before anything else — a preview that
  -- goes green past this point is a promise commit will not hit
  -- projects_company_id_name_key.
  PERFORM public.fn_check_batch_duplicate_names(v_company_id, p_projects);

  -- Design rule #3, no exceptions: a missing anchor RAISEs, it does not
  -- default to now(). Same wording rpc_instantiate_template uses below.
  IF v_anchor_date IS NULL THEN
    RAISE EXCEPTION 'A schedule anchor is required: set p_portfolio.target_date (the batch''s start date or deadline). This is never defaulted.';
  END IF;

  IF v_anchor_direction IS NULL OR v_anchor_direction NOT IN ('start', 'deadline') THEN
    RAISE EXCEPTION 'p_portfolio.anchor_direction must be ''start'' or ''deadline''.';
  END IF;

  IF v_anchor_date::date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Anchor date % is in the past.', v_anchor_date::date;
  END IF;

  -- Fails on the identical unmapped-category / foreign-pipeline / no-stage
  -- conditions the commit path checks — see that function's own comments.
  PERFORM public.fn_resolve_batch_category_mapping(v_company_id, v_template.body, p_category_mapping);

  SELECT min_offset, max_offset INTO v_min_offset, v_max_offset
  FROM public.fn_batch_offset_range(v_template.body);

  v_batch_start_date := public.fn_resolve_batch_start_date(v_anchor_date, v_anchor_direction, v_max_offset);

  SELECT COUNT(*) INTO v_project_count
  FROM jsonb_to_recordset(p_projects) AS x(name TEXT)
  WHERE NULLIF(TRIM(x.name), '') IS NOT NULL;

  IF v_project_count = 0 THEN
    RAISE EXCEPTION 'No valid project rows (every line was blank).';
  END IF;

  SELECT COUNT(DISTINCT rm.pipeline_id) INTO v_board_count
  FROM public.fn_resolve_batch_category_mapping(v_company_id, v_template.body, p_category_mapping) rm;

  -- MIN/MAX(start + offset) over the full projects x template-items product
  -- equals MIN/MAX(start) + MIN/MAX(offset) — the two vary independently
  -- across that product, so this is exact, not an approximation.
  SELECT MIN(proj_start) + (v_min_offset || ' days')::interval,
         MAX(proj_start) + (v_max_offset || ' days')::interval
    INTO v_first_task_date, v_last_task_date
  FROM (
    SELECT CASE WHEN x.start_date IS NOT NULL
                THEN public.fn_resolve_batch_start_date(x.start_date, v_anchor_direction, v_max_offset)
                ELSE v_batch_start_date END AS proj_start
    FROM jsonb_to_recordset(p_projects) AS x(name TEXT, start_date TIMESTAMPTZ)
    WHERE NULLIF(TRIM(x.name), '') IS NOT NULL
  ) s;

  RETURN jsonb_build_object(
    'projects', v_project_count,
    'tasks', v_project_count * jsonb_array_length(v_template.body),
    'boards', v_board_count,
    'first_task_date', v_first_task_date,
    'last_task_date', v_last_task_date
  );
END;
$$;

-- rpc_instantiate_template: same signature/body as
-- 20260801_batch_configuration_step.sql, +1 PERFORM mirroring preview's —
-- same position relative to the other pre-flight checks, so a batch that
-- fails here fails identically in preview, never only on commit.
CREATE OR REPLACE FUNCTION public.rpc_instantiate_template(
  p_template_id      UUID,
  p_portfolio        JSONB,
  p_projects         JSONB,
  p_category_mapping JSONB,
  p_idempotency_key  TEXT
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
  v_anchor_date       TIMESTAMPTZ := (p_portfolio->>'target_date')::timestamptz;
  v_anchor_direction  TEXT := p_portfolio->>'anchor_direction';
  v_min_offset        INT;
  v_max_offset        INT;
  v_batch_start_date  TIMESTAMPTZ;
  v_past_line         TEXT;
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

  -- NEW: same check preview runs, same position relative to the other
  -- pre-flight validation, before idempotency key is consumed by a write.
  PERFORM public.fn_check_batch_duplicate_names(v_company_id, p_projects);

  -- Design rule #3: no silent fallback. This exact COALESCE is the bug plan
  -- §13.9 flagged and explicitly rejected as "not a cleanup, a product
  -- decision" — the decision made was to require it, not default it.
  IF v_anchor_date IS NULL THEN
    RAISE EXCEPTION 'A schedule anchor is required: set p_portfolio.target_date (the batch''s start date or deadline). This is never defaulted.';
  END IF;

  IF v_anchor_direction IS NULL OR v_anchor_direction NOT IN ('start', 'deadline') THEN
    RAISE EXCEPTION 'p_portfolio.anchor_direction must be ''start'' or ''deadline''.';
  END IF;

  IF v_anchor_date::date < CURRENT_DATE THEN
    RAISE EXCEPTION 'Anchor date % is in the past.', v_anchor_date::date;
  END IF;

  -- Per-line overrides (existing `Name, date, ref` textarea format) carry
  -- the same anchor semantics — validate them the same way up front rather
  -- than discovering a backdated project after the batch is half-inserted.
  SELECT string_agg(x.name, ', ') INTO v_past_line
  FROM jsonb_to_recordset(p_projects) AS x(name TEXT, start_date TIMESTAMPTZ)
  WHERE x.start_date IS NOT NULL AND x.start_date::date < CURRENT_DATE;

  IF v_past_line IS NOT NULL THEN
    RAISE EXCEPTION 'Anchor override for project(s) [%] is in the past.', v_past_line;
  END IF;

  -- Fail fast, before anything is written — same resolver preview uses.
  PERFORM public.fn_resolve_batch_category_mapping(v_company_id, v_template.body, p_category_mapping);

  SELECT min_offset, max_offset INTO v_min_offset, v_max_offset
  FROM public.fn_batch_offset_range(v_template.body);

  v_batch_start_date := public.fn_resolve_batch_start_date(v_anchor_date, v_anchor_direction, v_max_offset);

  -- 1. The portfolio row IS the undo batch (plan §7), now also recording how
  -- its anchor was interpreted (Gap 2-style provenance).
  INSERT INTO public.portfolios (
    company_id, name, source, received_at, target_date, anchor_direction, manifest,
    idempotency_key, created_by, template_id, template_body_snapshot
  )
  VALUES (
    v_company_id,
    COALESCE(NULLIF(TRIM(p_portfolio->>'name'), ''), v_template.name || ' batch'),
    p_portfolio->>'source',
    COALESCE((p_portfolio->>'received_at')::timestamptz, now()),
    v_anchor_date,
    v_anchor_direction,
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
  ON CONFLICT (company_id, external_ref) WHERE deleted_at IS NULL DO NOTHING;

  -- 2b. Existing name-only path, unchanged, for every row that did NOT
  -- supply a ref.
  INSERT INTO public.clients (company_id, name, external_ref)
  SELECT DISTINCT v_company_id, NULLIF(TRIM(x.client_ref), ''), NULL
  FROM jsonb_to_recordset(p_projects) AS x(name TEXT, client_ref TEXT, client_external_ref TEXT, start_date TIMESTAMPTZ)
  WHERE NULLIF(TRIM(COALESCE(x.client_ref, '')), '') IS NOT NULL
    AND NULLIF(TRIM(COALESCE(x.client_external_ref, '')), '') IS NULL
  ON CONFLICT (company_id, name) WHERE deleted_at IS NULL DO NOTHING;

  -- 3. Skip per-row notification fan-out for the whole bulk insert below
  -- (Hazard 1). is_local = true: scoped to this transaction, auto-clears.
  PERFORM set_config('trustflow.bulk_instantiate', 'on', true);

  -- 4. Set-based insert: projects, then tasks, then team assignments — all
  -- from one WITH block, no loop.
  --   - incoming resolves each project's start_date: its own override
  --     (interpreted with the SAME anchor_direction as the batch) if the
  --     line supplied one, else the batch anchor.
  --   - new_projects now also writes due_date (start_date + the template's
  --     span) — previously never set, so "no upcoming deadlines" on the
  --     project dashboard was correct-but-misleading; the data just wasn't
  --     there.
  --   - task_items joins each template item to resolved_map on category —
  --     this is the ONLY source of pipeline_id/current_stage_id/
  --     assignee_team_id now (see file header re: legacy per-item fields).
  --     due_offset_days defaults to 0 (fn_batch_offset_range's convention),
  --     so due_date is never conditionally NULL anymore.
  WITH resolved_map AS (
    SELECT * FROM public.fn_resolve_batch_category_mapping(v_company_id, v_template.body, p_category_mapping)
  ),
  incoming AS (
    SELECT
      NULLIF(TRIM(x.name), '')                 AS name,
      NULLIF(TRIM(x.client_ref), '')            AS client_ref,
      NULLIF(TRIM(x.client_external_ref), '')   AS client_external_ref,
      CASE WHEN x.start_date IS NOT NULL
           THEN public.fn_resolve_batch_start_date(x.start_date, v_anchor_direction, v_max_offset)
           ELSE v_batch_start_date END           AS resolved_start_date
    FROM jsonb_to_recordset(p_projects) AS x(name TEXT, client_ref TEXT, client_external_ref TEXT, start_date TIMESTAMPTZ)
  ),
  new_projects AS (
    INSERT INTO public.projects (company_id, name, description, color, status, start_date, due_date, portfolio_id, client_id, created_by)
    SELECT
      v_company_id, i.name, v_template.description, v_template.color, 'active',
      i.resolved_start_date,
      i.resolved_start_date + (v_max_offset || ' days')::interval,
      v_portfolio_id, c.id, v_user_id
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
      gen_random_uuid()                             AS task_id,
      np.id                                          AS project_id,
      np.start_date                                  AS project_start_date,
      item->>'title'                                 AS title,
      item->>'description'                           AS description,
      rm.pipeline_id                                 AS pipeline_id,
      rm.current_stage_id                            AS current_stage_id,
      COALESCE(item->>'category', '')                AS category,
      COALESCE(item->>'priority', 'medium')          AS priority,
      COALESCE((item->>'weight')::bigint, 1)         AS weight,
      NULLIF(item->>'estimated_hours', '')::numeric  AS estimated_hours,
      COALESCE(NULLIF(item->>'due_offset_days', '')::int, 0) AS due_offset_days,
      rm.assignee_team_id                            AS assignee_team_id
    FROM new_projects np
    CROSS JOIN LATERAL jsonb_array_elements(v_template.body) AS item
    JOIN resolved_map rm ON rm.category = COALESCE(item->>'category', '')
  ),
  new_tasks AS (
    INSERT INTO public.tasks (
      id, company_id, title, description, pipeline_id, current_stage_id, category, priority, weight,
      estimated_hours, due_date, project_id, portfolio_id, created_by, manager_id
    )
    SELECT
      ti.task_id, v_company_id, ti.title, ti.description, ti.pipeline_id, ti.current_stage_id, ti.category, ti.priority, ti.weight,
      ti.estimated_hours,
      ti.project_start_date + (ti.due_offset_days || ' days')::interval,
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
