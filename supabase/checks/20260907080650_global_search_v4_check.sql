-- Runnable check for issue #318 ? similarity ("did you mean") search in
-- rpc_global_search (supabase/migrations/20260907080650_global_search_v4.sql).
--
-- Not a migration ? lives outside supabase/migrations so it never auto-applies.
-- Run by hand against a DEV/STAGING database that already has the v4 migration:
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/20260907080650_global_search_v4_check.sql
--
-- Wrapped in BEGIN/ROLLBACK: creates a throwaway company and users, seeds
-- throwaway tasks / a report / a comment, asserts, and rolls back.
--
-- ?? WHAT REGRESSION THIS LOCKS DOWN ????????????????????????????????????????
-- Before v4, `rpc_global_search` took ONE `ORDER BY score DESC LIMIT v_limit*3`
-- over the whole candidate pool *before* the ACL CTE. In any tenant with
-- >= v_limit*3 exact (tsvector) hits for a term, every fuzzy ("did you mean")
-- row fell outside that slice and ACL never saw it ? so once ACL removed the
-- exact hits the caller couldn't reach, the caller got an EMPTY result instead
-- of the fuzzy suggestion. Plus: fuzzy and exact scores were on different,
-- meaningless scales, and reports / comments / files_index had no fuzzy path.
--
-- (1) A wall of ACL-invisible exact hits (>= v_limit*3) does NOT starve the
--     one visible fuzzy row ? it still comes back.
-- (2) The same holds for a type-scoped query (parser emits p_types).
-- (3) For one entity type, an exact hit ranks ABOVE a fuzzy hit, and the two
--     land in their score bands (exact >= 1.0, fuzzy in [0.35, 1.0)).
-- (4) A report comes back on a typo'd term (fuzzy, not just ILIKE substring).
-- (5) A comment comes back on a typo'd term (fuzzy, not just ILIKE substring).
--
-- ?? WHY THIS CANNOT SPAM PRODUCTION ???????????????????????????????????????
-- Seeding tasks / comments fires the notification triggers, which write
-- notification_events, which carries trg_dispatch_notification_event ? a pg_net
-- POST to a HARDCODED PRODUCTION url. That trigger, and the two insert-notify
-- triggers, are disabled BY NAME for the duration. ALTER TABLE is
-- transactional, so ROLLBACK restores them even if an assertion raises; (6)
-- re-reads pg_trigger to prove the dispatcher was really off.

BEGIN;

ALTER TABLE public.notification_events DISABLE TRIGGER trg_dispatch_notification_event;
ALTER TABLE public.tasks              DISABLE TRIGGER trg_tasks_notify_insert;
ALTER TABLE public.task_comments      DISABLE TRIGGER trg_task_comments_notify;

CREATE TEMP TABLE gs318_ctx (
  company    UUID,
  owner_user UUID,   -- sees everything
  member     UUID,   -- non-owner, NO *.view_all ? sees only its own tasks
  mark       TEXT,   -- made-up marker word => the exact pool is 100% seeded
  fuzzy_task UUID,   -- member-owned, title trigram-matches but does NOT tsmatch
  exact_one  UUID,   -- one of the owner-owned exact tasks (invisible to member)
  report_id  UUID,
  comment_id UUID,
  upwork_task UUID   -- owner-owned; title carries the short word `upwork`, reached only by the 1-letter typo `upwark`
);
GRANT SELECT ON gs318_ctx TO authenticated;

DO $$
DECLARE
  v_company UUID; v_owner UUID; v_member UUID;
  v_mark TEXT := 'zzmark' || replace(gen_random_uuid()::text, '-', '');
  v_fuzzy UUID; v_exact UUID; v_report UUID; v_comment UUID; v_upwork UUID;
