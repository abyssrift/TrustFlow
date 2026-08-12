-- Runnable check for rpc_company_live_sessions (20260811_company_live_sessions.sql).
--
-- Not a migration -- lives outside supabase/migrations so it never gets
-- auto-applied. Run by hand against a DEV/STAGING database only:
--
--   psql "$DATABASE_URL" -f supabase/checks/20260811_company_live_sessions_check.sql
--
-- Wrapped in BEGIN/ROLLBACK: it inserts throwaway work sessions onto rows that
-- already exist, asserts, then always rolls back.
--
-- The function replaces direct reads of task_work_sessions. NOTE: an earlier
-- version of this header said that table's only select policy is
-- `auth.uid() = user_id`. That is false -- it also carries
-- `task_work_sessions_select USING (company_id = my_company_id())`, absent from
-- supabase/migrations/ but present in the prod schema dump at
-- 20260101000000_baseline_schema.sql:19963. The direct reads were NOT limited to
-- one row. See the migration header for the full correction.
--
--   1. IT MUST SEE OTHER PEOPLE. A live session belonging to a DIFFERENT user
--      in my company is returned. Not a regression test for a bug that existed,
--      but the contract this function must hold: if a scoping predicate is ever
--      tightened by mistake, presence collapses to the caller's own row and the
--      UI shows "nobody is working", which looks like real data rather than a
--      failure.
--   2. IT MUST NOT SEE OTHER TENANTS. Every returned row's user AND task belong
--      to my_company_id(). This is not tautological against the function body:
--      it is the guard for the recurring failure mode in this repo where an RPC
--      gets re-created from a stale body and silently loses a clause (see
--      bug_group_list_files_folder_id). If someone drops a scoping predicate,
--      this fails instead of leaking another company's task titles.
--   3. "ACTIVE" holds its definition: status='active' AND a heartbeat inside
--      8 hours (fn_sweep_stale_work_sessions' threshold). A 9h-stale row and a
--      completed row are both excluded.
--   4. IT MUST NOT LEAK TASK TITLES INSIDE THE TENANT. SECURITY DEFINER bypasses
--      tasks_select_visibility too, so a session on a task in an `assigned_only`
--      pipeline must come back with task_title AND pipeline_name NULL for a
--      caller who is not its creator/manager/assignee -- while the presence row
--      itself still appears, because who is working is company-wide by design.
--      Drop the CASE around t.title and this fails.
--
-- ponytail: seeds sessions onto EXISTING users/tasks instead of standing up a
-- whole second company+pipeline+stage+task. Assertion 2 is written against the
-- returned rows rather than against a planted foreign-tenant row, so it catches
-- a dropped scoping clause without that setup. Assertion 4 goes further and
-- MUTATES an existing pipeline/task into the shape it needs — safe only because
-- the whole thing rolls back, which is also why it runs last. Add the
-- two-tenant seed only if this ever fails and the cause is unclear.

BEGIN;

-- trg_dispatch_notification_event pg_net-POSTs to a hardcoded PRODUCTION url.
-- Any check that writes rows must disable triggers for its own transaction
-- (see security_local_clone_drives_prod).
SET LOCAL session_replication_role = replica;

DO $check$
DECLARE
  v_user       UUID;
  v_company    UUID;
  v_other_user UUID;
  v_task       UUID;
  v_seen       INT;
  v_leaked     INT;
  v_priv_task  UUID;
  v_session    UUID;
  v_title      TEXT;
  v_board      TEXT;
BEGIN
  SELECT id, company_id INTO v_user, v_company
  FROM public.users WHERE is_owner = true LIMIT 1;

  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No owner user found -- run this against a seeded dev DB, not prod.';
  END IF;

  -- Impersonate that owner so auth.uid()/my_company_id() resolve inside the
  -- SECURITY DEFINER function.
  --
  -- The `request.jwt.claims` JSON form, not the legacy `request.jwt.claim.sub`:
  -- current auth.uid() reads the JSON claims and only coalesces the legacy key
  -- in some versions. On a runtime that doesn't, my_company_id() resolves NULL,
  -- the function returns zero rows, and assert 1 fails looking exactly like the
  -- bug it is meant to detect. Matches 20260806_task_claiming_check.sql:60.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);

  SELECT id INTO v_other_user
  FROM public.users WHERE company_id = v_company AND id <> v_user LIMIT 1;

  SELECT id INTO v_task
  FROM public.tasks WHERE company_id = v_company AND deleted_at IS NULL LIMIT 1;

  IF v_task IS NULL THEN
    RAISE EXCEPTION 'No task in the caller company -- run against a seeded dev DB.';
  END IF;

  -- ── 1. Somebody else's live session is visible ──────────────────────────
  IF v_other_user IS NULL THEN
    RAISE NOTICE 'SKIP 1: company has only one user, cannot test cross-user visibility';
  ELSE
    -- company_id is NOT NULL with no default and no BEFORE INSERT trigger to
    -- fill it, so every insert below has to name it explicitly.
    INSERT INTO public.task_work_sessions (user_id, task_id, company_id, started_at, last_heartbeat_at, status)
    VALUES (v_other_user, v_task, v_company, now() - interval '10 minutes', now(), 'active');

    SELECT count(*) INTO v_seen
    FROM public.rpc_company_live_sessions() r
    WHERE r.user_id = v_other_user;

    IF v_seen <> 1 THEN
      RAISE EXCEPTION 'FAIL 1: another user''s live session is not visible (got % rows) -- back to the one-row RLS bug', v_seen;
    END IF;
    RAISE NOTICE 'PASS 1: another user''s live session is visible';
  END IF;

  -- ── 2. No row from another tenant, by user OR by task ───────────────────
  SELECT count(*) INTO v_leaked
  FROM public.rpc_company_live_sessions() r
  JOIN public.users u ON u.id = r.user_id
  JOIN public.tasks t ON t.id = r.task_id
  WHERE u.company_id IS DISTINCT FROM public.my_company_id()
     OR t.company_id IS DISTINCT FROM public.my_company_id();

  IF v_leaked <> 0 THEN
    RAISE EXCEPTION 'FAIL 2: % cross-tenant row(s) returned -- a scoping clause was lost', v_leaked;
  END IF;
  RAISE NOTICE 'PASS 2: every returned row is inside the caller company';

  -- ── 3. Stale and completed sessions are not "active" ────────────────────
  INSERT INTO public.task_work_sessions (user_id, task_id, company_id, started_at, last_heartbeat_at, status)
  VALUES
    -- 9h since the last heartbeat: past the 8h sweep threshold.
    (v_user, v_task, v_company, now() - interval '10 hours', now() - interval '9 hours', 'active'),
    (v_user, v_task, v_company, now() - interval '10 minutes', now(), 'completed');

  SELECT count(*) INTO v_seen
  FROM public.rpc_company_live_sessions() r
  WHERE r.user_id = v_user
    AND (r.last_heartbeat_at < now() - interval '8 hours');

  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'FAIL 3a: a session stale past 8h was reported as live';
  END IF;

  SELECT count(*) INTO v_seen
  FROM public.rpc_company_live_sessions() r
  JOIN public.task_work_sessions s ON s.id = r.session_id
  WHERE s.status <> 'active';

  IF v_seen <> 0 THEN
    RAISE EXCEPTION 'FAIL 3b: a completed session was reported as live';
  END IF;
  RAISE NOTICE 'PASS 3: stale and completed sessions are excluded';

  -- ── 4. A private task's title is withheld, its presence row is not ──────
  -- Runs LAST: it mutates a pipeline's visibility mode and strips a task's
  -- assignments, so nothing above should have to reason about that state.
  IF v_other_user IS NULL THEN
    RAISE NOTICE 'SKIP 4: company has only one user, cannot test a non-participant caller';
  ELSE
    SELECT t.id INTO v_priv_task
    FROM public.tasks t
    WHERE t.company_id = v_company AND t.deleted_at IS NULL AND t.pipeline_id IS NOT NULL
    LIMIT 1;

    IF v_priv_task IS NULL THEN
      RAISE NOTICE 'SKIP 4: no task on a pipeline in this company';
    ELSE
      -- Force the scenario rather than hunt for it: the pipeline hides
      -- unassigned work, and the OWNER (not v_other_user) is the only person
      -- attached to the task.
      UPDATE public.pipelines SET task_visibility_mode = 'assigned_only'
      WHERE id = (SELECT t.pipeline_id FROM public.tasks t WHERE t.id = v_priv_task);
      DELETE FROM public.task_assignments WHERE task_id = v_priv_task;
      UPDATE public.tasks SET created_by = v_user, manager_id = v_user WHERE id = v_priv_task;

      -- NOT redundant cleanup: idx_one_active_session_per_user is a UNIQUE
      -- partial index on (user_id) WHERE status = 'active', and assert 3 above
      -- deliberately leaves a 9h-stale ACTIVE row for this same v_user behind.
      -- Without this delete the insert below dies on that index and assert 4 --
      -- the only execution-level proof the intra-tenant title leak is closed --
      -- never runs at all. Delete this line and the check stops checking.
      DELETE FROM public.task_work_sessions WHERE user_id = v_user AND status = 'active';

      INSERT INTO public.task_work_sessions (user_id, task_id, company_id, started_at, last_heartbeat_at, status)
      VALUES (v_user, v_priv_task, v_company, now() - interval '5 minutes', now(), 'active')
      RETURNING id INTO v_session;

      -- Become the colleague with no claim on that task.
      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other_user::text, 'role', 'authenticated')::text, true);

      IF public.task_list_visible(v_priv_task) THEN
        -- Only reachable if this member holds is_owner / system.view_all_data /
        -- task.view_all / tasks.view_all, in which case they are ALLOWED the
        -- title and there is nothing to assert.
        RAISE NOTICE 'SKIP 4: % may see every task (owner or a view_all permission)', v_other_user;
      ELSE
        SELECT count(*) INTO v_seen FROM public.rpc_company_live_sessions() r
        WHERE r.session_id = v_session;

        IF v_seen <> 1 THEN
          RAISE EXCEPTION 'FAIL 4a: presence row vanished (got % rows) -- who is working is company-wide, only the title is gated', v_seen;
        END IF;

        SELECT r.task_title, r.pipeline_name INTO v_title, v_board
        FROM public.rpc_company_live_sessions() r WHERE r.session_id = v_session;

        IF v_title IS NOT NULL OR v_board IS NOT NULL THEN
          RAISE EXCEPTION 'FAIL 4b: leaked title/board (%, %) of an assigned_only task to a non-participant', v_title, v_board;
        END IF;
        RAISE NOTICE 'PASS 4: presence survives, title and board are withheld';
      END IF;

      PERFORM set_config('request.jwt.claims', json_build_object('sub', v_user::text, 'role', 'authenticated')::text, true);
    END IF;
  END IF;

  RAISE NOTICE 'rpc_company_live_sessions: all checks passed';
END;
$check$;

ROLLBACK;
