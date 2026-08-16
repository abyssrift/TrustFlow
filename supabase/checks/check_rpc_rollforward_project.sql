-- check_rpc_rollforward_project.sql
--
-- NOT a migration -- run by hand against local only:
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres \
--     -f supabase/checks/check_rpc_rollforward_project.sql
--
-- Issue #185 / plan §13.13 -- rpc_rollforward_project is
-- rpc_create_template_from_project + rpc_instantiate_template composed
-- against a live project instead of a stored template. This is the
-- acceptance test the issue itself demands:
--   1. A rolled-forward project's tasks land on a board, with a stage and a
--      due date -- the same reachability bar #182 set for bulk-create.
--   2. Each toggle (carry_assignments / carry_mapping / carry_estimates /
--      carry_files) actually changes the outcome.
--   3. Files are REFERENCED, not copied -- zero new filehub_files rows from
--      a files-carrying rollforward, and read access flows through the new
--      rolled_forward_from_project_id link, never widening beyond it.
--   4. A user who cannot see the source project cannot roll it forward.
--   5. rpc_undo_portfolio_instantiation cleanly reverses a rollforward batch,
--      same as any other portfolio_id.
--
-- Wrapped in BEGIN/ROLLBACK (mirrors 20260801_project_visibility_check.sql):
-- creates scratch rows in an EXISTING seeded company (real users/teams/
-- pipelines, no invented auth.users rows), always rolls back -- safe to
-- re-run, never leaves rows behind even on assertion failure (the RAISE
-- EXCEPTION itself aborts the transaction).

BEGIN;

CREATE TEMP TABLE rf_check_ctx (
  company        UUID,
  owner          UUID,
  team           UUID,
  team_member    UUID,
  deny_user      UUID,
  link_user      UUID,
  pipe_a         UUID, stage_a UUID,   -- source "Planning" category's board
  pipe_b         UUID, stage_b UUID,   -- source "Fieldwork" category's board
  pipe_c         UUID, stage_c UUID,   -- ALTERNATE board, only used by the carry_mapping=false override test
  client_id      UUID,
  source_project UUID,
  source_folder  UUID,
  source_file    UUID
);
GRANT SELECT, INSERT, UPDATE ON rf_check_ctx TO authenticated;

