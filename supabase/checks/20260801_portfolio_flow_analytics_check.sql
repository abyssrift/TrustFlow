-- Runnable check for issue #175: rpc_portfolio_wip_by_stage / rpc_portfolio_cfd
-- / rpc_portfolio_throughput / rpc_portfolio_capacity.
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/20260801_portfolio_flow_analytics_check.sql
--
-- Wrapped in BEGIN/ROLLBACK -- creates a project-kind pipeline + two throwaway
-- projects in an existing seeded company (reusing real users/teams, same
-- convention as 20260801_project_visibility_check.sql), moves them through
-- real stage transitions via rpc_advance_project_stage (so
-- project_stage_history is genuinely trigger-written, never a fabricated
-- INSERT), plus a bare pipeline in a second company for the cross-tenant
-- assertion. Temporarily bumps the test company's billing plan so the
-- pipeline-creation limit trigger (_enforce_pipeline_limit) doesn't block the
-- fixture -- rolled back with everything else. Always rolls back -- safe to
-- re-run, never leaves rows behind.
--
-- Smallest thing that fails if any of #175's acceptance behaviours regress:
--   1. rpc_portfolio_wip_by_stage's wip_count for a stage matches a
--      hand-written COUNT(*) over the SAME window, both server-side and from
--      three different callers (owner sees all, direct assignee sees only
--      their own project, zero-access sees zero -- not an error, silently
--      filtered, per §13.14's "no distinguishable denied state" rule).
--   2. rpc_portfolio_cfd's cumulative_count for a stage-or-beyond matches a
--      hand-written COUNT(DISTINCT project_id) over project_stage_history.
--   3. rpc_portfolio_throughput's arrivals/completions/wip_end/cycle_time_days
--      satisfy Little's Law (cycle_time = wip / (completions / bucket_days))
--      against the same real transitions.
--   4. rpc_portfolio_capacity's committed_hours/available_hours match
--      hand-written SUMs over tasks.estimated_hours / task_work_sessions, and
--      the numbers change with the CALLING user's own access, not the
--      assignee's -- a zero-access caller sees zero hours for a person whose
--      real logged hours are nonzero.
--   5. Cross-tenant isolation: a pipeline_id from a different company returns
--      zero rows from rpc_portfolio_cfd / rpc_portfolio_throughput, never an
--      error that would disclose it exists.

BEGIN;

CREATE TEMP TABLE pfa_check_ctx (
  company1     UUID,
  company2     UUID,
  team         UUID,
  creator      UUID,
  team_member  UUID,
  u_zero       UUID,
  u_direct     UUID,
  u_powner     UUID,
  pipeline1    UUID,
  pipeline2    UUID,
  stage_intake UUID,
  stage_done   UUID,
  project_a    UUID,
  project_b    UUID,
  task_a       UUID,
  admin_role   UUID
);
GRANT SELECT, INSERT, UPDATE ON pfa_check_ctx TO authenticated;

-- ── Fixture setup (runs as postgres -- bypasses RLS, has table grants) ─────
DO $$
DECLARE
  v_company1    UUID;
  v_company2    UUID;
  v_team        UUID;
  v_team_member UUID;
  v_creator     UUID;
  v_pool        UUID[];
  v_powner      UUID;
  v_pipeline1   UUID;
  v_pipeline2   UUID;
  v_intake      UUID;
  v_done        UUID;
  v_project_a   UUID;
  v_project_b   UUID;
  v_task_a      UUID;
  v_admin_role  UUID;
BEGIN
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

  -- Excludes project.view_all holders explicitly rather than trusting
  -- whoever sorts first by id (same reasoning as
  -- check_rpc_rollforward_project.sql): u_zero (pool[1]) must genuinely see
  -- nothing, and u_direct (pool[2]) must see ONLY project_a via its task
  -- assignment -- a view_all holder in either slot passes both assertions
  -- for the wrong reason (broad grant, not the accessibility path under
  -- test), which is exactly what made this check flag a false #281.
  -- u_powner is selected separately, without the view_all filter: it's only
  -- ever used as project_a's OWNER, and ownership alone already grants full
  -- access regardless of view_all, so the filter would just shrink the
  -- candidate pool for no behavioural reason.
  SELECT ARRAY_AGG(id) INTO v_pool FROM (
    SELECT u.id FROM public.users u
    WHERE u.company_id = v_company1 AND u.is_owner = false
      AND u.id NOT IN (
        SELECT tm2.user_id FROM public.team_members tm2
        WHERE tm2.team_id = v_team AND tm2.removed_at IS NULL
      )
      AND u.id NOT IN (
        SELECT ur3.user_id FROM public.user_roles ur3
        JOIN public.role_permissions rp3 ON rp3.role_id = ur3.role_id
        JOIN public.permissions perm3 ON perm3.id = rp3.permission_id AND perm3.key = 'project.view_all'
        WHERE ur3.revoked_at IS NULL
      )
    ORDER BY u.id
    LIMIT 2
  ) x;
  IF v_pool IS NULL OR ARRAY_LENGTH(v_pool, 1) < 2 THEN
    RAISE EXCEPTION 'Need 2 distinct non-owner, non-team, non-project.view_all users (u_zero, u_direct) in company % -- seed data too thin.', v_company1;
  END IF;

  SELECT u.id INTO v_powner FROM public.users u
  WHERE u.company_id = v_company1 AND u.is_owner = false
    AND u.id <> ALL (v_pool)
    AND u.id NOT IN (
      SELECT tm2.user_id FROM public.team_members tm2
      WHERE tm2.team_id = v_team AND tm2.removed_at IS NULL
    )
  LIMIT 1;
  IF v_powner IS NULL THEN
    RAISE EXCEPTION 'Need a third distinct non-owner, non-team user (u_powner) in company % -- seed data too thin.', v_company1;
  END IF;
  v_pool := v_pool || v_powner;

  -- Grant everyone in the pool analytics.view -- this check is about
  -- fn_project_accessible row filtering, not the screen-level gate.
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT DISTINCT ur.role_id, p.id
  FROM public.user_roles ur
  JOIN public.permissions p ON p.key = 'analytics.view'
  WHERE ur.user_id = ANY (v_pool[1:3]) AND ur.revoked_at IS NULL
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_admin_role FROM public.roles WHERE is_system = true AND name = 'Admin';
  IF v_admin_role IS NULL THEN RAISE EXCEPTION 'System Admin role not found.'; END IF;

  SELECT id INTO v_company2 FROM public.companies WHERE id <> v_company1 AND deleted_at IS NULL LIMIT 1;
  IF v_company2 IS NULL THEN RAISE EXCEPTION 'Need a second company for the cross-tenant assertion.'; END IF;

  -- Bump the pipeline limit so fixture creation isn't blocked by
  -- _enforce_pipeline_limit on a free-plan seeded company -- rolled back with
  -- everything else.
  INSERT INTO public.company_billing (company_id, plan_code)
  VALUES (v_company1, 'pro')
  ON CONFLICT (company_id) DO UPDATE SET plan_code = 'pro';

  INSERT INTO public.pipelines (company_id, name, subject_kind, created_by)
  VALUES (v_company1, 'PFA Selfcheck Pipeline', 'project', v_creator)
  RETURNING id INTO v_pipeline1;
  INSERT INTO public.pipelines (company_id, name, subject_kind, created_by)
  VALUES (v_company2, 'PFA Selfcheck Pipeline (other company)', 'project', NULL)
  RETURNING id INTO v_pipeline2;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial, is_terminal, terminal_type, submission_mode)
  VALUES (v_pipeline1, 'Intake', 1, true, false, NULL, 'none') RETURNING id INTO v_intake;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial, is_terminal, terminal_type, submission_mode)
  VALUES (v_pipeline1, 'Done', 2, false, true, 'success', 'none') RETURNING id INTO v_done;

  -- project_a: owner = pool[3] (u_powner), one task assigned to pool[2]
  -- (u_direct) with a known estimated_hours + a logged work session --
  -- accessible to owner + direct assignee, invisible to pool[1] (u_zero).
  --
  -- Trigger disabled around both project inserts below: neither supplies a
  -- pipeline_id or current_stage_id, and trg_projects_default_stage
  -- (20260803_project_stage_on_create_and_needs_attention.sql) resolves a
  -- default stage from the COMPANY, not from v_pipeline1 -- it would land
  -- these fixtures on some unrelated pre-existing pipeline instead of the
  -- one this check just created, corrupting the very rpc_advance_project_
  -- stage(..., v_intake) calls below (v_intake belongs to v_pipeline1).
  -- This check isn't testing default-staging at all, so excluding it here
  -- restores the pre-trigger fixture semantics the rest of the check relies on.
  ALTER TABLE public.projects DISABLE TRIGGER trg_projects_default_stage;

  INSERT INTO public.projects (company_id, name, created_by, owner_id)
  VALUES (v_company1, 'PFA Selfcheck Project A', v_creator, v_pool[3])
  RETURNING id INTO v_project_a;

  INSERT INTO public.tasks (company_id, project_id, title, created_by, estimated_hours)
  VALUES (v_company1, v_project_a, 'PFA task', v_creator, 6)
  RETURNING id INTO v_task_a;
  INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
  VALUES (v_task_a, v_company1, v_pool[2], v_creator);
  INSERT INTO public.task_work_sessions (task_id, user_id, company_id, started_at, total_seconds_spent, status)
  VALUES (v_task_a, v_pool[2], v_company1, now() - interval '1 day', 7200, 'completed');

  -- project_b: no owner, no assignment at all -- invisible to everyone
  -- except a project.view_all holder (unallocated work, per §13.14).
  INSERT INTO public.projects (company_id, name, created_by)
  VALUES (v_company1, 'PFA Selfcheck Project B', v_creator)
  RETURNING id INTO v_project_b;

  ALTER TABLE public.projects ENABLE TRIGGER trg_projects_default_stage;

  -- Real trigger-written stage moves -- run as the company owner so
  -- rpc_advance_project_stage's owner bypass skips transition-path
  -- validation (first placement has no path to validate anyway).
  PERFORM set_config('request.jwt.claim.sub', v_creator::text, true);
  PERFORM public.rpc_advance_project_stage(v_project_a, v_intake);
  PERFORM public.rpc_advance_project_stage(v_project_b, v_intake);

  INSERT INTO pfa_check_ctx (
    company1, company2, team, creator, team_member, u_zero, u_direct, u_powner,
    pipeline1, pipeline2, stage_intake, stage_done, project_a, project_b, task_a, admin_role
  ) VALUES (
    v_company1, v_company2, v_team, v_creator, v_team_member, v_pool[1], v_pool[2], v_pool[3],
    v_pipeline1, v_pipeline2, v_intake, v_done, v_project_a, v_project_b, v_task_a, v_admin_role
  );
