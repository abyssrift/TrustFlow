-- Runnable check for issue #142 Phase 9 (plan §18.3): typed project custom
-- fields -- project_field_defs / project_field_values, their RPCs, and the
-- custom_fields column rpc_projects_table now carries.
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/check_project_custom_fields.sql
--
-- Wrapped in BEGIN/ROLLBACK: creates two throwaway projects + one task in an
-- existing seeded company, plus one project in a SECOND company, reusing real
-- users/roles and never inventing auth.users rows (same convention as every
-- other check in this folder). Always rolls back -- safe to re-run, leaves
-- nothing behind.
--
-- Assertions run under `SET LOCAL ROLE authenticated` wherever RLS is the
-- thing being proved (the default postgres connection role is BYPASSRLS and
-- would silently prove nothing), with set_config('request.jwt.claim.sub', ...)
-- to impersonate each actor. The direct-table-write assertions deliberately
-- run as postgres instead: they must reach the TRIGGER, and RLS would deny
-- them before it ever fires -- the point being that the type rule holds for a
-- superuser writer too, not only for callers who go through the RPC.
--
-- Proves:
--   1. Three-actor visibility. projects.owner_id sees its project's values; a
--      task assignee sees values for THEIR project and zero for the other one;
--      a user with neither gets ZERO ROWS, not an error. Field DEFS stay
--      company-visible to all three -- the deliberate asymmetry (a column's
--      name and type is not project data), asserted so it is a decision
--      rather than an accident.
--   2. Cross-tenant isolation. Company B's OWNER -- maximum privilege inside
--      B, so a denial here cannot be a missing grant -- can neither read nor
--      write company A's defs or values, by RLS or by any of the three RPCs,
--      and cannot attach A's def to B's own project. Same key in both
--      companies coexists as two separate defs: per-COMPANY, never global.
--   3. Type violations are refused BY THE DATABASE: through the RPC (bad
--      number, non-member enum value) and through a direct INSERT that
--      bypasses it entirely (wrong typed column, two columns at once, a def
--      and a project from different companies).
--   4. The chosen delete semantics actually happen: soft-delete hides the
--      field everywhere and RETAINS its values; re-saving the same key
--      revives the same def id and the values reappear; and the partial
--      unique index lets a deleted key be reused instead of burning it.

BEGIN;

CREATE TEMP TABLE pcf_ctx (
  company_a  UUID,
  company_b  UUID,
  creator    UUID,
  u_zero     UUID,
  u_direct   UUID,
  u_powner   UUID,
  b_owner    UUID,
  project_a  UUID,
  project_b  UUID,
  project_c  UUID,
  def_fee    UUID,
  def_status UUID,
  def_b      UUID
);
GRANT SELECT ON pcf_ctx TO authenticated;

-- ── Fixture setup (postgres: bypasses RLS, has table grants) ──────────────
DO $$
DECLARE
  v_company_a UUID;
  v_company_b UUID;
  v_creator   UUID;
  v_b_owner   UUID;
  v_pool      UUID[];
  v_project_a UUID;
  v_project_b UUID;
  v_project_c UUID;
  v_task      UUID;
  v_def_fee   UUID;
  v_def_stat  UUID;
  v_def_b     UUID;
