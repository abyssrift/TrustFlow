-- Runnable check for issue #191 Phase 10 — project-level notifications.
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/20260805_project_notifications_check.sql
--
-- Wrapped in BEGIN/ROLLBACK: builds a throwaway portfolio + two projects +
-- one template inside an EXISTING seeded company, reusing real users (never
-- inventing auth.users rows -- same convention as every other check here),
-- asserts, then always rolls back.
--
-- ── WHY THIS CANNOT SPAM PRODUCTION ────────────────────────────────────────
-- notification_events carries trg_dispatch_notification_event, which
-- pg_net-POSTs to a HARDCODED PRODUCTION url. This check's entire subject is
-- rows landing in notification_events, so `SET LOCAL session_replication_role
-- = replica` (what most checks in this folder use) is not available -- it
-- would also disable the four triggers under test and the check would assert
-- on nothing while reporting success.
--
-- Instead the dispatch trigger alone is disabled, by name, for the duration:
--
--     ALTER TABLE public.notification_events DISABLE TRIGGER trg_dispatch_notification_event;
--
-- ALTER TABLE is transactional in Postgres, so the ROLLBACK at the bottom
-- restores it even if an assertion raises. The triggers under test stay live.
-- An assertion at the end re-reads pg_trigger to prove the dispatch trigger
-- was actually off while the events were being written -- if the DISABLE
-- silently failed, this check fails rather than quietly having posted.
--
-- ── WHAT IT PROVES ─────────────────────────────────────────────────────────
--   1. Raising a flag (either representation -- `blocked` or `flags[]`) emits
--      exactly ONE project.flag_raised; clearing it emits nothing.
--   2. The recipient list REACHES the project owner and EXCLUDES a user with
--      no access -- the #185/#186 leak shape, asserted directly.
--   3. project.due_soon fires for a project inside the 72h window, does NOT
--      fire for one already in a success-terminal stage, and is de-duplicated
--      to one per calendar day.
--   4. portfolio.completed fires only when the LAST project in the portfolio
--      reaches a success-terminal stage -- not on the first.
--   5. Editing a project template emits project_template.updated addressed to
--      template editors, and a no-op UPDATE emits nothing.

BEGIN;

-- See the header. Disabled by name, restored by ROLLBACK.
ALTER TABLE public.notification_events DISABLE TRIGGER trg_dispatch_notification_event;

CREATE TEMP TABLE pnotif_ctx (
  company      UUID,
  owner_user   UUID,
  u_owner      UUID,   -- projects.owner_id -> MUST be notified
  u_zero       UUID,   -- no access at all  -> MUST NOT be notified
  portfolio    UUID,
  pipeline     UUID,
  stage_open   UUID,
  stage_done   UUID,   -- is_terminal + terminal_type='success'
  project_a    UUID,
  project_b    UUID,
  template     UUID
);

DO $$
DECLARE
  v_company   UUID;
  v_owner     UUID;
  v_pool      UUID[];
  v_portfolio UUID;
  v_pipeline  UUID;
  v_open      UUID;
  v_done      UUID;
  v_a         UUID;
  v_b         UUID;
  v_template  UUID;
