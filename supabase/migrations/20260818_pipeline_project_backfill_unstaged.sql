-- #282: projects created before a company had ANY project-subject pipeline
-- correctly get left with NULL pipeline_id/current_stage_id by
-- trg_projects_default_stage (fn_default_project_stage finds nothing to
-- assign -- working as designed, see 20260803_project_stage_on_create_and_
-- needs_attention.sql). The gap is what happens next: nothing ever goes
-- back and stages them once a project pipeline DOES exist.
--
-- Traced on prod (company f3ad54e7-..., "Gooners.com"): 5 projects were
-- bulk-created at 18:11:54 with no project-subject pipeline yet configured
-- (correctly left unstaged). A project pipeline ("pipeline for projects")
-- was created 4 minutes later at 18:15:15. Nothing backfilled the 5
-- already-existing projects -- one of them only has a stage today because
-- a human apparently fixed it by hand later; the other 4 are still stuck.
--
-- Pipelines are created/flipped via direct client-side table writes, not an
-- RPC (contexts/PipelineEditorContext.tsx: createPipeline() does a raw
-- .insert() into pipelines then a second .insert() into pipeline_stages;
-- setPipelineSubjectKind() does a raw .update({subject_kind}) -- both
-- comment-documented as deliberate, RLS-gated, no RPC). A trigger is the
-- only place that can reliably close this without adding server-side
-- validation to a path the codebase intentionally left as a direct write.
--
-- Two triggers cover the two ways a company ends up with its first usable
-- project pipeline:
--   1. pipelines row transitions to (or is created as) subject_kind =
--      'project' -- covers the flip case, and covers a from-scratch create
--      IF stages already exist (they don't yet in the createPipeline()
--      order-of-operations above, so this is a no-op there; harmless).
--   2. a pipeline_stages row with is_initial = true is inserted on a
--      pipeline that is already subject_kind = 'project' -- covers
--      createPipeline()'s actual order: pipeline row first (no stages
--      yet), stages second.
-- Both call the same shared backfill, which only ever fills projects that
-- are still NULL -- never touches an explicit or already-resolved stage.

CREATE OR REPLACE FUNCTION public.fn_backfill_unstaged_projects(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.projects p
  SET    pipeline_id      = COALESCE(p.pipeline_id, d.pipeline_id),
         current_stage_id = d.stage_id
  FROM   public.fn_default_project_stage(p_company_id) d
  WHERE  p.company_id = p_company_id
    AND  p.deleted_at IS NULL
    AND  p.current_stage_id IS NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_pipelines_backfill_projects_on_subject_kind()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.subject_kind = 'project' THEN
    PERFORM public.fn_backfill_unstaged_projects(NEW.company_id);
  END IF;
  RETURN NEW;
END;
$function$;

-- Split into two triggers rather than one combined INSERT OR UPDATE trigger:
-- a WHEN clause can't uniformly reference OLD across an INSERT event (OLD
-- doesn't exist yet) and an UPDATE event in the same definition.
DROP TRIGGER IF EXISTS trg_pipelines_backfill_projects_insert ON public.pipelines;
CREATE TRIGGER trg_pipelines_backfill_projects_insert
  AFTER INSERT ON public.pipelines
  FOR EACH ROW
  WHEN (NEW.subject_kind = 'project')
  EXECUTE FUNCTION public.fn_pipelines_backfill_projects_on_subject_kind();

DROP TRIGGER IF EXISTS trg_pipelines_backfill_projects_update ON public.pipelines;
CREATE TRIGGER trg_pipelines_backfill_projects_update
  AFTER UPDATE OF subject_kind ON public.pipelines
  FOR EACH ROW
  WHEN (NEW.subject_kind = 'project' AND OLD.subject_kind IS DISTINCT FROM 'project')
  EXECUTE FUNCTION public.fn_pipelines_backfill_projects_on_subject_kind();

CREATE OR REPLACE FUNCTION public.fn_pipeline_stages_backfill_projects_on_initial()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_company_id   uuid;
  v_subject_kind text;
BEGIN
  SELECT company_id, subject_kind INTO v_company_id, v_subject_kind
  FROM public.pipelines WHERE id = NEW.pipeline_id;

  IF v_subject_kind = 'project' THEN
    PERFORM public.fn_backfill_unstaged_projects(v_company_id);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_pipeline_stages_backfill_projects ON public.pipeline_stages;
CREATE TRIGGER trg_pipeline_stages_backfill_projects
  AFTER INSERT ON public.pipeline_stages
  FOR EACH ROW
  WHEN (NEW.is_initial)
  EXECUTE FUNCTION public.fn_pipeline_stages_backfill_projects_on_initial();

-- One-time catch-up for every company already in this state today.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT company_id FROM public.projects WHERE deleted_at IS NULL AND current_stage_id IS NULL
  LOOP
    PERFORM public.fn_backfill_unstaged_projects(r.company_id);
  END LOOP;
END;
$$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, count(*) AS n
    FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname IN (
        'fn_backfill_unstaged_projects',
        'fn_pipelines_backfill_projects_on_subject_kind',
        'fn_pipeline_stages_backfill_projects_on_initial'
      )
    GROUP BY p.proname
  LOOP
    IF r.n <> 1 THEN
      RAISE EXCEPTION 'MIGRATION FAILED: % has % signatures, expected exactly 1', r.proname, r.n;
    END IF;
  END LOOP;
END;
$$;
