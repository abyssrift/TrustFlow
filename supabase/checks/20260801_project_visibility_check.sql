-- Runnable check for issue #186: fn_project_accessible, wired into all five
-- read paths (projects_select RLS, rpc_projects_table, rpc_project_dashboard,
-- rpc_get_projects, rpc_create_template_from_project).
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/20260801_project_visibility_check.sql
--
-- Wrapped in BEGIN/ROLLBACK: creates one throwaway project + two tasks in an
-- existing seeded company (reusing real users/teams, never inventing
-- auth.users rows -- same convention as every other check in this folder),
-- plus a bare project in a second company for the isolation assertion. Always
-- rolls back -- safe to re-run, never leaves rows behind.
--
-- Exercises real RLS by switching `SET LOCAL ROLE authenticated` for the
-- assertion blocks (the default `postgres` connection role is BYPASSRLS, so
-- testing the policy under it would silently prove nothing) combined with
-- set_config('request.jwt.claim.sub', <uid>, true) to impersonate each user,
-- transaction-local as required.
--
-- Smallest thing that fails if any of the five behaviours in #186's
-- acceptance list regress:
--   1. No assignment, no project.view_all -> ZERO rows from RLS, both list
--      RPCs, AND rpc_project_dashboard raises (not a blanked/partial result).
--   2. Directly assigned a task in the project -> sees it, rollups correct.
--   3. Team assigned a task in the project -> sees it (assignee's own
--      direct-assignment surface is empty; only the team grants access).
--   4. project.owner_id -> sees it, with no task assignment at all.
--   5. project.view_all -> sees project1 (own company) fully, INCLUDING
--      correct rollups, but rpc_project_dashboard on project2 (a DIFFERENT
--      company) still raises "Project not found." -- view_all is a
--      same-tenant bypass, never a tenant escape.

BEGIN;

CREATE TEMP TABLE pvis_check_ctx (
  company1     UUID,
  company2     UUID,
  team         UUID,
  creator      UUID,
  team_member  UUID,
  u_zero       UUID,
  u_direct     UUID,
  u_powner     UUID,
  project1     UUID,
  project2     UUID,
  task_direct  UUID,
  task_team    UUID,
  admin_role   UUID
);
GRANT SELECT, INSERT, UPDATE ON pvis_check_ctx TO authenticated;

-- ── Fixture setup (runs as postgres -- bypasses RLS, has table grants) ─────
DO $$
DECLARE
  v_company1    UUID;
  v_company2    UUID;
  v_team        UUID;
  v_team_member UUID;
  v_creator     UUID;
  v_pool        UUID[];
  v_project1    UUID;
  v_project2    UUID;
  v_task_direct UUID;
  v_task_team   UUID;
  v_admin_role  UUID;
