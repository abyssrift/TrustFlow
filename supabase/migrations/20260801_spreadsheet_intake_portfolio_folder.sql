-- 20260801_spreadsheet_intake_portfolio_folder.sql
-- Issue #188 (plan §15.3 "the file is evidence" — store the uploaded source
-- spreadsheet in FileHub against the portfolio it created).
--
-- Deliberately NOT a new upload path, a new FileHub visibility value, or a
-- change to UploadManagerContext.tsx / rpc_filehub_upload_commit. The client
-- gets/creates a folder via the EXISTING rpc_filehub_folder_create (idempotent
-- get-or-create, 20260716_filehub_folder_create_idempotent.sql) with
-- scope='broadcast', then uploads the file through the EXISTING
-- UploadManagerContext into that folder with visibility='broadcast' — exactly
-- the same primitives every other FileHub upload already uses. This migration
-- only adds a place for the ONE writer (rpc_instantiate_template) to remember
-- which folder it was told about, mirroring the existing
-- clients.standing_folder_id column/pattern.
--
-- portfolios has no UPDATE RLS policy (writes only via SECURITY DEFINER RPCs,
-- see 20260731_project_hierarchy_4_rls_placeholder.sql), so the folder must be
-- created BEFORE rpc_instantiate_template runs and passed in on p_portfolio —
-- already a flexible jsonb blob, so this is a body-only change, no signature
-- change, same pattern as the anchor/source/manifest fields it already reads.

ALTER TABLE public.portfolios
  ADD COLUMN IF NOT EXISTS standing_folder_id UUID REFERENCES public.filehub_folders(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.portfolios.standing_folder_id IS
  'FileHub folder holding this portfolio''s source file(s) (issue #188, plan §15.3) — same pattern as clients.standing_folder_id. Set at instantiate time from p_portfolio->>''standing_folder_id''; NULL for portfolios with no uploaded source (e.g. BulkCreateProjectsSheet''s manual paste-textarea path).';

-- rpc_instantiate_template: body verbatim from the LIVE definition (dumped via
-- pg_get_functiondef against the local stack, not retyped from a migration
-- file — recreating this function from a stale body has caused production
-- regressions twice before, see MEMORY note on rpc_filehub_group_list_files).
-- Same signature as 20260801_batch_duplicate_name_check.sql. The ONLY changes
-- are: one new column + one new value on the portfolios INSERT.
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

  -- Same check preview runs, same position relative to the other pre-flight
  -- validation, before idempotency key is consumed by a write.
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
  -- its anchor was interpreted (Gap 2-style provenance), and (NEW, issue #188)
  -- which FileHub folder its source file was uploaded to, if any.
  INSERT INTO public.portfolios (
    company_id, name, source, received_at, target_date, anchor_direction, manifest,
    idempotency_key, created_by, template_id, template_body_snapshot, standing_folder_id
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
    v_template.body,
    NULLIF(p_portfolio->>'standing_folder_id', '')::uuid
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
