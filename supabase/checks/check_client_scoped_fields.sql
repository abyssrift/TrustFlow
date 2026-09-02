-- Runnable check for issue #199 Phase 1 (plan docs/CLIENT_SCOPED_FIELDS_PLAN.md
-- §4.2): client-scoped custom fields — project_field_defs.scope,
-- client_field_values, its typecheck trigger + RLS, and the client legs added
-- to rpc_set_project_field_values / rpc_projects_table / fn_project_field_matches.
--
-- Not a migration — lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/check_client_scoped_fields.sql
--
-- Wrapped in BEGIN/ROLLBACK: seeds a client with TWO projects in an existing
-- company, one client-scoped def + one project-scoped def, plus a second
-- company with its own client/project. Reuses real users/roles, never invents
-- auth.users rows (same convention as check_project_custom_fields.sql). Always
-- rolls back.
--
-- RLS/RPC assertions run under `SET LOCAL ROLE authenticated` with
-- set_config('request.jwt.claim.sub', ...) to impersonate each actor. The
-- direct-INSERT trigger assertions run as postgres (BYPASSRLS) — RLS would deny
-- them before the trigger fires, and the point is that the type/scope rule
-- holds for a superuser writer too.
--
-- Proves:
--   1. A client-scoped value written ONCE against client_id is returned by
--      rpc_projects_table.custom_fields for EVERY project of that client, and
--      by fn_project_field_matches for each.
--   2. trg_client_field_value_typecheck refuses: wrong typed column, two
--      columns at once, a def from another company, and a scope='project' def.
--   3. rpc_set_project_field_values refuses an element with both keys / neither
--      key, and a client_id element whose def is scope='project'.
--   4. Company B's owner can neither read nor write company A's client values.
--   5. rpc_save_project_field_def refuses a scope flip once a value exists.
--   6. Re-import idempotency: saving the same def twice with the same p_scope
--      does not duplicate and does not error.

BEGIN;

CREATE TEMP TABLE csf_ctx (
  company_a   UUID,
  company_b   UUID,
  creator     UUID,
  u_powner    UUID,
  b_owner     UUID,
  client_a    UUID,
  client_b    UUID,
  project_a1  UUID,
  project_a2  UUID,
  project_b   UUID,
  def_focal   UUID,   -- scope = 'client'
  def_fee     UUID,   -- scope = 'project'
  def_b       UUID    -- company B, scope = 'client'
);
GRANT SELECT ON csf_ctx TO authenticated;

-- ── Fixture setup (postgres: bypasses RLS, has table grants) ──────────────
DO $$
DECLARE
  v_company_a UUID;
  v_company_b UUID;
  v_creator   UUID;
  v_powner    UUID;
  v_b_owner   UUID;
  v_client_a  UUID;
  v_client_b  UUID;
  v_p_a1      UUID;
  v_p_a2      UUID;
  v_p_b       UUID;
  v_def_focal UUID;
  v_def_fee   UUID;
  v_def_b     UUID;
