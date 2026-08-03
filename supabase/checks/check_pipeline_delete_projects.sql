-- Self-check for #196: deleting a pipeline soft-deleted every task on the
-- board, including tasks that were a PROJECT's work, with no warning and no
-- undo.
--
-- Creates its own fixtures and rolls back, so it leaves no rows behind and is
-- re-runnable:
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres \
--     -d postgres -f - < supabase/checks/check_pipeline_delete_projects.sql
--
-- Proves three things, each of which was broken before the fix:
--   1. A project whose tasks lived on the deleted board still reports the
--      correct task count AND the correct completion (both rollup readers).
--   2. No task belonging to a live project becomes unreachable -- asserted
--      through REAL RLS as a plain member (postgres is BYPASSRLS and would
--      prove nothing), not by reading the policy text.
--   3. The preview's numbers equal what the commit actually did to the rows --
--      plan §13.10's contract, asserted against the DB, not against the fact
--      that both call the same function.
--
-- An ASSERT failure names what regressed.

BEGIN;

CREATE TEMP TABLE pdel196_ctx (
  company     UUID,
  owner_id    UUID,
  member_id   UUID,
  pipeline    UUID,
  stage_todo  UUID,
  stage_done  UUID,
  project_a   UUID,
  project_b   UUID,
  t_p1        UUID,  -- project A, DONE  (terminal success stage)
  t_p2        UUID,  -- project A, DONE
  t_p3        UUID,  -- project A, todo, ASSIGNED to the plain member
  t_p4        UUID,  -- project A, todo, child of a board-only task
  t_p5        UUID,  -- project B, DONE
  t_b1        UUID,  -- board-only, parent of t_p4
  t_b2        UUID,  -- board-only
  t_c1        UUID   -- board-only, child of t_p1
) ON COMMIT DROP;

CREATE TEMP TABLE pdel196_board (task_id UUID) ON COMMIT DROP;

-- The RLS half runs as `authenticated`, which cannot read another role's temp
-- tables by default.
GRANT SELECT ON pdel196_ctx, pdel196_board TO authenticated;

-- ── Fixtures + the backend guarantees (runs as postgres, impersonating the
--    company owner via request.jwt.claims -- has_permission() short-circuits
--    true for owners, same trick every other check here uses) ─────────────
DO $setup$
DECLARE
  v_company    UUID;
  v_owner      UUID;
  v_member     UUID;
  v_cand       UUID;
  v_pipe       UUID;
  v_todo       UUID;
  v_done       UUID;
  v_pa         UUID;
  v_pb         UUID;
  v_p1 UUID; v_p2 UUID; v_p3 UUID; v_p4 UUID; v_p5 UUID;
  v_b1 UUID; v_b2 UUID; v_c1 UUID;

  v_before     RECORD;
  v_after      RECORD;
  v_stats_before RECORD;
  v_stats_after  RECORD;

  v_preview    JSONB;
  v_commit     JSONB;
  v_detached   INT;
  v_deleted    INT;
  v_still      INT;
