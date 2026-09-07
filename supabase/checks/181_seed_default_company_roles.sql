-- supabase/checks/181_seed_default_company_roles.sql
-- Runnable check for #181 (new workspaces created with zero roles).
-- Run with:
--   MSYS_NO_PATHCONV=1 docker cp <winpath> supabase_db_TrustFlow:/tmp/181_check.sql
--   MSYS_NO_PATHCONV=1 docker exec supabase_db_TrustFlow psql -U postgres -d postgres -f /tmp/181_check.sql
-- Everything runs inside BEGIN/ROLLBACK — it never commits.
--
-- Asserts:
--   1. A newly created company (via rpc_create_company_and_link) ends up with
--      the full role set (one company-scoped role per global system role).
--   2. Re-running the seed for that same company is a no-op (idempotent).
--   3. A company that already had its own role before the trigger fired is
--      left untouched (still exactly its original role, nothing added).
--   4. A non-owner user in a fresh company can actually be granted a working
--      permission (rpc_assign_user_roles -> has_permission flips true).

BEGIN;

DO $$
DECLARE
  v_owner_id       uuid := '00000000-0000-0000-0000-000000018101';
  v_second_user_id uuid := '00000000-0000-0000-0000-000000018102';
  v_prewired_owner uuid := '00000000-0000-0000-0000-000000018103';
  v_company_id     uuid;
  v_prewired_company_id uuid;
  v_template_count int;
  v_role_count     int;
  v_admin_role_id  uuid;
  v_has_perm       boolean;
BEGIN
  -- How many global system-role templates exist in this environment right now
  -- (varies by env, so the check derives the expected count instead of
  -- hardcoding 4).
  SELECT count(*) INTO v_template_count
  FROM public.roles WHERE company_id IS NULL AND is_system = TRUE AND deleted_at IS NULL;

  IF v_template_count = 0 THEN
    RAISE EXCEPTION 'CHECK SETUP FAILED: no global system-role templates found in this environment';
  END IF;

  -- ── Fixture: two throwaway auth users ──────────────────────────────
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_owner_id,       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'check181-owner@example.com',  'x', '{}', '{}', now(), now()),
    (v_prewired_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'check181-prewired@example.com','x', '{}', '{}', now(), now()),
    (v_second_user_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'check181-second@example.com', 'x', '{}', '{}', now(), now());

  -- ── 1. Fresh company via the real RPC path ends up with the full role set ──
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;
  v_company_id := public.rpc_create_company_and_link('Check181 Co', NULL);
  RESET role;

  SELECT count(*) INTO v_role_count FROM public.roles WHERE company_id = v_company_id;
  ASSERT v_role_count = v_template_count,
    format('expected %s seeded roles on fresh company, got %s', v_template_count, v_role_count);

  -- ── 2. Re-running the seed function directly is a no-op ──
  PERFORM public.fn_seed_company_default_roles(v_company_id);
  SELECT count(*) INTO v_role_count FROM public.roles WHERE company_id = v_company_id;
  ASSERT v_role_count = v_template_count,
    format('re-seeding changed role count: expected %s, got %s', v_template_count, v_role_count);

  -- ── 3. A company that already has a role before the trigger fires is untouched ──
  -- INSERT INTO companies fires the trigger synchronously in the same statement,
  -- so simulate "already had roles" by seeding once, deleting all but one role,
  -- then asserting a second seed pass does not restore the deleted ones.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'check181-owner2@example.com', 'x', '{}', '{}', now(), now())
  RETURNING id INTO v_prewired_owner;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_prewired_owner, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;
  v_prewired_company_id := public.rpc_create_company_and_link('Check181 Prewired Co', NULL);
  RESET role;

  -- Trim down to a single hand-made role, simulating "a company that already has roles"
  DELETE FROM public.roles WHERE company_id = v_prewired_company_id;
  INSERT INTO public.roles (company_id, name, is_system, is_default)
  VALUES (v_prewired_company_id, 'Hand-Rolled Role', FALSE, FALSE);

  PERFORM public.fn_seed_company_default_roles(v_prewired_company_id);

  SELECT count(*) INTO v_role_count FROM public.roles WHERE company_id = v_prewired_company_id;
  ASSERT v_role_count = 1,
    format('seed touched a company that already had a role: expected 1, got %s', v_role_count);

  -- ── 4. A non-owner in the fresh company can actually be granted a working permission ──
  INSERT INTO public.users (id, email, company_id, is_owner, is_active)
  VALUES (v_second_user_id, 'check181-second@example.com', v_company_id, FALSE, TRUE);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_second_user_id, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;
  v_has_perm := public.has_permission('company.settings');
  RESET role;
  ASSERT v_has_perm = FALSE, 'second user unexpectedly already had company.settings before any grant';

  SELECT id INTO v_admin_role_id FROM public.roles WHERE company_id = v_company_id AND name = 'Admin';
  ASSERT v_admin_role_id IS NOT NULL, 'seeded company has no company-scoped Admin role to grant';

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_id, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;
  PERFORM public.rpc_assign_user_roles(v_second_user_id, ARRAY[v_admin_role_id]);
  RESET role;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_second_user_id, 'role', 'authenticated')::text, true);
  SET LOCAL role authenticated;
  v_has_perm := public.has_permission('company.settings');
  RESET role;
  ASSERT v_has_perm = TRUE, 'second user was granted the company-scoped Admin role but still lacks company.settings';

  RAISE NOTICE 'CHECK 181: ALL ASSERTIONS PASSED';
END;
$$;

ROLLBACK;
