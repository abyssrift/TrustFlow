-- #189 regression check: projects_update must be gated by fn_project_accessible
-- on BOTH the pre-image (USING) and the post-image (WITH CHECK).
--
-- Run:  MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow \
--         psql -U postgres -d postgres -f - < supabase/checks/check_projects_update_accessible.sql
--
-- A clean run means the guard holds. Any CHECK FAILED means the #185-class
-- escalation is reachable again: a holder of project.edit editing a project
-- they cannot see. BEGIN/ROLLBACK, safe to re-run, changes nothing.
BEGIN;
DO $$
DECLARE
  v_co uuid; v_attacker uuid; v_victim uuid; v_secret uuid; v_own uuid; v_role uuid; v_n int;
  v_using TEXT; v_check TEXT;
BEGIN
  SELECT pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
    INTO v_using, v_check
  FROM pg_policy WHERE polrelid='public.projects'::regclass AND polname='projects_update';

  IF v_check IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: projects_update has no WITH CHECK — post-image unvalidated';
  END IF;
  IF position('fn_project_accessible' IN v_using) = 0
     OR position('fn_project_accessible' IN v_check) = 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: projects_update no longer calls fn_project_accessible on both sides';
  END IF;

  SELECT company_id, id INTO v_co, v_attacker
    FROM users WHERE is_owner = false AND company_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_victim FROM users WHERE company_id = v_co AND id <> v_attacker LIMIT 1;

  DELETE FROM user_roles WHERE user_id = v_attacker;          -- strip any view_all
  INSERT INTO roles (company_id, name) VALUES (v_co,'ZZ Editor') RETURNING id INTO v_role;
  INSERT INTO role_permissions (role_id, permission_id)
    SELECT v_role, id FROM permissions WHERE key IN ('project.view','project.edit');
  INSERT INTO user_roles (user_id, role_id, company_id) VALUES (v_attacker, v_role, v_co);

  INSERT INTO projects (company_id,name,owner_id) VALUES (v_co,'ZZ Secret',v_victim) RETURNING id INTO v_secret;
  INSERT INTO projects (company_id,name,owner_id) VALUES (v_co,'ZZ Mine',v_attacker) RETURNING id INTO v_own;

  PERFORM set_config('request.jwt.claims', json_build_object('sub',v_attacker::text,'role','authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  UPDATE projects SET name='PWNED' WHERE id=v_secret;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED: project.edit holder modified % project(s) they cannot see (#185-class escalation)', v_n;
  END IF;

  UPDATE projects SET name='ZZ Renamed' WHERE id=v_own;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED: the policy is too tight — a user cannot edit their OWN project (% rows)', v_n;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'OK: projects_update blocks editing an inaccessible project and still allows editing your own';
END $$;
ROLLBACK;