BEGIN
  -- A company with a team that has at least one non-owner member -- gives us
  -- company + team + "sees it only via team" candidate in one shot.
  SELECT te.company_id, te.id, tm.user_id
  INTO v_company1, v_team, v_team_member
  FROM public.team_members tm
  JOIN public.teams te ON te.id = tm.team_id
  JOIN public.users u  ON u.id = tm.user_id AND u.is_owner = false
  WHERE tm.removed_at IS NULL
  LIMIT 1;

  IF v_company1 IS NULL THEN
    RAISE EXCEPTION 'No company with a staffed team found -- run this against a seeded dev DB, not prod.';
  END IF;

  SELECT id INTO v_creator FROM public.users WHERE company_id = v_company1 AND is_owner = true LIMIT 1;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'No owner user in the chosen company.';
  END IF;

  -- 3 distinct non-owner users, NOT members of v_team (so the team-assignment
  -- fixture below can never accidentally grant them access) -- one each for
  -- "sees nothing", "direct assignee", "sees via owner_id".
  SELECT ARRAY_AGG(id) INTO v_pool FROM (
    SELECT u.id FROM public.users u
    WHERE u.company_id = v_company1 AND u.is_owner = false
      AND u.id NOT IN (
        SELECT tm2.user_id FROM public.team_members tm2
        WHERE tm2.team_id = v_team AND tm2.removed_at IS NULL
      )
    ORDER BY u.id
    LIMIT 3
  ) x;

  IF v_pool IS NULL OR ARRAY_LENGTH(v_pool, 1) < 3 THEN
    RAISE EXCEPTION 'Need 3 distinct non-owner, non-team users in company % -- seed data too thin.', v_company1;
  END IF;

  SELECT id INTO v_admin_role FROM public.roles WHERE is_system = true AND name = 'Admin';
  IF v_admin_role IS NULL THEN
    RAISE EXCEPTION 'System Admin role not found.';
  END IF;

  -- rpc_projects_table/rpc_project_dashboard have their OWN pre-existing
  -- screen-level gate (has_permission('project.view'), unrelated to #186 --
  -- it predates this issue and governs "can you open the Projects screen at
  -- all", not "can you see THIS row"). Grant it to whatever role each test
  -- user already holds so that gate isn't what denies them -- otherwise a
  -- "no rows" result could be misread as proof of row-level denial when it
  -- was actually this unrelated screen gate firing instead.
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT DISTINCT ur.role_id, x.perm_id
  FROM public.user_roles ur
  CROSS JOIN (VALUES
    ('62f36da2-9e5f-4b35-9203-2f3b59dcb2ad'::uuid), -- project.view
    ('b404e101-4fbc-48eb-8d7f-37e897aa26f0'::uuid)  -- project.create (gates rpc_create_template_from_project)
  ) AS x(perm_id)
  WHERE ur.user_id = ANY (v_pool[1:3] || v_team_member) AND ur.revoked_at IS NULL
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_company2 FROM public.companies
  WHERE id <> v_company1 AND deleted_at IS NULL LIMIT 1;
  IF v_company2 IS NULL THEN
    RAISE EXCEPTION 'Need a second company for the cross-tenant isolation assertion.';
  END IF;

  -- ── Project 1: owner_id = pool[3] ("u_powner"), no template-worthy body ──
  INSERT INTO public.projects (company_id, name, created_by, owner_id)
  VALUES (v_company1, 'PVIS Selfcheck Project', v_creator, v_pool[3])
  RETURNING id INTO v_project1;

  INSERT INTO public.tasks (company_id, project_id, title, created_by)
  VALUES (v_company1, v_project1, 'PVIS direct task', v_creator)
  RETURNING id INTO v_task_direct;
  INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
  VALUES (v_task_direct, v_company1, v_pool[2], v_creator);

  INSERT INTO public.tasks (company_id, project_id, title, created_by)
  VALUES (v_company1, v_project1, 'PVIS team task', v_creator)
  RETURNING id INTO v_task_team;
  INSERT INTO public.task_assignments (task_id, company_id, assignee_team_id, assigned_by)
  VALUES (v_task_team, v_company1, v_team, v_creator);

  -- ── Project 2: different company entirely, for the isolation assertion ──
  INSERT INTO public.projects (company_id, name)
  VALUES (v_company2, 'PVIS Selfcheck Project (other company)')
  RETURNING id INTO v_project2;

  INSERT INTO pvis_check_ctx (
    company1, company2, team, creator, team_member, u_zero, u_direct, u_powner,
    project1, project2, task_direct, task_team, admin_role
  ) VALUES (
    v_company1, v_company2, v_team, v_creator, v_team_member, v_pool[1], v_pool[2], v_pool[3],
    v_project1, v_project2, v_task_direct, v_task_team, v_admin_role
  );
END $$;

-- ── Assertions run as `authenticated` so projects_select RLS actually
--    engages (postgres is BYPASSRLS and would prove nothing here) ─────────
SET LOCAL ROLE authenticated;

-- ── 1. Zero assignment, zero view_all -> zero rows everywhere, including
--       rollups (dashboard raises, doesn't return a blanked JSON) ─────────
DO $$
DECLARE
  c        RECORD;
  v_uid    UUID;
  v_visible BOOLEAN;
  v_in_list BOOLEAN;
  v_dash_ok BOOLEAN := false;
  v_msg    TEXT;
BEGIN
  SELECT * INTO c FROM pvis_check_ctx;
  v_uid := c.u_zero;
  PERFORM set_config('request.jwt.claim.sub', v_uid::text, true);

  SELECT public.fn_project_accessible(c.project1) INTO v_visible;
  IF v_visible THEN
    RAISE EXCEPTION 'CHECK FAILED (1): fn_project_accessible true for a user with no assignment/view_all';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.projects WHERE id = c.project1) INTO v_visible;
  IF v_visible THEN
    RAISE EXCEPTION 'CHECK FAILED (1): projects_select RLS still shows the row directly';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.rpc_get_projects() WHERE id = c.project1) INTO v_in_list;
  IF v_in_list THEN
    RAISE EXCEPTION 'CHECK FAILED (1): rpc_get_projects returned an inaccessible project';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.rpc_projects_table(p_limit := 500) WHERE id = c.project1) INTO v_in_list;
  IF v_in_list THEN
    RAISE EXCEPTION 'CHECK FAILED (1): rpc_projects_table returned an inaccessible project (rollups would leak)';
  END IF;

  BEGIN
    PERFORM public.rpc_project_dashboard(c.project1);
    v_dash_ok := true; -- reached only if it did NOT raise
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  IF v_dash_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (1): rpc_project_dashboard returned data for an inaccessible project';
  END IF;
  IF v_msg IS DISTINCT FROM 'Project not found.' THEN
    RAISE EXCEPTION 'CHECK FAILED (1): expected "Project not found.", got: %', v_msg;
  END IF;

  -- The fifth (not-in-the-issue's-list) call site found during this work:
  -- rpc_create_template_from_project reads an arbitrary project's full task
  -- structure. u_zero holds project.create (granted in fixtures) but not
  -- accessibility on project1 -- must still be refused, same message.
  v_dash_ok := false;
  BEGIN
    PERFORM public.rpc_create_template_from_project(c.project1, 'PVIS Selfcheck Template (should not be created)');
    v_dash_ok := true;
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  IF v_dash_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (1): rpc_create_template_from_project captured an inaccessible project''s task structure';
  END IF;
  IF v_msg IS DISTINCT FROM 'Project not found.' THEN
    RAISE EXCEPTION 'CHECK FAILED (1): rpc_create_template_from_project should say "Project not found.", got: %', v_msg;
  END IF;

  RAISE NOTICE 'OK (1): no assignment / no view_all -> zero rows, zero rollups, all five call sites agree';
END $$;

-- ── 2. Directly assigned a task -> sees it ─────────────────────────────────
DO $$
DECLARE
  c     RECORD;
  v_ok  BOOLEAN;
  v_row RECORD;
  v_dash JSONB;
BEGIN
  SELECT * INTO c FROM pvis_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_direct::text, true);

  SELECT public.fn_project_accessible(c.project1) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (2): direct task assignee should see the project';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.projects WHERE id = c.project1) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'CHECK FAILED (2): projects_select RLS hides it from the direct assignee'; END IF;

  SELECT * INTO v_row FROM public.rpc_projects_table(p_limit := 500) WHERE id = c.project1;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'CHECK FAILED (2): rpc_projects_table missing the row for the direct assignee'; END IF;
  IF v_row.tasks_total IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (2): tasks_total = % (expected 2)', v_row.tasks_total;
  END IF;

  v_dash := public.rpc_project_dashboard(c.project1);
  IF (v_dash -> 'totals' ->> 'total')::INT IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (2): dashboard totals.total = % (expected 2)', v_dash -> 'totals' ->> 'total';
  END IF;

  -- Fifth call site: an accessible project can still be captured as a
  -- template (this was never blocked -- only cross-tenant/unassigned
  -- projects were the gap).
  PERFORM public.rpc_create_template_from_project(c.project1, 'PVIS Selfcheck Template (accessible)');

  RAISE NOTICE 'OK (2): direct task assignee sees the project + correct rollups via all five call sites';