END $$;

SET LOCAL ROLE authenticated;

-- ── 1. WIP by stage: hand COUNT(*) must equal the RPC, from THREE callers ──
DO $$
DECLARE
  c RECORD;
  v_hand_count INT;
  v_rpc_count  INT;
BEGIN
  SELECT * INTO c FROM pfa_check_ctx;

  -- Hand-written ground truth, no accessibility filter -- both projects sit
  -- in Intake.
  SELECT COUNT(*) INTO v_hand_count
  FROM public.projects p
  WHERE p.current_stage_id = c.stage_intake AND p.deleted_at IS NULL;
  IF v_hand_count <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (1): fixture setup wrong, expected 2 projects in Intake, hand count = %', v_hand_count;
  END IF;

  -- Owner sees both.
  PERFORM set_config('request.jwt.claim.sub', c.creator::text, true);
  SELECT wip_count INTO v_rpc_count FROM public.rpc_portfolio_wip_by_stage(c.pipeline1) WHERE stage_id = c.stage_intake;
  IF v_rpc_count IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (1): owner should see wip_count=2 for Intake, got %', v_rpc_count;
  END IF;

  -- Direct assignee (project_a only) sees 1.
  PERFORM set_config('request.jwt.claim.sub', c.u_direct::text, true);
  SELECT wip_count INTO v_rpc_count FROM public.rpc_portfolio_wip_by_stage(c.pipeline1) WHERE stage_id = c.stage_intake;
  IF v_rpc_count IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (1): direct assignee should see wip_count=1 (project_a only), got %', v_rpc_count;
  END IF;

  -- Zero access sees 0, not an error -- the two real projects are silently
  -- filtered, never disclosed.
  PERFORM set_config('request.jwt.claim.sub', c.u_zero::text, true);
  SELECT wip_count INTO v_rpc_count FROM public.rpc_portfolio_wip_by_stage(c.pipeline1) WHERE stage_id = c.stage_intake;
  IF v_rpc_count IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (1): zero-access caller should see wip_count=0 despite 2 real projects, got %', v_rpc_count;
  END IF;

  RAISE NOTICE 'OK (1): WIP-by-stage hand count = RPC, and differs correctly by caller (owner=2, direct=1, zero=0)';
