-- Runnable check for issue #191 §16.1 — ONE definition of "does this project
-- need a human" (supabase/migrations/20260806_project_needs_attention.sql).
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/20260806_project_needs_attention_check.sql
--
-- Wrapped in BEGIN/ROLLBACK: builds throwaway projects inside an EXISTING
-- seeded company, reusing real users (never inventing auth.users rows -- same
-- convention as every other check here), asserts, then always rolls back.
--
-- ── WHY THIS CHECK EXISTS ──────────────────────────────────────────────────
-- rpc_projects_table's p_blocked filter and lib/projectExceptions.ts had drifted
-- into two different answers to the same question. Three concrete gaps existed
-- on the server side, and ALL THREE are invisible in this database's real data:
-- 0 projects use flags[], 0 are finished-and-overdue, and all 35 sit at
-- projection confidence 'none'. The divergence was latent, not active -- which
-- is precisely why it needs synthetic fixtures rather than a spot check, and
-- why "it doesn't reproduce locally" was never evidence of correctness.
--
--   GAP 1 -- flags[] ignored. 20260801_project_header_flags.sql shipped
--   flags[]/flag_note alongside the older blocked/blocked_reason. A project
--   blocked only through the newer representation was invisible to the filter.
--
--   GAP 2 -- no done-exclusion. A FINISHED project past its due date still
--   reported as needing attention. A plain user-visible bug.
--
--   GAP 3 -- overrun ignored. The forecast the RPC already computes was never
--   consulted; and when it IS consulted it must stay silent at confidence
--   'none', where the server explicitly refused to forecast.
--
-- Plus the structural claim the migration makes: the needs_attention COLUMN and
-- the p_blocked FILTER call the same function, so no row can appear in one and
-- not the other. Asserted directly (5).
--
-- ── WHY THIS CANNOT SPAM PRODUCTION ────────────────────────────────────────
-- The fixture raises project flags (both representations) and moves a project
-- into a terminal stage. Both fire triggers that write notification_events,
-- which carries trg_dispatch_notification_event -- a pg_net POST to a HARDCODED
-- PRODUCTION url. That one trigger is disabled BY NAME for the duration (not
-- session_replication_role, which would also silence the project triggers whose
-- side effects the fixture depends on). ALTER TABLE is transactional, so the
-- ROLLBACK at the bottom restores it even if an assertion raises. Assertion (6)
-- re-reads pg_trigger to prove it was actually off, so a silently-failed
-- DISABLE fails the check instead of quietly having POSTed.

BEGIN;

ALTER TABLE public.notification_events DISABLE TRIGGER trg_dispatch_notification_event;

CREATE TEMP TABLE natt_ctx (
  company     UUID,
  owner_user  UUID,
  u_member    UUID,   -- owns every fixture project -> can see them all
  pipeline    UUID,
  stage_open  UUID,
  stage_done  UUID,   -- is_terminal + terminal_type = 'success'
  p_done      UUID,   -- GAP 2: finished AND 30 days overdue     -> NOT attention
  p_flagged   UUID,   -- GAP 1: blocked ONLY via flags[]         -> attention
  p_overrun   UUID,   -- GAP 3: forecast past due, confidence ok -> attention
  p_noforecast UUID,  -- GAP 3: same shape, confidence 'none'    -> NOT attention
  p_clear     UUID    -- control: nothing wrong with it          -> NOT attention
);
GRANT SELECT ON natt_ctx TO authenticated;

DO $$
DECLARE
  v_company  UUID;
  v_owner    UUID;
  v_member   UUID;
  v_perm     UUID;
  v_pipeline UUID;
  v_open     UUID;
  v_done     UUID;
  v_pdone    UUID;
  v_pflag    UUID;
  v_pover    UUID;
  v_pnof     UUID;
  v_pclear   UUID;