BEGIN
  -- Company A: needs 3 distinct non-owner users (zero-access / assignee /
  -- project owner) plus an is_owner user to create the fixtures.
  SELECT u.company_id INTO v_company_a
  FROM public.users u
  JOIN public.companies c ON c.id = u.company_id AND c.deleted_at IS NULL
  WHERE u.is_owner = false
  GROUP BY u.company_id
  HAVING COUNT(*) >= 3
  ORDER BY COUNT(*) DESC
  LIMIT 1;

  IF v_company_a IS NULL THEN
    RAISE EXCEPTION 'Need a company with 3 non-owner users -- run this against a seeded dev DB, not prod.';
  END IF;

  SELECT id INTO v_creator FROM public.users
  WHERE company_id = v_company_a AND is_owner = true LIMIT 1;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'No owner user in company %.', v_company_a;
  END IF;

  SELECT ARRAY_AGG(id) INTO v_pool FROM (
    SELECT u.id FROM public.users u
    WHERE u.company_id = v_company_a AND u.is_owner = false
    ORDER BY u.id LIMIT 3
  ) x;

  -- Company B: a DIFFERENT tenant, represented by its most privileged user.
  SELECT u.company_id, u.id INTO v_company_b, v_b_owner
  FROM public.users u
  JOIN public.companies c ON c.id = u.company_id AND c.deleted_at IS NULL
  WHERE u.company_id <> v_company_a AND u.is_owner = true
  LIMIT 1;
  IF v_company_b IS NULL THEN
    RAISE EXCEPTION 'Need a second company with an owner user for the isolation assertions.';
  END IF;

  -- project.view gates the table RPC and project.edit gates the field RPCs;
  -- both predate this work and govern "can you open Projects / edit a
  -- project at all", not "can you see THIS row". Grant them to whatever roles
  -- the three test users already hold, so a zero-row result can only mean
  -- row-level denial and never one of these unrelated screen gates.
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT DISTINCT ur.role_id, p.id
  FROM public.user_roles ur
  CROSS JOIN public.permissions p
  WHERE ur.user_id = ANY (v_pool)
    AND ur.revoked_at IS NULL
    AND p.key IN ('project.view', 'project.edit')
  ON CONFLICT DO NOTHING;

  -- project_a: owned by pool[3], with a task assigned to pool[2].
  INSERT INTO public.projects (company_id, name, created_by, owner_id)
  VALUES (v_company_a, 'PCF Selfcheck Project A', v_creator, v_pool[3])
  RETURNING id INTO v_project_a;

  INSERT INTO public.tasks (company_id, project_id, title, created_by)
  VALUES (v_company_a, v_project_a, 'PCF assigned task', v_creator)
  RETURNING id INTO v_task;
  INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
  VALUES (v_task, v_company_a, v_pool[2], v_creator);

  -- project_b: same company, owned by the is_owner user, no assignments --
  -- so pool[2] can reach project_a and must NOT reach this one.
  INSERT INTO public.projects (company_id, name, created_by, owner_id)
  VALUES (v_company_a, 'PCF Selfcheck Project B', v_creator, v_creator)
  RETURNING id INTO v_project_b;

  -- project_c: company B.
  INSERT INTO public.projects (company_id, name, created_by, owner_id)
  VALUES (v_company_b, 'PCF Selfcheck Project C', v_b_owner, v_b_owner)
  RETURNING id INTO v_project_c;

  -- Defs. `pcf_status` exists in BOTH companies on purpose (assertion 2).
  INSERT INTO public.project_field_defs (company_id, key, label, data_type, source_column, created_by)
  VALUES (v_company_a, 'pcf_fee', 'AUDIT 2025', 'number', 'AUDIT 2025', v_creator)
  RETURNING id INTO v_def_fee;

  INSERT INTO public.project_field_defs (company_id, key, label, data_type, enum_options, source_column, created_by)
  VALUES (v_company_a, 'pcf_status', 'Audit status', 'enum', ARRAY['Issued','Pending'], 'Audit status', v_creator)
  RETURNING id INTO v_def_stat;

  INSERT INTO public.project_field_defs (company_id, key, label, data_type, created_by)
  VALUES (v_company_b, 'pcf_status', 'Company B''s own field', 'text', v_b_owner)
  RETURNING id INTO v_def_b;

  INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_num)
  VALUES (v_project_a, v_def_fee, v_company_a, 8000);
  INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_text)
  VALUES (v_project_a, v_def_stat, v_company_a, 'Issued');
  INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_num)
  VALUES (v_project_b, v_def_fee, v_company_a, 1234);

  INSERT INTO pcf_ctx VALUES (
    v_company_a, v_company_b, v_creator, v_pool[1], v_pool[2], v_pool[3], v_b_owner,
    v_project_a, v_project_b, v_project_c, v_def_fee, v_def_stat, v_def_b
  );
