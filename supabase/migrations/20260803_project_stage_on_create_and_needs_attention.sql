-- Two things a user hit immediately on the projects list, both real.
--
-- 1. EVERY BULK-CREATED PROJECT HAS "NO STAGE"
-- rpc_instantiate_template sets pipeline_id/current_stage_id on the TASKS it
-- creates (that is the batch configuration step's whole job, #182) and never
-- on the PROJECT row. Phase 2 gave projects their own pipeline_id and
-- current_stage_id, and nothing populates them. Local: 31 of 39 projects had
-- neither.
--
-- The consequence is not cosmetic. A project with a NULL current_stage_id is
-- outside its own lifecycle: it cannot be advanced, project_stage_history
-- never gets a first row, and every §16 metric derived from stage movement
-- (days-in-stage, "blocked", "on pace", projected end) has no starting point.
-- The list rendering "No stage" on 31 rows is the visible tip of that.
--
-- Fix: a project starts in the initial stage of its company's project-subject
-- pipeline, exactly as a task starts in its board's initial stage. Chosen by:
-- the pipeline explicitly passed by the caller, else the company's default
-- project pipeline, else its only one. If a company has NO project-subject
-- pipeline the columns stay NULL rather than borrowing a task board — a task
-- board's stages are not a project's lifecycle, and quietly using one would
-- produce a project sitting in "In Review" meaning nothing.
--
-- 2. "NEEDS ATTENTION" DOES NOT FLAG A 174-DAY-OVERDUE PROJECT
-- The chip is wired to p_blocked, which filters ONLY projects.blocked. A
-- project 174 days past its due date is not "blocked" in that sense, so the
-- filter labelled "Needs attention" ignored the single most attention-worthy
-- row on the screen.
--
-- p_blocked is WIDENED rather than renamed or joined by a new parameter.
-- Adding a parameter to an existing function with CREATE OR REPLACE creates an
-- OVERLOAD, not a replacement — that killed the entire pipeline editor earlier
-- today (see 20260802_drop_stale_stage_rpc_overloads.sql), and renaming would
-- break every existing caller. The parameter name is now slightly stale; its
-- meaning is documented here and at its one call site.

-- ── 1. project stage on create ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_default_project_stage(p_company_id uuid)
RETURNS TABLE (pipeline_id uuid, stage_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, s.id
  FROM public.pipelines p
  JOIN public.pipeline_stages s ON s.pipeline_id = p.id AND s.is_initial
  WHERE p.company_id = p_company_id
    AND p.subject_kind = 'project'
    AND p.deleted_at IS NULL
  ORDER BY p.is_default DESC, p.created_at ASC
  LIMIT 1;
$$;

-- Trigger rather than patching every writer: rpc_instantiate_template,
-- rpc_rollforward_project, ProjectFolderModal and the spreadsheet path all
-- insert projects, and a rule enforced in one of them is not a rule (§13.2).
-- Only fills a NULL — an explicit stage from the caller always wins.
CREATE OR REPLACE FUNCTION public.fn_project_default_stage_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pipeline uuid;
  v_stage    uuid;
BEGIN
  IF NEW.current_stage_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT d.pipeline_id, d.stage_id INTO v_pipeline, v_stage
  FROM public.fn_default_project_stage(NEW.company_id) d;

  IF v_stage IS NULL THEN
    RETURN NEW;   -- no project pipeline configured; never borrow a task board
  END IF;

  NEW.pipeline_id      := COALESCE(NEW.pipeline_id, v_pipeline);
  NEW.current_stage_id := v_stage;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_default_stage ON public.projects;
CREATE TRIGGER trg_projects_default_stage
  BEFORE INSERT ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_project_default_stage_on_insert();

-- Backfill the projects already stranded outside their lifecycle.
UPDATE public.projects p
SET    pipeline_id = COALESCE(
         p.pipeline_id,
         (SELECT d.pipeline_id FROM public.fn_default_project_stage(p.company_id) d)
       ),
       current_stage_id =
         (SELECT d.stage_id FROM public.fn_default_project_stage(p.company_id) d)
WHERE  p.current_stage_id IS NULL
  AND  p.deleted_at IS NULL
  AND  EXISTS (
         SELECT 1 FROM public.fn_default_project_stage(p.company_id) d
         WHERE d.stage_id IS NOT NULL
       );

DO $verify$
DECLARE v_left INT; v_no_pipe INT;
BEGIN
  SELECT count(*) INTO v_left
  FROM public.projects p
  WHERE p.deleted_at IS NULL AND p.current_stage_id IS NULL
    AND EXISTS (SELECT 1 FROM public.fn_default_project_stage(p.company_id) d WHERE d.stage_id IS NOT NULL);

  SELECT count(DISTINCT p.company_id) INTO v_no_pipe
  FROM public.projects p
  WHERE p.deleted_at IS NULL AND p.current_stage_id IS NULL;

  IF v_left > 0 THEN
    RAISE EXCEPTION 'backfill missed % project(s) whose company HAS a project pipeline', v_left;
  END IF;

  RAISE NOTICE 'project default stage: backfill complete; % company/companies still have no project-subject pipeline (deliberately left NULL)', v_no_pipe;
END
$verify$;

-- ── 2. "Needs attention" must mean what the chip says ───────────────────────
-- Body patched from the LIVE definition via pg_get_functiondef rather than
-- retyped from a stale migration — recreating an RPC from an old body has
-- silently dropped behaviour in this repo twice (see the notes on
-- rpc_filehub_group_list_files). One predicate line changes.
DO $patch$
DECLARE
  v_def    TEXT;
  v_needle TEXT := 'AND (p_blocked IS NULL OR p.blocked = p_blocked)';
  v_repl   TEXT :=
    '-- p_blocked is the "Needs attention" filter, not a blocked-flag filter.' || E'\n    ' ||
    '-- TRUE means "this row wants a human": explicitly blocked, OR past its' || E'\n    ' ||
    '-- due date and not finished. A 174-day-overdue project was previously' || E'\n    ' ||
    '-- excluded because it carried no blocked flag. Name kept to avoid an' || E'\n    ' ||
    '-- overload (see 20260802_drop_stale_stage_rpc_overloads.sql).' || E'\n    ' ||
    'AND (p_blocked IS NULL OR (' || E'\n      ' ||
    '  CASE WHEN p_blocked' || E'\n      ' ||
    '    THEN p.blocked OR (p.due_date IS NOT NULL AND p.due_date::date < CURRENT_DATE)' || E'\n      ' ||
    '    ELSE NOT p.blocked AND NOT (p.due_date IS NOT NULL AND p.due_date::date < CURRENT_DATE)' || E'\n      ' ||
    '  END))';
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def
  FROM pg_proc WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'rpc_projects_table not found';
  END IF;

  IF position(v_needle IN v_def) = 0 THEN
    IF position('Needs attention' IN v_def) > 0 THEN
      RAISE NOTICE 'rpc_projects_table already widened; nothing to patch';
      RETURN;
    END IF;
    RAISE EXCEPTION 'could not locate the p_blocked predicate — refusing to patch blindly';
  END IF;

  EXECUTE replace(v_def, v_needle, v_repl);
  RAISE NOTICE 'rpc_projects_table: "Needs attention" now covers blocked OR overdue';
END
$patch$;

DO $verify$
DECLARE v_sigs INT;
BEGIN
  SELECT count(*) INTO v_sigs FROM pg_proc
  WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION 'rpc_projects_table must have exactly 1 signature, found % (overload trap)', v_sigs;
  END IF;
  RAISE NOTICE 'rpc_projects_table still has exactly one signature';
END
$verify$;