-- ── Fixture setup (as postgres -- bypasses RLS) ─────────────────────────────
DO $$
DECLARE
  v_company   UUID;
  v_owner     UUID;
  v_team      UUID;
  v_team_member UUID;
  v_pool      UUID[];
  v_pipe_a UUID; v_stage_a UUID;
  v_pipe_b UUID; v_stage_b UUID;
  v_pipe_c UUID; v_stage_c UUID;
  v_client    UUID;
  v_project   UUID;
  v_task_a1   UUID; v_task_a2 UUID; v_task_b1 UUID;
  v_folder    UUID;
  v_file      UUID;
  v_tag       TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  -- Company with >=3 stage-having task pipelines (need pipe_a/pipe_b for the
  -- source's real category->board mapping, plus pipe_c as the deliberately
  -- DIFFERENT board the carry_mapping=false test maps onto instead) AND a
  -- staffed team (for the carry_assignments proof).
  SELECT te.company_id, te.id, tm.user_id
  INTO v_company, v_team, v_team_member
  FROM public.team_members tm
  JOIN public.teams te ON te.id = tm.team_id
  JOIN public.users u  ON u.id = tm.user_id AND u.is_owner = false
  WHERE tm.removed_at IS NULL
    AND te.company_id IN (
      SELECT p.company_id FROM public.pipelines p
      WHERE p.deleted_at IS NULL AND p.subject_kind = 'task'
        AND EXISTS (SELECT 1 FROM public.pipeline_stages s WHERE s.pipeline_id = p.id)
      GROUP BY p.company_id HAVING COUNT(*) >= 3
    )
  LIMIT 1;

  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No company with >=3 stage-having task pipelines + a staffed team found -- seed one before running this check.';
  END IF;

  SELECT id INTO v_owner FROM public.users WHERE company_id = v_company AND is_owner = true LIMIT 1;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'No owner user found for company %.', v_company; END IF;

  -- Excludes project.view_all holders explicitly rather than trusting
  -- whoever sorts first by id: deny_user (pool[1]) must genuinely lack
  -- access for assertion 1 ("cannot see it -> cannot roll it forward"), and
  -- link_user (pool[2]) must ALSO lack it for assertion 3's "no direct
  -- access to the source project" check -- a view_all holder would make
  -- either assertion fail on the luck of UUID ordering, not a real bug.
  SELECT ARRAY_AGG(id) INTO v_pool FROM (
    SELECT u.id FROM public.users u
    WHERE u.company_id = v_company AND u.is_owner = false
      AND u.id NOT IN (SELECT tm2.user_id FROM public.team_members tm2 WHERE tm2.team_id = v_team AND tm2.removed_at IS NULL)
      AND u.id NOT IN (
        SELECT ur3.user_id FROM public.user_roles ur3
        JOIN public.role_permissions rp3 ON rp3.role_id = ur3.role_id
        JOIN public.permissions perm3 ON perm3.id = rp3.permission_id AND perm3.key = 'project.view_all'
        WHERE ur3.revoked_at IS NULL
      )
    ORDER BY u.id LIMIT 2
  ) x;
  IF v_pool IS NULL OR ARRAY_LENGTH(v_pool, 1) < 2 THEN
    RAISE EXCEPTION 'Need 2 distinct non-owner, non-team, non-project.view_all users in company % -- seed data too thin.', v_company;
  END IF;

  -- rpc_rollforward_project's OWN screen-level gate is project.create
  -- (mirrors rpc_create_template_from_project / rpc_instantiate_template).
  -- Grant it to both pool users so the deny-test below fails on the
  -- ROW-level accessibility check this issue is actually about, not this
  -- unrelated screen gate -- same reasoning as
  -- 20260801_project_visibility_check.sql's identical grant.
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT DISTINCT ur.role_id, x.perm_id
  FROM public.user_roles ur
  CROSS JOIN (VALUES
    ('62f36da2-9e5f-4b35-9203-2f3b59dcb2ad'::uuid), -- project.view
    ('b404e101-4fbc-48eb-8d7f-37e897aa26f0'::uuid)  -- project.create
  ) AS x(perm_id)
  WHERE ur.user_id = ANY (v_pool[1:2]) AND ur.revoked_at IS NULL
  ON CONFLICT DO NOTHING;

  SELECT p.id, s.id INTO v_pipe_a, v_stage_a
  FROM public.pipelines p JOIN LATERAL (SELECT id FROM public.pipeline_stages WHERE pipeline_id = p.id ORDER BY position ASC LIMIT 1) s ON true
  WHERE p.company_id = v_company AND p.deleted_at IS NULL AND p.subject_kind = 'task' LIMIT 1;

  SELECT p.id, s.id INTO v_pipe_b, v_stage_b
  FROM public.pipelines p JOIN LATERAL (SELECT id FROM public.pipeline_stages WHERE pipeline_id = p.id ORDER BY position ASC LIMIT 1) s ON true
  WHERE p.company_id = v_company AND p.deleted_at IS NULL AND p.subject_kind = 'task' AND p.id <> v_pipe_a LIMIT 1;

  SELECT p.id, s.id INTO v_pipe_c, v_stage_c
  FROM public.pipelines p JOIN LATERAL (SELECT id FROM public.pipeline_stages WHERE pipeline_id = p.id ORDER BY position ASC LIMIT 1) s ON true
  WHERE p.company_id = v_company AND p.deleted_at IS NULL AND p.subject_kind = 'task' AND p.id NOT IN (v_pipe_a, v_pipe_b) LIMIT 1;

  -- ── Client + source project, owned by v_owner so fn_project_accessible
  -- holds for the "carry it forward" calls below (owner_id branch). ────────
  INSERT INTO public.clients (company_id, name, external_ref)
  VALUES (v_company, 'RF Selfcheck Client ' || v_tag, 'RF-EXT-' || v_tag)
  RETURNING id INTO v_client;

  INSERT INTO public.projects (company_id, name, created_by, owner_id, client_id, start_date)
  VALUES (v_company, 'RF Selfcheck Source ' || v_tag, v_owner, v_owner, v_client, now())
  RETURNING id INTO v_project;

  -- Source tasks: a #182-compliant project (pipeline_id/current_stage_id set),
  -- two categories on two DIFFERENT boards, estimated_hours set, one task per
  -- category team-assigned -- everything a rollforward should be able to carry.
  INSERT INTO public.tasks (company_id, project_id, title, category, pipeline_id, current_stage_id, estimated_hours, created_by)
  VALUES (v_company, v_project, 'RF Plan 1', 'Planning', v_pipe_a, v_stage_a, 3, v_owner) RETURNING id INTO v_task_a1;
  INSERT INTO public.tasks (company_id, project_id, title, category, pipeline_id, current_stage_id, estimated_hours, created_by)
  VALUES (v_company, v_project, 'RF Plan 2', 'Planning', v_pipe_a, v_stage_a, 2, v_owner) RETURNING id INTO v_task_a2;
  INSERT INTO public.tasks (company_id, project_id, title, category, pipeline_id, current_stage_id, estimated_hours, created_by)
  VALUES (v_company, v_project, 'RF Field 1', 'Fieldwork', v_pipe_b, v_stage_b, 5, v_owner) RETURNING id INTO v_task_b1;

  INSERT INTO public.task_assignments (task_id, company_id, assignee_team_id, assigned_by)
  VALUES (v_task_a1, v_company, v_team, v_owner);
  INSERT INTO public.task_assignments (task_id, company_id, assignee_team_id, assigned_by)
  VALUES (v_task_b1, v_company, v_team, v_owner);

  -- ── "Last year's working papers": a project-scope FileHub folder + one
  -- file, standing in for a sealed deliverable (issue #174). Referenced, not
  -- copied, is what this check exists to prove. ───────────────────────────
  INSERT INTO public.filehub_folders (company_id, name, created_by, scope, project_id)
  VALUES (v_company, 'RF Selfcheck Deliverable ' || v_tag, v_owner, 'project', v_project)
  RETURNING id INTO v_folder;
  UPDATE public.projects SET deliverable_folder_id = v_folder WHERE id = v_project;

  INSERT INTO public.filehub_files (company_id, uploaded_by, storage_path, bucket, original_name, mime_type, size_bytes, visibility, folder_id, project_id)
  VALUES (v_company, v_owner, 'rf-selfcheck/' || v_tag || '/working-paper.xlsx', 'filehub', 'working-paper.xlsx', 'application/vnd.ms-excel', 1024, 'project', v_folder, v_project)
  RETURNING id INTO v_file;

  INSERT INTO rf_check_ctx (company, owner, team, team_member, deny_user, link_user, pipe_a, stage_a, pipe_b, stage_b, pipe_c, stage_c, client_id, source_project, source_folder, source_file)
  VALUES (v_company, v_owner, v_team, v_team_member, v_pool[1], v_pool[2], v_pipe_a, v_stage_a, v_pipe_b, v_stage_b, v_pipe_c, v_stage_c, v_client, v_project, v_folder, v_file);
END $$;

-- ══ 1. A user who cannot see the source project cannot roll it forward ═════
-- deny_user: not owner, not assigned, no view_all -- fn_project_accessible is
-- false for them, so rpc_create_template_from_project (step 1 of the
-- composition) must fold this into "Project not found.", never a distinct
-- "denied" (per §13.14: a distinguishable denial is itself a disclosure).
DO $$
DECLARE
  c RECORD; v_caught BOOLEAN := false; v_msg TEXT;
BEGIN
  SELECT * INTO c FROM rf_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.deny_user::text, true);
  BEGIN
    PERFORM public.rpc_rollforward_project(
      c.source_project, 'RF Should Not Exist',
      jsonb_build_object('target_date', (CURRENT_DATE + 30)::text, 'anchor_direction', 'start', 'idempotency_key', 'rf-selfcheck-deny')
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  ASSERT v_caught, 'expected a user with no access to the source project to be refused, it was not';
  ASSERT v_msg = 'Project not found.', format('expected "Project not found.", got: %s', v_msg);
  RAISE NOTICE 'OK (1): a user who cannot see the source project cannot roll it forward';
END $$;

-- ══ 2/3. Full carry (all four toggles true, mapping/team/files auto-derived) ═
DO $$
DECLARE
  c RECORD; v_result JSONB; v_project_id UUID; v_portfolio_id UUID;
  v_bad_reach INT; v_board_a INT; v_board_b INT; v_team_assigned INT;
BEGIN
  SELECT * INTO c FROM rf_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.owner::text, true);

  v_result := public.rpc_rollforward_project(
    c.source_project, 'RF Rollforward Full ' || c.source_project::text,
    jsonb_build_object(
      'target_date', (CURRENT_DATE + 30)::text, 'anchor_direction', 'start',
      'idempotency_key', 'rf-selfcheck-full-' || c.source_project::text,
      'carry_assignments', true, 'carry_mapping', true, 'carry_estimates', true, 'carry_files', true
    )
  );
  v_project_id := (v_result->>'project_id')::uuid;
  v_portfolio_id := (v_result->>'portfolio_id')::uuid;

  ASSERT (v_result->'carried'->>'assignments')::boolean = true, 'expected carried.assignments = true in the result';
  ASSERT (v_result->'carried'->>'mapping')::boolean = true, 'expected carried.mapping = true in the result';

  -- Reachability (issue #185's acceptance bar #1, same as #182's): every new
  -- task has a non-NULL pipeline_id/current_stage_id/due_date, and the
  -- project itself has a due_date.
  SELECT COUNT(*) INTO v_bad_reach FROM public.tasks
  WHERE project_id = v_project_id AND deleted_at IS NULL
    AND (pipeline_id IS NULL OR current_stage_id IS NULL OR due_date IS NULL);
  ASSERT v_bad_reach = 0, format('expected zero unreachable tasks, found %s', v_bad_reach);
  ASSERT (SELECT due_date FROM public.projects WHERE id = v_project_id) IS NOT NULL, 'expected the rolled-forward project to have a due_date';

  -- carry_mapping=true: category->board auto-derived from the SOURCE
  -- project's own usage -- Planning lands back on pipe_a/stage_a, Fieldwork
  -- on pipe_b/stage_b, same query shape components/tabs/_tasks_desktop.tsx
  -- uses (`.eq('pipeline_id', boardId)`, grouped by current_stage_id).
  SELECT COUNT(*) INTO v_board_a FROM public.tasks
  WHERE project_id = v_project_id AND pipeline_id = c.pipe_a AND current_stage_id = c.stage_a AND deleted_at IS NULL;
  ASSERT v_board_a = 2, format('expected 2 Planning tasks reachable on the SAME board pipe_a used last year, got %s', v_board_a);

  SELECT COUNT(*) INTO v_board_b FROM public.tasks
  WHERE project_id = v_project_id AND pipeline_id = c.pipe_b AND current_stage_id = c.stage_b AND deleted_at IS NULL;
  ASSERT v_board_b = 1, format('expected 1 Fieldwork task reachable on the SAME board pipe_b used last year, got %s', v_board_b);

  -- carry_assignments=true: the team carried into the mapping's
  -- assignee_team_id, so every new task got a task_assignments row.
  SELECT COUNT(*) INTO v_team_assigned FROM public.task_assignments ta
  JOIN public.tasks t ON t.id = ta.task_id
  WHERE t.project_id = v_project_id AND ta.assignee_team_id = c.team;
  ASSERT v_team_assigned = 3, format('expected all 3 new tasks team-assigned, got %s', v_team_assigned);

  -- carry_estimates=true: estimated_hours carried verbatim from the body.
  ASSERT (SELECT SUM(estimated_hours) FROM public.tasks WHERE project_id = v_project_id AND deleted_at IS NULL) = 10,
    format('expected estimated_hours to sum to 10 (3+2+5), got %s', (SELECT SUM(estimated_hours) FROM public.tasks WHERE project_id = v_project_id AND deleted_at IS NULL));

  -- carry_files=true: the LINK, not a copy.
  ASSERT (SELECT rolled_forward_from_project_id FROM public.projects WHERE id = v_project_id) = c.source_project,
    'expected rolled_forward_from_project_id to point at the source project';

  RAISE NOTICE 'OK (2/3): full carry -- reachable, mapping/team/estimates all carried verbatim from the source, file link set';

  -- Stash the full-carry project/portfolio ids in a session var (no second
  -- temp column needed) for the later file-access and undo assertions.
  PERFORM set_config('rf.full_project', v_project_id::text, false);
  PERFORM set_config('rf.full_portfolio', v_portfolio_id::text, false);
END $$;

-- ══ 3 (continued). Files are referenced, never copied ══════════════════════
DO $$
DECLARE
  c RECORD;
  v_project_id UUID := current_setting('rf.full_project')::uuid;
  v_files_before INT; v_files_after INT;
  v_can_see_direct BOOLEAN;
  v_can_see_via_link BOOLEAN;
  v_task_new UUID;
BEGIN
  SELECT * INTO c FROM rf_check_ctx;

  SELECT COUNT(*) INTO v_files_before FROM public.filehub_files WHERE deleted_at IS NULL;

  -- Give link_user a task in the NEW project only (never the old one), then
  -- prove: (a) they still cannot see the OLD project directly, (b) they CAN
  -- now reach its deliverable folder/file through the rolled-forward link,
  -- (c) the file count did not move -- the grant is read-time, not a copy.
  SELECT id INTO v_task_new FROM public.tasks WHERE project_id = v_project_id AND deleted_at IS NULL LIMIT 1;
  INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
  VALUES (v_task_new, c.company, c.link_user, c.owner);

  SELECT COUNT(*) INTO v_files_after FROM public.filehub_files WHERE deleted_at IS NULL;
  ASSERT v_files_after = v_files_before, format('expected ZERO new filehub_files rows from carry_files, before=%s after=%s', v_files_before, v_files_after);

  PERFORM set_config('request.jwt.claim.sub', c.link_user::text, true);

  SELECT public.fn_project_accessible(c.source_project) INTO v_can_see_direct;
  ASSERT v_can_see_direct = false, 'link_user should NOT have direct access to the source project (never assigned to it)';

  SELECT public.filehub_folder_accessible(c.source_folder) INTO v_can_see_via_link;
  ASSERT v_can_see_via_link = true, 'link_user should reach the SOURCE deliverable folder via rolled_forward_from_project_id now that they are assigned in the new project';

  RAISE NOTICE 'OK (3a): zero new filehub_files rows from carry_files, and the SECURITY DEFINER predicates grant access only through the rollforward link';
END $$;

-- Raw-table RLS check needs the actual `authenticated` role engaged (the
-- default `postgres` connection is BYPASSRLS and would prove nothing) --
-- SET LOCAL ROLE must be a top-level statement, not nested inside a DO block,
-- mirroring 20260801_project_visibility_check.sql's pattern. The
-- request.jwt.claim.sub GUC set above is transaction-local (is_local=true),
-- so it is still in effect here without being re-set.
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_file UUID := (SELECT source_file FROM rf_check_ctx);
BEGIN
  ASSERT EXISTS (SELECT 1 FROM public.filehub_files WHERE id = v_file),
    'filehub_files RLS should surface the linked source file to link_user via the project branch''s rollforward EXISTS clause';
  RAISE NOTICE 'OK (3b): filehub_files RLS (not just the SECURITY DEFINER predicate) surfaces the linked file';
END $$;
RESET ROLE;

-- ══ 4. carry_mapping=false requires + honors an explicit, DIFFERENT mapping ═
DO $$
DECLARE
  c RECORD; v_result JSONB; v_project_id UUID; v_on_c INT; v_caught BOOLEAN := false;
BEGIN
  SELECT * INTO c FROM rf_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.owner::text, true);

  -- Omitting category_mapping while carry_mapping=false must RAISE, naming
  -- the requirement rather than silently falling back to auto-derive.
  BEGIN
    PERFORM public.rpc_rollforward_project(
      c.source_project, 'RF Should Not Exist Either',
      jsonb_build_object('target_date', (CURRENT_DATE + 30)::text, 'anchor_direction', 'start',
        'idempotency_key', 'rf-selfcheck-nomap', 'carry_mapping', false)
    );
  EXCEPTION WHEN OTHERS THEN v_caught := true;
  END;
  ASSERT v_caught, 'expected carry_mapping=false with no category_mapping to RAISE';

  v_result := public.rpc_rollforward_project(
    c.source_project, 'RF Rollforward Remap ' || c.source_project::text,
    jsonb_build_object(
      'target_date', (CURRENT_DATE + 30)::text, 'anchor_direction', 'start',
      'idempotency_key', 'rf-selfcheck-remap-' || c.source_project::text,
      'carry_mapping', false,
      'category_mapping', jsonb_build_array(
        jsonb_build_object('category', 'Planning', 'pipeline_id', c.pipe_c),
        jsonb_build_object('category', 'Fieldwork', 'pipeline_id', c.pipe_c)
      )
    )
  );
  v_project_id := (v_result->>'project_id')::uuid;

  SELECT COUNT(*) INTO v_on_c FROM public.tasks
  WHERE project_id = v_project_id AND pipeline_id = c.pipe_c AND current_stage_id = c.stage_c AND deleted_at IS NULL;
  ASSERT v_on_c = 3, format('carry_mapping=false: expected all 3 tasks on the manually-chosen board pipe_c, got %s', v_on_c);

  RAISE NOTICE 'OK (4): carry_mapping=false requires and honors a fresh, DIFFERENT mapping instead of the source''s own boards';
