-- Runnable check for issue #191 Phase 10 — the Intelligence project/portfolio
-- lens (components/intelligence/ProjectLens.tsx).
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/20260805_intelligence_project_lens_check.sql
--
-- Wrapped in BEGIN/ROLLBACK: builds one throwaway portfolio + two projects +
-- 20 tasks inside an EXISTING seeded company, reusing real users (never
-- inventing auth.users rows -- same convention as every other check here),
-- asserts, then always rolls back.
--
-- ── WHY THIS CHECK EXISTS ──────────────────────────────────────────────────
-- The lens adds NO new SQL: it renders rpc_portfolios_table (via
-- usePortfolios) beside rpc_projects_table(p_blocked := TRUE). That means its
-- security and its honesty are entirely inherited, and both inherited claims
-- are worth a test that fails loudly if a later edit breaks them:
--
--   THE NEGATIVE (the #185/#186 leak shape). An Intelligence screen is an
--   aggregate over many projects. A member who can call the RPCs (they hold
--   project.view, so no screen-level gate is doing the work) but is on none of
--   the projects must get NO ROW for the portfolio -- not a row of zeros,
--   which would still confirm the batch exists, and not a project row.
--
--   THE AGREEMENT (§16.1: "if the three surfaces disagree about one project's
--   finish date, the feature has failed"). The portfolio panel and the
--   needs-attention panel sit next to each other on one screen and are fed by
--   two different RPCs. Their numbers must be the SAME numbers: the portfolio
--   rollup for a partially-visible batch must equal the sum over exactly the
--   projects the other RPC returns, and its projected_end/confidence must be
--   byte-identical to the project's own -- not merely "close".
--
-- ── WHY THIS CANNOT SPAM PRODUCTION ────────────────────────────────────────
-- The fixture raises a project's `blocked` flag (that is what puts it in the
-- needs-attention list), which fires the project.flag_raised trigger, which
-- writes notification_events, which carries trg_dispatch_notification_event --
-- a pg_net POST to a HARDCODED PRODUCTION url. That one trigger is disabled by
-- name for the duration; ALTER TABLE is transactional, so the ROLLBACK at the
-- bottom restores it even if an assertion raises. Assertion (4) re-reads
-- pg_trigger to prove it was actually off, so a silently-failed DISABLE fails
-- the check instead of quietly having POSTed.

BEGIN;

ALTER TABLE public.notification_events DISABLE TRIGGER trg_dispatch_notification_event;

CREATE TEMP TABLE plens_ctx (
  company    UUID,
  owner_user UUID,
  u_member   UUID,   -- projects.owner_id on project A -> sees A, never B
  u_zero     UUID,   -- holds project.view, is on nothing -> must see nothing
  portfolio  UUID,
  project_a  UUID,
  project_b  UUID,
  pipeline   UUID,
  stage_open UUID,
  stage_done UUID
);
GRANT SELECT ON plens_ctx TO authenticated;

-- ── Fixture (runs as postgres: bypasses RLS, has the table grants) ─────────
DO $$
DECLARE
  v_company   UUID;
  v_owner     UUID;
  v_pool      UUID[];
  v_perm      UUID;
  v_pipeline  UUID;
  v_open      UUID;
  v_done      UUID;
  v_portfolio UUID;
  v_a         UUID;
  v_b         UUID;
  v_roles     INT;
BEGIN
  SELECT u.company_id INTO v_company
  FROM public.users u
  WHERE u.is_owner = TRUE AND u.deleted_at IS NULL
    AND (SELECT COUNT(*) FROM public.users u2
         WHERE u2.company_id = u.company_id AND u2.is_owner = FALSE
           AND u2.deleted_at IS NULL AND u2.is_active) >= 2
  LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No seeded company with an owner + 2 non-owner users -- run this against a seeded dev DB, not prod.';
  END IF;

  SELECT id INTO v_owner FROM public.users
  WHERE company_id = v_company AND is_owner = TRUE LIMIT 1;

  -- Two non-owner users who do NOT hold project.view_all (which would make
  -- them see everything and destroy the negative assertion) and who DO hold at
  -- least one role (the next step grants project.view through it -- without a
  -- role there is nothing to grant, and "no rows" would then prove only that
  -- the screen-level gate fired).
  SELECT ARRAY_AGG(id) INTO v_pool FROM (
    SELECT u.id FROM public.users u
    WHERE u.company_id = v_company AND u.is_owner = FALSE
      AND u.deleted_at IS NULL AND u.is_active
      AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id AND ur.revoked_at IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.role_permissions rp ON rp.role_id = ur.role_id
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE ur.user_id = u.id AND ur.revoked_at IS NULL AND p.key = 'project.view_all'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.team_members tm
        JOIN public.team_roles tr ON tr.team_id = tm.team_id
        JOIN public.role_permissions rp ON rp.role_id = tr.role_id
        JOIN public.permissions p ON p.id = rp.permission_id
        WHERE tm.user_id = u.id AND tm.removed_at IS NULL AND p.key = 'project.view_all'
      )
    ORDER BY u.id LIMIT 2
  ) x;

  IF v_pool IS NULL OR ARRAY_LENGTH(v_pool, 1) < 2 THEN
    RAISE EXCEPTION 'Need 2 role-holding non-owner users without project.view_all in company % -- seed data too thin.', v_company;
  END IF;

  -- Both RPCs the lens reads have a screen-level gate (has_permission
  -- ('project.view')) that predates #186 and governs "can you open this screen
  -- at all", not "can you see THIS row". Grant it to both test users so that
  -- gate is provably NOT what denies u_zero later.
  SELECT id INTO v_perm FROM public.permissions WHERE key = 'project.view';
  IF v_perm IS NULL THEN
    RAISE EXCEPTION 'permissions.key = ''project.view'' not found -- schema drift.';
  END IF;

  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT DISTINCT ur.role_id, v_perm
  FROM public.user_roles ur
  WHERE ur.user_id = ANY (v_pool) AND ur.revoked_at IS NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.pipelines (company_id, name, subject_kind)
  VALUES (v_company, 'PLENS Check Pipeline ' || gen_random_uuid(), 'project')
  RETURNING id INTO v_pipeline;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_pipeline, 'Open', 0, TRUE) RETURNING id INTO v_open;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_terminal, terminal_type)
  VALUES (v_pipeline, 'Delivered', 1, TRUE, 'success') RETURNING id INTO v_done;

  INSERT INTO public.portfolios (company_id, name, created_by)
  VALUES (v_company, 'PLENS Check Batch ' || gen_random_uuid(), v_owner)
  RETURNING id INTO v_portfolio;

  -- A: owned by u_member (-> accessible to them, and to nobody else here),
  -- blocked (-> it is what the needs-attention panel is supposed to surface).
  INSERT INTO public.projects (company_id, name, pipeline_id, current_stage_id,
                               portfolio_id, owner_id, created_by, blocked, blocked_reason,
                               due_date)
  VALUES (v_company, 'PLENS Check Project A ' || gen_random_uuid(), v_pipeline, v_open,
          v_portfolio, v_pool[1], v_owner, TRUE, 'Waiting on the client',
          now() + INTERVAL '30 days')
  RETURNING id INTO v_a;

  -- B: same portfolio, owned by the company owner, no assignments -> invisible
  -- to BOTH test users. It is what makes "partial access" a real case: the
  -- batch has 2 projects, u_member must be told 1.
  INSERT INTO public.projects (company_id, name, pipeline_id, current_stage_id,
                               portfolio_id, owner_id, created_by)
  VALUES (v_company, 'PLENS Check Project B ' || gen_random_uuid(), v_pipeline, v_open,
          v_portfolio, v_owner, v_owner)
  RETURNING id INTO v_b;

  -- 20 tasks on A: 14 finished (a success-TERMINAL stage -- never a
  -- completed_at stamp), spread over 21 days of real pipeline_stage_history so
  -- fn_project_projection has a datable window and returns 'ok' rather than
  -- the 'none' every project in this database currently sits at. A projection
  -- that never leaves 'none' would make the agreement assertion vacuous.
  INSERT INTO public.tasks (company_id, title, project_id, created_by, manager_id,
                            pipeline_id, current_stage_id)
  SELECT v_company, 'PLENS t' || g, v_a, v_owner, v_owner, v_pipeline,
         CASE WHEN g <= 14 THEN v_done ELSE v_open END
  FROM generate_series(1, 20) g;

  INSERT INTO public.pipeline_stage_history (task_id, company_id, pipeline_id,
                                             from_stage_id, to_stage_id, transitioned_by, transitioned_at)
  SELECT t.id, v_company, v_pipeline, v_open, v_done, v_owner,
         now() - ((21 - (ROW_NUMBER() OVER (ORDER BY t.title))::INT) || ' days')::INTERVAL
  FROM public.tasks t
  WHERE t.project_id = v_a AND t.current_stage_id = v_done;

  INSERT INTO plens_ctx VALUES (v_company, v_owner, v_pool[1], v_pool[2],
                                v_portfolio, v_a, v_b, v_pipeline, v_open, v_done);