BEGIN
  -- A company that has BOTH an owner and at least one member with none of the
  -- see-everything permissions -- the member is what makes assertion 2 mean
  -- something. Discovered, not hardcoded, so this runs anywhere.
  FOR v_cand, v_company IN
    SELECT u.id, u.company_id
    FROM public.users u
    WHERE u.is_owner = false AND u.deleted_at IS NULL AND u.company_id IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.users o
                   WHERE o.company_id = u.company_id AND o.is_owner = true
                     AND o.deleted_at IS NULL)
  LOOP
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_cand)::text, true);
    IF NOT public.has_permission('task.view_all')
       AND NOT public.has_permission('tasks.view_all')
       AND NOT public.has_permission('system.view_all_data')
       AND NOT public.has_permission('project.view_all') THEN
      v_member := v_cand;
      EXIT;
    END IF;
  END LOOP;

  ASSERT v_member IS NOT NULL,
    'fixture: no company has an owner plus a member without view-all permissions';

  SELECT id INTO v_owner FROM public.users
   WHERE company_id = v_company AND is_owner = true AND deleted_at IS NULL LIMIT 1;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);
  ASSERT auth.uid() = v_owner, 'fixture: could not impersonate the owner';

  -- ── Board: two stages, the second is terminal-success (= "done") ────────
  -- task_visibility_mode 'all' so the member can see every task on the board
  -- BEFORE the delete; that is what makes "still visible after" a real result.
  INSERT INTO public.pipelines (company_id, name, task_visibility_mode)
  VALUES (v_company, 'ponytail #196 board', 'all')
  RETURNING id INTO v_pipe;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_initial, submission_mode)
  VALUES (v_pipe, 'TODO', 1, true, 'none') RETURNING id INTO v_todo;

  INSERT INTO public.pipeline_stages (pipeline_id, name, position, is_terminal, terminal_type, submission_mode)
  VALUES (v_pipe, 'DONE', 2, true, 'success', 'none') RETURNING id INTO v_done;

  INSERT INTO public.projects (company_id, name, created_by)
  VALUES (v_company, 'ponytail #196 project A', v_owner) RETURNING id INTO v_pa;
  INSERT INTO public.projects (company_id, name, created_by)
  VALUES (v_company, 'ponytail #196 project B', v_owner) RETURNING id INTO v_pb;

  -- 5 project tasks (2 of A done, 1 of B done) and 3 board-only tasks.
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, current_stage_id, project_id)
  VALUES (v_company, '#196 A done 1', v_owner, v_pipe, v_done, v_pa) RETURNING id INTO v_p1;
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, current_stage_id, project_id)
  VALUES (v_company, '#196 A done 2', v_owner, v_pipe, v_done, v_pa) RETURNING id INTO v_p2;
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, current_stage_id, project_id)
  VALUES (v_company, '#196 A open (member assigned)', v_owner, v_pipe, v_todo, v_pa) RETURNING id INTO v_p3;
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, current_stage_id)
  VALUES (v_company, '#196 board-only parent', v_owner, v_pipe, v_todo) RETURNING id INTO v_b1;
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, current_stage_id, project_id, parent_task_id)
  VALUES (v_company, '#196 A open child of board-only', v_owner, v_pipe, v_todo, v_pa, v_b1) RETURNING id INTO v_p4;
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, current_stage_id, project_id)
  VALUES (v_company, '#196 B done', v_owner, v_pipe, v_done, v_pb) RETURNING id INTO v_p5;
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, current_stage_id)
  VALUES (v_company, '#196 board-only 2', v_owner, v_pipe, v_todo) RETURNING id INTO v_b2;
  INSERT INTO public.tasks (company_id, title, created_by, pipeline_id, current_stage_id, parent_task_id)
  VALUES (v_company, '#196 board-only child of project task', v_owner, v_pipe, v_todo, v_p1) RETURNING id INTO v_c1;

  -- The member is an ASSIGNEE only: not creator (owner is), not manager (NULL).
  -- So after the detach the ONLY policy branch that can admit them is #196's
  -- fn_project_accessible clause.
  INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
  VALUES (v_p3, v_company, v_member, v_owner);

  -- Asserted HERE, not in the RLS block: under RLS a hidden row makes the same
  -- SELECT return NULL, so a visibility regression would masquerade as a
  -- fixture problem (it did, on the first run of negative test 4).
  ASSERT (SELECT created_by = v_owner AND manager_id IS NULL FROM public.tasks WHERE id = v_p3),
    'fixture: the probe task must be created by the owner and unmanaged, or the RLS test proves nothing';

  INSERT INTO pdel196_board (task_id)
  VALUES (v_p1),(v_p2),(v_p3),(v_p4),(v_p5),(v_b1),(v_b2),(v_c1);

  INSERT INTO pdel196_ctx VALUES (
    v_company, v_owner, v_member, v_pipe, v_todo, v_done, v_pa, v_pb,
    v_p1, v_p2, v_p3, v_p4, v_p5, v_b1, v_b2, v_c1
  );

  -- ── Rollups BEFORE ─────────────────────────────────────────────────────
  SELECT tasks_total, tasks_done, weighted_progress
    INTO v_before
    FROM public.rpc_projects_table(p_limit := 1000) WHERE id = v_pa;
  ASSERT v_before.tasks_total = 4,
    'fixture: project A should start with 4 tasks, got ' || COALESCE(v_before.tasks_total::text, 'NULL');
  ASSERT v_before.tasks_done = 2,
    'fixture: project A should start with 2 done, got ' || COALESCE(v_before.tasks_done::text, 'NULL');

  SELECT total_tasks, completed_tasks, completion_rate
    INTO v_stats_before
    FROM public.rpc_get_project_stats(ARRAY[v_pa]);

  -- ── PREVIEW ────────────────────────────────────────────────────────────
  v_preview := public.rpc_preview_delete_pipeline(v_pipe);

  ASSERT (v_preview->>'tasks_total')::INT = 8,
    '#196: preview tasks_total = ' || (v_preview->>'tasks_total') || ', expected 8';
  ASSERT (v_preview->>'tasks_detached')::INT = 5,
    '#196: preview tasks_detached = ' || (v_preview->>'tasks_detached') || ', expected 5';
  ASSERT (v_preview->>'tasks_deleted')::INT = 3,
    '#196: preview tasks_deleted = ' || (v_preview->>'tasks_deleted') || ', expected 3';
  -- The headline the user is owed: PROJECTS, not just tasks.
  ASSERT (v_preview->>'projects_affected')::INT = 2,
    '#196: preview projects_affected = ' || (v_preview->>'projects_affected') || ', expected 2';
  ASSERT jsonb_array_length(v_preview->'projects') = 2,
    '#196: preview did not name the affected projects';

  -- ── COMMIT ─────────────────────────────────────────────────────────────
  v_commit := public.rpc_delete_pipeline(v_pipe);

  ASSERT v_commit = v_preview,
    '#196 (§13.10): commit returned a different impact than the preview promised: '
    || v_commit::text || ' vs ' || v_preview::text;

  -- ── 1. Rollups AFTER == rollups BEFORE ─────────────────────────────────
  -- Asserted FIRST, because it is the headline of #196: this is the number the
  -- user watched go to zero.
  SELECT tasks_total, tasks_done, weighted_progress
    INTO v_after
    FROM public.rpc_projects_table(p_limit := 1000) WHERE id = v_pa;

  ASSERT v_after.tasks_total = v_before.tasks_total,
    '#196: project A task count went ' || v_before.tasks_total || ' -> '
    || COALESCE(v_after.tasks_total::text, 'NULL') || ' across the board delete';
  ASSERT v_after.tasks_done = v_before.tasks_done,
    '#196: project A completed count went ' || v_before.tasks_done || ' -> '
    || COALESCE(v_after.tasks_done::text, 'NULL') || ' across the board delete';
  ASSERT v_after.weighted_progress = v_before.weighted_progress,
    '#196: project A weighted_progress went ' || v_before.weighted_progress || ' -> '
    || COALESCE(v_after.weighted_progress::text, 'NULL') || ' across the board delete';

  -- Second, independent rollup reader -- a fix that only satisfies one of them
  -- has not fixed the project.
  SELECT total_tasks, completed_tasks, completion_rate
    INTO v_stats_after
    FROM public.rpc_get_project_stats(ARRAY[v_pa]);
  ASSERT v_stats_after.total_tasks = v_stats_before.total_tasks
     AND v_stats_after.completed_tasks = v_stats_before.completed_tasks
     AND v_stats_after.completion_rate = v_stats_before.completion_rate,
    '#196: rpc_get_project_stats disagrees after the delete: '
    || v_stats_before.total_tasks || '/' || v_stats_before.completed_tasks || '/' || v_stats_before.completion_rate
    || ' -> '
    || v_stats_after.total_tasks || '/' || v_stats_after.completed_tasks || '/' || v_stats_after.completion_rate;

  -- ── 3. Preview numbers == what actually happened to the rows ───────────
  SELECT count(*) FILTER (WHERE t.deleted_at IS NULL AND t.pipeline_id IS NULL AND t.project_id IS NOT NULL),
         count(*) FILTER (WHERE t.deleted_at IS NOT NULL),
         count(*) FILTER (WHERE t.deleted_at IS NULL)
    INTO v_detached, v_deleted, v_still
    FROM public.tasks t JOIN pdel196_board b ON b.task_id = t.id;

  ASSERT v_detached = (v_preview->>'tasks_detached')::INT,
    '#196: preview promised ' || (v_preview->>'tasks_detached')
    || ' detached, the commit actually detached ' || v_detached;
  ASSERT v_deleted = (v_preview->>'tasks_deleted')::INT,
    '#196: preview promised ' || (v_preview->>'tasks_deleted')
    || ' deleted, the commit actually deleted ' || v_deleted;
  ASSERT v_still = (v_preview->>'tasks_detached')::INT,
    '#196: survivors (' || v_still || ') != promised detached count';

  ASSERT (SELECT deleted_at IS NOT NULL FROM public.pipelines WHERE id = v_pipe),
    '#196: the pipeline itself was not soft-deleted';

  -- Completion lives in current_stage_id (rpc_projects_table joins
  -- pipeline_stages on it). Nulling it would silently un-finish the work.
  ASSERT (SELECT current_stage_id FROM public.tasks WHERE id = v_p1) = v_done,
    '#196: a detached task lost current_stage_id -- its completion is gone';

  -- No survivor may point at a task that was just deleted.
  ASSERT (SELECT parent_task_id FROM public.tasks WHERE id = v_p4) IS NULL,
    '#196: surviving project task still points at its deleted board-only parent';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.tasks c
    JOIN public.tasks p ON p.id = c.parent_task_id
    WHERE c.deleted_at IS NULL AND p.deleted_at IS NOT NULL
      AND c.id IN (SELECT task_id FROM pdel196_board)),
    '#196: a live task is parented to a soft-deleted task';

  RAISE NOTICE '#196 backend OK -- preview % detached / commit matched the rows; project A rollup held at % of % done, weighted_progress %',
    v_preview->>'tasks_detached', v_after.tasks_done, v_after.tasks_total, v_after.weighted_progress;