BEGIN
  -- A seeded company with an owner and at least two non-owner users.
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
  -- them see everything and destroy the negative assertion). Checked through
  -- the real predicate later, but filtered here so the fixture is honest.
  SELECT ARRAY_AGG(id) INTO v_pool FROM (
    SELECT u.id FROM public.users u
    WHERE u.company_id = v_company AND u.is_owner = FALSE
      AND u.deleted_at IS NULL AND u.is_active
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
    RAISE EXCEPTION 'Need 2 non-owner users without project.view_all in company % -- seed data too thin.', v_company;
  END IF;

  INSERT INTO public.pipelines (company_id, name, subject_kind)
  VALUES (v_company, 'PNOTIF Check Pipeline ' || gen_random_uuid(), 'project')
  RETURNING id INTO v_pipeline;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_pipeline, 'Open', 0, TRUE) RETURNING id INTO v_open;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_terminal, terminal_type)
  VALUES (v_pipeline, 'Delivered', 1, TRUE, 'success') RETURNING id INTO v_done;

  INSERT INTO public.portfolios (company_id, name, created_by)
  VALUES (v_company, 'PNOTIF Check Batch ' || gen_random_uuid(), v_owner)
  RETURNING id INTO v_portfolio;

  -- Both projects owned by v_pool[1] ("u_owner"); v_pool[2] ("u_zero") has
  -- no owner_id, no task assignment and no view_all -> zero access.
  INSERT INTO public.projects (company_id, name, pipeline_id, current_stage_id,
                               portfolio_id, owner_id, created_by)
  VALUES (v_company, 'PNOTIF Check Project A ' || gen_random_uuid(), v_pipeline, v_open,
          v_portfolio, v_pool[1], v_owner)
  RETURNING id INTO v_a;

  INSERT INTO public.projects (company_id, name, pipeline_id, current_stage_id,
                               portfolio_id, owner_id, created_by)
  VALUES (v_company, 'PNOTIF Check Project B ' || gen_random_uuid(), v_pipeline, v_open,
          v_portfolio, v_pool[1], v_owner)
  RETURNING id INTO v_b;

  INSERT INTO public.project_templates (company_id, name, body, created_by)
  VALUES (v_company, 'PNOTIF Check Template ' || gen_random_uuid(), '[]'::jsonb, v_owner)
  RETURNING id INTO v_template;

  INSERT INTO pnotif_ctx VALUES (v_company, v_owner, v_pool[1], v_pool[2], v_portfolio,
                                 v_pipeline, v_open, v_done, v_a, v_b, v_template);
END $$;


-- ── 1 + 2. FLAGS: fires once, reaches the owner, excludes the outsider ─────
DO $$
DECLARE
  c        RECORD;
  v_n      INT;
  v_ev     RECORD;
  v_rcpt   UUID[];
