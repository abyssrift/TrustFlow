-- Runnable check for issue #191 Phase 10 — projects and portfolios in global
-- search (supabase/migrations/20260808_global_search_projects_portfolios.sql).
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/20260808_global_search_projects_portfolios_check.sql
--
-- Wrapped in BEGIN/ROLLBACK: builds throwaway projects/portfolios inside an
-- EXISTING seeded company, reusing real users, asserts, then always rolls back.
--
-- ── WHY THIS CHECK EXISTS ──────────────────────────────────────────────────
-- `rpc_global_search` is SECURITY DEFINER (prosecdef = t). RLS does not run
-- inside it, so `projects_select` -- which is literally `fn_project_accessible(id)`
-- and default-deny -- protects NOTHING here. Every project row search returns
-- has to be re-gated by hand, inside the function body.
--
-- Search is the worst place to get this wrong: it hands back rows the user
-- never had on screen, by NAME, across the whole company, from three keystrokes.
-- That is the exact shape of #185/#186, twice fixed.
--
-- And a portfolio is not a separate secret. `portfolios_select` is only
-- company-scoped, so a portfolio row carries no per-project gate of its own --
-- surfacing "Statutory Financial Statement Audit batch" to someone who can
-- reach none of its six projects still tells them that engagement exists.
--
-- The four assertions below are therefore two positives and two negatives, and
-- then (5) FLIPS the negatives by granting `project.view_all`. Without (5) the
-- negatives would also pass if the whole branch were dead or blanket-denied --
-- (5) is what proves `fn_project_accessible` is the thing doing the work.
--
-- ── WHY THIS CANNOT SPAM PRODUCTION ────────────────────────────────────────
-- Inserting projects fires the project notification triggers, which write
-- notification_events, which carries trg_dispatch_notification_event -- a pg_net
-- POST to a HARDCODED PRODUCTION url. That trigger is disabled BY NAME for the
-- duration. ALTER TABLE is transactional so ROLLBACK restores it even if an
-- assertion raises, and (6) re-reads pg_trigger to prove it was really off.

BEGIN;

ALTER TABLE public.notification_events DISABLE TRIGGER trg_dispatch_notification_event;

CREATE TEMP TABLE gsp_ctx (
  company      UUID,
  owner_user   UUID,
  u_member     UUID,   -- the actor: NO project.view_all, owns only p_mine
  token        TEXT,   -- unique word planted in every fixture name
  pipeline     UUID,
  stage_open   UUID,
  pf_reachable UUID,   -- portfolio holding one project the actor owns  -> VISIBLE
  pf_hidden    UUID,   -- portfolio holding only unreachable projects   -> HIDDEN
  p_mine       UUID,   -- actor is owner_id                             -> VISIBLE
  p_hidden     UUID,   -- someone else's, no assignments                -> HIDDEN
  p_in_reach   UUID,   -- actor-owned, inside pf_reachable
  p_in_hidden  UUID    -- unreachable, inside pf_hidden
);
GRANT SELECT ON gsp_ctx TO authenticated;