BEGIN
  SELECT u.company_id INTO v_company_a
  FROM public.users u
  JOIN public.companies c ON c.id = u.company_id AND c.deleted_at IS NULL
  WHERE u.is_owner = false
  GROUP BY u.company_id
  HAVING COUNT(*) >= 1
  ORDER BY COUNT(*) DESC
  LIMIT 1;
  IF v_company_a IS NULL THEN
    RAISE EXCEPTION 'Need a company with a non-owner user — run against a seeded dev DB, not prod.';
  END IF;

  SELECT id INTO v_creator FROM public.users
  WHERE company_id = v_company_a AND is_owner = true LIMIT 1;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'No owner user in company %.', v_company_a;
  END IF;

  SELECT id INTO v_powner FROM public.users
  WHERE company_id = v_company_a AND is_owner = false ORDER BY id LIMIT 1;

  SELECT u.company_id, u.id INTO v_company_b, v_b_owner
  FROM public.users u
  JOIN public.companies c ON c.id = u.company_id AND c.deleted_at IS NULL
  WHERE u.company_id <> v_company_a AND u.is_owner = true
  LIMIT 1;
  IF v_company_b IS NULL THEN
    RAISE EXCEPTION 'Need a second company with an owner user for the isolation assertions.';
  END IF;

  -- project.view gates rpc_projects_table, project.edit gates the field RPCs.
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT DISTINCT ur.role_id, p.id
  FROM public.user_roles ur
  CROSS JOIN public.permissions p
  WHERE ur.user_id = v_powner
    AND ur.revoked_at IS NULL
    AND p.key IN ('project.view', 'project.edit')
  ON CONFLICT DO NOTHING;

  -- One client, TWO engagements — the whole point of #199.
  INSERT INTO public.clients (company_id, name)
  VALUES (v_company_a, 'CSF Selfcheck Client A') RETURNING id INTO v_client_a;

  INSERT INTO public.projects (company_id, name, created_by, owner_id, client_id)
  VALUES (v_company_a, 'CSF Audit 2025', v_creator, v_powner, v_client_a)
  RETURNING id INTO v_p_a1;
  INSERT INTO public.projects (company_id, name, created_by, owner_id, client_id)
  VALUES (v_company_a, 'CSF Tax 2025', v_creator, v_powner, v_client_a)
  RETURNING id INTO v_p_a2;

  -- Company B: its own client + project.
  INSERT INTO public.clients (company_id, name)
  VALUES (v_company_b, 'CSF Selfcheck Client B') RETURNING id INTO v_client_b;
  INSERT INTO public.projects (company_id, name, created_by, owner_id, client_id)
  VALUES (v_company_b, 'CSF Selfcheck Project B', v_b_owner, v_b_owner, v_client_b)
  RETURNING id INTO v_p_b;

  -- Defs. focal_point is client-scoped, fee is project-scoped.
  INSERT INTO public.project_field_defs (company_id, key, label, data_type, scope, source_column, created_by)
  VALUES (v_company_a, 'csf_focal', 'Focal point', 'text', 'client', 'Focal point', v_creator)
  RETURNING id INTO v_def_focal;

  INSERT INTO public.project_field_defs (company_id, key, label, data_type, scope, source_column, created_by)
  VALUES (v_company_a, 'csf_fee', 'Proposed fee', 'number', 'project', 'Proposed fee', v_creator)
  RETURNING id INTO v_def_fee;

  INSERT INTO public.project_field_defs (company_id, key, label, data_type, scope, created_by)
  VALUES (v_company_b, 'csf_focal_b', 'B focal', 'text', 'client', v_b_owner)
  RETURNING id INTO v_def_b;

  -- The client value, written ONCE against the client.
  INSERT INTO public.client_field_values (client_id, field_def_id, company_id, value_text)
  VALUES (v_client_a, v_def_focal, v_company_a, 'Jane Roe');
  -- A per-project value on one engagement only.
  INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_num)
  VALUES (v_p_a1, v_def_fee, v_company_a, 15000);

  INSERT INTO csf_ctx VALUES (
    v_company_a, v_company_b, v_creator, v_powner, v_b_owner,
    v_client_a, v_client_b, v_p_a1, v_p_a2, v_p_b,
    v_def_focal, v_def_fee, v_def_b
  );
END $$;

-- ═══ 1. One write, every engagement sees it ═══════════════════════════════
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c        RECORD;
  v_f1     JSONB;
  v_f2     JSONB;
  v_ids    UUID[];
  v_n      INT;
