-- Issue #22: Task Reversal — let a manager revert a task to the stage it was
-- in immediately before its current stage, correcting a mistaken transition
-- without losing history.
--
-- 'pipeline.reverse' was already declared as a permission key on the
-- "Project Manager" role template (lib/roleTemplates.ts:37), but no row for
-- it ever existed in public.permissions — so it resolved to nothing in both
-- has_permission() checks and the role-template → permission-id mapping in
-- RoleBuilder.tsx. This adds the missing row, following the same
-- one-migration-per-permission pattern as e.g. 20260614_company_edit_permission.sql.
INSERT INTO public.permissions (key, label, description, category)
VALUES ('pipeline.reverse', 'Revert Task Stage', 'Move a task back to its previous pipeline stage, correcting a mistaken transition.', 'pipeline')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.is_system = TRUE AND r.name ILIKE '%admin%'
  AND p.key = 'pipeline.reverse'
ON CONFLICT DO NOTHING;
--
-- Sibling to rpc_advance_stage rather than a modification of it: a revert
-- deliberately skips the pipeline_stage_transitions path check (it's an
-- off-graph move by design) and the post-transition hooks (spawn_recursive_task,
-- fn_handle_task_handshake, rpc_auto_assign_task) that a forward advance
-- fires — re-running those on a correction would duplicate child tasks and
-- re-fire handshake/reassignment logic.
--
-- Reuses two pieces that already exist but were never wired up:
--   - the 'pipeline.reverse' permission key (lib/roleTemplates.ts)
--   - the pipeline_stage_history.is_reversal column (already rendered as a
--     "REVERSAL" badge in PipelineJourney.tsx, but never set to true)
CREATE OR REPLACE FUNCTION public.rpc_revert_stage(p_task_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id       UUID;
  v_user_id          UUID := auth.uid();
  v_current_stage    UUID;
  v_pipeline_id      UUID;
  v_prev_stage       UUID;
  v_from_stage_name  TEXT;
  v_to_stage_name    TEXT;
BEGIN
  -- 1. Context & authorization
  SELECT company_id, current_stage_id, pipeline_id
  INTO   v_company_id, v_current_stage, v_pipeline_id
  FROM   public.tasks
  WHERE  id = p_task_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Task not found'; END IF;

  IF v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF NOT (
    (SELECT is_owner FROM public.users WHERE id = v_user_id) = TRUE
    OR public.has_permission('pipeline.reverse')
  ) THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

  -- 2. Find the previous stage: the most recent history row that moved this
  -- task into its current stage, within its current pipeline. Scoping to
  -- pipeline_id blocks reverting across a cross-pipeline move (out of scope
  -- for this issue) — if the last move was cross-pipeline, this simply finds
  -- nothing and step 3 raises.
  SELECT from_stage_id
  INTO   v_prev_stage
  FROM   public.pipeline_stage_history
  WHERE  task_id = p_task_id
    AND  to_stage_id = v_current_stage
    AND  pipeline_id = v_pipeline_id
  ORDER  BY transitioned_at DESC
  LIMIT  1;

  -- 3. Nothing to revert to
  IF v_prev_stage IS NULL THEN
    RAISE EXCEPTION 'Cannot revert: no prior stage found for this task in its current pipeline';
  END IF;

  -- 4. Update task
  UPDATE public.tasks
  SET    current_stage_id = v_prev_stage,
         updated_at       = NOW()
  WHERE  id = p_task_id;

  -- 5. History (marked as a reversal; no post-transition hooks fired)
  SELECT name INTO v_from_stage_name FROM public.pipeline_stages WHERE id = v_current_stage;
  SELECT name INTO v_to_stage_name   FROM public.pipeline_stages WHERE id = v_prev_stage;

  INSERT INTO public.pipeline_stage_history (
    task_id, company_id, pipeline_id, from_stage_id, to_stage_id,
    transitioned_by, from_stage_name, to_stage_name, is_reversal
  )
  VALUES (
    p_task_id, v_company_id, v_pipeline_id, v_current_stage, v_prev_stage,
    v_user_id, v_from_stage_name, v_to_stage_name, TRUE
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_revert_stage(uuid) TO authenticated;