BEGIN
  SELECT u.company_id INTO v_company
  FROM public.users u
  WHERE u.is_owner = TRUE AND u.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM public.users u2
                JOIN public.user_roles ur ON ur.user_id = u2.id AND ur.revoked_at IS NULL
                WHERE u2.company_id = u.company_id AND u2.is_owner = FALSE
                  AND u2.deleted_at IS NULL AND u2.is_active)
  LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No seeded company with an owner + a role-holding member -- run this against a seeded dev DB, not prod.';
  END IF;

  SELECT id INTO v_owner FROM public.users
  WHERE company_id = v_company AND is_owner = TRUE LIMIT 1;

  SELECT u.id INTO v_member FROM public.users u
  WHERE u.company_id = v_company AND u.is_owner = FALSE
    AND u.deleted_at IS NULL AND u.is_active
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id AND ur.revoked_at IS NULL)
  ORDER BY u.id LIMIT 1;

  -- rpc_projects_table has a screen-level gate (has_permission('project.view'))
  -- that governs "can you open this screen", not "can you see THIS row". Grant
  -- it, or every assertion below would only prove the gate fired.
  SELECT id INTO v_perm FROM public.permissions WHERE key = 'project.view';
  IF v_perm IS NULL THEN
    RAISE EXCEPTION 'permissions.key = ''project.view'' not found -- schema drift.';
  END IF;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT DISTINCT ur.role_id, v_perm FROM public.user_roles ur
  WHERE ur.user_id = v_member AND ur.revoked_at IS NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.pipelines (company_id, name, subject_kind)
  VALUES (v_company, 'NATT Check Pipeline ' || gen_random_uuid(), 'project')
  RETURNING id INTO v_pipeline;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_pipeline, 'Open', 0, TRUE) RETURNING id INTO v_open;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_terminal, terminal_type)
  VALUES (v_pipeline, 'Delivered', 1, TRUE, 'success') RETURNING id INTO v_done;

  -- GAP 2. Finished (success-terminal stage) and 30 days past its due date.
  -- The OLD server predicate returned this row; the dashboard never did.
  INSERT INTO public.projects (company_id, name, pipeline_id, current_stage_id, owner_id, created_by, due_date)
  VALUES (v_company, 'NATT done+overdue ' || gen_random_uuid(), v_pipeline, v_done, v_member, v_owner,
          now() - INTERVAL '30 days')
  RETURNING id INTO v_pdone;

  -- GAP 1. Blocked ONLY through flags[] -- `blocked` stays false, no due_date,
  -- so nothing else about this row can make it qualify.
  INSERT INTO public.projects (company_id, name, pipeline_id, current_stage_id, owner_id, created_by,
                               blocked, flags, flag_note)
  VALUES (v_company, 'NATT flags-only ' || gen_random_uuid(), v_pipeline, v_open, v_member, v_owner,
          FALSE, ARRAY['blocked']::TEXT[], 'waiting on legal')
  RETURNING id INTO v_pflag;

  -- GAP 3 positive. Due in 2 days (so NOT overdue), not blocked, but the
  -- forecast lands ~9 days out at confidence 'ok'.
  INSERT INTO public.projects (company_id, name, pipeline_id, current_stage_id, owner_id, created_by, due_date)
  VALUES (v_company, 'NATT overrun ' || gen_random_uuid(), v_pipeline, v_open, v_member, v_owner,
          now() + INTERVAL '2 days')
  RETURNING id INTO v_pover;

  -- GAP 3 negative. Same shape, but only 3 completions -> fn_project_projection
  -- refuses to forecast at all ('none'). Silence, not a guess.
  INSERT INTO public.projects (company_id, name, pipeline_id, current_stage_id, owner_id, created_by, due_date)
  VALUES (v_company, 'NATT no-forecast ' || gen_random_uuid(), v_pipeline, v_open, v_member, v_owner,
          now() + INTERVAL '2 days')
  RETURNING id INTO v_pnof;

  -- Control: open, due in 90 days, no flags, no tasks. Must never qualify --
  -- without it, a predicate stuck at TRUE would pass every other assertion.
  INSERT INTO public.projects (company_id, name, pipeline_id, current_stage_id, owner_id, created_by, due_date)
  VALUES (v_company, 'NATT clear ' || gen_random_uuid(), v_pipeline, v_open, v_member, v_owner,
          now() + INTERVAL '90 days')
  RETURNING id INTO v_pclear;

  -- 20 tasks on the overrun project, 14 finished across a 20-day window of real
  -- stage history -> rate 0.7/day, 6 remaining, ~9 days out, confidence 'ok'.
  INSERT INTO public.tasks (company_id, title, project_id, created_by, manager_id, pipeline_id, current_stage_id)
  SELECT v_company, 'NATT over t' || g, v_pover, v_owner, v_owner, v_pipeline,
         CASE WHEN g <= 14 THEN v_done ELSE v_open END
  FROM generate_series(1, 20) g;

  INSERT INTO public.pipeline_stage_history (task_id, company_id, pipeline_id,
                                             from_stage_id, to_stage_id, transitioned_by, transitioned_at)
  SELECT t.id, v_company, v_pipeline, v_open, v_done, v_owner,
         now() - ((21 - (ROW_NUMBER() OVER (ORDER BY t.title))::INT) || ' days')::INTERVAL
  FROM public.tasks t WHERE t.project_id = v_pover AND t.current_stage_id = v_done;

  -- 20 tasks on the no-forecast project, only 3 finished -> below the sample
  -- threshold, confidence 'none'.
  INSERT INTO public.tasks (company_id, title, project_id, created_by, manager_id, pipeline_id, current_stage_id)
  SELECT v_company, 'NATT nof t' || g, v_pnof, v_owner, v_owner, v_pipeline,
         CASE WHEN g <= 3 THEN v_done ELSE v_open END
  FROM generate_series(1, 20) g;

  INSERT INTO public.pipeline_stage_history (task_id, company_id, pipeline_id,
                                             from_stage_id, to_stage_id, transitioned_by, transitioned_at)
  SELECT t.id, v_company, v_pipeline, v_open, v_done, v_owner, now() - INTERVAL '10 days'
  FROM public.tasks t WHERE t.project_id = v_pnof AND t.current_stage_id = v_done;

  INSERT INTO natt_ctx VALUES (v_company, v_owner, v_member, v_pipeline, v_open, v_done,
                               v_pdone, v_pflag, v_pover, v_pnof, v_pclear);
