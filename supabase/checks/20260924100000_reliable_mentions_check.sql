-- #461 check: structured, company-scoped, access-aware @mentions
-- (20260924100000_reliable_mentions.sql).
--
-- Not a migration -- run by hand against a LOCAL/DEV database only:
--   psql "$DATABASE_URL" -f supabase/checks/20260924100000_reliable_mentions_check.sql
--
-- BEGIN/ROLLBACK: borrows seeded users, renames/strips them inside the
-- transaction, creates a throwaway pipeline-less task. Nothing persists, and
-- the pg_net calls queued by trg_dispatch_notification_event are discarded
-- with the rollback. Raises on the first failed assertion; prints
-- 'ALL MENTION CHECKS PASSED' otherwise.

BEGIN;

DO $$
DECLARE
  v_co        uuid;
  v_author    uuid;  -- non-owner, creates the task (so may comment)
  v_mentioned uuid;  -- non-owner, two-word name, task manager -> can see it
  v_bystander uuid;  -- non-owner, no roles/teams -> cannot see a pipeline-less task
  v_foreign   uuid;  -- user in another company
  v_task      uuid;
  v_comment   uuid;
  v_ids       uuid[];
  v_n         int;
  v_payload   jsonb;
BEGIN
  SELECT company_id INTO v_co
  FROM public.users WHERE company_id IS NOT NULL AND NOT is_owner
  GROUP BY company_id HAVING count(*) >= 3 LIMIT 1;
  IF v_co IS NULL THEN
    RAISE EXCEPTION 'CHECK SKIPPED: need a company with 3 non-owner users';
  END IF;

  SELECT id INTO v_author    FROM public.users WHERE company_id = v_co AND NOT is_owner ORDER BY id LIMIT 1;
  SELECT id INTO v_mentioned FROM public.users WHERE company_id = v_co AND NOT is_owner ORDER BY id OFFSET 1 LIMIT 1;
  SELECT id INTO v_bystander FROM public.users WHERE company_id = v_co AND NOT is_owner ORDER BY id OFFSET 2 LIMIT 1;
  SELECT id INTO v_foreign   FROM public.users WHERE company_id <> v_co LIMIT 1;
  IF v_foreign IS NULL THEN
    RAISE EXCEPTION 'CHECK SKIPPED: need a user in a second company';
  END IF;

  -- One UPDATE per row: a second update of a row already touched in this
  -- transaction re-checks users_id_fkey, which some local seed rows fail.
  UPDATE public.users
     SET is_active = true, deleted_at = NULL,
         full_name    = CASE WHEN id = v_mentioned THEN 'Zed Twoword' ELSE full_name END,
         display_name = CASE WHEN id = v_mentioned THEN NULL ELSE display_name END
   WHERE id IN (v_mentioned, v_bystander, v_foreign);
  -- notification_events.actor_id references auth.users.
  INSERT INTO auth.users (id, aud, role, email)
  SELECT v_author, 'authenticated', 'authenticated', 'mentions-check-' || v_author || '@example.invalid'
  WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_author);
  -- Bystander: no permission path to a pipeline-less task.
  DELETE FROM public.user_roles   WHERE user_id = v_bystander;
  DELETE FROM public.team_members WHERE user_id = v_bystander;

  INSERT INTO public.tasks (company_id, title, created_by, manager_id)
  VALUES (v_co, 'Mentions Check Task', v_author, v_mentioned) RETURNING id INTO v_task;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_author::text, 'role', 'authenticated')::text, true);

  -- Picker: mentioned user listed, bystander / foreign / self not.
  SELECT array_agg(id) INTO v_ids FROM public.rpc_task_mentionable_users(v_task);
  IF NOT (v_mentioned = ANY(v_ids)) THEN RAISE EXCEPTION 'FAIL picker: mentioned user missing'; END IF;
  IF v_bystander = ANY(v_ids) OR v_foreign = ANY(v_ids) OR v_author = ANY(v_ids) THEN
    RAISE EXCEPTION 'FAIL picker: returned a user who must be excluded: %', v_ids;
  END IF;

  v_comment := public.rpc_add_task_comment(
    v_task, 'hey @Zed Twoword and @nobody', NULL,
    ARRAY[v_mentioned, v_mentioned, v_bystander, v_foreign, v_author]);

  -- (b)(c) sanitized: only the visible same-company user, deduped.
  SELECT mentioned_user_ids INTO v_ids FROM public.task_comments WHERE id = v_comment;
  IF v_ids IS DISTINCT FROM ARRAY[v_mentioned] THEN
    RAISE EXCEPTION 'FAIL sanitize: expected {%}, got %', v_mentioned, v_ids;
  END IF;

  -- (a) two-word name mentioned by id -> exactly one task.mentioned, with company_id.
  SELECT count(*), max(payload::text)::jsonb INTO v_n, v_payload
  FROM public.notification_events
  WHERE event_type = 'task.mentioned' AND payload->>'comment_id' = v_comment::text;
  IF v_n <> 1 OR v_payload->>'mentioned_user_id' <> v_mentioned::text THEN
    RAISE EXCEPTION 'FAIL notify: % task.mentioned events, payload %', v_n, v_payload;
  END IF;
  IF v_payload->>'company_id' <> v_co::text OR v_payload->>'excerpt' IS NULL OR v_payload->>'actor_name' IS NULL THEN
    RAISE EXCEPTION 'FAIL notify payload: %', v_payload;
  END IF;

  -- task.commented still emitted, now company-scoped.
  IF NOT EXISTS (SELECT 1 FROM public.notification_events
                 WHERE event_type = 'task.commented' AND payload->>'comment_id' = v_comment::text
                   AND payload->>'company_id' = v_co::text) THEN
    RAISE EXCEPTION 'FAIL: task.commented missing or not company-scoped';
  END IF;

  -- Direct UPDATE path is sanitized too (RLS lets the author update the row).
  UPDATE public.task_comments SET mentioned_user_ids = ARRAY[v_foreign, v_bystander] WHERE id = v_comment;
  SELECT mentioned_user_ids INTO v_ids FROM public.task_comments WHERE id = v_comment;
  IF v_ids <> '{}'::uuid[] THEN RAISE EXCEPTION 'FAIL update sanitize: %', v_ids; END IF;

  -- fn_emit_notification_event stamps company_id for emitters that omit it.
  PERFORM public.fn_emit_notification_event('task.created', 'task', v_task, v_author, '{}'::jsonb);
  IF NOT EXISTS (SELECT 1 FROM public.notification_events
                 WHERE event_type = 'task.created' AND entity_id = v_task
                   AND payload->>'company_id' = v_co::text) THEN
    RAISE EXCEPTION 'FAIL: fn_emit_notification_event did not stamp company_id';
  END IF;

  -- (d) task_list_visible == task_visible_to(auth.uid()) for every user x task.
  -- (The before/after-migration snapshot is the stronger proof; this guards
  -- the wrapper from drifting.)
  FOR v_author IN SELECT id FROM public.users LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_author::text, 'role', 'authenticated')::text, true);
    IF EXISTS (SELECT 1 FROM public.tasks t
               WHERE public.task_list_visible(t.id) IS DISTINCT FROM public.task_visible_to(t.id, v_author)) THEN
      RAISE EXCEPTION 'FAIL: task_list_visible drifted for user %', v_author;
    END IF;
  END LOOP;

  -- (e) exactly one overload, and task_visible_to not exposed to clients.
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'rpc_add_task_comment' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'FAIL: rpc_add_task_comment has duplicate overloads';
  END IF;
  IF has_function_privilege('authenticated', 'public.task_visible_to(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.task_visible_to(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.rpc_task_mentionable_users(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: internal function reachable by anon/authenticated';
  END IF;

  RAISE NOTICE 'ALL MENTION CHECKS PASSED';
END $$;

ROLLBACK;
