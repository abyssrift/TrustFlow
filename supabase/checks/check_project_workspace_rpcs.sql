-- Focused structural/security check for Package 1B (#420).
-- The check is intentionally authored before the implementation migration.
-- Run against a disposable/local database; it rolls back all fixture changes.
BEGIN;

DO $$
DECLARE
  v_def text;
  v_acl text;
BEGIN
  ASSERT to_regprocedure('public.rpc_project_ensure_workspace_folder(uuid)') IS NOT NULL,
    'workspace ensure RPC is missing';
  ASSERT to_regprocedure('public.rpc_project_files(uuid)') IS NOT NULL,
    'project files RPC is missing';
  ASSERT to_regprocedure('public.rpc_project_workspace_bin(uuid)') IS NOT NULL,
    'project workspace Bin RPC is missing';

  SELECT pg_get_functiondef(to_regprocedure('public.rpc_project_ensure_workspace_folder(uuid)')) INTO v_def;
  ASSERT position('fn_project_accessible' IN v_def) > 0,
    'workspace ensure must use fn_project_accessible';
  ASSERT position('project.edit' IN v_def) > 0 AND position('filehub:view' IN v_def) > 0,
    'workspace ensure must require project.edit and filehub:view';
  ASSERT position('workspace_deleted' IN v_def) > 0,
    'workspace ensure must distinguish a soft-deleted workspace';
  ASSERT position('Project not found.' IN v_def) > 0,
    'workspace ensure must fold inaccessible/nonexistent projects to Project not found.';
  ASSERT position('FOR UPDATE' IN v_def) > 0,
    'workspace ensure must lock the project row';
  ASSERT position('search_path' IN v_def) > 0,
    'workspace ensure search_path is not hardened';

  SELECT pg_get_functiondef(to_regprocedure('public.rpc_project_files(uuid)')) INTO v_def;
  ASSERT position('standing_files' IN v_def) > 0 AND position('deliverable_files' IN v_def) > 0,
    'project files must retain standing/deliverable keys';
  ASSERT position('workspace' IN v_def) > 0 AND position('capabilities' IN v_def) > 0,
    'project files must expose typed workspace/capability data';
  ASSERT position('fn_project_accessible' IN v_def) > 0,
    'project files must use fn_project_accessible';
  ASSERT position('filehub:view' IN v_def) > 0,
    'project files must require FileHub visibility permission';

  ASSERT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.projects'::regclass AND attname = 'workspace_folder_id'
  ), 'projects.workspace_folder_id is missing';
  ASSERT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.filehub_folders'::regclass AND attname = 'project_root_kind'
  ), 'filehub_folders.project_root_kind is missing';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname = 'fn_project_mutation_accessible'
      AND pg_get_function_identity_arguments(p.oid) = 'p_project_id uuid'
  ), 'shared project mutation predicate is missing';
  ASSERT to_regprocedure('public.fn_project_workspace_descendant(uuid,uuid)') IS NOT NULL,
    'workspace ancestry helper is missing';
  ASSERT NOT has_function_privilege('anon', 'public.fn_project_ensure_deliverable_folder(uuid)', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'public.fn_project_ensure_deliverable_folder(uuid)', 'EXECUTE'),
    'deliverable root helper must not be directly callable by client roles';

  FOREACH v_def IN ARRAY ARRAY[
    'rpc_filehub_folder_create(text,uuid,text,uuid,uuid)',
    'rpc_filehub_folder_rename(uuid,text,uuid)',
    'rpc_filehub_folder_move(uuid,uuid)',
    'rpc_filehub_folder_delete(uuid)',
    'rpc_filehub_folder_restore(uuid)',
    'rpc_filehub_file_move(uuid,uuid)',
    'rpc_project_filehub_upload_commit(uuid,text,text,uuid[],uuid,text[],text,text,text,bigint,text,uuid,uuid,text,uuid)',
    'rpc_project_filehub_restore_version(uuid,uuid)',
    'rpc_project_filehub_replace_file(uuid,uuid,text,bigint,text,text,text,uuid)'
  ] LOOP
    ASSERT to_regprocedure('public.' || v_def) IS NOT NULL,
      'required project-aware FileHub signature is missing: ' || v_def;
    SELECT pg_get_functiondef(to_regprocedure('public.' || v_def)) INTO v_def;
    ASSERT position('search_path' IN v_def) > 0,
      'security-definer FileHub RPC is not hardened: ' || v_def;
  END LOOP;

  SELECT pg_get_functiondef(to_regprocedure('public.rpc_filehub_file_move(uuid,uuid)')) INTO v_def;
  ASSERT position('fn_project_mutation_accessible' IN v_def) > 0
     AND position('fn_project_workspace_descendant' IN v_def) > 0,
    'project file moves must use project mutation and workspace ancestry guards';
  SELECT pg_get_functiondef(to_regprocedure('public.rpc_filehub_folder_delete(uuid)')) INTO v_def;
  ASSERT position('project roots cannot be deleted' IN lower(v_def)) > 0,
    'project folder delete must reject roots';
  SELECT pg_get_functiondef(to_regprocedure('public.rpc_filehub_folder_restore(uuid)')) INTO v_def;
  ASSERT position('v_deleted_at' IN v_def) > 0
     AND position('Parent folder is in Bin under a different deletion event' IN v_def) > 0,
    'folder restore must preserve deletion events and restore an addressable ancestor chain';
  SELECT pg_get_functiondef(to_regprocedure('public.rpc_project_filehub_upload_commit(uuid,text,text,uuid[],uuid,text[],text,text,text,bigint,text,uuid,uuid,text,uuid)')) INTO v_def;
  ASSERT position('p_rel_dir is unsupported' IN v_def) > 0,
    'project upload must explicitly reject p_rel_dir';
  ASSERT pg_get_function_result(to_regprocedure('public.rpc_project_filehub_upload_commit(uuid,text,text,uuid[],uuid,text[],text,text,text,bigint,text,uuid,uuid,text,uuid)')) = 'jsonb',
    'project upload must return the committed FileHub file/version identity';

  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('rpc_project_ensure_workspace_folder', 'rpc_project_files')
      AND has_function_privilege('anon', p.oid, 'EXECUTE') = false
      AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  ), 'project RPC grants must be authenticated-only';

  RAISE NOTICE 'Package 1B structural/security assertions passed';
END $$;

ROLLBACK;