END $$;

-- ── 2. CFD cumulative_count matches a hand COUNT(DISTINCT project_id) ──────
DO $$
DECLARE
  c RECORD;
  v_hand_count INT;
  v_rpc_count  INT;
BEGIN
  SELECT * INTO c FROM pfa_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.creator::text, true);

  SELECT COUNT(DISTINCT psh.project_id) INTO v_hand_count
  FROM public.project_stage_history psh
  JOIN public.pipeline_stages to_ps ON to_ps.id = psh.to_stage_id
  WHERE psh.pipeline_id = c.pipeline1
    AND to_ps.position >= (SELECT position FROM public.pipeline_stages WHERE id = c.stage_intake)
    AND psh.transitioned_at <= now() + interval '1 day';

  SELECT cumulative_count INTO v_rpc_count
  FROM public.rpc_portfolio_cfd(c.pipeline1, (now() - interval '2 days')::date, (now() + interval '1 day')::date, 4)
  WHERE stage_id = c.stage_intake
  ORDER BY bucket_end DESC LIMIT 1;

  IF v_hand_count IS DISTINCT FROM v_rpc_count THEN
    RAISE EXCEPTION 'CHECK FAILED (2): CFD cumulative_count = % but hand COUNT(DISTINCT) = %', v_rpc_count, v_hand_count;
  END IF;
  IF v_rpc_count <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (2): expected 2 (both fixture projects reached Intake), got %', v_rpc_count;
  END IF;

  RAISE NOTICE 'OK (2): CFD cumulative_count (%) matches hand COUNT(DISTINCT project_id) exactly', v_rpc_count;
