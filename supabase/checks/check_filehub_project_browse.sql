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
ASSERT position('deliverable' IN pg_get_viewdef('public.files_index'::regclass, true)) > 0,
    'files_index must distinguish sealed deliverable rows';
  ASSERT position('''workspace''' IN pg_get_viewdef('public.files_index'::regclass, true)) > 0
     AND position('''deliverable''' IN pg_get_viewdef('public.files_index'::regclass, true)) > 0,
    'files_index must expose both workspace and deliverable origins';
  ASSERT NOT EXISTS (
    SELECT 1 FROM public.files_index fi
    WHERE fi.origin NOT IN ('shared', 'workspace', 'deliverable', 'brief', 'submission')
  ), 'files_index contains an unsupported Browse origin';

  ASSERT NOT EXISTS (
    SELECT 1 FROM public.files_index fi
    WHERE fi.origin = 'workspace'
      AND (fi.project_id IS NULL OR fi.workspace_folder_id IS NULL
           OR fi.canonical_file_id IS NULL OR fi.canonical_version_id IS NULL)
  ), 'workspace rows must carry project and canonical FileHub identity';

  RAISE NOTICE 'OK: project-aware FileHub Browse projection and ACL contract is present';
END $$;

-- Behavioral ACL proof. Build valid throwaway rows from existing same-company
-- users, impersonate a non-owner with no assignment/view_all, execute the real
-- SECURITY DEFINER Browse RPC, and roll everything back. If the seeded schema
-- cannot supply both actors, fail closed instead of replacing this with text
-- inspection.
CREATE TEMP TABLE filehub_project_browse_check_ctx (project_id uuid, denied_subject uuid);
GRANT SELECT, INSERT ON filehub_project_browse_check_ctx TO authenticated;
SET LOCAL session_replication_role = replica;
DO $$
DECLARE
  v_company uuid;
  v_owner uuid;
  v_denied uuid := gen_random_uuid();
  v_project uuid;
  v_workspace uuid;
  v_deliverable uuid;
  v_file uuid;
  v_version uuid;
BEGIN
  SELECT company_id, id INTO v_company, v_owner
  FROM public.users WHERE is_owner AND company_id IS NOT NULL AND deleted_at IS NULL LIMIT 1;
  IF v_company IS NULL OR v_owner IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: need an existing same-company owner for the ACL fixture';
  END IF;
  INSERT INTO public.projects(company_id,name,created_by,owner_id)
    VALUES(v_company,'CHK FileHub Browse ACL',v_owner,v_owner) RETURNING id INTO v_project;
  INSERT INTO public.filehub_folders(company_id,name,created_by,scope,project_id,project_root_kind)
    VALUES(v_company,'CHK Browse Workspace',v_owner,'project',v_project,'workspace') RETURNING id INTO v_workspace;
  INSERT INTO public.filehub_folders(company_id,name,created_by,scope,project_id,project_root_kind)
    VALUES(v_company,'CHK Browse Deliverable',v_owner,'project',v_project,'deliverable') RETURNING id INTO v_deliverable;
  UPDATE public.projects SET workspace_folder_id=v_workspace, deliverable_folder_id=v_deliverable WHERE id=v_project;
  INSERT INTO public.filehub_files(company_id,uploaded_by,storage_path,original_name,mime_type,size_bytes,visibility,folder_id,project_id)
    VALUES(v_company,v_owner,'chk-filehub-browse/project.bin','project.bin','application/octet-stream',1,'project',v_deliverable,v_project)
    RETURNING id INTO v_file;
  INSERT INTO public.filehub_file_versions(file_id,company_id,version_no,storage_path,bucket,original_name,size_bytes,mime_type,created_by)
    VALUES(v_file,v_company,1,'chk-filehub-browse/project.bin','filehub-files','project.bin',1,'application/octet-stream',v_owner)
    RETURNING id INTO v_version;
  UPDATE public.filehub_files SET current_version_id=v_version WHERE id=v_file;
  INSERT INTO filehub_project_browse_check_ctx(project_id,denied_subject)
    VALUES(v_project,v_denied);
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_project uuid;
  v_denied uuid;
  v_result jsonb;
BEGIN
  SELECT project_id,denied_subject INTO v_project,v_denied FROM filehub_project_browse_check_ctx;
  PERFORM set_config('request.jwt.claim.sub',v_denied::text,true);
  IF public.fn_project_accessible(v_project) THEN
    RAISE EXCEPTION 'CHECK FAILED: fixture actor unexpectedly passes fn_project_accessible';
  END IF;
  v_result := public.rpc_filehub_browse(
    p_project_id := v_project,
    p_origins := ARRAY['workspace','deliverable']::text[],
    p_limit := 200
  );
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_result->'items') item
             WHERE item->>'project_id'=v_project::text) THEN
    RAISE EXCEPTION 'CHECK FAILED: unauthorized project appeared in rpc_filehub_browse';
  END IF;
  RAISE NOTICE 'OK: unauthorized project is excluded by the executing Browse ACL';
END $$;

ROLLBACK;
