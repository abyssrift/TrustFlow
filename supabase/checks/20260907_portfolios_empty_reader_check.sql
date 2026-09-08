-- Regression check for the empty-portfolio branch in rpc_portfolios_table.
-- Run against a seeded dev/staging database; the transaction always rolls back.

BEGIN;

ALTER TABLE public.notification_events DISABLE TRIGGER trg_dispatch_notification_event;

CREATE TEMP TABLE portfolio_reader_ctx (
  company UUID,
  owner_user UUID,
  denied_user UUID,
  empty_portfolio UUID,
  hidden_portfolio UUID,
  visible_portfolio UUID,
  visible_project UUID
);
GRANT SELECT ON portfolio_reader_ctx TO authenticated;

DO $$
DECLARE
  v_company UUID;
  v_owner UUID;
  v_denied UUID;
  v_empty UUID;
  v_hidden UUID;
  v_visible UUID;
  v_project UUID;
BEGIN
  SELECT u.company_id, u.id
  INTO v_company, v_owner
  FROM public.users u
  WHERE u.is_owner = TRUE AND u.deleted_at IS NULL
    AND EXISTS (
      SELECT 1 FROM public.users u2
      WHERE u2.company_id = u.company_id AND u2.id <> u.id
        AND u2.is_owner = FALSE AND u2.deleted_at IS NULL
    )
  ORDER BY u.company_id
  LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'CHECK SKIPPED: need a seeded owner and same-company non-owner';
  END IF;

  SELECT u.id INTO v_denied
  FROM public.users u
  WHERE u.company_id = v_company AND u.id <> v_owner
    AND u.is_owner = FALSE AND u.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions pm ON pm.id = rp.permission_id
      WHERE ur.user_id = u.id AND ur.revoked_at IS NULL AND pm.key = 'project.view_all'
    )
  ORDER BY u.id LIMIT 1;

  IF v_denied IS NULL THEN
    RAISE EXCEPTION 'CHECK SKIPPED: need a same-company non-owner without project.view_all';
  END IF;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT DISTINCT ur.role_id, pm.id
  FROM public.user_roles ur
  CROSS JOIN public.permissions pm
  WHERE ur.user_id = v_denied AND ur.revoked_at IS NULL AND pm.key = 'project.view'
  ON CONFLICT DO NOTHING;

  INSERT INTO public.portfolios (company_id, name, source, created_by)
  VALUES (v_company, 'EMPTY READER ' || gen_random_uuid(), 'manual', v_owner)
  RETURNING id INTO v_empty;
  INSERT INTO public.portfolios (company_id, name, source, created_by)
  VALUES (v_company, 'HIDDEN READER ' || gen_random_uuid(), 'manual', v_owner)
  RETURNING id INTO v_hidden;
  INSERT INTO public.portfolios (company_id, name, source, created_by)
  VALUES (v_company, 'VISIBLE READER ' || gen_random_uuid(), 'manual', v_owner)
  RETURNING id INTO v_visible;

  INSERT INTO public.projects (company_id, name, created_by, owner_id, portfolio_id)
  VALUES (v_company, 'HIDDEN PROJECT ' || gen_random_uuid(), v_owner, v_owner, v_hidden);

  INSERT INTO public.projects (company_id, name, created_by, owner_id, portfolio_id)
  VALUES (v_company, 'VISIBLE PROJECT ' || gen_random_uuid(), v_owner, v_owner, v_visible)
  RETURNING id INTO v_project;

  INSERT INTO portfolio_reader_ctx
  VALUES (v_company, v_owner, v_denied, v_empty, v_hidden, v_visible, v_project);
END;
$$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c RECORD;
  v_empty RECORD;
  v_hidden BOOLEAN;
  v_visible RECORD;
BEGIN
  SELECT * INTO c FROM portfolio_reader_ctx;

  PERFORM set_config('request.jwt.claim.sub', c.denied_user::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.denied_user::TEXT, 'role', 'authenticated')::TEXT, true);

  SELECT * INTO v_empty FROM public.rpc_portfolios_table(p_search := 'EMPTY READER', p_limit := 100);
  ASSERT FOUND, 'empty same-company portfolio was hidden';
  ASSERT v_empty.id = c.empty_portfolio, 'empty portfolio search returned wrong row';
  ASSERT v_empty.projects_total = 0 AND v_empty.projects_done = 0
    AND v_empty.projects_blocked = 0 AND v_empty.tasks_total = 0
    AND v_empty.tasks_done = 0 AND v_empty.next_due IS NULL
    AND v_empty.projected_end IS NULL AND v_empty.confidence = 'none',
    'empty portfolio did not return zero rollups/confidence none';

  SELECT EXISTS (
    SELECT 1 FROM public.rpc_portfolios_table(p_search := 'HIDDEN READER', p_limit := 100)
  ) INTO v_hidden;
  ASSERT NOT v_hidden, 'portfolio with only inaccessible projects was visible';

  PERFORM set_config('request.jwt.claim.sub', c.owner_user::TEXT, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.owner_user::TEXT, 'role', 'authenticated')::TEXT, true);
  SELECT * INTO v_visible FROM public.rpc_portfolios_table(p_search := 'VISIBLE READER', p_limit := 100);
  ASSERT FOUND AND v_visible.id = c.visible_portfolio, 'accessible portfolio was hidden';
  ASSERT v_visible.projects_total = 1, 'accessible project rollup count changed';

  RAISE NOTICE '20260907 portfolio empty reader checks PASSED';
END;
$$;

RESET ROLE;

DO $$
DECLARE v_state "char";
BEGIN
  SELECT tgenabled INTO v_state FROM pg_trigger
  WHERE tgrelid = 'public.notification_events'::regclass
    AND tgname = 'trg_dispatch_notification_event';
  IF v_state IS NULL OR v_state <> 'D' THEN
    RAISE EXCEPTION 'CHECK FAILED: notification dispatch trigger was not disabled during fixture setup';
  END IF;
END;
$$;

ROLLBACK;
