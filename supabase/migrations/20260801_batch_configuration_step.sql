-- 20260801_batch_configuration_step.sql
-- Issue #182 (plan §13.10) — bulk create was producing unreachable tasks:
-- 66 tasks shipped with pipeline_id/current_stage_id/due_date all NULL.
-- Root cause (§13.10): rpc_instantiate_template left pipeline_id NULL and
-- due_date inert unless every caller happened to supply both, and nothing
-- ever forced the batch to be configured before commit. This migration adds
-- the missing step: EXTENDS rpc_instantiate_template (not a parallel path —
-- two ways to create projects from templates would drift) with a required
-- category→{pipeline_id, assignee_team_id} mapping and a required schedule
-- anchor, and adds a companion preview RPC so the UI can show the outcome
-- before committing. Backend only — no UI in this migration.
--
-- Design decisions (already settled with the user, see issue #182 body):
--   1. Map by CATEGORY, not by task. p_category_mapping is
--      [{category, pipeline_id, assignee_team_id?}, ...] — one row per
--      distinct category the template body uses, not one row per task.
--   2. Stage is not optional. Every task lands on its mapped pipeline's
--      FIRST stage by position — resolved server-side, never left NULL.
--   3. The schedule anchor is REQUIRED, no COALESCE(..., now()) fallback.
--      p_portfolio must carry target_date (the anchor) and anchor_direction
--      ('start' | 'deadline'). Back-scheduling ('deadline'): the anchor is
--      a deadline, and the batch's span is computed from the SAME
--      template body the tasks come from (MAX due_offset_days), so the
--      span can never drift from what actually gets inserted.
--   4. rpc_preview_instantiate_template returns the outcome (projects,
--      tasks, distinct boards, first/last task date), not a row count —
--      calls the exact same resolver/span functions as the real commit,
--      so "preview succeeded" is a promise the commit will also succeed.
--   5. Per-line overrides (existing `Name, date, ref` textarea format,
--      p_projects[].start_date) keep working — a line's date now overrides
--      the BATCH anchor for that one project only, using the same
--      anchor_direction semantics as the batch.
--
-- Judgment call: the template body's legacy per-item `pipeline_id` /
-- `assignee_team_id` fields (schema comment in
-- 20260731_project_hierarchy_1_schema.sql) are no longer read. Honoring a
-- per-task override here would be exactly the per-task mapping input the
-- issue says NOT to build, and it's what let templates carry silent NULLs
-- in the first place (starter templates and captured templates never set
-- them). Category mapping is now the SOLE source of pipeline_id/stage/team
-- for generated tasks.

-- ── portfolios.anchor_direction: provenance for how target_date was read ────
ALTER TABLE public.portfolios
  ADD COLUMN IF NOT EXISTS anchor_direction TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portfolios_anchor_direction_check') THEN
    ALTER TABLE public.portfolios
      ADD CONSTRAINT portfolios_anchor_direction_check
      CHECK (anchor_direction IS NULL OR anchor_direction IN ('start', 'deadline'));
  END IF;
END $$;

-- ── fn_batch_offset_range: the span this issue says belongs in the RPC ──────
-- Reads due_offset_days straight off the template body — the SAME body the
-- tasks are generated from a few lines later in rpc_instantiate_template —
-- so the back-scheduling span and the actual inserted due dates cannot
-- drift apart. Missing due_offset_days on an item defaults to 0 (same-day
-- as the project's resolved start) rather than staying NULL: a NULL
-- due_date is the exact bug this issue exists to close, and "due same day
-- it starts" is a defensible content-level default for an unscheduled item
-- — unlike the batch anchor itself, which is never defaulted.
CREATE OR REPLACE FUNCTION public.fn_batch_offset_range(p_template_body JSONB)
RETURNS TABLE (min_offset INT, max_offset INT)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT
    COALESCE(MIN(COALESCE((item->>'due_offset_days')::int, 0)), 0),
    COALESCE(MAX(COALESCE((item->>'due_offset_days')::int, 0)), 0)
  FROM jsonb_array_elements(p_template_body) AS item;
$$;

-- ── fn_resolve_batch_start_date: one formula, forward and back ──────────────
-- direction = 'start': the anchor IS the start date.
-- direction = 'deadline': the anchor is when the LAST task is due, so the
-- start date is the anchor minus the batch's span (fn_batch_offset_range's
-- max_offset). Used identically for the batch-level anchor and any per-line
-- override, so both directions behave the same at either granularity.
CREATE OR REPLACE FUNCTION public.fn_resolve_batch_start_date(
  p_anchor_date      TIMESTAMPTZ,
  p_anchor_direction TEXT,
  p_span_days        INT
)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_anchor_direction
    WHEN 'deadline' THEN p_anchor_date - (p_span_days || ' days')::interval
    ELSE p_anchor_date
  END;
$$;

-- ── fn_resolve_batch_category_mapping: the trust-boundary gate ──────────────
-- Validates and resolves p_category_mapping against p_template_body in one
-- place so rpc_preview_instantiate_template and rpc_instantiate_template
-- can never validate differently. Every RAISE here is a caller mistake, not
-- a server bug — messages name the offending category/pipeline explicitly
-- because a vague "invalid mapping" is how a category silently drops tasks.
CREATE OR REPLACE FUNCTION public.fn_resolve_batch_category_mapping(
  p_company_id       UUID,
  p_template_body    JSONB,
  p_category_mapping JSONB
)
RETURNS TABLE (category TEXT, pipeline_id UUID, current_stage_id UUID, assignee_team_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_body_categories TEXT[];
  v_map_categories  TEXT[];
  v_missing         TEXT;
  v_extra           TEXT;
  v_bad_pipeline    TEXT;
  v_no_stage        TEXT;
BEGIN
  IF p_template_body IS NULL OR jsonb_typeof(p_template_body) <> 'array' OR jsonb_array_length(p_template_body) = 0 THEN
    RAISE EXCEPTION 'Template has no tasks.';
  END IF;

  IF p_category_mapping IS NULL OR jsonb_typeof(p_category_mapping) <> 'array' OR jsonb_array_length(p_category_mapping) = 0 THEN
    RAISE EXCEPTION 'Category mapping is required — every category the template uses must be assigned a board before this batch can be created.';
  END IF;

  SELECT array_agg(DISTINCT COALESCE(item->>'category', '')) INTO v_body_categories
  FROM jsonb_array_elements(p_template_body) AS item;

  SELECT array_agg(DISTINCT COALESCE(m.category, '')) INTO v_map_categories
  FROM jsonb_to_recordset(p_category_mapping) AS m(category TEXT, pipeline_id UUID, assignee_team_id UUID);

  -- Design rule #3: an unmapped category is how tasks go missing. Loud, not silent.
  SELECT string_agg(DISTINCT c, ', ') INTO v_missing
  FROM unnest(v_body_categories) c
  WHERE NOT (c = ANY(v_map_categories));

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'Template category(ies) [%] have no board/team mapping. Every category the template uses must be mapped.', v_missing;
  END IF;

  -- Reverse check: a mapping row for a category the template does NOT use is
  -- very likely a typo against the template's actual category spelling —
  -- and a typo here is exactly how the category it was MEANT to cover falls
  -- through with no mapping at all.
  SELECT string_agg(DISTINCT c, ', ') INTO v_extra
  FROM unnest(v_map_categories) c
  WHERE NOT (c = ANY(v_body_categories));

  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'Category mapping references [%], which the template does not use — check for a typo.', v_extra;
  END IF;

  -- Trust boundary: pipeline_id must belong to the caller's company.
  SELECT string_agg(DISTINCT COALESCE(m.category, '') || ' -> ' || COALESCE(m.pipeline_id::text, 'NULL'), ', ')
    INTO v_bad_pipeline
  FROM jsonb_to_recordset(p_category_mapping) AS m(category TEXT, pipeline_id UUID)
  WHERE m.pipeline_id IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.pipelines p
       WHERE p.id = m.pipeline_id AND p.company_id = p_company_id AND p.deleted_at IS NULL
     );

  IF v_bad_pipeline IS NOT NULL THEN
    RAISE EXCEPTION 'Category mapping has a missing or foreign pipeline_id: %', v_bad_pipeline;
  END IF;

  -- Design rule #2: a pipeline_id alone still leaves a task off the board —
  -- it needs a first stage to actually resolve to.
  SELECT string_agg(DISTINCT m.category, ', ') INTO v_no_stage
  FROM jsonb_to_recordset(p_category_mapping) AS m(category TEXT, pipeline_id UUID)
  WHERE NOT EXISTS (SELECT 1 FROM public.pipeline_stages s WHERE s.pipeline_id = m.pipeline_id);

  IF v_no_stage IS NOT NULL THEN
    RAISE EXCEPTION 'Board mapped for categor(y/ies) [%] has no stages configured.', v_no_stage;
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    COALESCE(m.category, ''),
    m.pipeline_id,
    (SELECT s.id FROM public.pipeline_stages s WHERE s.pipeline_id = m.pipeline_id ORDER BY s.position ASC LIMIT 1),
    m.assignee_team_id
  FROM jsonb_to_recordset(p_category_mapping) AS m(category TEXT, pipeline_id UUID, assignee_team_id UUID);
END;
$$;

-- ── rpc_preview_instantiate_template: the outcome, not the row count ────────
-- Read-only. Calls the exact same resolver + span functions
-- rpc_instantiate_template uses below, so a preview that returns
-- successfully is a promise the commit will also succeed (same body, same
-- mapping, same anchor math — nothing here can drift from the write path).
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

GRANT EXECUTE ON FUNCTION public.rpc_preview_instantiate_template TO authenticated;

-- ── rpc_instantiate_template — extended with mandatory batch configuration ──
-- Same set-based shape (jsonb_to_recordset, single transaction, no loop),
-- same three §7 hazards (bulk_instantiate GUC, idempotency_key uniqueness,
-- portfolio-scoped undo), same Gap 1/2/3 fixes from
-- 20260731_project_hierarchy_5_gap_fixes.sql — all untouched. Two changes:
--   1. NEW required p_category_mapping param, resolved via
--      fn_resolve_batch_category_mapping — every task now gets a real
--      pipeline_id AND current_stage_id, never NULL.
--   2. p_portfolio.target_date + p_portfolio.anchor_direction are now a
--      REQUIRED schedule anchor (was silently optional before — that's
--      exactly how 194 researched due_offset_days sat inert, plan §13.9).
--      due_date is computed for every task; no longer conditionally NULL.
-- Signature changed (added p_category_mapping) — old 4-arg overload is
-- dropped explicitly below rather than left alongside as a second,
-- driftable way to call this. No caller exists yet (issue #182's UI half
-- is not built), so this is safe.
DROP FUNCTION IF EXISTS public.rpc_instantiate_template(UUID, JSONB, JSONB, TEXT);

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

GRANT EXECUTE ON FUNCTION public.rpc_instantiate_template TO authenticated;