END $$;


-- Assertions run as `authenticated` so RLS actually engages (postgres is
-- BYPASSRLS and would prove nothing).
SET LOCAL ROLE authenticated;

-- ── 1. THE NEGATIVE: on nothing -> no aggregate, not even a zero row ───────
DO $$
DECLARE
  c         RECORD;
  v_ok      BOOLEAN;
  v_rows    INT;
  v_called  BOOLEAN := FALSE;
  v_msg     TEXT;
BEGIN
  SELECT * INTO c FROM plens_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_zero::text, true);

  -- The screen gate must PASS for this user, or everything below proves only
  -- that the gate fired and nothing about the row-level predicate.
  BEGIN
    SELECT COUNT(*) INTO v_rows FROM public.rpc_portfolios_table(p_limit := 500);
    v_called := TRUE;
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
  END;
  IF NOT v_called THEN
    RAISE EXCEPTION 'CHECK INCONCLUSIVE (1): rpc_portfolios_table refused u_zero outright (%) -- the row-level assertions below would be vacuous', v_msg;
  END IF;

  SELECT public.fn_project_accessible(c.project_a) INTO v_ok;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (1): fixture miswired -- u_zero can access project A'; END IF;
  SELECT public.fn_project_accessible(c.project_b) INTO v_ok;
  IF v_ok THEN RAISE EXCEPTION 'CHECK FAILED (1): fixture miswired -- u_zero can access project B'; END IF;

  -- The portfolio panel: NO ROW. A row of zeros would still tell this user
  -- that the batch exists, which is the census #185/#186 were about.
  SELECT COUNT(*) INTO v_rows
  FROM public.rpc_portfolios_table(p_limit := 500) WHERE id = c.portfolio;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (1): rpc_portfolios_table returned % row(s) for a portfolio whose projects are all inaccessible', v_rows;
  END IF;

  -- The needs-attention panel: the exact call ProjectLens.tsx makes.
  SELECT COUNT(*) INTO v_rows
  FROM public.rpc_projects_table(p_blocked := TRUE, p_limit := 500)
  WHERE id IN (c.project_a, c.project_b);
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (1): the needs-attention call leaked % inaccessible project(s)', v_rows;
  END IF;

  SELECT COUNT(*) INTO v_rows
  FROM public.rpc_projects_table(p_limit := 500) WHERE id IN (c.project_a, c.project_b);
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (1): rpc_projects_table leaked % inaccessible project(s)', v_rows;
  END IF;

  SELECT COUNT(*) INTO v_rows FROM public.projects WHERE id IN (c.project_a, c.project_b);
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (1): projects_select RLS shows % row(s) directly', v_rows;
  END IF;

  RAISE NOTICE 'OK (1): a member holding project.view but assigned to nothing gets NO portfolio row, NO attention row, NO project row -- the aggregate cannot out-report fn_project_accessible';
