-- Runnable check for issue #197 / plan §18.3: rpc_projects_table's
-- p_field_filters, and the fn_project_field_matches predicate behind it.
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/check_project_field_filter.sql
--
-- Wrapped in BEGIN/ROLLBACK: creates three throwaway projects and four field
-- defs in an existing seeded company, reusing a real owner user and never
-- inventing auth.users rows (same convention as check_project_custom_fields).
-- Always rolls back.
--
-- Proves:
--   1. Equality filters each of the four value types, including the case- and
--      whitespace-drift that §21.1 says real files always have.
--   2. `set` / `unset` separate "filled in" from "the spreadsheet left it
--      blank" -- the question a 62%-coverage column always raises.
--   3. Multiple filters AND together, and a filter that matches nothing
--      returns ZERO ROWS rather than raising -- including a non-numeric string
--      aimed at a number field, which without the regex guard raises
--      invalid_text_representation and takes the entire projects list down.
--   4. A soft-deleted def's retained values are NOT filterable -- the same
--      "hidden everywhere" rule §18.3 states for reads.
--   5. rpc_projects_table still has exactly ONE signature (the overload trap),
--      and the patched body kept custom_fields and the widened "Needs
--      attention" predicate it was patched over.

BEGIN;

CREATE TEMP TABLE pff_ctx (
  company   UUID,
  owner_id  UUID,
  p_yes     UUID,
  p_no      UUID,
  p_blank   UUID,
  d_inv     UUID,
  d_status  UUID,
  d_fee     UUID,
  d_due     UUID,
  d_gone    UUID
);
GRANT SELECT ON pff_ctx TO authenticated;

DO $$
DECLARE
  v_company UUID;
  v_owner   UUID;
  v_yes     UUID;
  v_no      UUID;
  v_blank   UUID;
  v_inv     UUID;
  v_status  UUID;
  v_fee     UUID;
  v_due     UUID;
  v_gone    UUID;
BEGIN
  SELECT u.company_id, u.id INTO v_company, v_owner
  FROM public.users u
  JOIN public.companies c ON c.id = u.company_id AND c.deleted_at IS NULL
  WHERE u.is_owner = true
  ORDER BY u.company_id
  LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Need a company with an owner user -- run against a seeded dev DB, not prod.';
  END IF;

  -- project.view gates the RPC itself; this check is about row selection, not
  -- about the screen gate, so make sure it cannot be the reason for zero rows.
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT DISTINCT ur.role_id, p.id
  FROM public.user_roles ur
  CROSS JOIN public.permissions p
  WHERE ur.user_id = v_owner AND ur.revoked_at IS NULL
    AND p.key IN ('project.view', 'project.edit')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.projects (company_id, name, created_by, owner_id)
  VALUES (v_company, 'PFF Filter Yes', v_owner, v_owner) RETURNING id INTO v_yes;
  INSERT INTO public.projects (company_id, name, created_by, owner_id)
  VALUES (v_company, 'PFF Filter No', v_owner, v_owner) RETURNING id INTO v_no;
  INSERT INTO public.projects (company_id, name, created_by, owner_id)
  VALUES (v_company, 'PFF Filter Blank', v_owner, v_owner) RETURNING id INTO v_blank;

  INSERT INTO public.project_field_defs (company_id, key, label, data_type, created_by)
  VALUES (v_company, 'pff_inventory', 'PFF Inventory Count Needed', 'boolean', v_owner) RETURNING id INTO v_inv;
  INSERT INTO public.project_field_defs (company_id, key, label, data_type, enum_options, created_by)
  VALUES (v_company, 'pff_status', 'PFF EL Status', 'enum', ARRAY['Pending','Renewed'], v_owner) RETURNING id INTO v_status;
  INSERT INTO public.project_field_defs (company_id, key, label, data_type, created_by)
  VALUES (v_company, 'pff_fee', 'PFF Proposed fee', 'number', v_owner) RETURNING id INTO v_fee;
  INSERT INTO public.project_field_defs (company_id, key, label, data_type, created_by)
  VALUES (v_company, 'pff_due', 'PFF Follow-up', 'date', v_owner) RETURNING id INTO v_due;
  INSERT INTO public.project_field_defs (company_id, key, label, data_type, created_by)
  VALUES (v_company, 'pff_gone', 'PFF Retired column', 'text', v_owner) RETURNING id INTO v_gone;

  -- "Yes" row: every field filled. The enum cell is stored EXACTLY as the def
  -- allows; the drift the filter has to absorb is on the query side.
  INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_bool)
  VALUES (v_yes, v_inv, v_company, TRUE);
  INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_text)
  VALUES (v_yes, v_status, v_company, 'Renewed');
  INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_num)
  VALUES (v_yes, v_fee, v_company, 8000);
  INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_date)
  VALUES (v_yes, v_due, v_company, DATE '2026-02-08');
  INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_text)
  VALUES (v_yes, v_gone, v_company, 'kept on disk');

  -- "No" row: filled, but with the other answers.
  INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_bool)
  VALUES (v_no, v_inv, v_company, FALSE);
  INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_text)
  VALUES (v_no, v_status, v_company, 'Pending');
  INSERT INTO public.project_field_values (project_id, field_def_id, company_id, value_num)
  VALUES (v_no, v_fee, v_company, 12500);

  -- "Blank" row: no values at all -- the spreadsheet left the cells empty.

  INSERT INTO pff_ctx VALUES (v_company, v_owner, v_yes, v_no, v_blank, v_inv, v_status, v_fee, v_due, v_gone);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c        pff_ctx;
  v_ids    UUID[];
  v_n      INT;
