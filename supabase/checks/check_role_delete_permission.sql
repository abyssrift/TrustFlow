-- #213 regression check: deleting a role must actually work — for owners
-- AND for a non-owner holding only 'role.manage' — and must still refuse
-- cross-tenant and system/global roles.
--
-- Before the fix, RoleManagerContext.deleteRole() did a raw
-- `roles.update({deleted_at})`. Postgres requires an UPDATE's post-image to
-- remain visible under the table's SELECT policy (`deleted_at IS NULL`)
-- regardless of the UPDATE policy's own USING/WITH CHECK, so this failed
-- RLS for literally everyone, owners included — not just non-owners.
-- The fix moved the delete into rpc_delete_role (SECURITY DEFINER, bypasses
-- RLS for its own UPDATE), matching rpc_create_role/rpc_update_role.
--
-- Run:  MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow \
--         psql -U postgres -d postgres -f - < supabase/checks/check_role_delete_permission.sql
-- BEGIN/ROLLBACK, safe to re-run, changes nothing.
BEGIN;
DO $$
DECLARE
  v_co uuid; v_other_co uuid; v_owner uuid; v_manager uuid; v_manager_role uuid;
  v_target uuid; v_other_target uuid; v_system_target uuid;
BEGIN
  SELECT company_id, id INTO v_co, v_owner FROM users WHERE is_owner = true AND company_id IS NOT NULL LIMIT 1;
  SELECT id INTO v_manager FROM users WHERE company_id = v_co AND is_owner = false LIMIT 1;
  SELECT company_id INTO v_other_co FROM users WHERE company_id IS NOT NULL AND company_id <> v_co LIMIT 1;

  DELETE FROM user_roles WHERE user_id = v_manager;
  INSERT INTO roles (company_id, name) VALUES (v_co, 'ZZ Role Manager') RETURNING id INTO v_manager_role;
  INSERT INTO role_permissions (role_id, permission_id)
    SELECT v_manager_role, id FROM permissions WHERE key = 'role.manage';
  INSERT INTO user_roles (user_id, role_id, company_id) VALUES (v_manager, v_manager_role, v_co);

  -- Owner deletes a role in their own company.
  INSERT INTO roles (company_id, name) VALUES (v_co, 'ZZ Owner Target') RETURNING id INTO v_target;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM rpc_delete_role(v_target);
  RESET ROLE;
  IF (SELECT deleted_at FROM roles WHERE id = v_target) IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: owner could not delete a role in their own company (#213)';
  END IF;

  -- role.manage (non-owner) deletes a role in their own company.
  INSERT INTO roles (company_id, name) VALUES (v_co, 'ZZ Manager Target') RETURNING id INTO v_target;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  PERFORM rpc_delete_role(v_target);
  RESET ROLE;
  IF (SELECT deleted_at FROM roles WHERE id = v_target) IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: role.manage holder could not delete a role in their own company (#213)';
  END IF;

  -- Cross-tenant: role.manage holder must not delete another company's role.
  INSERT INTO roles (company_id, name) VALUES (v_other_co, 'ZZ Other Co Target') RETURNING id INTO v_other_target;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM rpc_delete_role(v_other_target);
    RESET ROLE;
    RAISE EXCEPTION 'CHECK FAILED: role.manage holder deleted a role in ANOTHER company — tenant isolation broken';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    IF SQLERRM NOT LIKE 'Scope Violation%' THEN RAISE; END IF;
  END;

  -- System / global template roles must stay undeletable.
  SELECT id INTO v_system_target FROM roles WHERE company_id IS NULL LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    PERFORM rpc_delete_role(v_system_target);
    RESET ROLE;
    RAISE EXCEPTION 'CHECK FAILED: a global template role was deleted — this breaks every other company';
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    IF SQLERRM NOT LIKE 'System Protection%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'OK: rpc_delete_role works for owners and role.manage holders, and blocks cross-tenant + global/system roles';
END $$;
ROLLBACK;
