-- Runnable check for issue #191 Phase 10 — rpc_projects_table's p_portfolio_id
-- is an INTERSECTION with access, never a substitute for it
-- (supabase/migrations/20260807_projects_table_portfolio_filter.sql).
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/20260807_projects_table_portfolio_filter_check.sql
--
-- Wrapped in BEGIN/ROLLBACK: builds one throwaway portfolio and three
-- throwaway projects inside an EXISTING seeded company, reusing real users
-- (never inventing auth.users rows -- same convention as every other check
-- here), asserts, then always rolls back.
--
-- ── WHY THIS CHECK EXISTS ──────────────────────────────────────────────────
-- Phase 10 made the portfolio a FILTER over the projects screen rather than a
-- destination with its own list. The obvious way to get that wrong is to treat
-- "you asked for portfolio X" as authorisation to show portfolio X's contents.
-- The old /portfolios/[id] screen was one `.eq('portfolio_id', id)` away from
-- exactly that; it only stayed safe because projects_select is default-deny
-- underneath it. The new parameter goes into a SECURITY DEFINER function,
-- where there is no RLS underneath to save it -- so the intersection has to be
-- proven, not assumed.
--
-- THE ACTOR THAT MATTERS is `u_denied`: a user who
--   * HOLDS project.view                (so the RPC's screen-level gate passes
--                                        and a zero result cannot be misread as
--                                        that unrelated gate firing), and
--   * does NOT hold project.view_all, does not own the project, and is not
--     assigned any task in it.
-- If scoping bypassed access, u_denied would see the batch's projects. It must
-- see none. Users are picked dynamically for exactly this shape -- a seeded
-- role that happens to carry project.view_all would make the whole check
-- vacuous, so (0) asserts the chosen actors really lack it.
--
-- ── WHY THIS CANNOT SPAM PRODUCTION ────────────────────────────────────────
-- Inserting projects fires the Phase 10 project triggers, which can write
-- notification_events, which carries trg_dispatch_notification_event -- a
-- pg_net POST to a HARDCODED PRODUCTION url. That one trigger is disabled BY
-- NAME for the duration. ALTER TABLE is transactional, so the ROLLBACK at the
-- bottom restores it even if an assertion raises. Assertion (5) re-reads
-- pg_trigger to prove it was actually off, so a silently-failed DISABLE fails
-- the check instead of quietly having POSTed.

BEGIN;

ALTER TABLE public.notification_events DISABLE TRIGGER trg_dispatch_notification_event;

CREATE TEMP TABLE pfscope_ctx (
  company    UUID,
  creator    UUID,
  u_seer     UUID,  -- owns pf_visible + out_visible; owns NOTHING else
  u_denied   UUID,  -- holds project.view, owns nothing, assigned nothing
  portfolio  UUID,
  pf_visible UUID,  -- in the batch, u_seer can see it
  pf_hidden  UUID,  -- in the batch, u_seer CANNOT see it
  out_visible UUID  -- u_seer can see it, NOT in the batch
);
GRANT SELECT ON pfscope_ctx TO authenticated;

-- ── Fixture setup (runs as postgres -- bypasses RLS, has table grants) ─────
DO $$
DECLARE
  v_company   UUID;
  v_creator   UUID;
  v_pool      UUID[];
  v_portfolio UUID;
  v_pf_vis    UUID;
  v_pf_hid    UUID;
  v_out_vis   UUID;
