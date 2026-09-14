-- Structural contract check for issue #420, Package 1A.
--
-- Run against a database with the migrations applied.  This check is
-- It also creates throwaway behavioral fixtures below; the whole check is
-- wrapped in BEGIN/ROLLBACK and leaves no application data behind.

BEGIN;

DO $$
DECLARE
  v_fk_count integer;
BEGIN
  ASSERT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'projects'
      AND column_name = 'workspace_folder_id'
  ), 'projects.workspace_folder_id is missing';

  ASSERT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'filehub_folders'
      AND column_name = 'project_root_kind'
  ), 'filehub_folders.project_root_kind is missing';

  ASSERT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.filehub_folders'::regclass
      AND conname = 'filehub_folders_project_root_kind_chk'
  ), 'named project root kind constraint is missing';

  ASSERT EXISTS (
    SELECT 1
    FROM pg_class i
    JOIN pg_namespace n ON n.oid = i.relnamespace
    WHERE n.nspname = 'public'
      AND i.relname = 'idx_filehub_folders_project_root_live'
      AND i.relkind = 'i'
  ), 'named live project root index is missing';

  ASSERT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.projects'::regclass
      AND tgname = 'trg_projects_workspace_folder_contract'
      AND NOT tgisinternal
  ), 'project workspace pointer trigger is missing';

  ASSERT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgrelid = 'public.filehub_folders'::regclass
      AND tgname = 'trg_filehub_folders_project_ancestry_contract'
      AND NOT tgisinternal
  ), 'project folder ancestry trigger is missing';

  ASSERT position('deliverable_folder_id' IN pg_get_functiondef('public.fn_projects_workspace_folder_contract()'::regprocedure)) > 0,
    'project root pointer trigger does not validate deliverable_folder_id';

  ASSERT position('''upload'',public.fn_project_mutation_accessible(p_project_id)' IN pg_get_functiondef('public.rpc_project_files(uuid)'::regprocedure)) > 0,
    'project files RPC does not expose upload capability for authorized workspace mutations';

  ASSERT position('deleted_at' IN pg_get_triggerdef((
    SELECT oid FROM pg_trigger
    WHERE tgrelid = 'public.filehub_folders'::regclass
      AND tgname = 'trg_filehub_folders_project_ancestry_contract'
      AND NOT tgisinternal
  ))) > 0,
    'project root trigger does not fire for soft deletion';

  ASSERT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'fn_project_ensure_deliverable_folder'
      AND pg_get_functiondef(p.oid) LIKE '%project_root_kind%'
      AND pg_get_functiondef(p.oid) LIKE '%deliverable%'
  ), 'deliverable folder helper does not classify newly-created roots';

  SELECT count(*)
  INTO v_fk_count
  FROM pg_constraint
  WHERE conrelid = 'public.projects'::regclass
    AND contype = 'f'
    AND conname = 'projects_workspace_folder_id_fkey';
  ASSERT v_fk_count = 1, 'named workspace folder foreign key is missing';

  ASSERT NOT EXISTS (
    SELECT 1
    FROM public.filehub_folders f
    WHERE f.project_root_kind IS NOT NULL
      AND (
        f.project_root_kind NOT IN ('workspace', 'deliverable')
        OR f.scope <> 'project'
        OR f.project_id IS NULL
        OR f.parent_id IS NOT NULL
      )
  ), 'a non-root or non-project folder has a project root kind';

  ASSERT NOT EXISTS (
    SELECT 1
    FROM public.projects p
    LEFT JOIN public.filehub_folders f
      ON f.id = p.workspace_folder_id
    WHERE p.workspace_folder_id IS NOT NULL
      AND (
        f.id IS NULL
        OR f.company_id IS DISTINCT FROM p.company_id
        OR f.project_id IS DISTINCT FROM p.id
        OR f.scope IS DISTINCT FROM 'project'
        OR f.parent_id IS NOT NULL
        OR f.project_root_kind IS DISTINCT FROM 'workspace'
        OR f.deleted_at IS NOT NULL
      )
  ), 'a workspace pointer does not target its live same-project workspace root';

  ASSERT NOT EXISTS (
    SELECT 1
    FROM public.projects p
    LEFT JOIN public.filehub_folders f
      ON f.id = p.deliverable_folder_id
    WHERE p.deliverable_folder_id IS NOT NULL
      AND (
        f.id IS NULL
        OR f.company_id IS DISTINCT FROM p.company_id
        OR f.project_id IS DISTINCT FROM p.id
        OR f.scope IS DISTINCT FROM 'project'
        OR f.parent_id IS NOT NULL
        OR f.project_root_kind IS DISTINCT FROM 'deliverable'
        OR f.deleted_at IS NOT NULL
      )
  ), 'a deliverable pointer does not target its same-project deliverable root';

  ASSERT NOT EXISTS (
    SELECT 1
    FROM public.filehub_folders child
    JOIN public.filehub_folders parent ON parent.id = child.parent_id
    WHERE child.scope = 'project'
      AND (
        parent.scope IS DISTINCT FROM 'project'
        OR parent.project_id IS DISTINCT FROM child.project_id
        OR parent.company_id IS DISTINCT FROM child.company_id
      )
  ), 'a project folder has cross-project or cross-company ancestry';

  RAISE NOTICE 'OK: project workspace schema contract is present and current data satisfies root/pointer/ancestry invariants';
END $$;

-- Behavioral coverage for the capability consumed by the project Files UI.
-- Dedicated fixture roles keep these outcomes independent of seeded roles:
--   1. assigned non-owner with project.edit + filehub:view => upload=true;
--   2. assigned viewer with filehub:view but no project.edit => upload=false;
--   3. unassigned viewer with project.view + filehub:view but no project.edit
--      => fn_project_accessible and the RPC both deny it; and
--      an accessible project without a workspace remains upload=false.
CREATE TEMP TABLE pwc_capability_ctx (
  company UUID, mutator UUID, viewer UUID, denied UUID,
  with_workspace UUID, without_workspace UUID
);
GRANT SELECT ON pwc_capability_ctx TO authenticated;
SET LOCAL session_replication_role = replica;

DO $$
DECLARE
  v_company UUID;
  v_owner UUID;
  v_mutator UUID;
  v_viewer UUID;
  v_denied UUID;
  v_mutator_role UUID;
  v_viewer_role UUID;
  v_denied_role UUID;
  v_project UUID;
  v_no_workspace UUID;
  v_task UUID;
  v_tag TEXT := replace(gen_random_uuid()::text, '-', '');
BEGIN
  SELECT u.company_id, u.id INTO v_company, v_owner
  FROM public.users u
  WHERE u.is_owner = true AND u.deleted_at IS NULL AND u.is_active
  ORDER BY u.id
  LIMIT 1;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'No active owner user found for capability fixture.';
  END IF;

  -- Use fresh auth-backed identities so this check never mutates an existing
  -- user's company, ownership, roles, or assignments.
  v_mutator := gen_random_uuid();
  v_viewer := gen_random_uuid();
  v_denied := gen_random_uuid();
  INSERT INTO auth.users(id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_mutator, 'authenticated', 'authenticated', format('check-%s@test.invalid', v_mutator), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_viewer, 'authenticated', 'authenticated', format('check-%s@test.invalid', v_viewer), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_denied, 'authenticated', 'authenticated', format('check-%s@test.invalid', v_denied), '{}'::jsonb, '{}'::jsonb, now(), now());
  INSERT INTO public.users(id, company_id, email, is_owner, is_active)
  VALUES
    (v_mutator, v_company, format('check-%s@test.invalid', v_mutator), false, true),
    (v_viewer, v_company, format('check-%s@test.invalid', v_viewer), false, true),
    (v_denied, v_company, format('check-%s@test.invalid', v_denied), false, true);

  INSERT INTO public.roles (company_id, name)
  VALUES (v_company, 'PWC mutator ' || v_tag)
  RETURNING id INTO v_mutator_role;
  INSERT INTO public.roles (company_id, name)
  VALUES (v_company, 'PWC viewer ' || v_tag)
  RETURNING id INTO v_viewer_role;
  INSERT INTO public.roles (company_id, name)
  VALUES (v_company, 'PWC denied ' || v_tag)
  RETURNING id INTO v_denied_role;
  INSERT INTO public.user_roles (user_id, role_id, company_id) VALUES
    (v_mutator, v_mutator_role, v_company), (v_viewer, v_viewer_role, v_company);
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_mutator_role, p.id FROM public.permissions p WHERE p.key IN ('project.view', 'project.edit', 'filehub:view')
  UNION ALL
  SELECT v_viewer_role, p.id FROM public.permissions p WHERE p.key IN ('project.view', 'filehub:view');
  INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT v_denied_role, p.id FROM public.permissions p WHERE p.key IN ('project.view', 'filehub:view');

  INSERT INTO public.projects (company_id, name, owner_id, created_by)
  VALUES (v_company, 'PWC workspace ' || v_tag, v_owner, v_owner)
  RETURNING id INTO v_project;
  INSERT INTO public.tasks (company_id, project_id, title, created_by)
  VALUES (v_company, v_project, 'PWC mutator task ' || v_tag, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
  VALUES (v_task, v_company, v_mutator, v_owner);
  INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
  VALUES (v_task, v_company, v_viewer, v_owner);

  INSERT INTO public.projects (company_id, name, owner_id, created_by)
  VALUES (v_company, 'PWC no workspace ' || v_tag, v_owner, v_owner)
  RETURNING id INTO v_no_workspace;
  INSERT INTO public.tasks (company_id, project_id, title, created_by)
  VALUES (v_company, v_no_workspace, 'PWC no workspace viewer task ' || v_tag, v_owner)
  RETURNING id INTO v_task;
  INSERT INTO public.task_assignments (task_id, company_id, assignee_user_id, assigned_by)
  VALUES (v_task, v_company, v_viewer, v_owner);

  PERFORM set_config('request.jwt.claim.sub', v_owner::text, true);
  PERFORM public.rpc_project_ensure_workspace_folder(v_project);
  INSERT INTO pwc_capability_ctx VALUES (v_company, v_mutator, v_viewer, v_denied, v_project, v_no_workspace);
END $$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  c RECORD;
  v_result JSONB;
  v_msg TEXT;
  v_raised BOOLEAN;
BEGIN
  SELECT * INTO c FROM pwc_capability_ctx;

  PERFORM set_config('request.jwt.claim.sub', c.mutator::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.mutator::text, 'role', 'authenticated')::text, true);
  v_result := public.rpc_project_files(c.with_workspace);
  IF (v_result #>> '{workspace,capabilities,upload}') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'CHECK FAILED (capability 1): authorized project mutation should return upload=true, got %', v_result #> '{workspace,capabilities}';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', c.viewer::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.viewer::text, 'role', 'authenticated')::text, true);
  v_result := public.rpc_project_files(c.with_workspace);
  IF (v_result #>> '{workspace,capabilities,upload}') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'CHECK FAILED (capability 2): accessible view-only caller should return upload=false, got %', v_result #> '{workspace,capabilities}';
  END IF;
  v_result := public.rpc_project_files(c.without_workspace);
  IF (v_result #>> '{workspace,capabilities,upload}') IS DISTINCT FROM 'false' THEN
    RAISE EXCEPTION 'CHECK FAILED (capability 3): accessible project without workspace must fail closed with upload=false, got %', v_result #> '{workspace,capabilities}';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', c.denied::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', c.denied::text, 'role', 'authenticated')::text, true);
  IF public.fn_project_accessible(c.with_workspace) THEN
    RAISE EXCEPTION 'CHECK FAILED (capability 4): unassigned project.view/filehub:view caller unexpectedly passed fn_project_accessible';
  END IF;
  v_raised := false;
  BEGIN
    PERFORM public.rpc_project_files(c.with_workspace);
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    v_raised := true;
  END;
  IF NOT v_raised OR v_msg IS DISTINCT FROM 'Insufficient permissions to view projects.' THEN
    RAISE EXCEPTION 'CHECK FAILED (capability 5): denied caller was not fail-closed, raised=%, message=%', v_raised, v_msg;
  END IF;
  RAISE NOTICE 'OK: rpc_project_files upload capability is true only for authorized mutations and false for view-only, no-workspace, and denied callers';
END $$;

RESET ROLE;

RESET session_replication_role;

ROLLBACK;
