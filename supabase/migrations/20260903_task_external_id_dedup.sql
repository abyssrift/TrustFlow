-- Issue #100: import pipeline + stage structure (not automations) from Jira/Odoo/Trello.
--
-- This migration covers the task-dedup half of the issue's idempotency
-- requirement: "reuse a pipeline with the matching name instead of creating
-- a duplicate on re-import. Same for tasks — needs the externalId dedup
-- that's currently deferred (store external_id/external_url, skip/update on
-- re-import)."
--
-- ImportedTask.externalId/externalUrl (lib/imports/types.ts) already flow
-- out of every adapter's mapToCanonical (Jira issue key, Odoo task id,
-- Trello card id/url) — they were just dropped on the floor at persist time
-- because rpc_create_task had no matching params and tasks had no matching
-- columns. This wires up what was already flowing through, it doesn't
-- invent new source data.
--
-- Pipeline creation itself is NOT touched here — it stays a direct
-- client-side insert into pipelines + a second insert into pipeline_stages
-- (contexts/PipelineEditorContext.tsx createPipeline()), per this
-- codebase's documented rule that pipeline writes are RLS-gated direct
-- writes, not an RPC (see 20260818_pipeline_project_backfill_unstaged.sql's
-- header comment). TaskMobilityModal.tsx's new "create or reuse a pipeline
-- named after the imported board" logic follows that same pattern.

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS external_id  text,
  ADD COLUMN IF NOT EXISTS external_url text;

-- Scoped to (company_id, external_id), partial on deleted_at/non-empty —
-- mirrors pipelines_company_id_name_key's shape (20260802_pipelines_name_
-- uniqueness_soft_delete.sql): a soft-deleted task must not block a fresh
-- import of the same source item, and manually-created/CSV-imported tasks
-- (external_id NULL/empty) are never subject to this constraint.
CREATE UNIQUE INDEX IF NOT EXISTS tasks_company_id_external_id_key
  ON public.tasks (company_id, external_id)
  WHERE deleted_at IS NULL AND external_id IS NOT NULL AND external_id <> '';

-- rpc_create_task gains two optional trailing params (existing callers never
-- pass them, so behavior for manual creation / CSV import / task cloning is
-- unchanged). When p_external_id is supplied and a non-deleted task with the
-- same (company_id, external_id) already exists, update it in place instead
-- of inserting a duplicate sibling — "skip/update on re-import".
CREATE OR REPLACE FUNCTION public.rpc_create_task(
  p_title                 text,
  p_description           text        DEFAULT NULL,
  p_priority              text        DEFAULT 'medium',
  p_due_date              timestamptz DEFAULT NULL,
  p_pipeline_id           uuid        DEFAULT NULL,
  p_project_id            uuid        DEFAULT NULL,
  p_manager_id            uuid        DEFAULT NULL,
  p_category              text        DEFAULT NULL,
  p_weight                bigint      DEFAULT 1,
  p_visibility_permission text        DEFAULT NULL,
  p_start_date            timestamptz DEFAULT NULL,
  p_estimated_hours       numeric     DEFAULT NULL,
  p_external_id           text        DEFAULT NULL,
  p_external_url          text        DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_task_id           UUID;
  v_company_id        UUID;
  v_user_id           UUID := auth.uid();
  v_initial_stage     UUID;
  v_initial_name      TEXT;
  v_resolved_pipeline UUID;
  v_existing_task_id  UUID;
BEGIN
  v_company_id := public.my_company_id();

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('task.create')
    OR public.has_permission('system.view_all_data')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions to create tasks';
  END IF;

  PERFORM public._rate_limit('create_task', 60);

  IF p_pipeline_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.pipelines
    WHERE id = p_pipeline_id AND company_id = v_company_id AND deleted_at IS NULL
  ) THEN
    v_resolved_pipeline := p_pipeline_id;
  ELSE
    v_resolved_pipeline := NULL;
  END IF;

  IF v_resolved_pipeline IS NULL AND p_project_id IS NOT NULL THEN
    SELECT pipeline_id INTO v_resolved_pipeline
    FROM   public.projects
    WHERE  id = p_project_id AND company_id = v_company_id;
  END IF;

  IF v_resolved_pipeline IS NULL THEN
    SELECT id INTO v_resolved_pipeline
    FROM   public.pipelines
    WHERE  company_id = v_company_id AND is_default = TRUE AND deleted_at IS NULL
    LIMIT  1;
  END IF;

  IF p_external_id IS NOT NULL AND p_external_id <> '' THEN
    SELECT id INTO v_existing_task_id
    FROM   public.tasks
    WHERE  company_id = v_company_id AND external_id = p_external_id AND deleted_at IS NULL;
  END IF;

  IF v_existing_task_id IS NOT NULL THEN
    UPDATE public.tasks
    SET    title           = p_title,
           description     = p_description,
           priority        = p_priority,
           due_date        = p_due_date,
           category        = p_category,
           weight          = LEAST(10, GREATEST(1, COALESCE(p_weight, 1))),
           start_date      = p_start_date,
           estimated_hours = p_estimated_hours,
           external_url    = COALESCE(p_external_url, external_url),
           pipeline_id     = COALESCE(v_resolved_pipeline, pipeline_id),
           updated_at      = now()
    WHERE  id = v_existing_task_id
    RETURNING id INTO v_task_id;

    RETURN v_task_id;
  END IF;

  IF v_resolved_pipeline IS NOT NULL THEN
    SELECT id, name INTO v_initial_stage, v_initial_name
    FROM   public.pipeline_stages
    WHERE  pipeline_id = v_resolved_pipeline AND is_initial = TRUE
    LIMIT  1;
  END IF;

  INSERT INTO public.tasks (
    company_id, title, description, priority, due_date,
    created_by, manager_id, project_id,
    pipeline_id, current_stage_id,
    status, category, weight,
    visibility_permission, start_date, estimated_hours,
    external_id, external_url
  ) VALUES (
    v_company_id, p_title, p_description, p_priority, p_due_date,
    v_user_id, COALESCE(p_manager_id, v_user_id), p_project_id,
    v_resolved_pipeline, v_initial_stage,
    COALESCE(v_initial_name, 'open'), p_category, LEAST(10, GREATEST(1, COALESCE(p_weight, 1))),
    p_visibility_permission, p_start_date, p_estimated_hours,
    NULLIF(p_external_id, ''), p_external_url
  ) RETURNING id INTO v_task_id;

  IF v_initial_stage IS NOT NULL THEN
    INSERT INTO public.pipeline_stage_history (
      task_id, company_id, pipeline_id,
      from_stage_id, to_stage_id,
      transitioned_by, from_stage_name, to_stage_name
    ) VALUES (
      v_task_id, v_company_id, v_resolved_pipeline,
      NULL, v_initial_stage,
      v_user_id, NULL, v_initial_name
    );
  END IF;

  PERFORM public.log_event(
    v_company_id, v_user_id, 'task', v_task_id, 'task.created',
    jsonb_build_object(
      'title',                 p_title,
      'priority',              p_priority,
      'pipeline',              v_resolved_pipeline,
      'visibility_permission', p_visibility_permission,
      'start_date',            p_start_date,
      'estimated_hours',       p_estimated_hours
    )
  );

  RETURN v_task_id;
END;
$function$;