END $$;

-- ═══ 1. Three-actor visibility ════════════════════════════════════════════
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c        RECORD;
  v_n      INT;
  v_fields JSONB;
BEGIN
  SELECT * INTO c FROM pcf_ctx;

  -- 1a. projects.owner_id -> sees its project's values, and the table RPC
  --     carries them in one round trip.
  PERFORM set_config('request.jwt.claim.sub', c.u_powner::text, true);

  SELECT COUNT(*) INTO v_n FROM public.project_field_values WHERE project_id = c.project_a;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (1a): project owner sees % value rows for project A (expected 2)', v_n;
  END IF;

  SELECT t.custom_fields INTO v_fields
  FROM public.rpc_projects_table(p_limit := 500) t WHERE t.id = c.project_a;
  IF v_fields IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (1a): rpc_projects_table returned no row for the project owner';
  END IF;
  IF (v_fields ->> 'pcf_fee') IS DISTINCT FROM '8000'
     OR (v_fields ->> 'pcf_status') IS DISTINCT FROM 'Issued' THEN
    RAISE EXCEPTION 'CHECK FAILED (1a): custom_fields = % (expected pcf_fee 8000 / pcf_status Issued)', v_fields;
  END IF;

  -- 1b. Task assignee -> THEIR project only. project_b is same-company and
  --     holds a value for the same field: if the gate were company-wide
  --     instead of fn_project_accessible, this is the row that would leak.
  PERFORM set_config('request.jwt.claim.sub', c.u_direct::text, true);

  SELECT COUNT(*) INTO v_n FROM public.project_field_values WHERE project_id = c.project_a;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (1b): assignee sees % value rows for their own project (expected 2)', v_n;
  END IF;

  SELECT COUNT(*) INTO v_n FROM public.project_field_values WHERE project_id = c.project_b;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (1b): assignee sees % value rows for a project they are not on (expected 0)', v_n;
  END IF;

  -- 1c. Neither owner nor assignee -> ZERO ROWS, no error.
  PERFORM set_config('request.jwt.claim.sub', c.u_zero::text, true);

  SELECT COUNT(*) INTO v_n FROM public.project_field_values
  WHERE project_id IN (c.project_a, c.project_b);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (1c): no-access user sees % value rows (expected 0)', v_n;
  END IF;

  SELECT COUNT(*) INTO v_n FROM public.rpc_projects_table(p_limit := 500) t
  WHERE t.id IN (c.project_a, c.project_b);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (1c): rpc_projects_table returned % rows to a no-access user', v_n;
  END IF;

  -- Deliberate asymmetry: the field DEFINITIONS are company metadata (a
  -- column name and type, no project data) and stay visible. Asserted so a
  -- future change to that policy is a decision, not a silent one.
  SELECT COUNT(*) INTO v_n FROM public.project_field_defs
  WHERE id IN (c.def_fee, c.def_status);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (1c): field defs should stay company-visible, saw % of 2', v_n;
  END IF;

  RAISE NOTICE 'OK (1): owner sees values, assignee sees only their project, no-access user gets zero rows (not an error)';
END $$;

-- ═══ 2. Cross-tenant isolation ════════════════════════════════════════════
DO $$
DECLARE
  c      RECORD;
  v_n    INT;
  v_ok   BOOLEAN;
  v_msg  TEXT;