DO $$
DECLARE
  v_company UUID; v_owner UUID; v_member UUID; v_token TEXT;
  v_pipeline UUID; v_open UUID;
  v_pf_ok UUID; v_pf_no UUID;
  v_p_mine UUID; v_p_hidden UUID; v_p_in_ok UUID; v_p_in_no UUID;
  v_va INT;
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

  SELECT id INTO v_owner FROM public.users WHERE company_id = v_company AND is_owner = TRUE LIMIT 1;

  -- The actor must NOT already hold project.view_all, or (2)/(4) prove nothing
  -- and (5) has nothing to flip.
  SELECT u.id INTO v_member FROM public.users u
  WHERE u.company_id = v_company AND u.is_owner = FALSE
    AND u.deleted_at IS NULL AND u.is_active
    AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = u.id AND ur.revoked_at IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions pm ON pm.id = rp.permission_id
      WHERE ur.user_id = u.id AND ur.revoked_at IS NULL AND pm.key = 'project.view_all')
  ORDER BY u.id LIMIT 1;
  IF v_member IS NULL THEN
    RAISE EXCEPTION 'Every member in this company already holds project.view_all -- the negative assertions would be vacuous.';
  END IF;

  -- A token no real row can contain, so "found" always means "found the fixture".
  v_token := 'zqxsrch' || replace(gen_random_uuid()::text, '-', '');

  INSERT INTO public.pipelines (company_id, name, subject_kind)
  VALUES (v_company, 'GSP Check Pipeline ' || v_token, 'project') RETURNING id INTO v_pipeline;
  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial)
  VALUES (v_pipeline, 'Open', 0, TRUE) RETURNING id INTO v_open;

  INSERT INTO public.portfolios (company_id, name, created_by)
  VALUES (v_company, v_token || ' reachable batch', v_owner) RETURNING id INTO v_pf_ok;
  INSERT INTO public.portfolios (company_id, name, created_by)
  VALUES (v_company, v_token || ' hidden batch', v_owner) RETURNING id INTO v_pf_no;

  -- Actor-owned => fn_project_accessible returns true on the owner branch.
  INSERT INTO public.projects (company_id, name, pipeline_id, current_stage_id, owner_id, created_by)
  VALUES (v_company, v_token || ' my standalone project', v_pipeline, v_open, v_member, v_owner)
  RETURNING id INTO v_p_mine;

  -- Owned by the company owner, zero tasks => zero assignments => unreachable
  -- to anyone without project.view_all.
  INSERT INTO public.projects (company_id, name, pipeline_id, current_stage_id, owner_id, created_by)
  VALUES (v_company, v_token || ' someone elses project', v_pipeline, v_open, v_owner, v_owner)
  RETURNING id INTO v_p_hidden;

  INSERT INTO public.projects (company_id, name, pipeline_id, current_stage_id, owner_id, created_by, portfolio_id)
  VALUES (v_company, v_token || ' inside reachable batch', v_pipeline, v_open, v_member, v_owner, v_pf_ok)
  RETURNING id INTO v_p_in_ok;

  INSERT INTO public.projects (company_id, name, pipeline_id, current_stage_id, owner_id, created_by, portfolio_id)
  VALUES (v_company, v_token || ' inside hidden batch', v_pipeline, v_open, v_owner, v_owner, v_pf_no)
  RETURNING id INTO v_p_in_no;

  INSERT INTO gsp_ctx VALUES (v_company, v_owner, v_member, v_token, v_pipeline, v_open,
                              v_pf_ok, v_pf_no, v_p_mine, v_p_hidden, v_p_in_ok, v_p_in_no);

  SELECT COUNT(*) INTO v_va FROM public.projects
  WHERE id IN (v_p_mine, v_p_hidden, v_p_in_ok, v_p_in_no) AND search_tsv IS NULL;
  IF v_va <> 0 THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: % fixture project(s) have a NULL search_tsv -- the generated column is not maintained', v_va;
  END IF;
END $$;


-- ── 0. The index really covers the fixture (as the definer, no ACL involved)
DO $$
DECLARE c RECORD; v_n INT;
BEGIN
  SELECT * INTO c FROM gsp_ctx;
  SELECT COUNT(*) INTO v_n FROM public.projects
  WHERE search_tsv @@ to_tsquery('english', c.token) AND deleted_at IS NULL;
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: projects.search_tsv matches % of 4 fixture rows -- the tsvector does not index the name', v_n;
  END IF;
  SELECT COUNT(*) INTO v_n FROM public.portfolios WHERE search_tsv @@ to_tsquery('english', c.token);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: portfolios.search_tsv matches % of 2 fixture rows', v_n;
  END IF;
  RAISE NOTICE 'OK (0): both generated tsvectors index the fixture -- anything missing below is the ACL, not the index';
END $$;


-- ── 1..4 through the RPC, as the actor ─────────────────────────────────────
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c RECORD; v_hits JSONB; v_types TEXT[];
  v_seen_mine BOOL; v_seen_hidden BOOL; v_seen_pf_ok BOOL; v_seen_pf_no BOOL;
