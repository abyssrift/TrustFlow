-- Backfill `project.view_all` onto pre-existing companies' admin-tier roles.
--
-- THE ACTUAL DEFECT (narrower than #190 first claimed)
-- 20260801_project_visibility.sql seeded `project.view_all` onto the GLOBAL
-- TEMPLATE roles (company_id IS NULL, is_system = true). #190 read that as the
-- seed aiming at the wrong target. It is not: fn_seed_company_default_roles
-- COPIES each template role's permissions into the new company's roles, so
-- every company created after that migration inherits the grant correctly.
-- Verified by seeding a throwaway company on local — Owner, Admin and Manager
-- each came out holding project.view_all, Personnel correctly without it.
--
-- What was missed is only the BACKFILL. Companies that already existed when
-- that migration ran were never revisited, and fn_seed_company_default_roles
-- cannot fix them: it returns early if the company has any role at all, by
-- design (it must never overwrite a company's customised roles).
--
-- Consequence until fixed: projects_select is default-deny (#186), so in every
-- pre-existing company only `users.is_owner`, a project's own owner_id, and
-- users assigned a task in it can see a project. Managers see an empty
-- Projects tab, and a freshly bulk-created project with no assignments is
-- visible to the company owner alone — which is the flagship Phase 1 feature
-- looking broken on the companies that have the most data.
--
-- WHY MATCH ON PERMISSION, NOT ON ROLE NAME
-- The obvious backfill is `WHERE name IN ('Owner','Admin','Manager')`. It was
-- rejected. Role names are user-editable free text, and this database already
-- contains 'Highest Priviledge', 'Audit Manager', 'Marketing Departament' and
-- 'Audit Department Member' — none of which match, all of which may well be
-- admin-tier. Name-matching would silently miss them, and would break again
-- the moment somebody renames a role.
--
-- Matching on an existing admin-tier PERMISSION follows intent rather than
-- labels, and it is this repo's established pattern for exactly this problem:
--   20260510_reports_engine_v2.sql
--     "Grant to every role that already has system.view_all_data
--      (i.e. admin-level roles)"
--   20260525_fix_analytics_permissions_assignment.sql
--     same shape, keyed on user.view_all
-- This migration is the third instance of that pattern, not a new one.
--
-- DEGRADES SAFELY
-- A company with no admin-tier role gets nobody, which is the correct outcome:
-- that company's problem is #181 (four of six production companies were
-- created with zero roles), and inventing a grant here would paper over it.
-- This migration deliberately does NOT fix #181.
--
-- Idempotent: ON CONFLICT DO NOTHING, safe to re-run, and safe on prod because
-- it only ever ADDS a grant to roles that already hold a broader one.

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT DISTINCT r.id, target.id
FROM public.roles r
JOIN public.role_permissions rp ON rp.role_id = r.id
JOIN public.permissions marker
  ON marker.id = rp.permission_id
 AND marker.key IN ('system.view_all_data', 'user.view_all')
CROSS JOIN public.permissions target
WHERE target.key = 'project.view_all'
  AND r.company_id IS NOT NULL      -- templates already have it; leave them alone
  AND r.deleted_at IS NULL
ON CONFLICT DO NOTHING;

DO $verify$
DECLARE
  v_companies_covered INT;
  v_companies_total   INT;
  v_roles_granted     INT;
  v_no_admin_tier     INT;
BEGIN
  SELECT count(*) INTO v_companies_total FROM public.companies;

  SELECT count(DISTINCT r.company_id) INTO v_companies_covered
  FROM public.roles r
  JOIN public.role_permissions rp ON rp.role_id = r.id
  JOIN public.permissions p ON p.id = rp.permission_id AND p.key = 'project.view_all'
  WHERE r.company_id IS NOT NULL AND r.deleted_at IS NULL;

  SELECT count(*) INTO v_roles_granted
  FROM public.roles r
  JOIN public.role_permissions rp ON rp.role_id = r.id
  JOIN public.permissions p ON p.id = rp.permission_id AND p.key = 'project.view_all'
  WHERE r.company_id IS NOT NULL AND r.deleted_at IS NULL;

  -- Companies left with nobody: expected to be exactly those with no
  -- admin-tier role at all (the #181 population), never a silent miss.
  SELECT count(*) INTO v_no_admin_tier
  FROM public.companies c
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles r
    JOIN public.role_permissions rp ON rp.role_id = r.id
    JOIN public.permissions p ON p.id = rp.permission_id
     AND p.key IN ('system.view_all_data', 'user.view_all')
    WHERE r.company_id = c.id AND r.deleted_at IS NULL
  );

  RAISE NOTICE 'project.view_all backfill: % roles across %/% companies; % companies have no admin-tier role at all (#181, deliberately untouched)',
    v_roles_granted, v_companies_covered, v_companies_total, v_no_admin_tier;

  IF v_companies_covered + v_no_admin_tier < v_companies_total THEN
    RAISE EXCEPTION 'backfill missed % company/companies that DO have an admin-tier role — investigate before shipping',
      v_companies_total - v_companies_covered - v_no_admin_tier;
  END IF;
END
$verify$;
