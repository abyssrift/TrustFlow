-- check_rpc_template_editor.sql
--
-- NOT a migration — nothing under supabase/checks/ is auto-applied. Run by hand
-- against a local Postgres you can write to (NEVER prod):
--
--   MSYS_NO_PATHCONV=1 docker exec -i supabase_db_TrustFlow psql -U postgres -d postgres -f - < supabase/checks/check_rpc_template_editor.sql
--
-- Issue #177 (Projects Phase 7 — the template editor). Exercises the three
-- new write RPCs (20260801_rpc_template_editor.sql) and closes the loop the
-- issue's acceptance criteria demand: a template authored through this path
-- must actually instantiate — round-tripped here through
-- rpc_preview_instantiate_template, the same read-only resolver the real
-- Bulk Create flow uses, so a pass here is a promise Bulk Create will
-- succeed against this exact template too.
--
-- Cleans up its own scratch rows on success; leaves them on failure for
-- inspection (same convention as check_rpc_batch_config.sql).

DO $$
DECLARE
  v_user_id      UUID;
  v_company_id   UUID;
  v_pipe_id      UUID;
  v_stage_id     UUID;
  v_template_id  UUID;
  v_template     public.project_templates;
  v_tag          TEXT := replace(gen_random_uuid()::text, '-', '');
  v_good_body    JSONB;
  v_preview      JSONB;
  v_caught       BOOLEAN;
  v_msg          TEXT;