BEGIN
  SELECT * INTO c FROM pcf_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.b_owner::text, true);

  -- Reads
  SELECT COUNT(*) INTO v_n FROM public.project_field_defs
  WHERE id IN (c.def_fee, c.def_status);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (2): company B read % of company A''s field defs', v_n;
  END IF;

  SELECT COUNT(*) INTO v_n FROM public.project_field_values
  WHERE project_id IN (c.project_a, c.project_b);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (2): company B read % of company A''s field values', v_n;
  END IF;

  -- Same key, two companies: per-COMPANY, never global.
  SELECT COUNT(*) INTO v_n FROM public.project_field_defs WHERE key = 'pcf_status';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (2): company B sees % defs keyed pcf_status (expected exactly its own)', v_n;
  END IF;

  -- Writes: edit A's def
  v_ok := false;
  BEGIN
    PERFORM public.rpc_save_project_field_def(
      p_key := 'pcf_fee', p_label := 'HIJACKED', p_data_type := 'text', p_id := c.def_fee);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (2): company B edited company A''s field def'; END IF;
  IF v_msg IS DISTINCT FROM 'Custom field not found.' THEN
    RAISE EXCEPTION 'CHECK FAILED (2): expected "Custom field not found.", got: %', v_msg;
  END IF;

  -- Writes: delete A's def
  v_ok := false;
  BEGIN
    PERFORM public.rpc_delete_project_field_def(c.def_fee);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (2): company B deleted company A''s field def'; END IF;
  IF v_msg IS DISTINCT FROM 'Custom field not found.' THEN
    RAISE EXCEPTION 'CHECK FAILED (2): expected "Custom field not found.", got: %', v_msg;
  END IF;

  -- Writes: set a value on A's project (denial reads the same as
  -- non-existence -- a distinguishable "denied" would itself disclose that
  -- the engagement exists, §13.14).
  v_ok := false;
  BEGIN
    PERFORM public.rpc_set_project_field_values(jsonb_build_array(jsonb_build_object(
      'project_id', c.project_a, 'field_def_id', c.def_fee, 'value', 99999)));
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (2): company B wrote a value onto company A''s project'; END IF;
  IF v_msg IS DISTINCT FROM 'Project not found.' THEN
    RAISE EXCEPTION 'CHECK FAILED (2): expected "Project not found.", got: %', v_msg;
  END IF;

  -- Writes: attach A's def to B's OWN project -- the sideways version, where
  -- the project check alone would pass.
  v_ok := false;
  BEGIN
    PERFORM public.rpc_set_project_field_values(jsonb_build_array(jsonb_build_object(
      'project_id', c.project_c, 'field_def_id', c.def_fee, 'value', 42)));
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (2): company A''s def was attached to a company B project'; END IF;
  IF v_msg IS DISTINCT FROM 'Custom field not found.' THEN
    RAISE EXCEPTION 'CHECK FAILED (2): expected "Custom field not found.", got: %', v_msg;
  END IF;

  RAISE NOTICE 'OK (2): company B can neither read nor write company A''s defs or values, by RLS or by any RPC';
END $$;

-- ═══ 3. Type violations are refused by the DATABASE ═══════════════════════
DO $$
DECLARE
  c     RECORD;
  v_ok  BOOLEAN;
  v_msg TEXT;
BEGIN
  SELECT * INTO c FROM pcf_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_powner::text, true);

  -- 3a. "8,000" style text into a number field. This is exactly the real-file
  --     case from §18.4 -- money as text -- and it must fail loudly rather
  --     than land as NULL.
  v_ok := false;
  BEGIN
    PERFORM public.rpc_set_project_field_values(jsonb_build_array(jsonb_build_object(
      'project_id', c.project_a, 'field_def_id', c.def_fee, 'value', '8,000')));
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLSTATE;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (3a): "8,000" was accepted into a number field'; END IF;
  IF v_msg <> '22P02' THEN
    RAISE EXCEPTION 'CHECK FAILED (3a): expected invalid_text_representation (22P02), got %', v_msg;
  END IF;

  -- 3b. A value outside the enum's options.
  v_ok := false;
  BEGIN
    PERFORM public.rpc_set_project_field_values(jsonb_build_array(jsonb_build_object(
      'project_id', c.project_a, 'field_def_id', c.def_status, 'value', 'Definitely Not An Option')));
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (3b): a non-member value was accepted into an enum field'; END IF;
  IF v_msg NOT LIKE '%not one of the allowed options%' THEN
    RAISE EXCEPTION 'CHECK FAILED (3b): unexpected error: %', v_msg;
  END IF;

  RAISE NOTICE 'OK (3a/3b): the RPC refuses a bad number and a non-member enum value';
