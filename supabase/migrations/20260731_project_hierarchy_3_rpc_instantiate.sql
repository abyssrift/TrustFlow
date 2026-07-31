-- 20260731_project_hierarchy_3_rpc_instantiate.sql
-- rpc_instantiate_template + the notification fan-out fix it depends on +
-- rpc_undo_portfolio_instantiation (plan §7, issue #171 hazards 1-3).
--
-- Hazard 1 (notification fan-out): fn_trg_tasks_notify_insert fires once per
-- task row via trg_tasks_notify_insert (AFTER INSERT ... FOR EACH ROW). A
-- 20-project x 25-task batch is 500 per-row events. Fix: rpc_instantiate_template
-- sets a transaction-local GUC before the bulk insert; the trigger checks it
-- and skips emission; the RPC emits exactly one project.created_from_template
-- event afterward. This CREATE OR REPLACE re-applies the existing trigger
-- function body (read live from prod via MCP execute_sql before editing) with
-- only the early-return guard added — nothing else about task-insert
-- notifications changes.
--
-- Hazard 2 (idempotency): enforced by the UNIQUE (company_id, idempotency_key)
-- constraint added on public.portfolios in 20260731_project_hierarchy_schema.sql.
-- A repeat call with the same key returns the original result instead of
-- inserting again.
--
-- Hazard 3 (rollback): rpc_undo_portfolio_instantiation soft-deletes
-- (deleted_at = now()) every project and task carrying the portfolio's id,
-- then the portfolio itself. Soft delete, not hard delete — mirrors the
-- deleted_at convention every _select policy in this codebase already relies
-- on, and unlike the existing rpc_archive_project (which hard-DELETEs; that
-- pattern is exactly the Phase-0 hazard called out in plan §10 / issue #156)
-- this stays reversible by direct SQL if someone undoes the wrong batch.

-- ── fn_trg_tasks_notify_insert: skip per-row emission during bulk instantiate ──
CREATE OR REPLACE FUNCTION public.fn_trg_tasks_notify_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('trustflow.bulk_instantiate', true) = 'on' THEN
    RETURN NEW; -- rpc_instantiate_template emits one project.created_from_template event instead
  END IF;

  PERFORM public.fn_emit_notification_event(
    'task.created',
    'task',
    NEW.id,
    NEW.created_by,
    jsonb_build_object(
      'task_id',    NEW.id,
      'pipeline_id', NEW.pipeline_id,
      'stage_id',   NEW.current_stage_id,
      'created_by', NEW.created_by
    )
  );
  RETURN NEW;
END;
$function$;

-- ── rpc_instantiate_template ─────────────────────────────────────────────────
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

  -- 1. The portfolio row IS the undo batch (plan §7).
  INSERT INTO public.portfolios (company_id, name, source, received_at, target_date, manifest, idempotency_key, created_by)
  VALUES (
    v_company_id,
    COALESCE(NULLIF(TRIM(p_portfolio->>'name'), ''), v_template.name || ' batch'),
    p_portfolio->>'source',
    COALESCE((p_portfolio->>'received_at')::timestamptz, now()),
    (p_portfolio->>'target_date')::timestamptz,
    COALESCE(p_portfolio->'manifest', '[]'::jsonb),
    p_idempotency_key,
    v_user_id
  )
  RETURNING id INTO v_portfolio_id;

  -- 2. Upsert clients by name — a separate statement (not part of the
  -- set-based CTE below) so the client rows exist before the project insert
  -- looks them up. Still one transaction: this whole function is one RPC
  -- call, so an error anywhere below rolls both statements back together.
  INSERT INTO public.clients (company_id, name, external_ref)
  SELECT DISTINCT v_company_id, x.client_ref, NULL
  FROM jsonb_to_recordset(p_projects) AS x(name TEXT, client_ref TEXT, start_date TIMESTAMPTZ)
  WHERE NULLIF(TRIM(COALESCE(x.client_ref, '')), '') IS NOT NULL
  ON CONFLICT (company_id, name) DO NOTHING;

  -- 3. Skip per-row notification fan-out for the whole bulk insert below
  -- (Hazard 1). is_local = true: scoped to this transaction, auto-clears.
  PERFORM set_config('trustflow.bulk_instantiate', 'on', true);

  -- 4. Set-based insert: projects, then tasks, then team assignments — all
  -- from one WITH block, no loop. task_items pre-generates each task's id so
  -- new_tasks and new_assignments can both key off it (a CTE referenced more
  -- than once is materialized once in Postgres, so the ids line up).
  WITH incoming AS (
    SELECT
      NULLIF(TRIM(x.name), '')       AS name,
      NULLIF(TRIM(x.client_ref), '') AS client_ref,
      x.start_date                    AS start_date
    FROM jsonb_to_recordset(p_projects) AS x(name TEXT, client_ref TEXT, start_date TIMESTAMPTZ)
  ),
  new_projects AS (
    INSERT INTO public.projects (company_id, name, description, color, status, start_date, portfolio_id, client_id, created_by)
    SELECT v_company_id, i.name, v_template.description, v_template.color, 'active', i.start_date, v_portfolio_id, c.id, v_user_id
    FROM incoming i
    LEFT JOIN public.clients c ON c.company_id = v_company_id AND c.name = i.client_ref
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

-- ── rpc_undo_portfolio_instantiation — one-call rollback (Hazard 3) ─────────
CREATE OR REPLACE FUNCTION public.rpc_undo_portfolio_instantiation(
  p_portfolio_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id UUID := public.my_company_id();
  v_user_id    UUID := auth.uid();
  v_portfolio  RECORD;
  v_task_count INT;
  v_project_count INT;
BEGIN
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('project.delete')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to undo a bulk instantiation.';
  END IF;

  SELECT * INTO v_portfolio
  FROM public.portfolios
  WHERE id = p_portfolio_id AND company_id = v_company_id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Portfolio not found.';
  END IF;

  WITH undone_tasks AS (
    UPDATE public.tasks
    SET deleted_at = now()
    WHERE portfolio_id = p_portfolio_id AND deleted_at IS NULL
    RETURNING id
  )
  SELECT COUNT(*) FROM undone_tasks INTO v_task_count;

  WITH undone_projects AS (
    UPDATE public.projects
    SET deleted_at = now()
    WHERE portfolio_id = p_portfolio_id AND deleted_at IS NULL
    RETURNING id
  )
  SELECT COUNT(*) FROM undone_projects INTO v_project_count;

  UPDATE public.portfolios SET deleted_at = now() WHERE id = p_portfolio_id;

  PERFORM public.log_event(v_company_id, v_user_id, 'portfolio', p_portfolio_id, 'portfolio.instantiation_undone',
    jsonb_build_object('projects_removed', v_project_count, 'tasks_removed', v_task_count));

  RETURN jsonb_build_object(
    'portfolio_id', p_portfolio_id,
    'projects_removed', v_project_count,
    'tasks_removed', v_task_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_undo_portfolio_instantiation TO authenticated;