BEGIN
  SELECT * INTO c FROM csf_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_powner::text, true);

  SELECT t.custom_fields INTO v_f1 FROM public.rpc_projects_table(p_limit := 500) t WHERE t.id = c.project_a1;
  SELECT t.custom_fields INTO v_f2 FROM public.rpc_projects_table(p_limit := 500) t WHERE t.id = c.project_a2;

  IF v_f1 IS NULL OR v_f2 IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (1): rpc_projects_table returned no row for one of the client''s projects';
  END IF;
  -- The client-scoped value is on BOTH, written once.
  IF (v_f1 ->> 'csf_focal') IS DISTINCT FROM 'Jane Roe'
     OR (v_f2 ->> 'csf_focal') IS DISTINCT FROM 'Jane Roe' THEN
    RAISE EXCEPTION 'CHECK FAILED (1): csf_focal not shared across engagements: p_a1=% p_a2=%', v_f1, v_f2;
  END IF;
  -- The project-scoped value is on its own engagement only.
  IF (v_f1 ->> 'csf_fee') IS DISTINCT FROM '15000' THEN
    RAISE EXCEPTION 'CHECK FAILED (1): project-scoped fee missing on its own project: %', v_f1;
  END IF;
  IF v_f2 ? 'csf_fee' THEN
    RAISE EXCEPTION 'CHECK FAILED (1): project-scoped fee leaked onto the sibling engagement: %', v_f2;
  END IF;

  -- fn_project_field_matches resolves the client leg — exercised through
  -- rpc_projects_table's p_field_filters (the fn itself is granted to nobody).
  -- Case/whitespace-insensitive equality must match on BOTH engagements.
  SELECT ARRAY_AGG(t.id ORDER BY t.name) INTO v_ids FROM public.rpc_projects_table(
    p_limit := 500,
    p_field_filters := '[{"key":"csf_focal","op":"eq","value":"  jane ROE "}]'::jsonb) t
  WHERE t.id IN (c.project_a1, c.project_a2);
  IF v_ids IS DISTINCT FROM ARRAY[c.project_a1, c.project_a2] AND v_ids IS DISTINCT FROM ARRAY[c.project_a2, c.project_a1] THEN
    RAISE EXCEPTION 'CHECK FAILED (1): eq filter on a client-scoped key did not match both engagements: %', v_ids;
  END IF;

  -- set matches both; unset matches neither.
  SELECT count(*) INTO v_n FROM public.rpc_projects_table(
    p_limit := 500, p_field_filters := '[{"key":"csf_focal","op":"set"}]'::jsonb) t
  WHERE t.id IN (c.project_a1, c.project_a2);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (1): op:set on a client-scoped key matched % of 2 engagements', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.rpc_projects_table(
    p_limit := 500, p_field_filters := '[{"key":"csf_focal","op":"unset"}]'::jsonb) t
  WHERE t.id IN (c.project_a1, c.project_a2);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (1): op:unset on a set client-scoped key still matched % engagements', v_n;
  END IF;

  RAISE NOTICE 'OK (1): one client-scoped write shows on every engagement; project-scoped stays put; the filter predicate resolves the client leg';
END $$;

-- ═══ 2. The client typecheck trigger (direct writes, as postgres) ═════════
RESET ROLE;

DO $$
DECLARE
  c     RECORD;
  v_ok  BOOLEAN;
  v_msg TEXT;
BEGIN
  SELECT * INTO c FROM csf_ctx;

  -- 2a. Wrong typed column: text def, value in value_num.
  v_ok := false;
  BEGIN
    INSERT INTO public.client_field_values (client_id, field_def_id, company_id, value_num)
    VALUES (c.client_a, c.def_focal, c.company_a, 42);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (2a): a number landed in a text client field'; END IF;
  IF v_msg NOT LIKE '%must be stored in the matching column%' THEN
    RAISE EXCEPTION 'CHECK FAILED (2a): unexpected error: %', v_msg;
  END IF;

  -- 2b. Two typed columns at once.
  v_ok := false;
  BEGIN
    INSERT INTO public.client_field_values (client_id, field_def_id, company_id, value_text, value_num)
    VALUES (c.client_b, c.def_b, c.company_b, 'x', 1);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (2b): two populated value columns were accepted'; END IF;
  IF v_msg NOT LIKE '%client_field_values_one_value_ck%' THEN
    RAISE EXCEPTION 'CHECK FAILED (2b): unexpected error: %', v_msg;
  END IF;

  -- 2c. A def from another company.
  v_ok := false;
  BEGIN
    INSERT INTO public.client_field_values (client_id, field_def_id, company_id, value_text)
    VALUES (c.client_b, c.def_focal, c.company_b, 'x');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (2c): a client value bridged two companies'; END IF;
  -- def_focal is company A + scope client; against a company B client the def
  -- lookup (scope='client' ok) succeeds then the company mismatch fires. If
  -- the row order differed it could also be "does not exist" — accept either.
  IF v_msg NOT LIKE '%different company%' AND v_msg NOT LIKE '%does not exist%' THEN
    RAISE EXCEPTION 'CHECK FAILED (2c): unexpected error: %', v_msg;
  END IF;

  -- 2d. A scope='project' def must never receive a client value.
  v_ok := false;
  BEGIN
    INSERT INTO public.client_field_values (client_id, field_def_id, company_id, value_num)
    VALUES (c.client_a, c.def_fee, c.company_a, 999);
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (2d): a project-scoped def accepted a client value'; END IF;
  IF v_msg NOT LIKE '%does not exist%' THEN
    RAISE EXCEPTION 'CHECK FAILED (2d): unexpected error: %', v_msg;
  END IF;

  -- 2e. And the other direction, on the project trigger: a client-scoped def
  --     must never receive a PROJECT value.
  v_ok := false;
  BEGIN
    INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_text)
    VALUES (c.project_a1, c.def_focal, c.company_a, 'x');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (2e): a client-scoped def accepted a project value'; END IF;
  IF v_msg NOT LIKE '%does not exist%' THEN
    RAISE EXCEPTION 'CHECK FAILED (2e): unexpected error: %', v_msg;
  END IF;

  RAISE NOTICE 'OK (2): client typecheck trigger refuses wrong-column, two-column, cross-company and wrong-scope writes (both directions)';