BEGIN
  SELECT * INTO c FROM pff_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.owner_id::TEXT, true);

  -- ── 1. Equality across all four types, with §21.1's drift ──────────────
  SELECT ARRAY_AGG(t.id) INTO v_ids FROM public.rpc_projects_table(
    p_limit := 500,
    p_field_filters := '[{"key":"pff_inventory","op":"eq","value":"YES"}]'::JSONB) t
  WHERE t.id IN (c.p_yes, c.p_no, c.p_blank);
  IF v_ids IS DISTINCT FROM ARRAY[c.p_yes] THEN
    RAISE EXCEPTION 'CHECK FAILED (1a): boolean "YES" matched % (expected only the Yes row)', v_ids;
  END IF;

  -- Lower case and padding on BOTH sides of the comparison.
  SELECT ARRAY_AGG(t.id) INTO v_ids FROM public.rpc_projects_table(
    p_limit := 500,
    p_field_filters := '[{"key":"pff_status","op":"eq","value":"  renewed "}]'::JSONB) t
  WHERE t.id IN (c.p_yes, c.p_no, c.p_blank);
  IF v_ids IS DISTINCT FROM ARRAY[c.p_yes] THEN
    RAISE EXCEPTION 'CHECK FAILED (1b): enum "  renewed " matched % (expected only the Yes row)', v_ids;
  END IF;

  SELECT ARRAY_AGG(t.id) INTO v_ids FROM public.rpc_projects_table(
    p_limit := 500,
    p_field_filters := '[{"key":"pff_fee","op":"eq","value":"8000"}]'::JSONB) t
  WHERE t.id IN (c.p_yes, c.p_no, c.p_blank);
  IF v_ids IS DISTINCT FROM ARRAY[c.p_yes] THEN
    RAISE EXCEPTION 'CHECK FAILED (1c): number 8000 matched % (expected only the Yes row)', v_ids;
  END IF;

  SELECT ARRAY_AGG(t.id) INTO v_ids FROM public.rpc_projects_table(
    p_limit := 500,
    p_field_filters := '[{"key":"pff_due","op":"eq","value":"2026-02-08"}]'::JSONB) t
  WHERE t.id IN (c.p_yes, c.p_no, c.p_blank);
  IF v_ids IS DISTINCT FROM ARRAY[c.p_yes] THEN
    RAISE EXCEPTION 'CHECK FAILED (1d): date matched % (expected only the Yes row)', v_ids;
  END IF;

  RAISE NOTICE 'OK (1): equality filters boolean / enum / number / date, absorbing case and whitespace drift';

  -- ── 2. set vs unset ────────────────────────────────────────────────────
  SELECT ARRAY_AGG(t.id ORDER BY t.name) INTO v_ids FROM public.rpc_projects_table(
    p_limit := 500,
    p_field_filters := '[{"key":"pff_due","op":"set"}]'::JSONB) t
  WHERE t.id IN (c.p_yes, c.p_no, c.p_blank);
  IF v_ids IS DISTINCT FROM ARRAY[c.p_yes] THEN
    RAISE EXCEPTION 'CHECK FAILED (2a): "has any value" matched % (expected only the Yes row)', v_ids;
  END IF;

  SELECT count(*) INTO v_n FROM public.rpc_projects_table(
    p_limit := 500,
    p_field_filters := '[{"key":"pff_due","op":"unset"}]'::JSONB) t
  WHERE t.id IN (c.p_yes, c.p_no, c.p_blank);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (2b): "is blank" matched % of the 3 fixtures (expected 2)', v_n;
  END IF;

  RAISE NOTICE 'OK (2): set / unset separate a filled cell from one the spreadsheet left blank';

  -- ── 3. Filters AND together; an impossible one is empty, not an error ──
  SELECT ARRAY_AGG(t.id) INTO v_ids FROM public.rpc_projects_table(
    p_limit := 500,
    p_field_filters := '[{"key":"pff_inventory","op":"eq","value":"true"},
                         {"key":"pff_status","op":"eq","value":"Renewed"}]'::JSONB) t
  WHERE t.id IN (c.p_yes, c.p_no, c.p_blank);
  IF v_ids IS DISTINCT FROM ARRAY[c.p_yes] THEN
    RAISE EXCEPTION 'CHECK FAILED (3a): two ANDed filters matched % (expected only the Yes row)', v_ids;
  END IF;

  SELECT count(*) INTO v_n FROM public.rpc_projects_table(
    p_limit := 500,
    p_field_filters := '[{"key":"pff_inventory","op":"eq","value":"true"},
                         {"key":"pff_status","op":"eq","value":"Pending"}]'::JSONB) t
  WHERE t.id IN (c.p_yes, c.p_no, c.p_blank);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (3b): contradictory filters matched % rows (expected 0)', v_n;
  END IF;

  -- The regex guard. Unguarded this raises 22P02 and the whole list dies.
  SELECT count(*) INTO v_n FROM public.rpc_projects_table(
    p_limit := 500,
    p_field_filters := '[{"key":"pff_fee","op":"eq","value":"8,000 KWD"}]'::JSONB) t;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (3c): junk aimed at a number field matched % rows (expected 0)', v_n;
  END IF;

  -- A key that does not exist is empty, not an error either.
  SELECT count(*) INTO v_n FROM public.rpc_projects_table(
    p_limit := 500,
    p_field_filters := '[{"key":"pff_no_such_field","op":"eq","value":"x"}]'::JSONB) t;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (3d): unknown field key matched % rows (expected 0)', v_n;
  END IF;

  -- And no filter at all still returns the fixtures.
  SELECT count(*) INTO v_n FROM public.rpc_projects_table(p_limit := 500) t
  WHERE t.id IN (c.p_yes, c.p_no, c.p_blank);
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'CHECK FAILED (3e): NULL p_field_filters returned % of 3 fixtures', v_n;
  END IF;

  RAISE NOTICE 'OK (3): filters AND together; unmatchable, malformed and unknown filters return zero rows, never an error';