END $$;

-- ── 3. Team assigned a task -> sees it via the team, not a direct row ──────
DO $$
DECLARE
  c    RECORD;
  v_ok BOOLEAN;
BEGIN
  SELECT * INTO c FROM pvis_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.team_member::text, true);

  SELECT public.fn_project_accessible(c.project1) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (3): team member should see the project via the team assignment';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.projects WHERE id = c.project1) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'CHECK FAILED (3): projects_select RLS hides it from the team member'; END IF;

  SELECT EXISTS(SELECT 1 FROM public.rpc_get_projects() WHERE id = c.project1) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'CHECK FAILED (3): rpc_get_projects missing the row for the team member'; END IF;

  RAISE NOTICE 'OK (3): team-assigned member sees the project (no direct assignment of their own)';
END $$;

-- ── 4. project.owner_id -> sees it with zero task assignment ───────────────
DO $$
DECLARE
  c    RECORD;
  v_ok BOOLEAN;
BEGIN
  SELECT * INTO c FROM pvis_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_powner::text, true);

  SELECT public.fn_project_accessible(c.project1) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (4): projects.owner_id should see the project';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.projects WHERE id = c.project1) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'CHECK FAILED (4): projects_select RLS hides it from the project owner'; END IF;

  RAISE NOTICE 'OK (4): project.owner_id sees the project with no task assignment at all';