END $$;

-- ══ 5. carry_assignments=false carries NO team, carry_estimates=false carries NO hours ═
DO $$
DECLARE
  c RECORD; v_result JSONB; v_project_id UUID; v_assigned INT; v_hours NUMERIC;
BEGIN
  SELECT * INTO c FROM rf_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.owner::text, true);

  v_result := public.rpc_rollforward_project(
    c.source_project, 'RF Rollforward Bare ' || c.source_project::text,
    jsonb_build_object(
      'target_date', (CURRENT_DATE + 30)::text, 'anchor_direction', 'start',
      'idempotency_key', 'rf-selfcheck-bare-' || c.source_project::text,
      'carry_assignments', false, 'carry_mapping', true, 'carry_estimates', false, 'carry_files', false
    )
  );
  v_project_id := (v_result->>'project_id')::uuid;

  SELECT COUNT(*) INTO v_assigned FROM public.task_assignments ta JOIN public.tasks t ON t.id = ta.task_id
  WHERE t.project_id = v_project_id;
  ASSERT v_assigned = 0, format('carry_assignments=false: expected zero task_assignments rows, got %s', v_assigned);

  SELECT COUNT(*) INTO v_hours FROM public.tasks WHERE project_id = v_project_id AND deleted_at IS NULL AND estimated_hours IS NOT NULL;
  ASSERT v_hours = 0, format('carry_estimates=false: expected zero tasks with a non-NULL estimated_hours, got %s', v_hours);

  ASSERT (SELECT rolled_forward_from_project_id FROM public.projects WHERE id = v_project_id) IS NULL,
    'carry_files=false: expected rolled_forward_from_project_id to stay NULL';

  RAISE NOTICE 'OK (5): carry_assignments=false and carry_estimates=false each independently suppress their field; carry_files=false leaves no link';