END $$;

-- ═══ 3. rpc_set_project_field_values — key + scope discipline ═════════════
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c     RECORD;
  v_ok  BOOLEAN;
  v_msg TEXT;
BEGIN
  SELECT * INTO c FROM csf_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_powner::text, true);

  -- 3a. Both keys.
  v_ok := false;
  BEGIN
    PERFORM public.rpc_set_project_field_values(jsonb_build_array(jsonb_build_object(
      'project_id', c.project_a1, 'client_id', c.client_a, 'field_def_id', c.def_focal, 'value', 'z')));
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (3a): an element with both project_id and client_id was accepted'; END IF;
  IF v_msg NOT LIKE '%exactly one of project_id or client_id%' THEN
    RAISE EXCEPTION 'CHECK FAILED (3a): unexpected error: %', v_msg;
  END IF;

  -- 3b. Neither key.
  v_ok := false;
  BEGIN
    PERFORM public.rpc_set_project_field_values(jsonb_build_array(jsonb_build_object(
      'field_def_id', c.def_focal, 'value', 'z')));
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (3b): an element with neither key was accepted'; END IF;
  IF v_msg NOT LIKE '%exactly one of project_id or client_id%' THEN
    RAISE EXCEPTION 'CHECK FAILED (3b): unexpected error: %', v_msg;
  END IF;

  -- 3c. client_id element whose def is scope='project'.
  v_ok := false;
  BEGIN
    PERFORM public.rpc_set_project_field_values(jsonb_build_array(jsonb_build_object(
      'client_id', c.client_a, 'field_def_id', c.def_fee, 'value', 100)));
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (3c): a project-scoped def was written via client_id'; END IF;
  IF v_msg IS DISTINCT FROM 'Custom field not found.' THEN
    RAISE EXCEPTION 'CHECK FAILED (3c): expected "Custom field not found.", got: %', v_msg;
  END IF;

  -- 3d. The happy path still works: a client_id element updates the shared value.
  PERFORM public.rpc_set_project_field_values(jsonb_build_array(jsonb_build_object(
    'client_id', c.client_a, 'field_def_id', c.def_focal, 'value', 'John Doe')));
  IF (SELECT value_text FROM public.client_field_values WHERE client_id = c.client_a AND field_def_id = c.def_focal)
     IS DISTINCT FROM 'John Doe' THEN
    RAISE EXCEPTION 'CHECK FAILED (3d): the client_id write path did not update the shared value';
  END IF;

  RAISE NOTICE 'OK (3): rpc_set_project_field_values enforces exactly-one-key and def/scope agreement; the client_id write path works';
END $$;

-- ═══ 4. Cross-tenant isolation on client values ══════════════════════════
DO $$
DECLARE
  c     RECORD;
  v_n   INT;
  v_ok  BOOLEAN;
  v_msg TEXT;