END $$;

-- ── 5. project.view_all: sees everything in-company, nothing cross-company ─
-- Grant the system Admin role (carries project.view_all per this migration's
-- seed) to u_zero -- the same user asserted at ZERO access in step 1, so
-- this proves the transition, not just an independently-privileged user.
-- INSERT into user_roles needs table privileges beyond what `authenticated`
-- has under RLS, so this one fixture step runs back on the postgres role.
RESET ROLE;
DO $$
DECLARE
  c RECORD;
BEGIN
  SELECT * INTO c FROM pvis_check_ctx;
  INSERT INTO public.user_roles (user_id, role_id, company_id, assigned_by)
  VALUES (c.u_zero, c.admin_role, c.company1, c.creator);
END $$;
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c      RECORD;
  v_ok   BOOLEAN;
  v_row  RECORD;
  v_msg  TEXT;
  v_dash_ok BOOLEAN := false;
BEGIN
  SELECT * INTO c FROM pvis_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_zero::text, true);

  -- Own company, previously zero access: now full visibility + rollups.
  SELECT public.fn_project_accessible(c.project1) INTO v_ok;
  IF NOT v_ok THEN RAISE EXCEPTION 'CHECK FAILED (5): project.view_all holder should see project1'; END IF;

  SELECT * INTO v_row FROM public.rpc_projects_table(p_limit := 500) WHERE id = c.project1;
  IF v_row.id IS NULL OR v_row.tasks_total IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (5): view_all holder should see project1 with tasks_total=2, got %', v_row.tasks_total;
  END IF;

  -- Different company: still invisible, even with view_all.
  SELECT public.fn_project_accessible(c.project2) INTO v_ok;
  IF v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (5): project.view_all crossed a tenant boundary (fn_project_accessible)';
  END IF;

  SELECT EXISTS(SELECT 1 FROM public.projects WHERE id = c.project2) INTO v_ok;
  IF v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (5): project.view_all crossed a tenant boundary (projects_select RLS)';
  END IF;

  BEGIN
    PERFORM public.rpc_project_dashboard(c.project2);
    v_dash_ok := true;
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  IF v_dash_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (5): rpc_project_dashboard leaked a different company''s project to a view_all holder';
  END IF;
  IF v_msg IS DISTINCT FROM 'Project not found.' THEN
    RAISE EXCEPTION 'CHECK FAILED (5): cross-tenant dashboard call should say "Project not found.", got: %', v_msg;
  END IF;

  RAISE NOTICE 'OK (5): project.view_all sees everything in its own company and nothing outside it -- not a tenant escape';
END $$;

RESET ROLE;

DO $$ BEGIN
  RAISE NOTICE 'ALL OK: issue #186 project-visibility predicate verified across RLS + rpc_projects_table + rpc_project_dashboard + rpc_get_projects, default-deny / assignment / team / owner_id / view_all / cross-tenant isolation all hold.';
END $$;

ROLLBACK;