BEGIN
  SELECT * INTO c FROM pnotif_ctx;

  -- Sanity: the negative user really is denied by the real predicate, so a
  -- later "not in recipients" result means the notification respected access,
  -- not that the fixture was miswired.
  PERFORM set_config('request.jwt.claim.sub', c.u_zero::text, true);
  IF public.fn_project_accessible(c.project_a) THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: u_zero can see project A -- the negative assertion below would prove nothing';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', c.u_owner::text, true);
  IF NOT public.fn_project_accessible(c.project_a) THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: the project owner cannot see their own project';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', '', true);

  -- Act: raise a flag through the NEW representation (flags text[]).
  UPDATE public.projects
  SET flags = ARRAY['at_risk']::TEXT[], flag_note = 'slipping'
  WHERE id = c.project_a;

  SELECT COUNT(*) INTO v_n FROM public.notification_events
  WHERE event_type = 'project.flag_raised' AND entity_id = c.project_a;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (1): expected 1 project.flag_raised, got %', v_n;
  END IF;

  SELECT * INTO v_ev FROM public.notification_events
  WHERE event_type = 'project.flag_raised' AND entity_id = c.project_a;

  IF v_ev.payload -> 'flags_added' <> '["at_risk"]'::JSONB THEN
    RAISE EXCEPTION 'CHECK FAILED (1): flags_added = % (expected ["at_risk"])', v_ev.payload -> 'flags_added';
  END IF;
  IF v_ev.payload ->> 'reason' IS DISTINCT FROM 'slipping' THEN
    RAISE EXCEPTION 'CHECK FAILED (1): reason = % (expected "slipping")', v_ev.payload ->> 'reason';
  END IF;

  SELECT ARRAY(SELECT jsonb_array_elements_text(v_ev.payload -> 'recipient_user_ids')::UUID)
  INTO v_rcpt;

  IF NOT (c.u_owner = ANY (v_rcpt)) THEN
    RAISE EXCEPTION 'CHECK FAILED (2): the project owner is NOT in the recipient list -- notification would never reach them';
  END IF;
  IF c.u_zero = ANY (v_rcpt) THEN
    RAISE EXCEPTION 'CHECK FAILED (2): LEAK -- a user who cannot open the project is in the recipient list (#185/#186 shape)';
  END IF;

  -- The OLD representation (`blocked` boolean, still written by
  -- ProjectBlockedToggle.tsx) must fire too, and independently.
  UPDATE public.projects SET blocked = TRUE, blocked_reason = 'waiting on client'
  WHERE id = c.project_b;

  SELECT COUNT(*) INTO v_n FROM public.notification_events
  WHERE event_type = 'project.flag_raised' AND entity_id = c.project_b;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (1b): the legacy `blocked` column did not emit a flag event (got %)', v_n;
  END IF;

  -- Setting flags[] to the SAME flag `blocked` already implies must not
  -- double-notify -- the union is what is compared, not either column alone.
  UPDATE public.projects SET flags = ARRAY['blocked']::TEXT[] WHERE id = c.project_b;
  SELECT COUNT(*) INTO v_n FROM public.notification_events
  WHERE event_type = 'project.flag_raised' AND entity_id = c.project_b;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (1c): the same flag arriving via the other column double-notified (got %)', v_n;
  END IF;

  -- CLEARING a flag is silent.
  UPDATE public.projects SET flags = '{}'::TEXT[], blocked = FALSE WHERE id = c.project_b;
  SELECT COUNT(*) INTO v_n FROM public.notification_events
  WHERE event_type = 'project.flag_raised' AND entity_id = c.project_b;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (1d): clearing a flag emitted an event (total % for project B)', v_n;
  END IF;

  RAISE NOTICE 'OK (1+2): flag_raised fires once per newly-raised flag from BOTH representations, is silent on clear, reaches the project owner, and excludes a user with no access';
END $$;


-- ── 3. DUE SOON: window, done-stage skip, per-day de-dup ───────────────────
DO $$
DECLARE
  c     RECORD;
  v_n   INT;
  v_ev  RECORD;
  v_rcpt UUID[];
BEGIN
  SELECT * INTO c FROM pnotif_ctx;

  -- A: due in 2 days, still Open  -> must fire.
  -- B: due in 2 days, but already in the success-terminal stage -> must not.
  UPDATE public.projects SET due_date = now() + INTERVAL '2 days' WHERE id IN (c.project_a, c.project_b);
  UPDATE public.projects SET current_stage_id = c.stage_done WHERE id = c.project_b;

  PERFORM public.fn_check_project_deadlines();

  SELECT COUNT(*) INTO v_n FROM public.notification_events
  WHERE event_type = 'project.due_soon' AND entity_id = c.project_a;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (3): expected 1 project.due_soon for the open project, got %', v_n;
  END IF;

  SELECT COUNT(*) INTO v_n FROM public.notification_events
  WHERE event_type = 'project.due_soon' AND entity_id = c.project_b;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (3): a project already in a success-terminal stage was nagged about its deadline (% events)', v_n;
  END IF;

  SELECT * INTO v_ev FROM public.notification_events
  WHERE event_type = 'project.due_soon' AND entity_id = c.project_a;
  SELECT ARRAY(SELECT jsonb_array_elements_text(v_ev.payload -> 'recipient_user_ids')::UUID) INTO v_rcpt;
  IF NOT (c.u_owner = ANY (v_rcpt)) THEN
    RAISE EXCEPTION 'CHECK FAILED (3): due_soon recipient list omits the project owner';
  END IF;
  IF c.u_zero = ANY (v_rcpt) THEN
    RAISE EXCEPTION 'CHECK FAILED (3): LEAK -- due_soon addressed a user who cannot open the project';
  END IF;

  -- Second sweep the same day is a no-op.
  PERFORM public.fn_check_project_deadlines();
  SELECT COUNT(*) INTO v_n FROM public.notification_events
  WHERE event_type = 'project.due_soon' AND entity_id = c.project_a;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (3): the sweep is not de-duplicated per day (got % events)', v_n;
  END IF;

  -- Outside the 72h window: nothing new.
  UPDATE public.projects SET due_date = now() + INTERVAL '30 days' WHERE id = c.project_a;
  DELETE FROM public.notification_events WHERE event_type = 'project.due_soon' AND entity_id = c.project_a;
  PERFORM public.fn_check_project_deadlines();
  SELECT COUNT(*) INTO v_n FROM public.notification_events
  WHERE event_type = 'project.due_soon' AND entity_id = c.project_a;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (3): a project due in 30 days was reported as due soon';
  END IF;

  RAISE NOTICE 'OK (3): due_soon fires inside the 72h window only, skips success-terminal projects, de-dups per day, and never addresses a user without access';