BEGIN
  SELECT * INTO c FROM gsp_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_member::text, true);

  v_hits := public.rpc_global_search(p_terms := c.token, p_limit := 200);

  SELECT array_agg(DISTINCT e->>'type') INTO v_types FROM jsonb_array_elements(v_hits) e;

  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_hits) e WHERE (e->>'id')::uuid = c.p_mine)      INTO v_seen_mine;
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_hits) e WHERE (e->>'id')::uuid = c.p_hidden)    INTO v_seen_hidden;
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_hits) e WHERE (e->>'id')::uuid = c.pf_reachable) INTO v_seen_pf_ok;
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_hits) e WHERE (e->>'id')::uuid = c.pf_hidden)   INTO v_seen_pf_no;

  -- (1) POSITIVE: the branch exists at all.
  IF NOT v_seen_mine THEN
    RAISE EXCEPTION 'CHECK FAILED (1): a project the actor OWNS is missing from search (types returned: %) -- the project branch is dead or over-gated', v_types;
  END IF;
  IF NOT ('project' = ANY (v_types)) THEN
    RAISE EXCEPTION 'CHECK FAILED (1): no row came back typed ''project''';
  END IF;
  RAISE NOTICE 'OK (1): an accessible project IS returned, typed ''project''';

  -- (2) NEGATIVE: fn_project_accessible re-applied inside SECURITY DEFINER.
  IF v_seen_hidden THEN
    RAISE EXCEPTION 'CHECK FAILED (2): LEAK -- search returned a project the actor cannot access. rpc_global_search is SECURITY DEFINER; projects_select never ran.';
  END IF;
  RAISE NOTICE 'OK (2): an inaccessible project is NOT returned -- fn_project_accessible is applied inside the function';

  -- (3) POSITIVE: a portfolio with at least one reachable project.
  IF NOT v_seen_pf_ok THEN
    RAISE EXCEPTION 'CHECK FAILED (3): a portfolio holding a project the actor owns is missing from search -- the portfolio gate is too tight';
  END IF;
  IF NOT ('portfolio' = ANY (v_types)) THEN
    RAISE EXCEPTION 'CHECK FAILED (3): no row came back typed ''portfolio''';
  END IF;
  RAISE NOTICE 'OK (3): a portfolio with >= 1 reachable project IS returned, typed ''portfolio''';

  -- (4) NEGATIVE: the #185/#186 shape. The name alone is the leak.
  IF v_seen_pf_no THEN
    RAISE EXCEPTION 'CHECK FAILED (4): LEAK -- a portfolio whose projects are ALL inaccessible was returned by name. portfolios_select is only company-scoped, so nothing else stops this.';
  END IF;
  RAISE NOTICE 'OK (4): a portfolio with zero reachable projects does NOT appear -- its name never reaches the actor';
END $$;


-- ── 5. Flip it: grant project.view_all, the same two rows must appear ───────
-- Without this, (2) and (4) would also pass if the branches were blanket-denied
-- or absent. This is what proves the predicate is the thing deciding.
RESET ROLE;

DO $$
DECLARE c RECORD; v_perm UUID;
BEGIN
  SELECT * INTO c FROM gsp_ctx;
  SELECT id INTO v_perm FROM public.permissions WHERE key = 'project.view_all';
  IF v_perm IS NULL THEN
    RAISE EXCEPTION 'permissions.key = ''project.view_all'' not found -- schema drift.';
  END IF;
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT DISTINCT ur.role_id, v_perm FROM public.user_roles ur
  WHERE ur.user_id = c.u_member AND ur.revoked_at IS NULL
  ON CONFLICT DO NOTHING;
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE c RECORD; v_hits JSONB; v_seen_hidden BOOL; v_seen_pf_no BOOL;
BEGIN
  SELECT * INTO c FROM gsp_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_member::text, true);

  v_hits := public.rpc_global_search(p_terms := c.token, p_limit := 200);
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_hits) e WHERE (e->>'id')::uuid = c.p_hidden)  INTO v_seen_hidden;
  SELECT EXISTS (SELECT 1 FROM jsonb_array_elements(v_hits) e WHERE (e->>'id')::uuid = c.pf_hidden) INTO v_seen_pf_no;

  IF NOT v_seen_hidden THEN
    RAISE EXCEPTION 'CHECK FAILED (5): with project.view_all the previously hidden project STILL does not appear -- (2) passed for the wrong reason (blanket deny / dead branch)';
  END IF;
  IF NOT v_seen_pf_no THEN
    RAISE EXCEPTION 'CHECK FAILED (5): with project.view_all the previously hidden portfolio STILL does not appear -- (4) passed for the wrong reason';
  END IF;
  RAISE NOTICE 'OK (5): granting project.view_all makes exactly the two hidden rows appear -- (2) and (4) were fn_project_accessible, not a blanket gate';
