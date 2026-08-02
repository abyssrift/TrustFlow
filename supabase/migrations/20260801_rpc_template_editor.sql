-- 20260801_rpc_template_editor.sql
-- Issue #177 (Projects Phase 7, plan §4/§8/§10) — the template editor.
--
-- project_templates ships NO INSERT/UPDATE/DELETE policy
-- (20260731_project_hierarchy_4_rls_placeholder.sql is explicit that all
-- writes go through SECURITY DEFINER RPCs pending plan §11). The existing
-- write paths only ever INSERT a fully-formed row (capture-from-project,
-- starter library) — there was no way to edit `body` after the fact. This
-- adds the missing write path, mirroring the existing RPCs' shape exactly:
-- same permission check (is_owner OR project.create for writes, OR
-- project.delete for the delete-strength action, matching the schema
-- migration's documented convention), same plain-update body, no RLS change.
--
-- Body item contract (unchanged from plan §4 / rpc_create_template_from_project
-- / lib/starterTemplates.ts): title, description?, category?, priority?,
-- weight?, estimated_hours?, due_offset_days?. Per the #182 correction
-- recorded in plan §13.10, `pipeline_id` and `assignee_team_id` on a body
-- item are legacy and NO LONGER READ by rpc_instantiate_template — the
-- editor does not expose them, and fn_validate_template_body below does not
-- validate them. A template edited and re-saved through this path will
-- simply stop carrying them, which is the correct cleanup, not a bug.

-- ── fn_validate_template_body: the trust-boundary gate for `body` ───────────
-- Mirrors the exact constraints the DB enforces at actual task-insert time
-- (ck_tasks_priority, tasks_weight_1_10) plus the shapes rpc_instantiate_template
-- casts blindly (estimated_hours::numeric, due_offset_days::int). Catching
-- these here means a bad template fails loud, with the offending task named,
-- at SAVE time in the editor — not as a raw Postgres cast/constraint error
-- buried inside a 20-project bulk instantiate. Every RAISE names the
-- offender, matching fn_resolve_batch_category_mapping's standard.
CREATE OR REPLACE FUNCTION public.fn_validate_template_body(p_body JSONB)
RETURNS VOID
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_bad_title    TEXT;
  v_bad_priority TEXT;
  v_bad_weight   TEXT;
  v_bad_hours    TEXT;
  v_bad_offset   TEXT;
BEGIN
  IF p_body IS NULL OR jsonb_typeof(p_body) <> 'array' THEN
    RAISE EXCEPTION 'Template body must be an array of tasks.';
  END IF;

  SELECT string_agg('#' || idx || (CASE WHEN NULLIF(TRIM(item->>'title'), '') IS NOT NULL THEN ' "' || (item->>'title') || '"' ELSE '' END), ', ')
    INTO v_bad_title
  FROM jsonb_array_elements(p_body) WITH ORDINALITY AS t(item, idx)
  WHERE NULLIF(TRIM(item->>'title'), '') IS NULL;
  IF v_bad_title IS NOT NULL THEN
    RAISE EXCEPTION 'Task(s) missing a title: %', v_bad_title;
  END IF;

  SELECT string_agg('"' || (item->>'title') || '" (' || (item->>'priority') || ')', ', ')
    INTO v_bad_priority
  FROM jsonb_array_elements(p_body) AS item
  WHERE (item->>'priority') IS NOT NULL AND (item->>'priority') NOT IN ('urgent', 'high', 'medium', 'low');
  IF v_bad_priority IS NOT NULL THEN
    RAISE EXCEPTION 'Task(s) with an invalid priority (must be urgent/high/medium/low): %', v_bad_priority;
  END IF;

  -- Mirrors tasks_weight_1_10 CHECK (weight BETWEEN 1 AND 10) — an integer string only.
  SELECT string_agg('"' || (item->>'title') || '" (' || (item->>'weight') || ')', ', ')
    INTO v_bad_weight
  FROM jsonb_array_elements(p_body) AS item
  WHERE (item->>'weight') IS NOT NULL
    AND (NOT (item->>'weight') ~ '^[0-9]+$' OR (item->>'weight')::int NOT BETWEEN 1 AND 10);
  IF v_bad_weight IS NOT NULL THEN
    RAISE EXCEPTION 'Task(s) with weight outside 1-10: %', v_bad_weight;
  END IF;

  SELECT string_agg('"' || (item->>'title') || '" (' || (item->>'estimated_hours') || ')', ', ')
    INTO v_bad_hours
  FROM jsonb_array_elements(p_body) AS item
  WHERE (item->>'estimated_hours') IS NOT NULL
    AND (NOT (item->>'estimated_hours') ~ '^[0-9]+(\.[0-9]+)?$');
  IF v_bad_hours IS NOT NULL THEN
    RAISE EXCEPTION 'Task(s) with a negative or invalid estimated_hours: %', v_bad_hours;
  END IF;

  -- Non-negative whole number only — matches fn_batch_offset_range's
  -- COALESCE(...::int, 0) cast, which would otherwise fail mid-instantiate.
  SELECT string_agg('"' || (item->>'title') || '" (' || (item->>'due_offset_days') || ')', ', ')
    INTO v_bad_offset
  FROM jsonb_array_elements(p_body) AS item
  WHERE (item->>'due_offset_days') IS NOT NULL
    AND NOT (item->>'due_offset_days') ~ '^[0-9]+$';
  IF v_bad_offset IS NOT NULL THEN
    RAISE EXCEPTION 'Task(s) with an invalid due_offset_days (must be a non-negative whole number of days): %', v_bad_offset;
  END IF;
END;
$$;

-- ── rpc_create_project_template: blank-slate authoring ──────────────────────
-- The starter library (20260801_rpc_create_starter_template.sql) and
-- save-as-template (rpc_create_template_from_project) both require an
-- existing source (a curated starter or a finished project). This is the
-- third way a project_templates row comes into existence: truly from
-- scratch, body='[]', for a firm authoring one item at a time in the editor.
-- Same permission check as the other two creators.
CREATE OR REPLACE FUNCTION public.rpc_create_project_template(
  p_name        TEXT,
  p_description TEXT DEFAULT NULL,
  p_color       TEXT DEFAULT NULL
)
RETURNS public.project_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id UUID := public.my_company_id();
  v_user_id    UUID := auth.uid();
  v_template   public.project_templates;
BEGIN
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('project.create')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to create templates.';
  END IF;

  IF p_name IS NULL OR TRIM(p_name) = '' THEN
    RAISE EXCEPTION 'Template name is required.';
  END IF;

  INSERT INTO public.project_templates (company_id, name, description, color, body, created_by)
  VALUES (v_company_id, TRIM(p_name), p_description, p_color, '[]'::jsonb, v_user_id)
  RETURNING * INTO v_template;

  PERFORM public.log_event(v_company_id, v_user_id, 'project_template', v_template.id, 'project_template.created',
    jsonb_build_object('name', v_template.name, 'source', 'blank'));

  RETURN v_template;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_create_project_template(TEXT, TEXT, TEXT) TO authenticated;

-- ── rpc_update_project_template: the editor's save path ─────────────────────
-- Full replace of name/description/color/body, scoped to the caller's
-- company. Body length 0 is allowed (an in-progress draft) — only
-- rpc_instantiate_template/rpc_preview_instantiate_template refuse an empty
-- body ("Template has no tasks"), and that stays their job, not this RPC's.
CREATE OR REPLACE FUNCTION public.rpc_update_project_template(
  p_template_id UUID,
  p_name        TEXT,
  p_description TEXT,
  p_color       TEXT,
  p_body        JSONB
)
RETURNS public.project_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id UUID := public.my_company_id();
  v_user_id    UUID := auth.uid();
  v_template   public.project_templates;
BEGIN
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('project.create')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to edit templates.';
  END IF;

  IF p_name IS NULL OR TRIM(p_name) = '' THEN
    RAISE EXCEPTION 'Template name is required.';
  END IF;

  PERFORM public.fn_validate_template_body(p_body);

  UPDATE public.project_templates
  SET name = TRIM(p_name),
      description = p_description,
      color = p_color,
      body = p_body,
      updated_at = now()
  WHERE id = p_template_id AND company_id = v_company_id AND deleted_at IS NULL
  RETURNING * INTO v_template;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found.';
  END IF;

  PERFORM public.log_event(v_company_id, v_user_id, 'project_template', v_template.id, 'project_template.updated',
    jsonb_build_object('name', v_template.name, 'task_count', jsonb_array_length(v_template.body)));

  RETURN v_template;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_update_project_template(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;

-- ── rpc_delete_project_template: soft delete, delete-strength permission ────
-- Mirrors the schema migration's documented convention
-- ("rpc_undo_portfolio_instantiation gates on project.delete, mirrors the
-- existing delete-strength action"). Soft delete only — project_templates
-- already carries deleted_at, and the SELECT policy already filters it out,
-- so this needs no new RLS.
CREATE OR REPLACE FUNCTION public.rpc_delete_project_template(p_template_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_company_id UUID := public.my_company_id();
  v_user_id    UUID := auth.uid();
  v_name       TEXT;
BEGIN
  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('project.delete')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to delete templates.';
  END IF;

  UPDATE public.project_templates
  SET deleted_at = now()
  WHERE id = p_template_id AND company_id = v_company_id AND deleted_at IS NULL
  RETURNING name INTO v_name;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Template not found.';
  END IF;

  PERFORM public.log_event(v_company_id, v_user_id, 'project_template', p_template_id, 'project_template.deleted',
    jsonb_build_object('name', v_name));
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_delete_project_template(UUID) TO authenticated;