END $$;


-- ── 2. THE AGREEMENT: partial access, and both panels say the same thing ───
DO $$
DECLARE
  c      RECORD;
  pf     RECORD;
  pr     RECORD;
  v_rows INT;
BEGIN
  SELECT * INTO c FROM plens_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_member::text, true);

  SELECT * INTO pf FROM public.rpc_portfolios_table(p_limit := 500) WHERE id = c.portfolio;
  IF pf.id IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (2): the batch owner sees no portfolio row at all';
  END IF;

  SELECT * INTO pr FROM public.rpc_projects_table(p_limit := 500) WHERE id = c.project_a;
  IF pr.id IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (2): project A missing from rpc_projects_table for its own owner';
  END IF;

  -- Partial access is reported partially: 2 projects in the batch, 1 visible.
  IF pf.projects_total <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (2): projects_total = % (expected 1 -- project B is not accessible to this user)', pf.projects_total;
  END IF;
  SELECT COUNT(*) INTO v_rows FROM public.rpc_projects_table(p_limit := 500) WHERE id = c.project_b;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (2): project B is visible to a user who owns only project A';
  END IF;

  IF pf.projects_blocked <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (2): projects_blocked = % (expected 1)', pf.projects_blocked;
  END IF;

  -- The two panels are fed by two RPCs. Same numbers or the screen lies.
  IF pf.tasks_total IS DISTINCT FROM pr.tasks_total OR pf.tasks_done IS DISTINCT FROM pr.tasks_done THEN
    RAISE EXCEPTION 'CHECK FAILED (2): portfolio panel says %/% tasks, project panel says %/% -- the two halves of the lens disagree',
      pf.tasks_done, pf.tasks_total, pr.tasks_done, pr.tasks_total;
  END IF;
  IF pr.tasks_total <> 20 OR pr.tasks_done <> 14 THEN
    RAISE EXCEPTION 'CHECK FAILED (2): tasks %/% (expected 14/20) -- "done" is not the success-terminal stage predicate', pr.tasks_done, pr.tasks_total;
  END IF;

  -- §16.1's whole point, asserted: ONE finish date, from ONE definition.
  IF pf.confidence = 'none' THEN
    RAISE EXCEPTION 'CHECK FAILED (2): the fixture failed to produce a forecast at all -- the equality below would prove nothing';
  END IF;
  IF pf.projected_end IS DISTINCT FROM pr.projected_end THEN
    RAISE EXCEPTION 'CHECK FAILED (2): portfolio projects % , project projects % -- two surfaces, two dates',
      pf.projected_end, pr.projected_end;
  END IF;
  IF pf.confidence IS DISTINCT FROM pr.projection_confidence THEN
    RAISE EXCEPTION 'CHECK FAILED (2): confidence % vs % -- one surface would render a fact and the other a guess',
      pf.confidence, pr.projection_confidence;
  END IF;

  RAISE NOTICE 'OK (2): partial access reports 1 of 2 projects, and the portfolio panel and project panel agree on tasks (%/%), projected_end (%) and confidence (%)',
    pf.tasks_done, pf.tasks_total, pf.projected_end, pf.confidence;