BEGIN
  -- Create an isolated company with an owner and a non-owner member. The
  -- member has no role rows, so it has no *.view_all permission and must be
  -- blind to the owner-owned exact tasks in assertion (1).
  v_owner := gen_random_uuid();
  v_member := gen_random_uuid();
  INSERT INTO public.companies (name, slug)
  VALUES ('ZZ Global Search ' || v_mark, 'zz-global-search-' || lower(v_mark))
  RETURNING id INTO v_company;

  INSERT INTO auth.users (id, email)
  VALUES
    (v_owner, 'zz-global-search-owner-' || v_owner || '@test.local'),
    (v_member, 'zz-global-search-member-' || v_member || '@test.local');
  INSERT INTO public.users (id, company_id, email, is_owner, is_active)
  VALUES
    (v_owner, v_company, 'zz-global-search-owner-' || v_owner || '@test.local', true, true),
    (v_member, v_company, 'zz-global-search-member-' || v_member || '@test.local', false, true);

  -- 15 exact tasks (= v_limit*3 when the assertions call with p_limit := 5),
  -- owned by the OWNER with no pipeline => task_list_visible() is FALSE for the
  -- member (null-pipeline branch needs creator/manager/task.view_all).
  -- Title carries the marker so the exact pool is exactly these rows.
  INSERT INTO public.tasks (company_id, title, created_by)
  SELECT v_company, 'reconciliation ' || v_mark || ' batch ' || g, v_owner
  FROM generate_series(1,15) g;
  SELECT id INTO v_exact FROM public.tasks
  WHERE company_id = v_company AND title LIKE 'reconciliation ' || v_mark || ' batch %' LIMIT 1;

  -- The one fuzzy row: "reconcilliation" (double-l typo) stems to 'reconcilli',
  -- which 'reconciliation':* does NOT prefix-match, so it is trigram-only.
  -- Owned by the MEMBER => visible to the member.
  INSERT INTO public.tasks (company_id, title, created_by)
  VALUES (v_company, 'reconcilliation ' || v_mark || ' ledger', v_member)
  RETURNING id INTO v_fuzzy;

  -- report_type replace('_',' ') gives the fuzzy-matchable phrase.
  INSERT INTO public.reporting_jobs (company_id, requested_by, report_type)
  VALUES (v_company, v_owner, v_mark || '_reconcilliation')
  RETURNING id INTO v_report;

  INSERT INTO public.task_comments (task_id, company_id, author_id, content)
  VALUES (v_fuzzy, v_company, v_owner, v_mark || ' reconcilliation ledger notes for the quarter')
  RETURNING id INTO v_comment;

  -- #318 threshold tune: a task whose title carries the short real word
  -- `upwork`. Check (8) queries the bare 1-letter typo `upwark`
  -- (word_similarity ~0.43) ? below the original 0.45 GUC floor, above 0.35.
  -- Owned by the OWNER (creator => visible without a pipeline).
  INSERT INTO public.tasks (company_id, title, created_by)
  VALUES (v_company, 'upwork ' || v_mark, v_owner)
  RETURNING id INTO v_upwork;

  INSERT INTO gs318_ctx VALUES (v_company, v_owner, v_member, v_mark, v_fuzzy, v_exact, v_report, v_comment, v_upwork);
END $$;


-- ?? 0. Fixture sanity (as the definer): the exact pool is exactly 15, the
--       fuzzy row is NOT an exact match, and it does trigram-match. ??????????
DO $$
DECLARE c RECORD; v_exact_n INT; v_fuzzy_ts BOOL; v_fuzzy_trgm BOOL;
BEGIN
  SELECT * INTO c FROM gs318_ctx;
  SELECT count(*) INTO v_exact_n FROM public.tasks t
  WHERE t.company_id = c.company AND t.deleted_at IS NULL
    AND t.search_tsv @@ to_tsquery('english', 'reconciliation:* & ' || c.mark || ':*');
  IF v_exact_n <> 15 THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: exact pool is % rows, expected 15 (marker collided with real data?)', v_exact_n;
  END IF;
  SELECT (t.search_tsv @@ to_tsquery('english', 'reconciliation:* & ' || c.mark || ':*'))
    INTO v_fuzzy_ts FROM public.tasks t WHERE t.id = c.fuzzy_task;
  IF v_fuzzy_ts THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: the fuzzy row tsmatches ? it is not testing the fuzzy path';
  END IF;
  SELECT word_similarity('reconciliation ' || c.mark, t.title) >= 0.35
    INTO v_fuzzy_trgm FROM public.tasks t WHERE t.id = c.fuzzy_task;
  IF NOT v_fuzzy_trgm THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: the fuzzy row does not trigram-match at 0.35';
  END IF;
  RAISE NOTICE 'OK (0): 15 exact + 1 trigram-only fuzzy row seeded';
