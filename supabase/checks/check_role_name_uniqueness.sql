-- #212 regression check: role names can no longer be created as exact or
-- case-insensitive duplicates, and a soft-deleted role's name can be
-- reused. Covers 20260816_role_name_uniqueness.sql.
--
-- Run:  MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow \
--         psql -U postgres -d postgres -f - < supabase/checks/check_role_name_uniqueness.sql
-- BEGIN/ROLLBACK, safe to re-run, changes nothing.
BEGIN;
DO $$
DECLARE
  v_co uuid; v_owner uuid; v_first uuid; v_dupe uuid; v_deleted uuid;
BEGIN
  SELECT company_id, id INTO v_co, v_owner FROM users WHERE is_owner = true AND company_id IS NOT NULL LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;

  -- Baseline create must succeed.
  v_first := rpc_create_role('ZZ Uniqueness Target', NULL, NULL, NULL);

  -- Exact duplicate must be rejected with a friendly message, not a raw
  -- unique_violation.
  BEGIN
    PERFORM rpc_create_role('ZZ Uniqueness Target', NULL, NULL, NULL);
    RAISE EXCEPTION 'CHECK FAILED: an exact-duplicate role name was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'A role named%already exists%' THEN RAISE; END IF;
  END;

  -- Case-insensitive duplicate must also be rejected.
  BEGIN
    PERFORM rpc_create_role('zz uniqueness target', NULL, NULL, NULL);
    RAISE EXCEPTION 'CHECK FAILED: a case-insensitive duplicate role name was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'A role named%already exists%' THEN RAISE; END IF;
  END;

  -- Renaming a second role onto an existing name must also be rejected.
  v_dupe := rpc_create_role('ZZ Uniqueness Other', NULL, NULL, NULL);
  BEGIN
    PERFORM rpc_update_role(v_dupe, 'ZZ UNIQUENESS TARGET', NULL, NULL, NULL);
    RAISE EXCEPTION 'CHECK FAILED: rpc_update_role allowed renaming onto an existing name';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'A role named%already exists%' THEN RAISE; END IF;
  END;

  -- A soft-deleted role's name must be reusable.
  v_deleted := rpc_create_role('ZZ Reusable Name', NULL, NULL, NULL);
  PERFORM rpc_delete_role(v_deleted);
  PERFORM rpc_create_role('ZZ Reusable Name', NULL, NULL, NULL);

  RESET ROLE;
  RAISE NOTICE 'OK: role names reject exact + case-insensitive duplicates on create and rename, and soft-deleted names are reusable';
END $$;
ROLLBACK;