END $$;

RESET ROLE;

-- ── 4. A soft-deleted def is not filterable, though its values remain ────
DO $$
DECLARE c pff_ctx;
BEGIN
  SELECT * INTO c FROM pff_ctx;
  UPDATE public.project_field_defs SET deleted_at = now() WHERE id = c.d_gone;
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c     pff_ctx;
  v_n   INT;
  v_kept INT;
BEGIN
  SELECT * INTO c FROM pff_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.owner_id::TEXT, true);

  SELECT count(*) INTO v_n FROM public.rpc_projects_table(
    p_limit := 500,
    p_field_filters := '[{"key":"pff_gone","op":"eq","value":"kept on disk"}]'::JSONB) t;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (4a): a soft-deleted field still filters (% rows)', v_n;
  END IF;

  -- ... and "is blank" must not resurrect it either: with the def hidden,
  -- every project reads as blank, so this is the one op that would quietly
  -- start matching everything if the deleted_at join were dropped.
  SELECT count(*) INTO v_n FROM public.rpc_projects_table(
    p_limit := 500,
    p_field_filters := '[{"key":"pff_gone","op":"unset"}]'::JSONB) t
  WHERE t.id IN (c.p_yes, c.p_no, c.p_blank);
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'CHECK FAILED (4b): a hidden field should read blank on all 3 fixtures, got %', v_n;
  END IF;

  RESET ROLE;
  SELECT count(*) INTO v_kept FROM public.project_field_values WHERE field_def_id = c.d_gone;
  IF v_kept <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (4c): the hidden field''s value was destroyed (% rows, expected 1)', v_kept;
  END IF;

  RAISE NOTICE 'OK (4): a soft-deleted field vanishes from the filter while its values stay on disk';
END $$;

RESET ROLE;

-- ── 5. The overload trap, and what the patch must not have dropped ───────
DO $$
DECLARE v_sigs INT; v_args TEXT;
BEGIN
  SELECT count(*), min(pg_get_function_identity_arguments(oid))
  INTO v_sigs, v_args
  FROM pg_proc WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;

  IF v_sigs <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (5a): rpc_projects_table has % signatures (overload trap)', v_sigs;
  END IF;
  IF v_args <> 'p_search text, p_stage_id uuid, p_blocked boolean, p_limit integer, p_offset integer, p_field_filters jsonb' THEN
    RAISE EXCEPTION 'CHECK FAILED (5b): unexpected signature %', v_args;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace
      AND prosrc LIKE '%custom_fields%' AND prosrc LIKE '%Needs attention%'
  ) THEN
    RAISE EXCEPTION 'CHECK FAILED (5c): the patch lost custom_fields or the widened "Needs attention" predicate';
  END IF;

  RAISE NOTICE 'OK (5): exactly one signature, and the patch kept custom_fields and "Needs attention"';
END $$;

DO $$ BEGIN
  RAISE NOTICE 'ALL OK: rpc_projects_table custom-field filtering -- typed equality with drift tolerance, set/unset, ANDed filters, no-error on junk, soft-deleted fields excluded, one signature.';
END $$;

ROLLBACK;