END $$;


-- ── 0. The fixture really is the shape the assertions assume ───────────────
DO $$
DECLARE c RECORD; v_conf TEXT; v_end DATE; v_due DATE;
BEGIN
  SELECT * INTO c FROM natt_ctx;

  SELECT confidence, projected_end INTO v_conf, v_end FROM public.fn_project_projection(c.p_overrun);
  SELECT due_date::date INTO v_due FROM public.projects WHERE id = c.p_overrun;
  IF v_conf = 'none' OR v_end IS NULL THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: the overrun project has no forecast (confidence=%) -- assertion (3) would prove nothing', v_conf;
  END IF;
  IF v_end <= v_due THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: projected_end % is not after due_date % -- there is no overrun to detect', v_end, v_due;
  END IF;

  SELECT confidence INTO v_conf FROM public.fn_project_projection(c.p_noforecast);
  IF v_conf <> 'none' THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: the no-forecast project came back at confidence % -- the negative in (3) would prove nothing', v_conf;
  END IF;

  RAISE NOTICE 'OK (0): fixture is honest -- overrun project forecasts past its due date at real confidence, control project forecasts nothing';
END $$;


-- ── 1..4 via the RPC, as `authenticated` so RLS actually engages ───────────
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c        RECORD;
  v_att    BOOLEAN;
  v_in     BOOLEAN;
  v_rows   INT;
