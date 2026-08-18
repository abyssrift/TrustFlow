-- #280 regression check: fn_project_default_stage_on_insert() must resolve
-- current_stage_id from the project's OWN pipeline_id when one is given
-- explicitly, never from the company's unrelated default pipeline. Covers
-- 20260816_project_default_stage_pipeline_fix.sql.
--
-- #282 regression check (Cases 4-5 below): a project created BEFORE its
-- company had any project-subject pipeline must get backfilled once one
-- shows up later -- whether that's a brand-new pipeline (created with
-- subject_kind='project' from the start, stages added after) or an
-- existing task pipeline flipped to subject_kind='project'. Covers
-- 20260818_pipeline_project_backfill_unstaged.sql.
--
-- Run:  MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow \
--         psql -U postgres -d postgres -f - < supabase/checks/check_project_default_stage_trigger.sql
-- BEGIN/ROLLBACK, safe to re-run, changes nothing.
BEGIN;
DO $$
DECLARE
  v_company  uuid;
  v_creator  uuid;
  v_pipe_a   uuid;  -- company default (is_default = true)
  v_stage_a  uuid;
  v_pipe_b   uuid;  -- explicit, non-default
  v_stage_b  uuid;
  v_project  uuid;
  v_got_pipe uuid;
  v_got_stage uuid;
