-- #280: fn_project_default_stage_on_insert() filled pipeline_id and
-- current_stage_id inconsistently. pipeline_id correctly used COALESCE (an
-- explicit value wins), but current_stage_id was unconditionally
-- overwritten with the COMPANY-DEFAULT project pipeline's initial stage --
-- even when the INSERT already supplied an explicit, different pipeline_id.
-- fn_default_project_stage(company_id) has no idea what NEW.pipeline_id
-- was, so a project could come back with current_stage_id pointing at a
-- stage belonging to a completely different pipeline than its own
-- pipeline_id. Verified against prod before this fix (rolled back).
--
-- Fix: when NEW.pipeline_id is already known, resolve the initial stage
-- from THAT pipeline directly -- never borrow the company-wide default's
-- stage. Only fall back to fn_default_project_stage (which also picks the
-- pipeline) when pipeline_id was NULL too.

CREATE OR REPLACE FUNCTION public.fn_project_default_stage_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pipeline uuid;
  v_stage    uuid;
BEGIN
  IF NEW.current_stage_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.pipeline_id IS NOT NULL THEN
    -- Explicit pipeline given: resolve ITS OWN initial stage. Never borrow
    -- the company-default pipeline's stage for a project pointed at a
    -- different pipeline.
    SELECT s.id INTO v_stage
    FROM public.pipeline_stages s
    WHERE s.pipeline_id = NEW.pipeline_id AND s.is_initial;

    IF v_stage IS NULL THEN
      RETURN NEW;   -- explicit pipeline has no initial stage; leave unset
    END IF;

    NEW.current_stage_id := v_stage;
    RETURN NEW;
  END IF;

  -- No pipeline given either: fall back to the company-wide default
  -- project pipeline (same behaviour as before for this case).
  SELECT d.pipeline_id, d.stage_id INTO v_pipeline, v_stage
  FROM public.fn_default_project_stage(NEW.company_id) d;

  IF v_stage IS NULL THEN
    RETURN NEW;   -- no project pipeline configured; never borrow a task board
  END IF;

  NEW.pipeline_id      := v_pipeline;
  NEW.current_stage_id := v_stage;
  RETURN NEW;
END;
$function$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, count(*) AS n
    FROM   pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE  n.nspname = 'public'
      AND  p.proname = 'fn_project_default_stage_on_insert'
    GROUP BY p.proname
  LOOP
    IF r.n <> 1 THEN
      RAISE EXCEPTION 'MIGRATION FAILED: % has % signatures, expected exactly 1', r.proname, r.n;
    END IF;
  END LOOP;
END;
$$;