END
$setup$;

-- ── 2. Reachability, through REAL RLS ──────────────────────────────────────
SET LOCAL ROLE authenticated;

DO $rls$
DECLARE
  c         RECORD;
  v_sees_p3 BOOLEAN;
  v_sees_b2 BOOLEAN;
  v_n       INT;
BEGIN
  SELECT * INTO c FROM pdel196_ctx;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.member_id)::text, true);
  ASSERT auth.uid() = c.member_id, 'fixture: could not impersonate the member under RLS';

  -- The member is only an assignee (creator/manager was asserted above, before
  -- RLS was in the way). Nothing else may be admitting them.
  ASSERT NOT public.has_permission('task.view_all')
     AND NOT public.has_permission('tasks.view_all'),
    'fixture: the member holds a view-all permission -- the test proves nothing';

  SELECT EXISTS (SELECT 1 FROM public.tasks WHERE id = c.t_p3) INTO v_sees_p3;
  ASSERT v_sees_p3,
    '#196: a task on a LIVE project became unreachable to its assignee after the board was deleted';

  -- Every surviving project task must be readable by someone who can see the
  -- project -- not just the one the member is assigned to.
  SELECT count(*) INTO v_n
  FROM public.tasks t
  WHERE t.id IN (c.t_p1, c.t_p2, c.t_p3, c.t_p4);
  ASSERT v_n = 4,
    '#196: only ' || v_n || ' of project A''s 4 surviving tasks are visible to a project member';

  -- Control: a board-only task really is gone. If this passes for the wrong
  -- reason (i.e. everything is visible), the assertions above are meaningless.
  SELECT EXISTS (SELECT 1 FROM public.tasks WHERE id = c.t_b2) INTO v_sees_b2;
  ASSERT NOT v_sees_b2,
    '#196: a deleted board-only task is still visible -- the RLS probe is not discriminating';

  RAISE NOTICE '#196 RLS OK -- all 4 surviving project tasks readable by an assignee-only member; deleted board tasks are not';
END
$rls$;

RESET ROLE;

ROLLBACK;