END $$;


-- ?? 1 & 2 ? as the member (blind to the exact pool) ???????????????????????
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c RECORD; v_hits JSONB;
BEGIN
  SELECT * INTO c FROM gs318_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.member::text, true);

  IF public.task_list_visible(c.exact_one) THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: an exact task is visible to the member ? cannot prove the pre-ACL cut';
  END IF;
  IF NOT public.task_list_visible(c.fuzzy_task) THEN
    RAISE EXCEPTION 'FIXTURE BROKEN: the fuzzy task is not visible to the member';
  END IF;

  -- (1) p_limit := 5 => v_limit*3 = 15 exact candidates, ALL ACL-invisible.
  -- Pre-v4 the single slice filled with those 15 and dropped the fuzzy row
  -- before ACL, so the member got []. v4's fuzzy slice keeps it.
  v_hits := public.rpc_global_search(p_terms := 'reconciliation ' || c.mark, p_limit := 5);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_hits) e WHERE (e->>'id')::uuid = c.fuzzy_task) THEN
    RAISE EXCEPTION 'CHECK FAILED (1): a wall of ACL-invisible exact hits starved the fuzzy row before ACL ? the pre-#318 regression is back';
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_hits) e WHERE (e->>'type') = 'task' AND (e->>'id')::uuid <> c.fuzzy_task) THEN
    RAISE EXCEPTION 'CHECK FAILED (1): an ACL-invisible exact task leaked into the member''s results';
  END IF;
  RAISE NOTICE 'OK (1): the visible fuzzy row survives a >= v_limit*3 wall of invisible exact hits';

  -- (2) same, but the parser narrowed to a type.
  v_hits := public.rpc_global_search(p_terms := 'reconciliation ' || c.mark, p_types := ARRAY['task'], p_limit := 5);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_hits) e WHERE (e->>'id')::uuid = c.fuzzy_task) THEN
    RAISE EXCEPTION 'CHECK FAILED (2): with p_types := {task} the fuzzy row is gone ? type/date filters are not applied inside the fuzzy slice';
  END IF;
  RAISE NOTICE 'OK (2): a type-scoped query still returns the fuzzy row';
END $$;

RESET ROLE;


-- ?? 3, 4, 5 ? as the owner (sees everything) ??????????????????????????????
SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c RECORD; v_hits JSONB; v_ix_exact INT; v_ix_fuzzy INT; v_sc_exact REAL; v_sc_fuzzy REAL;
BEGIN
  SELECT * INTO c FROM gs318_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.owner_user::text, true);

  -- (3) exact ranks above fuzzy, both in their score bands.
  v_hits := public.rpc_global_search(p_terms := 'reconciliation ' || c.mark, p_limit := 40);
  SELECT ord, (e->>'score')::real INTO v_ix_exact, v_sc_exact
  FROM jsonb_array_elements(v_hits) WITH ORDINALITY t(e, ord) WHERE (e->>'id')::uuid = c.exact_one;
  SELECT ord, (e->>'score')::real INTO v_ix_fuzzy, v_sc_fuzzy
  FROM jsonb_array_elements(v_hits) WITH ORDINALITY t(e, ord) WHERE (e->>'id')::uuid = c.fuzzy_task;
  IF v_ix_exact IS NULL OR v_ix_fuzzy IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED (3): exact (%) or fuzzy (%) row missing for the owner', v_ix_exact, v_ix_fuzzy;
  END IF;
  IF v_ix_exact >= v_ix_fuzzy THEN
    RAISE EXCEPTION 'CHECK FAILED (3): exact hit at position % did not rank above the fuzzy hit at position %', v_ix_exact, v_ix_fuzzy;
  END IF;
  IF NOT (v_sc_exact >= 1.0 AND v_sc_fuzzy >= 0.35 AND v_sc_fuzzy < 1.0) THEN
    RAISE EXCEPTION 'CHECK FAILED (3): score bands off ? exact=% (want >= 1.0), fuzzy=% (want 0.35..1.0)', v_sc_exact, v_sc_fuzzy;
  END IF;
  RAISE NOTICE 'OK (3): exact (score %) ranks above fuzzy (score %)', v_sc_exact, v_sc_fuzzy;

  -- (4) a report on a typo'd term. "reconcilliation" is not a substring of the
  -- search term, so this can only come back via the new word_similarity path.
  v_hits := public.rpc_global_search(p_terms := 'reconciliation ' || c.mark, p_limit := 40);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_hits) e WHERE (e->>'id')::uuid = c.report_id AND (e->>'type') = 'report') THEN
    RAISE EXCEPTION 'CHECK FAILED (4): a report whose type only fuzzy-matches the term did not come back';
  END IF;
  RAISE NOTICE 'OK (4): a report is found on a typo''d term';

  -- (5) a comment on a typo'd term.
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_hits) e WHERE (e->>'id')::uuid = c.comment_id AND (e->>'type') = 'comment') THEN
    RAISE EXCEPTION 'CHECK FAILED (5): a comment whose content only fuzzy-matches the term did not come back';
  END IF;
  RAISE NOTICE 'OK (5): a comment is found on a typo''d term';

  -- (8) #318 threshold tune (belongs with 3-5): a short real word (`upwork`)
  -- reached only by its 1-letter typo (`upwark`, word_similarity ~0.43).
  -- That score cleared the old 0.45 GUC floor; it must return now that the
  -- fuzzy threshold is 0.35.
  v_hits := public.rpc_global_search(p_terms := 'upwark', p_limit := 40);
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_hits) e WHERE (e->>'id')::uuid = c.upwork_task) THEN
    RAISE EXCEPTION 'CHECK FAILED (8): task ''upwork ?'' not returned for the 1-letter typo ''upwark'' ? the 0.35 fuzzy threshold is not in effect';
  END IF;
  RAISE NOTICE 'OK (8): a short word reached by a 1-letter typo (upwark -> upwork) matches at the 0.35 threshold';
