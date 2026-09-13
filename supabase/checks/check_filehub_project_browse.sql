-- FileHub project-aware Browse projection contract (issue #429, Task 1).
-- Data-independent assertions intentionally run in a transaction and roll back.
BEGIN;

DO $$
DECLARE
  v_def text;
BEGIN
  FOREACH v_def IN ARRAY ARRAY[
    'project_id', 'workspace_folder_id', 'workspace_path', 'origin',
    'canonical_file_id', 'canonical_version_id'
  ] LOOP
    ASSERT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'files_index'
        AND column_name = v_def
    ), format('files_index is missing Browse projection column %s', v_def);
  END LOOP;

  ASSERT to_regprocedure('public.rpc_filehub_browse(text,text[],uuid,text,text,timestamptz,integer,uuid,boolean,text[])') IS NOT NULL,
    'rpc_filehub_browse must expose the optional p_origins text[] parameter';
  ASSERT position('fn_project_accessible' IN pg_get_functiondef('public.filehub_file_accessible(uuid)'::regprocedure)) > 0,
    'filehub_file_accessible must delegate project ACL to fn_project_accessible';

  v_def := pg_get_functiondef('public.rpc_filehub_browse(text,text[],uuid,text,text,timestamptz,integer,uuid,boolean,text[])'::regprocedure);
  ASSERT position('p_origins' IN v_def) > 0, 'Browse origin filter parameter is missing';
  ASSERT position('canonical_file_id' IN v_def) > 0, 'Browse must return canonical file identity';
  ASSERT position('canonical_version_id' IN v_def) > 0, 'Browse must return canonical version identity';
  ASSERT position('workspace_path' IN v_def) > 0, 'Browse must return workspace path';
  ASSERT position('fn_project_accessible' IN v_def) > 0, 'Browse must enforce project ACL through fn_project_accessible';
  ASSERT position('p_origins IS NULL OR' IN v_def) > 0, 'Browse must apply a server-side origin filter';
  ASSERT position('filehub_file_version_id' IN pg_get_viewdef('public.files_index'::regclass, true)) > 0,
    'files_index must derive alias identity from existing FileHub version pointers';

  ASSERT NOT EXISTS (
    SELECT 1
    FROM public.files_index fi
    LEFT JOIN public.filehub_file_versions fv ON fv.id = fi.canonical_version_id
    WHERE fi.source IN ('task_brief', 'submission')
      AND fi.canonical_file_id IS NOT NULL
      AND (fv.id IS NULL OR fv.file_id IS DISTINCT FROM fi.canonical_file_id)
  ), 'task/submission Browse aliases must preserve file-to-version identity';

  ASSERT position('origin=''workspace''' IN v_def) > 0
     AND position('fn_project_accessible(c.project_id)' IN v_def) > 0,
    'Browse must exclude inaccessible project rows through the shared project ACL';
  ASSERT position('visibility = ''project''' IN pg_get_functiondef('public.filehub_file_accessible(uuid)'::regprocedure)) > 0,
    'filehub_file_accessible must retain the project visibility branch';

  ASSERT NOT EXISTS (
    SELECT 1 FROM public.files_index fi
    WHERE fi.origin = 'workspace'
      AND (fi.project_id IS NULL OR fi.workspace_folder_id IS NULL
           OR fi.canonical_file_id IS NULL OR fi.canonical_version_id IS NULL)
  ), 'workspace rows must carry project and canonical FileHub identity';

  RAISE NOTICE 'OK: project-aware FileHub Browse projection and ACL contract is present';
END $$;

ROLLBACK;
