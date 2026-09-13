-- Structural contract check for issue #420, Package 1A.
--
-- Run against a database with the migrations applied.  This check is
-- intentionally data-independent: it verifies the schema objects and the
-- invariants that protect project workspace/deliverable roots without
-- creating or mutating application data.

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

ROLLBACK;