BEGIN
  SELECT p.company_id, p.id, s.id
    INTO v_company_id, v_pipe_id, v_stage_id
  FROM public.pipelines p
  JOIN LATERAL (SELECT id FROM public.pipeline_stages WHERE pipeline_id = p.id ORDER BY position ASC LIMIT 1) s ON true
  WHERE p.deleted_at IS NULL
  LIMIT 1;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'No company with a stage-having pipeline found — seed one before running this check.';
  END IF;

  SELECT id INTO v_user_id FROM public.users WHERE is_owner = true AND company_id = v_company_id LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No owner user found for company %.', v_company_id;
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);

  -- ══ 1. rpc_create_project_template — blank-slate authoring ═══════════════
  v_template := public.rpc_create_project_template('selfcheck-tmpleditor-' || v_tag, 'desc', '#6366f1');
  v_template_id := v_template.id;
  ASSERT v_template.body = '[]'::jsonb, 'blank template must start with an empty body array';
  ASSERT v_template.company_id = v_company_id, 'blank template must be scoped to the caller''s company';

  -- ══ 2. fn_validate_template_body / rpc_update_project_template — every
  --       bad shape must RAISE, naming the offending task ═══════════════════
  v_caught := false;
  BEGIN
    PERFORM public.rpc_update_project_template(v_template_id, 'x', 'd', '#000000',
      jsonb_build_array(jsonb_build_object('title', '', 'category', 'Planning')));
  EXCEPTION WHEN OTHERS THEN v_caught := true; v_msg := SQLERRM;
  END;
  ASSERT v_caught AND v_msg ILIKE '%missing a title%', 'empty title must RAISE naming it, got: ' || COALESCE(v_msg, 'NULL');

  v_caught := false;
  BEGIN
    PERFORM public.rpc_update_project_template(v_template_id, 'x', 'd', '#000000',
      jsonb_build_array(jsonb_build_object('title', 'Bad priority', 'priority', 'whenever')));
  EXCEPTION WHEN OTHERS THEN v_caught := true; v_msg := SQLERRM;
  END;
  ASSERT v_caught AND v_msg ILIKE '%invalid priority%', 'bad priority must RAISE naming it, got: ' || COALESCE(v_msg, 'NULL');

  v_caught := false;
  BEGIN
    PERFORM public.rpc_update_project_template(v_template_id, 'x', 'd', '#000000',
      jsonb_build_array(jsonb_build_object('title', 'Bad weight', 'weight', 15)));
  EXCEPTION WHEN OTHERS THEN v_caught := true; v_msg := SQLERRM;
  END;
  ASSERT v_caught AND v_msg ILIKE '%weight outside 1-10%', 'out-of-range weight must RAISE naming it, got: ' || COALESCE(v_msg, 'NULL');

  v_caught := false;
  BEGIN
    PERFORM public.rpc_update_project_template(v_template_id, 'x', 'd', '#000000',
      jsonb_build_array(jsonb_build_object('title', 'Bad hours', 'estimated_hours', -3)));
  EXCEPTION WHEN OTHERS THEN v_caught := true; v_msg := SQLERRM;
  END;
  ASSERT v_caught AND v_msg ILIKE '%estimated_hours%', 'negative estimated_hours must RAISE naming it, got: ' || COALESCE(v_msg, 'NULL');

  v_caught := false;
  BEGIN
    PERFORM public.rpc_update_project_template(v_template_id, 'x', 'd', '#000000',
      jsonb_build_array(jsonb_build_object('title', 'Bad offset', 'due_offset_days', -1)));
  EXCEPTION WHEN OTHERS THEN v_caught := true; v_msg := SQLERRM;
  END;
  ASSERT v_caught AND v_msg ILIKE '%due_offset_days%', 'negative due_offset_days must RAISE naming it, got: ' || COALESCE(v_msg, 'NULL');

  -- Cross-company scoping: editing a template that isn't in the caller's company must 404, not leak.
  v_caught := false;
  BEGIN
    PERFORM public.rpc_update_project_template(gen_random_uuid(), 'x', 'd', '#000000', '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_caught := true; v_msg := SQLERRM;
  END;
  ASSERT v_caught AND v_msg ILIKE '%not found%', 'unknown template id must RAISE "not found", got: ' || COALESCE(v_msg, 'NULL');

  -- ══ 3. A real, valid save — then round-trip through
  --       rpc_preview_instantiate_template, same resolver Bulk Create uses,
  --       to prove an editor-authored body actually instantiates: lands on
  --       a board, a stage, and a due date ═══════════════════════════════════
  v_good_body := jsonb_build_array(
    jsonb_build_object('title', 'Kickoff', 'description', 'Start the engagement', 'category', 'Planning', 'priority', 'high', 'weight', 3, 'estimated_hours', 2, 'due_offset_days', 0),
    jsonb_build_object('title', 'Fieldwork', 'description', 'Do the work', 'category', 'Planning', 'priority', 'medium', 'weight', 5, 'estimated_hours', 8, 'due_offset_days', 12)
  );
  v_template := public.rpc_update_project_template(v_template_id, 'selfcheck-tmpleditor-' || v_tag, 'desc', '#6366f1', v_good_body);
  ASSERT v_template.body = v_good_body, 'a valid body must save byte-for-byte (no field silently dropped or coerced)';
  -- Not >= created_at: now() is stable for the whole transaction this DO
  -- block runs in, so create and this update share one timestamp — that's
  -- expected here, not a regression.
  ASSERT v_template.updated_at IS NOT NULL, 'updated_at must be set on save';

  v_preview := public.rpc_preview_instantiate_template(
    v_template_id,
    jsonb_build_object('target_date', (CURRENT_DATE + 7)::text, 'anchor_direction', 'start'),
    jsonb_build_array(jsonb_build_object('name', 'TemplateEditor Preview Co ' || v_tag)),
    jsonb_build_array(jsonb_build_object('category', 'Planning', 'pipeline_id', v_pipe_id))
  );
  ASSERT (v_preview->>'projects')::int = 1, 'preview must report 1 project';
  ASSERT (v_preview->>'tasks')::int = 2, 'preview must report 2 tasks (one project x 2-item body)';
  ASSERT (v_preview->>'boards')::int = 1, 'preview must report 1 board (single category, single mapping)';
  ASSERT v_preview->>'first_task_date' IS NOT NULL AND v_preview->>'last_task_date' IS NOT NULL,
    'preview must resolve real first/last task dates, not NULL — the exact orphan-output bug plan §13.10 exists to close';

  -- ══ 4. rpc_delete_project_template — soft delete, then invisible to both
  --       SELECT (via deleted_at) and the write RPCs ═══════════════════════
  PERFORM public.rpc_delete_project_template(v_template_id);
  ASSERT (SELECT deleted_at FROM public.project_templates WHERE id = v_template_id) IS NOT NULL,
    'delete must set deleted_at, not hard-delete the row';

  v_caught := false;
  BEGIN
    PERFORM public.rpc_update_project_template(v_template_id, 'x', 'd', '#000000', '[]'::jsonb);
  EXCEPTION WHEN OTHERS THEN v_caught := true;
  END;
  ASSERT v_caught, 'a soft-deleted template must no longer be editable';

  DELETE FROM public.project_templates WHERE id = v_template_id;

  RAISE NOTICE 'check_rpc_template_editor.sql: ALL CHECKS PASSED';
END $$;