END $$;

-- Direct table writes: RLS has no INSERT policy, so these have to run as
-- postgres to reach the TRIGGER at all. That is the point -- the type rule
-- must hold for a writer that never touches the RPC.
RESET ROLE;

DO $$
DECLARE
  c     RECORD;
  v_ok  BOOLEAN;
  v_msg TEXT;
BEGIN
  SELECT * INTO c FROM pcf_ctx;

  -- 3c. Right value, wrong column: text into a number-typed field.
  v_ok := false;
  BEGIN
    INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_text)
    VALUES (c.project_b, c.def_status, c.company_a, 'Issued');   -- fine, warm-up
    INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_text)
    VALUES (c.project_b, c.def_fee, c.company_a, 'eight thousand')
    ON CONFLICT (project_id, field_def_id) DO UPDATE
      SET value_text = EXCLUDED.value_text, value_num = NULL;
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (3c): a direct INSERT stored text in a number-typed field';
  END IF;
  IF v_msg NOT LIKE '%must be stored in the matching column%' THEN
    RAISE EXCEPTION 'CHECK FAILED (3c): unexpected error: %', v_msg;
  END IF;

  -- 3d. Two typed columns at once -- ambiguous, refused by the CHECK.
  v_ok := false;
  BEGIN
    INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_text, value_num)
    VALUES (c.project_b, c.def_status, c.company_a, 'Issued', 1);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (3d): a row with two populated value columns was accepted'; END IF;
  IF v_msg NOT LIKE '%project_field_values_one_value_ck%' THEN
    RAISE EXCEPTION 'CHECK FAILED (3d): unexpected error: %', v_msg;
  END IF;

  -- 3e. A company B project carrying a company A def -- refused even for a
  --     BYPASSRLS writer, because the tenant rule lives in the trigger and
  --     not only in the RPC.
  v_ok := false;
  BEGIN
    INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_num)
    VALUES (c.project_c, c.def_fee, c.company_b, 1);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (3e): a value bridged two companies'; END IF;
  IF v_msg NOT LIKE '%belongs to a different company%' THEN
    RAISE EXCEPTION 'CHECK FAILED (3e): unexpected error: %', v_msg;
  END IF;

  RAISE NOTICE 'OK (3c/3d/3e): the trigger and CHECK refuse wrong-column, two-column and cross-company writes even from postgres';
END $$;

-- ═══ 4. Delete-def semantics: soft delete, values RETAINED ════════════════
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c        RECORD;
  v_res    JSONB;
  v_n      INT;
  v_fields JSONB;
BEGIN
  SELECT * INTO c FROM pcf_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_powner::text, true);

  v_res := public.rpc_delete_project_field_def(c.def_fee);
  IF (v_res ->> 'values_retained')::INT IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (4): delete reported values_retained = % (expected 2)', v_res ->> 'values_retained';
  END IF;

  -- Gone from the defs list...
  SELECT COUNT(*) INTO v_n FROM public.project_field_defs WHERE id = c.def_fee;
  IF v_n <> 0 THEN RAISE EXCEPTION 'CHECK FAILED (4): a deleted def is still listed'; END IF;

  -- ...and gone from the table RPC, while the sibling field stays.
  SELECT t.custom_fields INTO v_fields
  FROM public.rpc_projects_table(p_limit := 500) t WHERE t.id = c.project_a;
  IF v_fields ? 'pcf_fee' THEN
    RAISE EXCEPTION 'CHECK FAILED (4): rpc_projects_table still surfaces a deleted field: %', v_fields;
  END IF;
  IF (v_fields ->> 'pcf_status') IS DISTINCT FROM 'Issued' THEN
    RAISE EXCEPTION 'CHECK FAILED (4): deleting one field disturbed another: %', v_fields;
  END IF;

  RAISE NOTICE 'OK (4a): deleting a field def hides it from the defs list and from rpc_projects_table';
END $$;

RESET ROLE;
DO $$
DECLARE
  c   RECORD;
  v_n INT;