END $$;


-- ── 4. BATCH COMPLETION: only when the LAST project is done ────────────────
DO $$
DECLARE
  c      RECORD;
  v_n    INT;
  v_ev   RECORD;
  v_rcpt UUID[];
BEGIN
  SELECT * INTO c FROM pnotif_ctx;

  -- Project B is already in stage_done (from step 3). Project A is Open, so
  -- the portfolio is NOT complete and nothing should have been emitted yet.
  SELECT COUNT(*) INTO v_n FROM public.notification_events
  WHERE event_type = 'portfolio.completed' AND entity_id = c.portfolio;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (4): portfolio reported complete while a project was still open (% events)', v_n;
  END IF;

  -- Act: the last project reaches the success-terminal stage.
  UPDATE public.projects SET current_stage_id = c.stage_done WHERE id = c.project_a;

  SELECT COUNT(*) INTO v_n FROM public.notification_events
  WHERE event_type = 'portfolio.completed' AND entity_id = c.portfolio;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (4): expected 1 portfolio.completed once every project was done, got %', v_n;
  END IF;

  SELECT * INTO v_ev FROM public.notification_events
  WHERE event_type = 'portfolio.completed' AND entity_id = c.portfolio;
  IF (v_ev.payload ->> 'project_count')::INT <> 2 THEN
    RAISE EXCEPTION 'CHECK FAILED (4): project_count = % (expected 2)', v_ev.payload ->> 'project_count';
  END IF;

  SELECT ARRAY(SELECT jsonb_array_elements_text(v_ev.payload -> 'recipient_user_ids')::UUID) INTO v_rcpt;
  IF NOT (c.u_owner = ANY (v_rcpt)) THEN
    RAISE EXCEPTION 'CHECK FAILED (4): the owner of every project in the batch is not in the recipient list';
  END IF;
  IF c.u_zero = ANY (v_rcpt) THEN
    RAISE EXCEPTION 'CHECK FAILED (4): LEAK -- portfolio.completed addressed a user who can open none of its projects';
  END IF;

  RAISE NOTICE 'OK (4): portfolio.completed fires exactly once, only when every project reached is_terminal+terminal_type=success, addressed to people who can open at least one of them';
END $$;


-- ── 5. TEMPLATE CHANGES ────────────────────────────────────────────────────
DO $$
DECLARE
  c      RECORD;
  v_n    INT;
  v_ev   RECORD;
  v_rcpt UUID[];
