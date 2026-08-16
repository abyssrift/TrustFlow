-- #280 regression check: fn_project_default_stage_on_insert() must resolve
-- current_stage_id from the project's OWN pipeline_id when one is given
-- explicitly, never from the company's unrelated default pipeline. Covers
-- 20260816_project_default_stage_pipeline_fix.sql.
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
ROLLBACK;