BEGIN
  SELECT * INTO c FROM pcf_ctx;

  -- The decision, verified on disk: the values are RETAINED, not cascaded
  -- away. §18.2 rule 3 -- "hide this column" must not destroy an import.
  SELECT COUNT(*) INTO v_n FROM public.project_field_values WHERE field_def_id = c.def_fee;
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (4b): % value rows survived the def delete (expected 2 -- they must be RETAINED)', v_n;
  END IF;

  -- Partial unique index (plan §13.6): the deleted key is reusable, not burnt.
  INSERT INTO public.project_field_defs (company_id, key, label, data_type)
  VALUES (c.company_a, 'pcf_fee', 'A brand new field reusing a deleted key', 'text');
  DELETE FROM public.project_field_defs
  WHERE company_id = c.company_a AND key = 'pcf_fee' AND deleted_at IS NULL;

  RAISE NOTICE 'OK (4b): values retained on disk, and the deleted key is reusable (partial unique index holds)';
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  c        RECORD;
  v_res    JSONB;
  v_fields JSONB;
  v_n      INT;
BEGIN
  SELECT * INTO c FROM pcf_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_powner::text, true);

  -- Re-saving the same key REVIVES the same def id, so the retained values
  -- come back -- which is also what makes a repeat import idempotent instead
  -- of accumulating duplicate defs.
  v_res := public.rpc_save_project_field_def(
    p_key := 'pcf_fee', p_label := 'AUDIT 2025', p_data_type := 'number');
  IF (v_res ->> 'id')::UUID IS DISTINCT FROM c.def_fee THEN
    RAISE EXCEPTION 'CHECK FAILED (4c): re-saving the key created a NEW def (% vs %) instead of reviving',
      v_res ->> 'id', c.def_fee;
  END IF;

  SELECT t.custom_fields INTO v_fields
  FROM public.rpc_projects_table(p_limit := 500) t WHERE t.id = c.project_a;
  IF (v_fields ->> 'pcf_fee') IS DISTINCT FROM '8000' THEN
    RAISE EXCEPTION 'CHECK FAILED (4c): retained value did not come back on revive: %', v_fields;
  END IF;

  -- And the type of a populated field is frozen: allowing this would
  -- manufacture rows the value trigger exists to refuse.
  BEGIN
    PERFORM public.rpc_save_project_field_def(
      p_key := 'pcf_fee', p_label := 'AUDIT 2025', p_data_type := 'text');
    RAISE EXCEPTION 'CHECK FAILED (4c): changed a populated field''s data_type';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%while it has values%' THEN RAISE; END IF;
  END;

  -- Bulk write + clear, the shape the importer uses.
  v_res := public.rpc_set_project_field_values(jsonb_build_array(
    jsonb_build_object('project_id', c.project_a, 'field_def_id', c.def_fee,    'value', 12500),
    jsonb_build_object('project_id', c.project_a, 'field_def_id', c.def_status, 'value', NULL)
  ));
  IF (v_res ->> 'set')::INT <> 1 OR (v_res ->> 'cleared')::INT <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (4d): bulk set returned % (expected set 1 / cleared 1)', v_res;
  END IF;

  SELECT t.custom_fields INTO v_fields
  FROM public.rpc_projects_table(p_limit := 500) t WHERE t.id = c.project_a;
  IF (v_fields ->> 'pcf_fee') IS DISTINCT FROM '12500' OR v_fields ? 'pcf_status' THEN
    RAISE EXCEPTION 'CHECK FAILED (4d): after bulk set/clear custom_fields = %', v_fields;
  END IF;

  RAISE NOTICE 'OK (4c/4d): re-save revives the def and its values, a populated type is frozen, bulk set/clear works';
END $$;

RESET ROLE;

DO $$ BEGIN
  RAISE NOTICE 'ALL OK: project custom fields -- three-actor visibility via fn_project_accessible, cross-tenant isolation on defs AND values, DB-enforced typing (RPC + trigger + CHECK), retain-on-delete with revive, partial unique index on a soft-deleted key.';
END $$;

ROLLBACK;