BEGIN
  -- A company with at least two non-owner users whose roles do NOT carry
  -- project.view_all. view_all short-circuits fn_project_accessible, so an
  -- actor holding it can prove nothing about the intersection.
  SELECT u.company_id, ARRAY_AGG(u.id ORDER BY u.id)
  INTO v_company, v_pool
  FROM public.users u
  JOIN public.companies c ON c.id = u.company_id AND c.deleted_at IS NULL
  WHERE u.is_owner = false
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions pm ON pm.id = rp.permission_id
      WHERE ur.user_id = u.id AND ur.revoked_at IS NULL AND pm.key = 'project.view_all'
    )
  GROUP BY u.company_id
  HAVING count(*) >= 2
  LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Need a company with 2+ non-owner users lacking project.view_all -- run against a seeded dev DB, not prod.';
  END IF;

  SELECT id INTO v_creator FROM public.users WHERE company_id = v_company AND is_owner = true LIMIT 1;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'No owner user in company % to author the fixture.', v_company;
  END IF;

  -- The RPC has a screen-level gate (has_permission('project.view')) that is
  -- unrelated to row access. Grant it to BOTH actors so a zero result can only
  -- mean row-level denial -- otherwise (1) would "pass" for the wrong reason.
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT DISTINCT ur.role_id, pm.id
  FROM public.user_roles ur
  CROSS JOIN public.permissions pm
  WHERE ur.user_id = ANY (v_pool[1:2]) AND ur.revoked_at IS NULL AND pm.key = 'project.view'
  ON CONFLICT DO NOTHING;

  INSERT INTO public.portfolios (company_id, name, created_by)
  VALUES (v_company, 'PFSCOPE Selfcheck Batch', v_creator)
  RETURNING id INTO v_portfolio;

  -- In the batch, owned by the seer -> accessible AND in scope.
  INSERT INTO public.projects (company_id, name, created_by, owner_id, portfolio_id)
  VALUES (v_company, 'PFSCOPE visible in batch', v_creator, v_pool[1], v_portfolio)
  RETURNING id INTO v_pf_vis;

  -- In the batch, owned by someone else, no assignments -> in scope but NOT
  -- accessible to either actor. This is the row a bypass would leak.
  INSERT INTO public.projects (company_id, name, created_by, owner_id, portfolio_id)
  VALUES (v_company, 'PFSCOPE hidden in batch', v_creator, v_creator, v_portfolio)
  RETURNING id INTO v_pf_hid;

  -- Accessible to the seer but OUTSIDE the batch -> proves the filter filters.
  INSERT INTO public.projects (company_id, name, created_by, owner_id, portfolio_id)
  VALUES (v_company, 'PFSCOPE visible outside batch', v_creator, v_pool[1], NULL)
  RETURNING id INTO v_out_vis;

  INSERT INTO pfscope_ctx (company, creator, u_seer, u_denied, portfolio, pf_visible, pf_hidden, out_visible)
  VALUES (v_company, v_creator, v_pool[1], v_pool[2], v_portfolio, v_pf_vis, v_pf_hid, v_out_vis);
END $$;

-- ── 0. The fixture actors really are unprivileged, or nothing below means
--       anything. Run as postgres: this reads role wiring, not rows. ───────
DO $$
DECLARE c RECORD; v_bad UUID;
BEGIN
  SELECT * INTO c FROM pfscope_ctx;
  SELECT ur.user_id INTO v_bad
  FROM public.user_roles ur
  JOIN public.role_permissions rp ON rp.role_id = ur.role_id
  JOIN public.permissions pm ON pm.id = rp.permission_id
  WHERE ur.user_id IN (c.u_seer, c.u_denied) AND ur.revoked_at IS NULL
    AND pm.key = 'project.view_all'
  LIMIT 1;
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'CHECK VACUOUS (0): fixture actor % holds project.view_all -- it would see everything regardless', v_bad;
  END IF;
  RAISE NOTICE 'OK (0): both fixture actors lack project.view_all';
END $$;

-- ── Assertions run as `authenticated` so auth.uid()/has_permission and the
--    RLS underneath resolve for a real caller, not the BYPASSRLS superuser ─
SET LOCAL ROLE authenticated;

-- ── 1. THE POINT. A user who holds project.view but cannot access ANY of the
--       batch's projects sees ZERO of them when scoping by the portfolio. ──
DO $$
DECLARE c RECORD; v_n INT; v_any BOOLEAN;
BEGIN
  SELECT * INTO c FROM pfscope_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_denied::text, true);

  -- Sanity: this user genuinely cannot reach either row.
  IF public.fn_project_accessible(c.pf_visible) OR public.fn_project_accessible(c.pf_hidden) THEN
    RAISE EXCEPTION 'CHECK SETUP BROKEN (1): u_denied can already access a batch project';
  END IF;

  SELECT count(*) INTO v_n
  FROM public.rpc_projects_table(p_limit := 500, p_portfolio_id := c.portfolio);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (1): portfolio scope returned % rows to a user with no access -- the filter BYPASSED fn_project_accessible', v_n;
  END IF;

  -- And specifically not the two fixture rows, in case the batch ever gains
  -- rows this user legitimately owns.
  SELECT EXISTS(
    SELECT 1 FROM public.rpc_projects_table(p_limit := 500, p_portfolio_id := c.portfolio)
    WHERE id IN (c.pf_visible, c.pf_hidden)
  ) INTO v_any;
  IF v_any THEN
    RAISE EXCEPTION 'CHECK FAILED (1): an inaccessible project leaked through the portfolio scope';
  END IF;

  RAISE NOTICE 'OK (1): portfolio scope is denied exactly as the unscoped read is';
END $$;