BEGIN
  -- Throwaway company: a real seeded company may already hold the one
  -- is_default=true project pipeline slot (idx_pipelines_one_default), so
  -- this needs its own company to freely control which pipeline is default.
  INSERT INTO public.companies (name, slug) VALUES ('ZZ Default Stage Co', 'zz-default-stage-co')
    RETURNING id INTO v_company;
  v_creator := gen_random_uuid();
  INSERT INTO auth.users (id, email) VALUES (v_creator, 'zz-default-stage-' || v_creator || '@test.local');
  INSERT INTO public.users (id, company_id, email, is_owner)
    VALUES (v_creator, v_company, 'zz-default-stage-' || v_creator || '@test.local', true);

  INSERT INTO public.pipelines (company_id, name, subject_kind, is_default)
  VALUES (v_company, 'ZZ Default Project Pipeline', 'project', true)
  RETURNING id INTO v_pipe_a;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_pipe_a, 'ZZ A Initial', 1, true) RETURNING id INTO v_stage_a;

  INSERT INTO public.pipelines (company_id, name, subject_kind, is_default)
  VALUES (v_company, 'ZZ Other Project Pipeline', 'project', false)
  RETURNING id INTO v_pipe_b;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_pipe_b, 'ZZ B Initial', 1, true) RETURNING id INTO v_stage_b;

  -- Case 1: explicit pipeline_id = B, no current_stage_id -> must land on
  -- B's own initial stage, NOT A's (the bug: it landed on A's before the fix).
  INSERT INTO public.projects (company_id, name, created_by, owner_id, pipeline_id)
  VALUES (v_company, 'ZZ Explicit Pipeline Project', v_creator, v_creator, v_pipe_b)
  RETURNING id, pipeline_id, current_stage_id INTO v_project, v_got_pipe, v_got_stage;

  IF v_got_pipe IS DISTINCT FROM v_pipe_b THEN
    RAISE EXCEPTION 'CHECK FAILED: explicit pipeline_id was not preserved (#280)';
  END IF;
  IF v_got_stage IS DISTINCT FROM v_stage_b THEN
    RAISE EXCEPTION 'CHECK FAILED: current_stage_id came from the wrong pipeline (got %, expected B''s %) (#280)', v_got_stage, v_stage_b;
  END IF;

  -- Case 2: no pipeline_id, no current_stage_id -> falls back to the
  -- company default pipeline (unchanged behaviour).
  INSERT INTO public.projects (company_id, name, created_by, owner_id)
  VALUES (v_company, 'ZZ No Pipeline Project', v_creator, v_creator)
  RETURNING pipeline_id, current_stage_id INTO v_got_pipe, v_got_stage;

  IF v_got_pipe IS DISTINCT FROM v_pipe_a OR v_got_stage IS DISTINCT FROM v_stage_a THEN
    RAISE EXCEPTION 'CHECK FAILED: no-pipeline insert did not fall back to the company default (#280)';
  END IF;

  -- Case 3: explicit current_stage_id already set -> trigger must not touch it.
  INSERT INTO public.projects (company_id, name, created_by, owner_id, pipeline_id, current_stage_id)
  VALUES (v_company, 'ZZ Explicit Stage Project', v_creator, v_creator, v_pipe_b, v_stage_b)
  RETURNING pipeline_id, current_stage_id INTO v_got_pipe, v_got_stage;

  IF v_got_pipe IS DISTINCT FROM v_pipe_b OR v_got_stage IS DISTINCT FROM v_stage_b THEN
    RAISE EXCEPTION 'CHECK FAILED: trigger touched an explicitly-set current_stage_id (#280)';
  END IF;

  RAISE NOTICE 'OK: fn_project_default_stage_on_insert resolves current_stage_id from the project''s own pipeline_id';
END $$;

-- #282: a project inserted before its company has ANY project-subject
-- pipeline yet is correctly left NULL, then must get backfilled once one
-- shows up -- via either a fresh pipeline (stages added after the pipeline
-- row) or an existing task pipeline flipped to subject_kind='project'.
DO $$
DECLARE
  v_company    uuid;
  v_creator    uuid;
  v_project    uuid;
  v_new_pipe   uuid;
  v_new_stage  uuid;
  v_task_pipe  uuid;
  v_flip_stage uuid;
  v_got_pipe   uuid;
  v_got_stage  uuid;
BEGIN
  -- Case 4: brand-new project pipeline, created with no stages yet (matches
  -- contexts/PipelineEditorContext.tsx createPipeline()'s two-step order).
  INSERT INTO public.companies (name, slug) VALUES ('ZZ Late Pipeline Co', 'zz-late-pipeline-co')
    RETURNING id INTO v_company;
  v_creator := gen_random_uuid();
  INSERT INTO auth.users (id, email) VALUES (v_creator, 'zz-late-pipeline-' || v_creator || '@test.local');
  INSERT INTO public.users (id, company_id, email, is_owner)
    VALUES (v_creator, v_company, 'zz-late-pipeline-' || v_creator || '@test.local', true);

  INSERT INTO public.projects (company_id, name, created_by, owner_id)
  VALUES (v_company, 'ZZ Stranded Project', v_creator, v_creator)
  RETURNING id INTO v_project;

  SELECT pipeline_id, current_stage_id INTO v_got_pipe, v_got_stage
  FROM public.projects WHERE id = v_project;
  IF v_got_pipe IS NOT NULL OR v_got_stage IS NOT NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: project got staged with no project pipeline in the company at all (#282)';
  END IF;

  INSERT INTO public.pipelines (company_id, name, subject_kind, is_default)
  VALUES (v_company, 'ZZ Late Project Pipeline', 'project', true)
  RETURNING id INTO v_new_pipe;

  -- Pipeline row alone (no stages yet) must not have staged it either.
  SELECT pipeline_id, current_stage_id INTO v_got_pipe, v_got_stage
  FROM public.projects WHERE id = v_project;
  IF v_got_stage IS NOT NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: project got staged before the pipeline had any stages (#282)';
  END IF;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_new_pipe, 'ZZ Late Initial', 1, true) RETURNING id INTO v_new_stage;

  SELECT pipeline_id, current_stage_id INTO v_got_pipe, v_got_stage
  FROM public.projects WHERE id = v_project;
  IF v_got_pipe IS DISTINCT FROM v_new_pipe OR v_got_stage IS DISTINCT FROM v_new_stage THEN
    RAISE EXCEPTION 'CHECK FAILED: stranded project was not backfilled once its pipeline got an initial stage (#282)';
  END IF;

  -- Case 5: an existing TASK pipeline later flipped to subject_kind =
  -- 'project' must backfill the same way. Fresh company so fn_default_
  -- project_stage has no other project pipeline to find.
  INSERT INTO public.companies (name, slug) VALUES ('ZZ Flip Pipeline Co', 'zz-flip-pipeline-co')
    RETURNING id INTO v_company;
  v_creator := gen_random_uuid();
  INSERT INTO auth.users (id, email) VALUES (v_creator, 'zz-flip-pipeline-' || v_creator || '@test.local');
  INSERT INTO public.users (id, company_id, email, is_owner)
    VALUES (v_creator, v_company, 'zz-flip-pipeline-' || v_creator || '@test.local', true);

  INSERT INTO public.pipelines (company_id, name, subject_kind, is_default)
  VALUES (v_company, 'ZZ Task Pipeline', 'task', false)
  RETURNING id INTO v_task_pipe;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_task_pipe, 'ZZ Task Initial', 1, true) RETURNING id INTO v_flip_stage;

  INSERT INTO public.projects (company_id, name, created_by, owner_id)
  VALUES (v_company, 'ZZ Stranded Project 2', v_creator, v_creator)
  RETURNING id INTO v_project;

  SELECT pipeline_id, current_stage_id INTO v_got_pipe, v_got_stage
  FROM public.projects WHERE id = v_project;
  IF v_got_pipe IS NOT NULL OR v_got_stage IS NOT NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: project got staged from a task-kind pipeline (#282)';
  END IF;

  UPDATE public.pipelines SET subject_kind = 'project' WHERE id = v_task_pipe;

  SELECT pipeline_id, current_stage_id INTO v_got_pipe, v_got_stage
  FROM public.projects WHERE id = v_project;
  IF v_got_pipe IS DISTINCT FROM v_task_pipe OR v_got_stage IS DISTINCT FROM v_flip_stage THEN
    RAISE EXCEPTION 'CHECK FAILED: stranded project was not backfilled when its task pipeline flipped to project (#282)';
  END IF;

  RAISE NOTICE 'OK: unstaged projects get backfilled once a project pipeline (new or flipped) exists with an initial stage';
END $$;
ROLLBACK;