END $$;

RESET ROLE;


-- ?? 6. Prove the production dispatcher was OFF the whole time ?????????????
DO $$
DECLARE v_enabled "char";
BEGIN
  SELECT tgenabled INTO v_enabled FROM pg_trigger
  WHERE tgrelid = 'public.notification_events'::regclass
    AND tgname  = 'trg_dispatch_notification_event';
  IF v_enabled IS NULL THEN
    RAISE EXCEPTION 'CHECK INCONCLUSIVE (6): trg_dispatch_notification_event not found ? cannot prove nothing was POSTed';
  END IF;
  IF v_enabled <> 'D' THEN
    RAISE EXCEPTION 'CHECK FAILED (6): the production dispatch trigger was ENABLED (tgenabled=%) while this check inserted rows', v_enabled;
  END IF;
  RAISE NOTICE 'OK (6): trg_dispatch_notification_event was DISABLED throughout ? zero pg_net POSTs';
END $$;


-- ?? 7. Exactly one signature, authenticated still holds EXECUTE, SECURITY DEFINER
DO $$
DECLARE v_sigs INT; v_acl TEXT; v_secdef BOOL;
BEGIN
  SELECT COUNT(*) INTO v_sigs FROM pg_proc
  WHERE proname = 'rpc_global_search' AND pronamespace = 'public'::regnamespace;
  IF v_sigs <> 1 THEN
    RAISE EXCEPTION 'CHECK FAILED (7): rpc_global_search has % signatures ? PostgREST would answer PGRST203', v_sigs;
  END IF;
  SELECT array_to_string(proacl, ','), prosecdef INTO v_acl, v_secdef FROM pg_proc
  WHERE proname = 'rpc_global_search' AND pronamespace = 'public'::regnamespace;
  IF v_acl IS NULL OR position('authenticated=X' IN v_acl) = 0 THEN
    RAISE EXCEPTION 'CHECK FAILED (7): authenticated has no EXECUTE on rpc_global_search (acl=%)', v_acl;
  END IF;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'CHECK INCONCLUSIVE (7): rpc_global_search is no longer SECURITY DEFINER ? re-read this check''s premise';
  END IF;
  RAISE NOTICE 'OK (7): 1 signature, authenticated holds EXECUTE, still SECURITY DEFINER';
END $$;

DO $$ BEGIN
  RAISE NOTICE 'ALL OK: #318 ? the fuzzy ("did you mean") path survives a wall of exact hits and the pre-ACL cut, exact still outranks fuzzy on one comparable scale, and reports/comments fuzzy-match too.';
END $$;

ROLLBACK;