BEGIN
  SELECT * INTO c FROM natt_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_member::text, true);

  -- Sanity: all five fixture rows are visible to this user, or a "not in the
  -- attention list" result would just mean "not in any list".
  SELECT COUNT(*) INTO v_rows FROM public.rpc_projects_table(p_limit := 500)
  WHERE id IN (c.p_done, c.p_flagged, c.p_overrun, c.p_noforecast, c.p_clear);
  IF v_rows <> 5 THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: only % of 5 fixture projects are visible to the test user', v_rows;
  END IF;

  -- ── GAP 2: finished AND overdue is NOT attention ────────────────────────
  SELECT needs_attention INTO v_att FROM public.rpc_projects_table(p_limit := 500) WHERE id = c.p_done;
  SELECT EXISTS(SELECT 1 FROM public.rpc_projects_table(p_blocked := TRUE, p_limit := 500) WHERE id = c.p_done) INTO v_in;
  IF v_att OR v_in THEN
    RAISE EXCEPTION 'CHECK FAILED (2): a FINISHED project 30 days past its due date reports as needing attention (column=%, in filter=%) -- the done-exclusion is missing', v_att, v_in;
  END IF;
  RAISE NOTICE 'OK (2): a success-terminal project past its due date is NOT attention -- neither the column nor the filter';

  -- ── GAP 1: blocked only via flags[] IS attention ────────────────────────
  SELECT needs_attention INTO v_att FROM public.rpc_projects_table(p_limit := 500) WHERE id = c.p_flagged;
  SELECT EXISTS(SELECT 1 FROM public.rpc_projects_table(p_blocked := TRUE, p_limit := 500) WHERE id = c.p_flagged) INTO v_in;
  IF NOT v_att OR NOT v_in THEN
    RAISE EXCEPTION 'CHECK FAILED (1): a project blocked ONLY through flags[] is invisible to the server (column=%, in filter=%) -- the two blocked representations are not unioned', v_att, v_in;
  END IF;
  RAISE NOTICE 'OK (1): flags[] = {blocked} with projects.blocked = false IS attention -- both representations count';

  -- ── GAP 3: overrun fires, and only with a real forecast ─────────────────
  SELECT needs_attention INTO v_att FROM public.rpc_projects_table(p_limit := 500) WHERE id = c.p_overrun;
  SELECT EXISTS(SELECT 1 FROM public.rpc_projects_table(p_blocked := TRUE, p_limit := 500) WHERE id = c.p_overrun) INTO v_in;
  IF NOT v_att OR NOT v_in THEN
    RAISE EXCEPTION 'CHECK FAILED (3): a project forecast to land after its due date at real confidence is not attention (column=%, in filter=%)', v_att, v_in;
  END IF;

  SELECT needs_attention INTO v_att FROM public.rpc_projects_table(p_limit := 500) WHERE id = c.p_noforecast;
  SELECT EXISTS(SELECT 1 FROM public.rpc_projects_table(p_blocked := TRUE, p_limit := 500) WHERE id = c.p_noforecast) INTO v_in;
  IF v_att OR v_in THEN
    RAISE EXCEPTION 'CHECK FAILED (3): a project at confidence ''none'' raised an overrun warning (column=%, in filter=%) -- the server refused to forecast and the UI guessed anyway', v_att, v_in;
  END IF;
  RAISE NOTICE 'OK (3): overrun fires at real confidence and stays silent at ''none''';

  -- ── Control ─────────────────────────────────────────────────────────────
  SELECT needs_attention INTO v_att FROM public.rpc_projects_table(p_limit := 500) WHERE id = c.p_clear;
  IF v_att THEN
    RAISE EXCEPTION 'CHECK FAILED (4): a clean project due in 90 days reports as needing attention -- the predicate is stuck TRUE';
  END IF;
  RAISE NOTICE 'OK (4): a clean project is not attention -- the predicate discriminates';
END $$;


-- ── 5. The column and the filter cannot disagree, over EVERY visible row ───
DO $$
DECLARE
  c        RECORD;
  v_bad    INT;
  v_total  INT;
  v_att    INT;
BEGIN
  SELECT * INTO c FROM natt_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_member::text, true);

  SELECT COUNT(*) INTO v_total FROM public.rpc_projects_table(p_limit := 500);
  SELECT COUNT(*) INTO v_att   FROM public.rpc_projects_table(p_limit := 500) WHERE needs_attention;

  -- Symmetric difference between "the column says so" and "the filter returned
  -- it", plus the p_blocked := FALSE arm, which must be the exact complement.
  SELECT COUNT(*) INTO v_bad FROM (
    SELECT id FROM public.rpc_projects_table(p_limit := 500) WHERE needs_attention
    EXCEPT SELECT id FROM public.rpc_projects_table(p_blocked := TRUE, p_limit := 500)
    UNION ALL
    SELECT id FROM public.rpc_projects_table(p_blocked := TRUE, p_limit := 500)
    EXCEPT SELECT id FROM public.rpc_projects_table(p_limit := 500) WHERE needs_attention
    UNION ALL
    SELECT id FROM public.rpc_projects_table(p_blocked := FALSE, p_limit := 500) WHERE needs_attention
  ) x;

  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (5): % row(s) where the needs_attention column and the p_blocked filter disagree -- they are supposed to be one function', v_bad;
  END IF;
  IF v_att = 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (5): no row is attention at all -- the agreement above is vacuous';
  END IF;

  RAISE NOTICE 'OK (5): % of % visible rows are attention, and the column, the p_blocked := TRUE filter and the complement of p_blocked := FALSE agree on every one', v_att, v_total;
END $$;


-- ── 5b. The confidence gate, isolated from any fixture ─────────────────────
-- The end-to-end negative above rides on fn_project_projection returning a NULL
-- projected_end at 'none'. This pins the gate itself: same non-null date, same
-- due date, only the confidence changes.
RESET ROLE;
DO $$
DECLARE
  v_due  TIMESTAMPTZ := now() + INTERVAL '2 days';
  v_end  DATE        := (CURRENT_DATE + 30);