END $$;

-- ══ 6. Duplicate-name collision is legible, not a raw constraint error ═════
DO $$
DECLARE
  c RECORD; v_dupe_name TEXT; v_caught BOOLEAN := false; v_msg TEXT;
BEGIN
  SELECT * INTO c FROM rf_check_ctx;
  PERFORM set_config('request.jwt.claim.sub', c.owner::text, true);

  v_dupe_name := 'RF Already Active ' || c.source_project::text;
  INSERT INTO public.projects (company_id, name, status, created_by) VALUES (c.company, v_dupe_name, 'active', c.owner);

  BEGIN
    PERFORM public.rpc_rollforward_project(
      c.source_project, v_dupe_name,
      jsonb_build_object('target_date', (CURRENT_DATE + 30)::text, 'anchor_direction', 'start', 'idempotency_key', 'rf-selfcheck-dupe')
    );
  EXCEPTION WHEN OTHERS THEN
    v_caught := true; GET STACKED DIAGNOSTICS v_msg = MESSAGE_TEXT;
  END;
  ASSERT v_caught, 'expected a name colliding with an active project to RAISE';
  ASSERT v_msg LIKE '%' || v_dupe_name || '%', format('expected the error to NAME the offending project, got: %s', v_msg);
  ASSERT v_msg NOT LIKE '%constraint%', format('expected fn_check_batch_duplicate_names''s legible error, not a raw constraint violation, got: %s', v_msg);

  RAISE NOTICE 'OK (6): a colliding project name RAISEs a legible, offender-naming error via the same fn_check_batch_duplicate_names every other batch path uses';
