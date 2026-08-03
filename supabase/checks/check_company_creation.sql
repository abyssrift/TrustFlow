-- A brand-new workspace must arrive fully configured. Regression check for
-- the two bugs fixed in 20260803_fix_company_creation.sql.
--
-- Run: MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow \
--        psql -U postgres -d postgres -f - < supabase/checks/check_company_creation.sql
-- BEGIN/ROLLBACK, safe to re-run, creates nothing permanent.
BEGIN;
DO $$
DECLARE v_uid uuid; v_co uuid; v_pipe uuid; n int;
BEGIN
  SELECT id INTO v_uid FROM auth.users LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_uid::text,'role','authenticated')::text, true);
  SELECT rpc_create_company_and_link('ZZ Check Co', NULL) INTO v_co;
  SELECT id INTO v_pipe FROM pipelines WHERE company_id = v_co;

  SELECT count(*) INTO n FROM roles WHERE company_id = v_co;
  IF n = 0 THEN RAISE EXCEPTION 'CHECK FAILED: new company has zero roles (#181)'; END IF;

  SELECT count(*) INTO n FROM roles r
    JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id AND p.key = 'project.view_all'
   WHERE r.company_id = v_co;
  IF n = 0 THEN RAISE EXCEPTION 'CHECK FAILED: no role holds project.view_all — Projects renders empty for everyone but the owner (#190)'; END IF;

  -- The owner must be on THIS COMPANY'S role, never on a global template.
  -- A per-tenant role editor writing to a company_id IS NULL row would change
  -- the seed for every other company on the platform.
  SELECT count(*) INTO n FROM user_roles ur JOIN roles r ON r.id = ur.role_id
   WHERE ur.company_id = v_co AND r.company_id IS NULL;
  IF n > 0 THEN RAISE EXCEPTION 'CHECK FAILED: owner is linked to a GLOBAL TEMPLATE role — editing it would alter every other company'; END IF;

  SELECT count(*) INTO n FROM user_roles ur JOIN roles r ON r.id = ur.role_id
   WHERE ur.company_id = v_co AND r.company_id = v_co;
  IF n <> 1 THEN RAISE EXCEPTION 'CHECK FAILED: owner is not on exactly one of their own company roles (got %)', n; END IF;

  SELECT count(*) INTO n FROM pipeline_stages WHERE pipeline_id = v_pipe;
  IF n < 2 THEN RAISE EXCEPTION 'CHECK FAILED: default pipeline has % stage(s)', n; END IF;

  SELECT count(*) INTO n FROM pipeline_stage_transitions t
    JOIN pipeline_stages s ON s.id = t.from_stage_id WHERE s.pipeline_id = v_pipe;
  IF n = 0 THEN RAISE EXCEPTION 'CHECK FAILED: default pipeline has no transitions — nothing can be advanced'; END IF;

  SELECT count(*) INTO n FROM pipeline_stage_actions a
    JOIN pipeline_stages s ON s.id = a.stage_id WHERE s.pipeline_id = v_pipe;
  IF n = 0 THEN RAISE EXCEPTION 'CHECK FAILED: default pipeline has no stage ACTION BUTTONS — the board renders with nothing to click'; END IF;

  RAISE NOTICE 'OK: new company arrives with roles, project.view_all, an owner on its OWN role, and a pipeline with transitions and action buttons';
END $$;
ROLLBACK;
