-- #181: a new workspace arrived with zero roles, so RBAC was unusable in it —
-- nothing to assign, and any second person who joined held no permissions and
-- could not be granted any. The owner never noticed because has_permission()
-- short-circuits on users.is_owner.
--
-- Four things have to hold, and three of them are about NOT doing damage:
--
--   1. a company created by ANY path comes out with the template roles and
--      their permissions — the trigger is on the table, not in an RPC, so
--      even a hand-written INSERT during support work is covered;
--   2. a company that already has roles is left completely alone. The seeder
--      returns early by design: pouring the template back over a workspace
--      that customised its roles would be worse than the bug;
--   3. seeding is idempotent, because the migration carrying it will be
--      re-run against databases in different states;
--   4. nobody is left holding a GLOBAL TEMPLATE role. That row is shared by
--      every company on the platform, so a per-tenant role editor writing to
--      it is a tenancy leak (20260803_fix_company_creation.sql, BUG A).
--
-- Everything runs in ONE transaction and rolls back.
BEGIN;

-- NOTE — no `SET LOCAL session_replication_role = replica` here, unlike every
-- other check in this directory. That setting disables user triggers, and the
-- trigger is the entire subject of this file: with it on, the check reported
-- "expected 4 seeded roles, got 0" against a database where seeding works
-- perfectly. It is safe to omit because the thing it guards against —
-- trg_dispatch_notification_event pg_net-POSTing to a hardcoded PRODUCTION
-- url — lives on notification_events, and nothing below writes to that table.
-- The assertion at the end of this check enforces that.

DO $check$
DECLARE
  v_plain     UUID;
  v_custom    UUID;
  v_roles     INT;
  v_perms     INT;
  v_again     INT;
  v_templates INT;
  v_leaked    INT;
  v_events    INT;
  v_events_0  INT;
BEGIN
  SELECT COUNT(*) INTO v_events_0 FROM public.notification_events;
  SELECT COUNT(*) INTO v_templates
  FROM public.roles WHERE company_id IS NULL AND is_system = TRUE AND deleted_at IS NULL;

  IF v_templates = 0 THEN
    RAISE EXCEPTION 'no global template roles in this database — the seeder has nothing to copy, and every company it creates will be empty';
  END IF;

  -- ── 1. a bare INSERT, not the RPC — the path no function audit covers ─────
  INSERT INTO public.companies (name, slug) VALUES ('CHK seed plain', 'chk-seed-plain')
  RETURNING id INTO v_plain;

  SELECT COUNT(*) INTO v_roles FROM public.roles WHERE company_id = v_plain;
  IF v_roles <> v_templates THEN
    RAISE EXCEPTION 'expected % seeded roles from a plain INSERT, got %', v_templates, v_roles;
  END IF;

  SELECT COUNT(*) INTO v_perms
  FROM public.role_permissions rp JOIN public.roles r ON r.id = rp.role_id
  WHERE r.company_id = v_plain;
  IF v_perms = 0 THEN
    RAISE EXCEPTION 'roles were seeded but carried no permissions — an empty role is the same outage with more rows';
  END IF;

  -- Owner must exist as a role OF THIS COMPANY, not merely as the template.
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE company_id = v_plain AND name = 'Owner') THEN
    RAISE EXCEPTION 'the new company has no Owner role of its own';
  END IF;

  -- ── 3. idempotent ────────────────────────────────────────────────────────
  PERFORM public.fn_seed_company_default_roles(v_plain);
  SELECT COUNT(*) INTO v_again FROM public.roles WHERE company_id = v_plain;
  IF v_again <> v_roles THEN
    RAISE EXCEPTION 're-seeding duplicated roles: % -> %', v_roles, v_again;
  END IF;

  -- ── 2. a company that customised its roles is untouched ──────────────────
  INSERT INTO public.companies (name, slug) VALUES ('CHK seed custom', 'chk-seed-custom')
  RETURNING id INTO v_custom;

  DELETE FROM public.role_permissions rp USING public.roles r
  WHERE rp.role_id = r.id AND r.company_id = v_custom;
  DELETE FROM public.roles WHERE company_id = v_custom;

  INSERT INTO public.roles (company_id, name, description, is_system, is_default)
  VALUES (v_custom, 'Highest Priviledge', 'a real role name from this database', FALSE, FALSE);

  PERFORM public.fn_seed_company_default_roles(v_custom);

  SELECT COUNT(*) INTO v_roles FROM public.roles WHERE company_id = v_custom;
  IF v_roles <> 1 THEN
    RAISE EXCEPTION 'the template was poured over a company that had its own roles: 1 -> %', v_roles;
  END IF;

  -- ── 4. no user anywhere still holds a global template role ───────────────
  SELECT COUNT(*) INTO v_leaked
  FROM public.user_roles ur
  JOIN public.roles r ON r.id = ur.role_id
  WHERE r.company_id IS NULL AND r.is_system = TRUE
    -- Only counts as a leak if the user's own company HAS a same-named role
    -- to hold instead; otherwise the backfill correctly left it alone rather
    -- than stranding someone with no role at all.
    AND EXISTS (
      SELECT 1 FROM public.roles own
      WHERE own.company_id = ur.company_id AND own.name = r.name AND own.deleted_at IS NULL
    );

  IF v_leaked > 0 THEN
    RAISE EXCEPTION '% user_roles row(s) still point at a global template role their own company also has', v_leaked;
  END IF;

  -- ── the premise of running without session_replication_role = replica ────
  SELECT COUNT(*) INTO v_events FROM public.notification_events;
  IF v_events <> v_events_0 THEN
    RAISE EXCEPTION 'this check emitted % notification event(s) with the dispatch trigger LIVE — it POSTs to production. Re-add SET LOCAL session_replication_role = replica and find another way to exercise the seeding trigger.', v_events - v_events_0;
  END IF;

  RAISE NOTICE 'check_company_default_roles: 6/6 pass (% templates seeded per company)', v_templates;
END;
$check$;

ROLLBACK;