END $$;


-- ── 3. The needs-attention panel actually surfaces the blocked project ─────
DO $$
DECLARE
  c      RECORD;
  v_ok   BOOLEAN;
BEGIN
  SELECT * INTO c FROM plens_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_member::text, true);

  SELECT EXISTS(
    SELECT 1 FROM public.rpc_projects_table(p_blocked := TRUE, p_limit := 500)
    WHERE id = c.project_a
  ) INTO v_ok;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (3): a blocked, accessible project is missing from the needs-attention call';
  END IF;

  RAISE NOTICE 'OK (3): rpc_projects_table(p_blocked := TRUE) -- the lens attention panel -- surfaces the blocked project for the user who can open it';
END $$;


-- ── 4. Prove the production dispatcher was OFF the whole time ──────────────
RESET ROLE;
DO $$
DECLARE v_enabled "char";
BEGIN
  SELECT tgenabled INTO v_enabled FROM pg_trigger
  WHERE tgrelid = 'public.notification_events'::regclass
    AND tgname  = 'trg_dispatch_notification_event';

  IF v_enabled IS NULL THEN
    RAISE EXCEPTION 'CHECK INCONCLUSIVE (4): trg_dispatch_notification_event not found -- cannot prove nothing was POSTed';
  END IF;
  IF v_enabled <> 'D' THEN
    RAISE EXCEPTION 'CHECK FAILED (4): the production dispatch trigger was ENABLED (tgenabled=%) while this check raised a project flag', v_enabled;
  END IF;

  RAISE NOTICE 'OK (4): trg_dispatch_notification_event was DISABLED throughout -- zero pg_net POSTs to the hardcoded production url';
END $$;

DO $$ BEGIN
  RAISE NOTICE 'ALL OK: the Intelligence project/portfolio lens reads only access-filtered aggregates (no row at all for a user on nothing), reports partial access partially, and its two panels agree on tasks, projected end and confidence.';
END $$;

ROLLBACK;
