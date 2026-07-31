-- #172 Projects P2 -- close the enforcement gap flagged in the newest issue
-- comment (plan doc #142 sec 13.2): rpc_advance_project_stage was the only
-- writer of project_stage_history, and the only user trigger on projects is
-- trg_projects_updated_at. Any UPDATE public.projects SET current_stage_id
-- outside the RPC moved the project and recorded no history row -- no error,
-- just a stage move that silently doesn't count.
--
-- Fix: an AFTER UPDATE trigger on projects.current_stage_id is now the sole
-- writer of project_stage_history. rpc_advance_project_stage keeps its
-- permission + transition-path validation and its UPDATE, but drops the
-- direct INSERT it used to do -- if it still inserted too, every RPC-driven
-- move would double up now that the trigger also fires on that same UPDATE.
-- One writer, chosen deliberately: the trigger is what makes the invariant
-- hold regardless of call path (RPC, console, future admin tooling, a bulk
-- backfill script) -- exactly the property the RPC-only version didn't have.
--
-- transitioned_by: auth.uid() inside the trigger, same as the RPC used to
-- capture. For a user-initiated request it resolves to that user. For a
-- system/cron/service-role write with no JWT in scope it is NULL --
-- transitioned_by has no NOT NULL constraint, so this is a silent-but-honest
-- "no user" rather than a failure, matching how the RPC already treated
-- v_user_id IS NULL as a legitimate system-actor case.
--
-- Fires only on an actual change (IS DISTINCT FROM), which already covers
-- first placement from NULL. It deliberately does NOT fire when the new
-- value is NULL: to_stage_id is NOT NULL on project_stage_history (mirrors
-- pipeline_stage_history), and current_stage_id's FK is ON DELETE SET NULL,
-- so a deleted pipeline_stages row would otherwise fire this trigger with
-- NEW.current_stage_id = NULL and abort the deletion on a NOT NULL
-- violation. Losing a project's stage isn't a transition to record under
-- today's schema; widening to_stage_id to nullable to capture it is a
-- bigger, unasked change.
--
-- pipeline_id is looked up from pipeline_stages via NEW.current_stage_id
-- rather than trusted off NEW.pipeline_id: the RPC updates both columns
-- together so they already agree, but a raw UPDATE that only touches
-- current_stage_id must not record a history row against a stale pipeline.

CREATE OR REPLACE FUNCTION public.fn_project_stage_history_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_pipeline_id     UUID;
  v_from_stage_name TEXT;
  v_to_stage_name   TEXT;
BEGIN
  SELECT ps.pipeline_id, ps.name INTO v_pipeline_id, v_to_stage_name
  FROM public.pipeline_stages ps
  WHERE ps.id = NEW.current_stage_id;

  IF OLD.current_stage_id IS NOT NULL THEN
    SELECT name INTO v_from_stage_name
    FROM public.pipeline_stages WHERE id = OLD.current_stage_id;
  END IF;

  INSERT INTO public.project_stage_history (
    project_id, company_id, pipeline_id, from_stage_id, to_stage_id,
    transitioned_by, from_stage_name, to_stage_name
  )
  VALUES (
    NEW.id, NEW.company_id, v_pipeline_id, OLD.current_stage_id, NEW.current_stage_id,
    auth.uid(), v_from_stage_name, v_to_stage_name
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_stage_history ON public.projects;
CREATE TRIGGER trg_projects_stage_history
AFTER UPDATE OF current_stage_id ON public.projects
FOR EACH ROW
WHEN (NEW.current_stage_id IS DISTINCT FROM OLD.current_stage_id
      AND NEW.current_stage_id IS NOT NULL)
EXECUTE FUNCTION public.fn_project_stage_history_write();

-- rpc_advance_project_stage: identical to 20260731_rpc_advance_project_stage.sql
-- except step 5 (the direct history INSERT) is removed -- the trigger above
-- now does that write. Everything else (auth, transition-path validation,
-- the UPDATE itself) is unchanged.
CREATE OR REPLACE FUNCTION public.rpc_advance_project_stage(
  p_project_id UUID,
  p_to_stage_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id      UUID;
  v_user_id         UUID := auth.uid();
  v_current_stage   UUID;
  v_pipeline_id     UUID;
  v_target_pipe_id  UUID;
BEGIN
  -- 1. Context & authorization
  SELECT company_id, current_stage_id, pipeline_id
  INTO   v_company_id, v_current_stage, v_pipeline_id
  FROM   public.projects
  WHERE  id = p_project_id AND deleted_at IS NULL;

  IF v_company_id IS NULL THEN RAISE EXCEPTION 'Project not found'; END IF;

  -- System/cron operations (v_user_id IS NULL) are allowed through, same as
  -- rpc_advance_stage.
  IF v_user_id IS NOT NULL AND v_company_id != public.my_company_id() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- 2. Target stage must exist and belong to a project-kind pipeline.
  SELECT ps.pipeline_id INTO v_target_pipe_id
  FROM public.pipeline_stages ps
  WHERE ps.id = p_to_stage_id;

  IF v_target_pipe_id IS NULL THEN
    RAISE EXCEPTION 'Target stage not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.pipelines p
    WHERE p.id = v_target_pipe_id AND p.subject_kind = 'project'
  ) THEN
    RAISE EXCEPTION 'Target stage does not belong to a project pipeline';
  END IF;

  -- 3. Transition path validation (owners bypass; skipped on first
  -- placement when the project has no current stage yet).
  IF v_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND is_owner = TRUE) THEN
    IF v_current_stage IS NOT NULL AND v_pipeline_id = v_target_pipe_id THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.pipeline_stage_transitions
        WHERE from_stage_id = v_current_stage AND to_stage_id = p_to_stage_id
      ) THEN
        RAISE EXCEPTION 'Invalid stage transition path';
      END IF;
    END IF;
  END IF;

  -- 4. Update project. trg_projects_stage_history fires on this UPDATE and
  -- writes the project_stage_history row -- see fn_project_stage_history_write
  -- above. Do not add a second INSERT here; that would double the row.
  UPDATE public.projects
  SET    current_stage_id = p_to_stage_id,
         pipeline_id      = v_target_pipe_id,
         updated_at       = NOW()
  WHERE  id = p_project_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_advance_project_stage(UUID, UUID) TO authenticated;