BEGIN
  SELECT * INTO c FROM csf_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.b_owner::text, true);

  SELECT COUNT(*) INTO v_n FROM public.client_field_values WHERE client_id = c.client_a;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (4): company B read % of company A''s client values', v_n;
  END IF;

  v_ok := false;
  BEGIN
    PERFORM public.rpc_set_project_field_values(jsonb_build_array(jsonb_build_object(
      'client_id', c.client_a, 'field_def_id', c.def_focal, 'value', 'HIJACK')));
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (4): company B wrote a value onto company A''s client'; END IF;
  -- Client not visible → "Client not found."; def not visible → "Custom field
  -- not found." Either is a correct §13.14 denial.
  IF v_msg NOT IN ('Client not found.', 'Custom field not found.') THEN
    RAISE EXCEPTION 'CHECK FAILED (4): expected a not-found denial, got: %', v_msg;
  END IF;

  -- Confirm nothing changed — from a role that can actually see the row.
  PERFORM set_config('request.jwt.claim.sub', c.u_powner::text, true);
  IF (SELECT value_text FROM public.client_field_values WHERE client_id = c.client_a AND field_def_id = c.def_focal)
     IS DISTINCT FROM 'John Doe' THEN
    RAISE EXCEPTION 'CHECK FAILED (4): company A''s client value changed';
  END IF;

  RAISE NOTICE 'OK (4): company B can neither read nor write company A''s client values';
END $$;

-- ═══ 5. Scope flip refused once a value exists ═══════════════════════════
DO $$
DECLARE
  c     RECORD;
  v_ok  BOOLEAN;
  v_msg TEXT;
BEGIN
  SELECT * INTO c FROM csf_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_powner::text, true);

  -- csf_focal has a client_field_values row → cannot go back to project.
  v_ok := false;
  BEGIN
    PERFORM public.rpc_save_project_field_def(
      p_key := 'csf_focal', p_label := 'Focal point', p_data_type := 'text',
      p_id := c.def_focal, p_scope := 'project');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (5): scope flip was allowed on a populated field'; END IF;
  IF v_msg NOT LIKE '%scope of custom field%while it has values%' THEN
    RAISE EXCEPTION 'CHECK FAILED (5): unexpected error: %', v_msg;
  END IF;

  -- csf_fee has a project_field_values row → cannot go to client either.
  v_ok := false;
  BEGIN
    PERFORM public.rpc_save_project_field_def(
      p_key := 'csf_fee', p_label := 'Proposed fee', p_data_type := 'number',
      p_id := c.def_fee, p_scope := 'client');
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM;
  END;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (5): project→client flip was allowed on a populated field'; END IF;
  IF v_msg NOT LIKE '%scope of custom field%while it has values%' THEN
    RAISE EXCEPTION 'CHECK FAILED (5): unexpected error: %', v_msg;
  END IF;

  RAISE NOTICE 'OK (5): rpc_save_project_field_def refuses a scope flip while the field has values';
END $$;

-- ═══ 6. Re-import idempotency ════════════════════════════════════════════
DO $$
DECLARE
  c      RECORD;
  v_res1 JSONB;
  v_res2 JSONB;
  v_n    INT;
BEGIN
  SELECT * INTO c FROM csf_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_powner::text, true);

  v_res1 := public.rpc_save_project_field_def(
    p_key := 'csf_position', p_label := 'Position', p_data_type := 'text', p_scope := 'client');
  v_res2 := public.rpc_save_project_field_def(
    p_key := 'csf_position', p_label := 'Position', p_data_type := 'text', p_scope := 'client');

  IF (v_res1 ->> 'id') IS DISTINCT FROM (v_res2 ->> 'id') THEN
    RAISE EXCEPTION 'CHECK FAILED (6): saving the same def twice produced two ids (% vs %)', v_res1 ->> 'id', v_res2 ->> 'id';
  END IF;
  IF (v_res2 ->> 'scope') IS DISTINCT FROM 'client' THEN
    RAISE EXCEPTION 'CHECK FAILED (6): re-save lost the scope: %', v_res2;
  END IF;

  SELECT COUNT(*) INTO v_n FROM public.project_field_defs
  WHERE company_id = c.company_a AND key = 'csf_position' AND deleted_at IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (6): % live defs keyed csf_position (expected 1)', v_n;
  END IF;

  RAISE NOTICE 'OK (6): saving the same client-scoped def twice is idempotent';
END $$;

RESET ROLE;

DO $$ BEGIN
  RAISE NOTICE 'ALL OK: client-scoped fields — one write shared across every engagement, DB-enforced typing + scope (trigger both directions), key/scope discipline in the writer, cross-tenant isolation, scope-flip refused while populated, idempotent re-import.';
END $$;

ROLLBACK;