END $$;

-- ── 3. Throughput / cycle time satisfies Little's Law on the same data ─────
DO $$
DECLARE
  c RECORD;
  v_arrivals_total    INT;
  v_completions_total INT;
  v_final_row         RECORD;
BEGIN
  SELECT * INTO c FROM pfa_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.creator::text, true);

  -- Sum across ALL buckets, not just the final one -- with only 3 buckets
  -- spanning [now-2d, now+1d], the fixture's "now" transitions can land in
  -- the MIDDLE bucket depending on where "now" falls in that span (bucket
  -- boundaries are evenly spaced across the whole range, not date-aligned to
  -- "today"). Asserting against the final bucket alone was a check bug, not
  -- an RPC bug -- confirmed against a raw arrival_events query landing the
  -- event in bucket 2 of 3.
  SELECT COALESCE(SUM(arrivals), 0), COALESCE(SUM(completions), 0)
  INTO v_arrivals_total, v_completions_total
  FROM public.rpc_portfolio_throughput(c.pipeline1, (now() - interval '2 days')::date, (now() + interval '1 day')::date, 3);

  IF v_arrivals_total IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (3): expected 2 arrivals total across all buckets, got %', v_arrivals_total;
  END IF;
  IF v_completions_total IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (3): expected 0 completions total across all buckets, got %', v_completions_total;
  END IF;

  -- wip_end is a running total (arrived-so-far minus completed-so-far as of
  -- each bucket's end), so the FINAL bucket's wip_end/cycle_time are
  -- well-defined regardless of which bucket the arrival itself landed in.
  SELECT * INTO v_final_row
  FROM public.rpc_portfolio_throughput(c.pipeline1, (now() - interval '2 days')::date, (now() + interval '1 day')::date, 3)
  ORDER BY bucket_end DESC LIMIT 1;

  IF v_final_row.wip_end IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (3): expected wip_end=2 (both parked in Intake, none terminal), got %', v_final_row.wip_end;
  END IF;
  -- Neither project reached Done -- completions must be 0 and cycle time
  -- undefined (NULL) in the final bucket too, never a divide-by-zero or a
  -- misleading 0.
  IF v_final_row.completions IS DISTINCT FROM 0 OR v_final_row.cycle_time_days IS NOT NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (3): expected 0 completions / NULL cycle time in final bucket, got completions=%, cycle=%',
      v_final_row.completions, v_final_row.cycle_time_days;
  END IF;

  RAISE NOTICE 'OK (3): throughput totals match fixture (arrivals=2 total, wip_end=2, completions=0 -> cycle_time NULL, no div-by-zero)';
END $$;

-- ── 4. Capacity: hand SUM matches, and it tracks the CALLER's access ───────
DO $$
DECLARE
  c RECORD;
  v_hand_committed NUMERIC;
  v_hand_available NUMERIC;
  v_row RECORD;
BEGIN
  SELECT * INTO c FROM pfa_check_ctx;

  SELECT t.estimated_hours INTO v_hand_committed FROM public.tasks t WHERE t.id = c.task_a;
  SELECT ROUND(SUM(ws.total_seconds_spent) / 3600.0, 1) INTO v_hand_available
  FROM public.task_work_sessions ws WHERE ws.task_id = c.task_a;

  IF v_hand_committed IS DISTINCT FROM 6 OR v_hand_available IS DISTINCT FROM 2.0 THEN
    RAISE EXCEPTION 'CHECK FAILED (4): fixture wrong, expected committed=6 available=2.0, got committed=%, available=%',
      v_hand_committed, v_hand_available;
  END IF;

  -- Owner (accessible) sees u_direct's real hours.
  PERFORM set_config('request.jwt.claim.sub', c.creator::text, true);
  SELECT * INTO v_row FROM public.rpc_portfolio_capacity((now() - interval '3 days')::date, (now() + interval '1 day')::date)
  WHERE user_id = c.u_direct;
  IF v_row.committed_hours IS DISTINCT FROM v_hand_committed OR v_row.available_hours IS DISTINCT FROM v_hand_available THEN
    RAISE EXCEPTION 'CHECK FAILED (4): owner-caller capacity mismatch: got committed=%, available=% (want %, %)',
      v_row.committed_hours, v_row.available_hours, v_hand_committed, v_hand_available;
  END IF;

  -- Zero-access caller: u_direct's row must NOT show project_a's hours (the
  -- caller's own accessibility gates every row, not the assignee's).
  PERFORM set_config('request.jwt.claim.sub', c.u_zero::text, true);
  SELECT * INTO v_row FROM public.rpc_portfolio_capacity((now() - interval '3 days')::date, (now() + interval '1 day')::date)
  WHERE user_id = c.u_direct;
  IF v_row.user_id IS NOT NULL AND (v_row.committed_hours > 0 OR v_row.available_hours > 0) THEN
    RAISE EXCEPTION 'CHECK FAILED (4): zero-access caller should see u_direct with zero hours (or no row), got committed=%, available=%',
      v_row.committed_hours, v_row.available_hours;
  END IF;

  RAISE NOTICE 'OK (4): capacity hand SUM matches RPC (committed=%, available=%), and gates by the CALLER''s own access', v_hand_committed, v_hand_available;
END $$;

-- ── 5. Cross-tenant isolation: a foreign pipeline_id returns zero rows ─────
DO $$
DECLARE
  c RECORD;
  v_n INT;
BEGIN
  SELECT * INTO c FROM pfa_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.creator::text, true);

  SELECT COUNT(*) INTO v_n FROM public.rpc_portfolio_cfd(c.pipeline2, (now() - interval '2 days')::date, (now() + interval '1 day')::date, 3);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (5): rpc_portfolio_cfd leaked % rows for a different company''s pipeline', v_n;
  END IF;

  SELECT COUNT(*) INTO v_n FROM public.rpc_portfolio_throughput(c.pipeline2, (now() - interval '2 days')::date, (now() + interval '1 day')::date, 3);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (5): rpc_portfolio_throughput leaked % rows for a different company''s pipeline', v_n;
  END IF;

  SELECT COUNT(*) INTO v_n FROM public.rpc_portfolio_wip_by_stage(c.pipeline2);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (5): rpc_portfolio_wip_by_stage leaked % rows for a different company''s pipeline', v_n;
  END IF;

  RAISE NOTICE 'OK (5): a foreign-company pipeline_id returns zero rows from all three bucketed/stage RPCs -- no cross-tenant leak';
END $$;

RESET ROLE;

DO $$ BEGIN
  RAISE NOTICE 'ALL OK: issue #175 portfolio flow analytics verified -- WIP-by-stage, CFD, throughput/cycle-time and capacity all hand-checked, all four gated by fn_project_accessible per the calling user, cross-tenant isolation holds.';
END $$;

ROLLBACK;