END $$;

-- ══ 7. rpc_undo_portfolio_instantiation cleanly reverses a rollforward ═════
DO $$
DECLARE
  v_portfolio_id UUID := current_setting('rf.full_portfolio')::uuid;
  v_project_id   UUID := current_setting('rf.full_project')::uuid;
  v_undo JSONB;
BEGIN
  v_undo := public.rpc_undo_portfolio_instantiation(v_portfolio_id);
  ASSERT (v_undo->>'projects_removed')::int = 1, format('expected 1 project removed, got %s', v_undo->>'projects_removed');
  ASSERT (v_undo->>'tasks_removed')::int = 3, format('expected 3 tasks removed, got %s', v_undo->>'tasks_removed');
  ASSERT (SELECT deleted_at FROM public.projects WHERE id = v_project_id) IS NOT NULL, 'rolled-forward project should be soft-deleted after undo';
  ASSERT (SELECT deleted_at FROM public.portfolios WHERE id = v_portfolio_id) IS NOT NULL, 'the batch portfolio should be soft-deleted after undo';

  RAISE NOTICE 'OK (7): rpc_undo_portfolio_instantiation cleanly reverses a rollforward batch like any other portfolio_id';
END $$;

RESET ROLE;

DO $$ BEGIN
  RAISE NOTICE 'ALL CHECKS PASSED: rpc_rollforward_project -- reachability, all four toggles, referenced-not-copied files, access gating, duplicate-name legibility, and undo all hold.';
END $$;

ROLLBACK;