BEGIN
  IF public.fn_project_needs_attention(FALSE, '{}', v_due, FALSE, NULL, v_end, 'none') THEN
    RAISE EXCEPTION 'CHECK FAILED (5b): confidence ''none'' fired an overrun';
  END IF;
  IF NOT public.fn_project_needs_attention(FALSE, '{}', v_due, FALSE, NULL, v_end, 'low') THEN
    RAISE EXCEPTION 'CHECK FAILED (5b): confidence ''low'' did not fire -- it is shown as uncertain, not hidden';
  END IF;
  IF NOT public.fn_project_needs_attention(FALSE, '{}', v_due, FALSE, NULL, v_end, 'ok') THEN
    RAISE EXCEPTION 'CHECK FAILED (5b): confidence ''ok'' did not fire';
  END IF;
  IF public.fn_project_needs_attention(FALSE, '{}', v_due, FALSE, NULL, v_end, NULL) THEN
    RAISE EXCEPTION 'CHECK FAILED (5b): a NULL confidence fired -- absence of a forecast must read as ''none''';
  END IF;
  -- A blocked flag outranks a terminal stage: a human explicitly said stop.
  IF NOT public.fn_project_needs_attention(FALSE, ARRAY['blocked'], NULL, TRUE, 'success', NULL, 'none') THEN
    RAISE EXCEPTION 'CHECK FAILED (5b): an explicit block was swallowed by the done-exclusion';
  END IF;
  -- A non-success terminal stage is NOT "done".
  IF NOT public.fn_project_needs_attention(FALSE, '{}', now() - INTERVAL '3 days', TRUE, 'failure', NULL, 'none') THEN
    RAISE EXCEPTION 'CHECK FAILED (5b): a FAILURE-terminal overdue project was treated as finished';
  END IF;
  -- Nothing at all.
  IF public.fn_project_needs_attention(FALSE, '{}', NULL, FALSE, NULL, NULL, 'none') THEN
    RAISE EXCEPTION 'CHECK FAILED (5b): an empty row qualified';
  END IF;

  RAISE NOTICE 'OK (5b): the confidence gate, the flag override and the success-only done-exclusion all behave -- and the same assertions exist in lib/projectExceptions.check.ts';
END $$;


-- ── 6. Prove the production dispatcher was OFF the whole time ──────────────
DO $$
DECLARE v_enabled "char";
BEGIN
  SELECT tgenabled INTO v_enabled FROM pg_trigger
  WHERE tgrelid = 'public.notification_events'::regclass
    AND tgname  = 'trg_dispatch_notification_event';

  IF v_enabled IS NULL THEN
    RAISE EXCEPTION 'CHECK INCONCLUSIVE (6): trg_dispatch_notification_event not found -- cannot prove nothing was POSTed';
  END IF;
  IF v_enabled <> 'D' THEN
    RAISE EXCEPTION 'CHECK FAILED (6): the production dispatch trigger was ENABLED (tgenabled=%) while this check raised project flags', v_enabled;
  END IF;

  RAISE NOTICE 'OK (6): trg_dispatch_notification_event was DISABLED throughout -- zero pg_net POSTs to the hardcoded production url';
END $$;


-- ── 7. Exactly one signature, and the grants survived the DROP ─────────────
DO $$
DECLARE v_sigs INT; v_acl TEXT;
BEGIN
  SELECT COUNT(*) INTO v_sigs FROM pg_proc
  WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (7): rpc_projects_table has % signatures -- PostgREST would answer PGRST203', v_sigs;
  END IF;

  SELECT array_to_string(proacl, ',') INTO v_acl FROM pg_proc
  WHERE proname = 'rpc_projects_table' AND pronamespace = 'public'::regnamespace;
  IF v_acl IS NULL OR position('authenticated=X' IN v_acl) = 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (7): authenticated has no EXECUTE on rpc_projects_table (acl=%) -- the DROP took the grants and they were not re-applied', v_acl;
  END IF;
  IF position('=X' IN COALESCE(split_part(v_acl, ',', 1), '')) > 0 AND split_part(v_acl, ',', 1) LIKE '=%' THEN
    RAISE EXCEPTION 'CHECK FAILED (7): PUBLIC still holds EXECUTE on rpc_projects_table (acl=%)', v_acl;
  END IF;

  RAISE NOTICE 'OK (7): rpc_projects_table has exactly 1 signature and authenticated holds EXECUTE';
END $$;

DO $$ BEGIN
  RAISE NOTICE 'ALL OK: #191 -- one definition of "needs a human". flags[] counts, a finished project is never overdue or overrunning, an overrun fires only at a confidence the server stands behind, and the needs_attention column and the p_blocked filter are the same function.';
END $$;

ROLLBACK;