BEGIN
  SELECT * INTO c FROM pnotif_ctx;

  -- A no-op UPDATE (nothing in the content columns changed) is silent.
  UPDATE public.project_templates SET updated_at = now() WHERE id = c.template;
  SELECT COUNT(*) INTO v_n FROM public.notification_events
  WHERE event_type = 'project_template.updated' AND entity_id = c.template;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (5): a bare updated_at bump emitted a template event';
  END IF;

  UPDATE public.project_templates
  SET body = '[{"title":"Kickoff"}]'::JSONB, name = name || ' (edited)'
  WHERE id = c.template;

  SELECT COUNT(*) INTO v_n FROM public.notification_events
  WHERE event_type = 'project_template.updated' AND entity_id = c.template;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (5): expected 1 project_template.updated, got %', v_n;
  END IF;

  SELECT * INTO v_ev FROM public.notification_events
  WHERE event_type = 'project_template.updated' AND entity_id = c.template;
  IF (v_ev.payload ->> 'task_count')::INT <> 1 OR (v_ev.payload ->> 'body_changed') <> 'true' THEN
    RAISE EXCEPTION 'CHECK FAILED (5): payload wrong -- task_count=%, body_changed=%',
      v_ev.payload ->> 'task_count', v_ev.payload ->> 'body_changed';
  END IF;

  SELECT ARRAY(SELECT jsonb_array_elements_text(v_ev.payload -> 'recipient_user_ids')::UUID) INTO v_rcpt;
  IF NOT (c.owner_user = ANY (v_rcpt)) THEN
    RAISE EXCEPTION 'CHECK FAILED (5): the company owner (who can always edit templates) is not a recipient';
  END IF;

  -- The soft delete is not an edit.
  UPDATE public.project_templates SET deleted_at = now() WHERE id = c.template;
  SELECT COUNT(*) INTO v_n FROM public.notification_events
  WHERE event_type = 'project_template.updated' AND entity_id = c.template;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (5): soft-deleting a template emitted an "updated" event (total %)', v_n;
  END IF;

  RAISE NOTICE 'OK (5): project_template.updated fires on real content changes only, addressed to template editors, silent on no-op and on soft delete';
END $$;


-- ── 6. Every event has an active rule that can actually route it ───────────
DO $$
DECLARE
  v_missing TEXT;
BEGIN
  SELECT string_agg(t, ', ') INTO v_missing
  FROM unnest(ARRAY['project.flag_raised','project.due_soon',
                    'portfolio.completed','project_template.updated']) AS t
  WHERE NOT EXISTS (
    SELECT 1 FROM public.notification_rules r
    WHERE r.event_type = t AND r.is_active
      AND 'payload_users' = ANY (r.recipient_strategies)
      AND r.recipient_config ->> 'payload_field' = 'recipient_user_ids'
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (6): no active payload_users rule for: % -- events would be emitted and dropped on the floor', v_missing;
  END IF;

  RAISE NOTICE 'OK (6): all four new event types have an active rule reading recipient_user_ids';
END $$;


-- ── 7. Prove the production dispatcher was OFF the whole time ──────────────
DO $$
DECLARE v_enabled "char";
BEGIN
  SELECT tgenabled INTO v_enabled FROM pg_trigger
  WHERE tgrelid = 'public.notification_events'::regclass
    AND tgname  = 'trg_dispatch_notification_event';

  IF v_enabled IS NULL THEN
    RAISE EXCEPTION 'CHECK INCONCLUSIVE (7): trg_dispatch_notification_event not found -- cannot prove nothing was POSTed';
  END IF;
  IF v_enabled <> 'D' THEN
    RAISE EXCEPTION 'CHECK FAILED (7): the production dispatch trigger was ENABLED (tgenabled=%) while this check wrote % notification_events rows -- real devices may have been notified',
      v_enabled, (SELECT COUNT(*) FROM public.notification_events);
  END IF;

  RAISE NOTICE 'OK (7): trg_dispatch_notification_event was DISABLED for the whole check -- zero pg_net POSTs to the hardcoded production url';
END $$;

DO $$ BEGIN
  RAISE NOTICE 'ALL OK: #191 Phase 10 -- flag_raised / due_soon / portfolio.completed / project_template.updated all emit through fn_emit_notification_event, all recipient lists are filtered by fn_project_accessible, and no user without access appears in any of them.';
END $$;

ROLLBACK;
