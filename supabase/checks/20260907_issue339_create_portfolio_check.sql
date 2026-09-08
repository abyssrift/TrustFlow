-- Issue #339 self-check. Transaction-wrapped; always rolls back.
-- Run with:
--   psql "$DATABASE_URL" -f supabase/checks/20260907_issue339_create_portfolio_check.sql

BEGIN;

DO $$
DECLARE
  v_company       UUID;
  v_owner         UUID;
  v_denied        UUID;
  v_foreign       UUID;
  v_tag           TEXT := replace(gen_random_uuid()::TEXT, '-', '');
  v_result        JSONB;
  v_portfolio_id  UUID;
  v_row           public.portfolios;
  v_rejected      BOOLEAN;
  v_foreign_count INTEGER;
BEGIN
  SELECT u.company_id, u.id
  INTO v_company, v_owner
  FROM public.users AS u
  WHERE u.is_owner = TRUE
    AND u.company_id IS NOT NULL
    AND u.deleted_at IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.users AS u2
      WHERE u2.company_id = u.company_id
        AND u2.id <> u.id
        AND u2.is_owner = FALSE
        AND u2.deleted_at IS NULL
    )
  ORDER BY u.company_id
  LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'CHECK SKIPPED: need a seeded owner and same-company non-owner.';
  END IF;

  SELECT u.id
  INTO v_denied
  FROM public.users AS u
  WHERE u.company_id = v_company
    AND u.id <> v_owner
    AND u.is_owner = FALSE
    AND u.deleted_at IS NULL
  ORDER BY u.id
  LIMIT 1;

  SELECT c.id
  INTO v_foreign
  FROM public.companies AS c
  WHERE c.id <> v_company
    AND c.deleted_at IS NULL
  ORDER BY c.id
  LIMIT 1;

  IF v_foreign IS NULL THEN
    RAISE EXCEPTION 'CHECK SKIPPED: need a second seeded company for isolation.';
  END IF;

  -- Make the selected non-owner a genuinely unauthorized caller for this
  -- transaction, without inventing auth users or leaving role changes behind.
  DELETE FROM public.user_roles WHERE user_id = v_denied;
  PERFORM set_config('request.jwt.claim.sub', v_denied::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_denied::TEXT, 'role', 'authenticated')::TEXT, true);
  ASSERT NOT public.has_permission('project.create'),
    'fixture user unexpectedly retains project.create';

  v_rejected := FALSE;
  BEGIN
    PERFORM public.rpc_create_portfolio('unauthorized-' || v_tag);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := TRUE;
  END;
  ASSERT v_rejected, 'unauthorized non-owner was allowed to create a portfolio';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.portfolios
    WHERE name = 'unauthorized-' || v_tag
  ), 'unauthorized call inserted a portfolio';

  -- Blank names are rejected before the insert, even for an authorized owner.
  PERFORM set_config('request.jwt.claim.sub', v_owner::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner::TEXT, 'role', 'authenticated')::TEXT, true);
  v_rejected := FALSE;
  BEGIN
    PERFORM public.rpc_create_portfolio('   ');
  EXCEPTION WHEN OTHERS THEN
    v_rejected := TRUE;
  END;
  ASSERT v_rejected, 'blank portfolio name was accepted';

  -- Authorized creation must trim the name, mark the source, retain the
  -- caller, and return the exact inserted row id.
  v_result := public.rpc_create_portfolio('  Issue 339 ' || v_tag || '  ');
  v_portfolio_id := (v_result->>'id')::UUID;

  SELECT * INTO v_row
  FROM public.portfolios
  WHERE id = v_portfolio_id;

  ASSERT FOUND, 'returned portfolio id does not correspond to an inserted row';
  ASSERT v_row.company_id = v_company, 'portfolio was not created in caller company';
  ASSERT v_row.name = 'Issue 339 ' || v_tag, 'portfolio name was not trimmed';
  ASSERT v_row.source = 'manual', 'manual portfolio source was not recorded';
  ASSERT v_row.created_by = v_owner, 'portfolio creator does not match auth.uid()';
  ASSERT (v_result->>'id')::UUID = v_row.id, 'returned id differs from inserted row id';
  ASSERT v_result->>'name' = v_row.name, 'returned name differs from inserted row';
  ASSERT v_result->>'source' = 'manual', 'returned source is not manual';
  ASSERT NULLIF(v_result->>'created_at', '') IS NOT NULL, 'created_at missing from return JSONB';

  -- No company argument exists: even with a foreign company present, the RPC
  -- can only use the caller's my_company_id() and cannot target that company.
  SELECT COUNT(*) INTO v_foreign_count
  FROM public.portfolios
  WHERE company_id = v_foreign AND name = 'Issue 339 ' || v_tag;
  ASSERT v_foreign_count = 0, 'portfolio was created under a foreign company';

  RAISE NOTICE '20260907 issue #339 portfolio RPC checks PASSED';
END;
$$;

ROLLBACK;
