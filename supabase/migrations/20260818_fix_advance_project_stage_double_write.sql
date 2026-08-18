-- #283: rpc_advance_project_stage double-writes project_stage_history.
--
-- Root cause is migration replay ORDER, not application logic. On 2026-07-31:
--   - 19e26fc / 20260731_rpc_advance_project_stage.sql (18:26) created the RPC
--     with a manual `INSERT INTO project_stage_history` as its step 5.
--   - c3eafa1 / 20260731_project_stage_history_trigger.sql (22:29, chrono-
--     logically LATER) added trg_projects_stage_history as the sole writer and
--     re-defined the RPC WITHOUT that manual insert -- its own commit message
--     says so explicitly.
-- Supabase applies migrations in filename-sorted order. "project_stage_
-- history_trigger.sql" sorts before "rpc_advance_project_stage.sql" (p < r)
-- despite being authored after it, so on any fresh apply the OLDER file's
-- CREATE OR REPLACE runs LAST and silently puts the manual insert back.
-- Verified live on prod via pg_get_functiondef: step 5 is still there today.
--
-- Fix: re-apply exactly the body c3eafa1 intended to be final (trigger is the
-- sole writer; RPC keeps auth + transition-path validation + the UPDATE,
-- drops the direct INSERT). No filename trick this time -- this migration's
-- date is safely after both originals either way.

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

  -- 4. Update project. trg_projects_stage_history (AFTER UPDATE OF
  -- current_stage_id) is the sole writer of project_stage_history -- no
  -- manual INSERT here, or every RPC-driven move double-writes.
  UPDATE public.projects
  SET    current_stage_id = p_to_stage_id,
         pipeline_id      = v_target_pipe_id,
         updated_at       = NOW()
  WHERE  id = p_project_id;
END;
$function$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, count(*) AS n
    FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname = 'rpc_advance_project_stage'
    GROUP BY p.proname
  LOOP
    IF r.n <> 1 THEN
      RAISE EXCEPTION 'MIGRATION FAILED: % has % signatures, expected exactly 1', r.proname, r.n;
    END IF;
  END LOOP;
END;
$$;