-- ── 2. Scoping never WIDENS. The seer owns one project in the batch and the
--       batch holds a second one they cannot see: scoping shows the first and
--       still hides the second. ────────────────────────────────────────────
DO $$
DECLARE c RECORD; v_vis BOOLEAN; v_hid BOOLEAN;
BEGIN
  SELECT * INTO c FROM pfscope_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_seer::text, true);

  SELECT EXISTS(SELECT 1 FROM public.rpc_projects_table(p_limit := 500, p_portfolio_id := c.portfolio) WHERE id = c.pf_visible)
    INTO v_vis;
  SELECT EXISTS(SELECT 1 FROM public.rpc_projects_table(p_limit := 500, p_portfolio_id := c.portfolio) WHERE id = c.pf_hidden)
    INTO v_hid;

  IF NOT v_vis THEN
    RAISE EXCEPTION 'CHECK FAILED (2): the scoped read hid a project the user owns -- the filter is over-narrowing';
  END IF;
  IF v_hid THEN
    RAISE EXCEPTION 'CHECK FAILED (2): the scoped read revealed an inaccessible project in the same batch';
  END IF;
  RAISE NOTICE 'OK (2): scoped read = same batch INTERSECT what this user could already see';
END $$;

-- ── 3. Scoped ⊆ unscoped, as sets. The migration's claim is that the new
--       predicate can only ever REMOVE rows; assert it rather than trusting
--       the WHERE clause reads that way. ──────────────────────────────────
DO $$
DECLARE c RECORD; v_extra UUID;
BEGIN
  SELECT * INTO c FROM pfscope_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_seer::text, true);

  SELECT s.id INTO v_extra
  FROM public.rpc_projects_table(p_limit := 500, p_portfolio_id := c.portfolio) s
  WHERE NOT EXISTS (
    SELECT 1 FROM public.rpc_projects_table(p_limit := 500) u WHERE u.id = s.id
  )
  LIMIT 1;

  IF v_extra IS NOT NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (3): project % is visible ONLY when scoped -- p_portfolio_id added a row instead of removing rows', v_extra;
  END IF;
  RAISE NOTICE 'OK (3): the scoped result is a subset of the unscoped result';
END $$;

-- ── 4. The filter actually filters: an accessible project OUTSIDE the batch
--       is in the unscoped read and absent from the scoped one. Without this
--       a filter that silently did nothing would pass (1)-(3). ────────────
DO $$
DECLARE c RECORD; v_unscoped BOOLEAN; v_scoped BOOLEAN;
BEGIN
  SELECT * INTO c FROM pfscope_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_seer::text, true);

  SELECT EXISTS(SELECT 1 FROM public.rpc_projects_table(p_limit := 500) WHERE id = c.out_visible)
    INTO v_unscoped;
  SELECT EXISTS(SELECT 1 FROM public.rpc_projects_table(p_limit := 500, p_portfolio_id := c.portfolio) WHERE id = c.out_visible)
    INTO v_scoped;

  IF NOT v_unscoped THEN
    RAISE EXCEPTION 'CHECK SETUP BROKEN (4): the out-of-batch control is not visible unscoped either';
  END IF;
  IF v_scoped THEN
    RAISE EXCEPTION 'CHECK FAILED (4): a project outside the batch appeared under the portfolio scope -- p_portfolio_id is not filtering';
  END IF;
  RAISE NOTICE 'OK (4): out-of-batch projects are excluded by the scope';
END $$;

RESET ROLE;

-- ── 5. The production-notification trigger really was off for all of the
--       above (a silently-failed DISABLE must fail the check, not POST). ──
DO $$
DECLARE v_state "char";
BEGIN
  SELECT tgenabled INTO v_state FROM pg_trigger
  WHERE tgrelid = 'public.notification_events'::regclass
    AND tgname = 'trg_dispatch_notification_event';
  IF v_state IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (5): trg_dispatch_notification_event not found -- it may have been renamed; re-verify this check cannot POST to prod';
  END IF;
  IF v_state <> 'D' THEN
    RAISE EXCEPTION 'CHECK FAILED (5): trg_dispatch_notification_event was ENABLED (%) -- this run may have POSTed to production', v_state;
  END IF;
  RAISE NOTICE 'OK (5): the production dispatch trigger was disabled throughout';
END $$;

-- ── 6. Structural: still exactly one signature, still granted to
--       authenticated. A DROP-and-recreate loses grants silently, and an
--       overload makes PostgREST answer PGRST203 to every caller. ─────────
DO $$
DECLARE v_sigs INT; v_args TEXT; v_acl TEXT;
BEGIN
  SELECT count(*) INTO v_sigs FROM pg_proc
  WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (6): rpc_projects_table has % signatures (PostgREST would answer PGRST203)', v_sigs;
  END IF;

  SELECT pg_get_function_identity_arguments(oid), proacl::text INTO v_args, v_acl
  FROM pg_proc WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;

  IF position('p_portfolio_id uuid' IN v_args) = 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (6): rpc_projects_table does not take p_portfolio_id: (%)', v_args;
  END IF;
  IF position('authenticated=X' IN COALESCE(v_acl, '')) = 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (6): authenticated lost EXECUTE on rpc_projects_table (acl: %)', v_acl;
  END IF;
  RAISE NOTICE 'OK (6): one signature (%), authenticated holds EXECUTE', v_args;
END $$;

ROLLBACK;