END $$;


-- ── 5b. The parser's type filter reaches the new branches ──────────────────
DO $$
DECLARE c RECORD; v_types TEXT[];
BEGIN
  SELECT * INTO c FROM gsp_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.u_member::text, true);

  SELECT array_agg(DISTINCT e->>'type') INTO v_types
  FROM jsonb_array_elements(public.rpc_global_search(p_terms := c.token, p_types := ARRAY['project'], p_limit := 200)) e;
  IF v_types IS DISTINCT FROM ARRAY['project'] THEN
    RAISE EXCEPTION 'CHECK FAILED (5b): p_types := {project} returned types % -- what hooks/useSearchQuery.ts sends for "audit projects" does not narrow', v_types;
  END IF;

  SELECT array_agg(DISTINCT e->>'type') INTO v_types
  FROM jsonb_array_elements(public.rpc_global_search(p_terms := c.token, p_types := ARRAY['portfolio'], p_limit := 200)) e;
  IF v_types IS DISTINCT FROM ARRAY['portfolio'] THEN
    RAISE EXCEPTION 'CHECK FAILED (5b): p_types := {portfolio} returned types %', v_types;
  END IF;

  RAISE NOTICE 'OK (5b): p_types = {project} / {portfolio} narrow exactly, so the parser keywords land';
END $$;

RESET ROLE;


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
    RAISE EXCEPTION 'CHECK FAILED (6): the production dispatch trigger was ENABLED (tgenabled=%) while this check inserted projects', v_enabled;
  END IF;
  RAISE NOTICE 'OK (6): trg_dispatch_notification_event was DISABLED throughout -- zero pg_net POSTs to the hardcoded production url';
END $$;


-- ── 7. Exactly one signature, and authenticated still holds EXECUTE ────────
DO $$
DECLARE v_sigs INT; v_acl TEXT; v_secdef BOOL;
BEGIN
  SELECT COUNT(*) INTO v_sigs FROM pg_proc
  WHERE proname = 'rpc_global_search' AND pronamespace = 'public'::regnamespace;
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (7): rpc_global_search has % signatures -- PostgREST would answer PGRST203', v_sigs;
  END IF;

  SELECT array_to_string(proacl, ','), prosecdef INTO v_acl, v_secdef FROM pg_proc
  WHERE proname = 'rpc_global_search' AND pronamespace = 'public'::regnamespace;
  IF v_acl IS NULL OR position('authenticated=X' IN v_acl) = 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (7): authenticated has no EXECUTE on rpc_global_search (acl=%)', v_acl;
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'CHECK INCONCLUSIVE (7): rpc_global_search is no longer SECURITY DEFINER -- the premise of this whole check changed, re-read it';
  END IF;

  RAISE NOTICE 'OK (7): 1 signature, authenticated holds EXECUTE, still SECURITY DEFINER (so the in-body gate above is still load-bearing)';
END $$;

DO $$ BEGIN
  RAISE NOTICE 'ALL OK: #191 Phase 10 -- projects and portfolios are searchable, and rpc_global_search re-applies fn_project_accessible itself. An inaccessible project never appears; a portfolio whose projects are all inaccessible never appears BY NAME either.';
END $$;

ROLLBACK;
