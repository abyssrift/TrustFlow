-- FileHub project-aware Browse projection contract (issue #429, Task 1).
-- Data-independent assertions intentionally run in a transaction and roll back.
BEGIN;

DO $$
DECLARE
  v_def text;
  v_view_def text;
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

  ASSERT to_regprocedure('public.rpc_filehub_browse(text,text[],uuid,text,text,timestamptz,integer,uuid,boolean,text[],uuid)') IS NOT NULL,
    'rpc_filehub_browse must expose the optional p_origins text[] and p_before_file_id uuid parameters';
  ASSERT to_regprocedure('public.rpc_filehub_browse(text,text[],uuid,text,text,timestamptz,integer,uuid,boolean,text[])') IS NULL,
    'rpc_filehub_browse must not retain the pre-cursor overload';
  ASSERT has_function_privilege('authenticated', 'public.rpc_filehub_browse(text,text[],uuid,text,text,timestamptz,integer,uuid,boolean,text[],uuid)', 'EXECUTE'),
    'authenticated must retain Browse RPC execute grant';
  ASSERT NOT has_function_privilege('anon', 'public.rpc_filehub_browse(text,text[],uuid,text,text,timestamptz,integer,uuid,boolean,text[],uuid)', 'EXECUTE'),
    'anon must not have Browse RPC execute grant';
  ASSERT position('fn_project_accessible' IN pg_get_functiondef('public.filehub_file_accessible(uuid)'::regprocedure)) > 0,
    'filehub_file_accessible must delegate project ACL to fn_project_accessible';

  v_def := pg_get_functiondef('public.rpc_filehub_browse(text,text[],uuid,text,text,timestamptz,integer,uuid,boolean,text[],uuid)'::regprocedure);
  ASSERT position('p_origins' IN v_def) > 0, 'Browse origin filter parameter is missing';
  ASSERT position('fi.folder_id' IN v_def) > 0
     AND position('c.folder_id' IN v_def) > 0,
    'Browse must return folder_id through both the direct and paginated result paths';
  ASSERT position('canonical_file_id' IN v_def) > 0, 'Browse must return canonical file identity';
  ASSERT position('canonical_version_id' IN v_def) > 0, 'Browse must return canonical version identity';
  ASSERT position('workspace_path' IN v_def) > 0, 'Browse must return workspace path';
  ASSERT position('fn_project_accessible' IN v_def) > 0, 'Browse must enforce project ACL through fn_project_accessible';
  ASSERT position('p_origins IS NULL OR' IN v_def) > 0, 'Browse must apply a server-side origin filter';
  ASSERT position('p_before_file_id' IN v_def) > 0, 'Browse cursor tie-breaker parameter is missing';
  ASSERT position('fi.created_at < p_before' IN v_def) > 0
     AND position('fi.created_at = p_before' IN v_def) > 0
     AND position('fi.file_id < p_before_file_id' IN v_def) > 0,
    'Browse must filter the next page by created_at and file_id';
  ASSERT position('ORDER BY fi.created_at DESC, fi.file_id DESC' IN v_def) > 0
     AND position('ORDER BY c.created_at DESC, c.file_id DESC' IN v_def) > 0
     AND position('ORDER BY a.created_at DESC, a.file_id DESC' IN v_def) > 0,
    'Browse pool, accepted rows, and results must use deterministic tie ordering';
  ASSERT position('WITH candidate AS' IN v_def) > 0
     AND position('LIMIT v_limit + 1' IN v_def) > 0
     AND position('v_pool > v_limit' IN v_def) > 0
     AND position('v_limit*3' IN v_def) = 0,
    'Browse must ACL-filter the candidate before the page limit and use exact has_more semantics';
  ASSERT position('AND CASE WHEN fi.origin IN (''workspace'',''deliverable'') THEN public.fn_project_accessible(fi.project_id)' IN v_def) > 0,
    'Browse candidate must retain the ACL predicate before LIMIT';
  ASSERT position('AND (p_project_id IS NULL OR fi.project_id=p_project_id)' IN v_def) > 0
     AND position('AND (p_category IS NULL OR fi.category=p_category OR fi.task_category=p_category)' IN v_def) > 0
     AND position('AND (p_type IS NULL OR public.file_mime_class(fi.mime_type)=p_type)' IN v_def) > 0
     AND position('AND (v_q='''' OR fi.file_name ILIKE' IN v_def) > 0,
    'Browse facets must apply project, category, type, and search filters';
  ASSERT position('filehub_file_version_id' IN pg_get_viewdef('public.files_index'::regclass, true)) > 0,
    'files_index must derive alias identity from existing FileHub version pointers';
  v_view_def := pg_get_viewdef('public.files_index'::regclass, true);
  ASSERT position('cf.bucket' IN v_view_def) > 0
     AND position('cv.bucket' IN v_view_def) > 0
     AND position('COALESCE' IN upper(v_view_def)) > 0,
    'task/submission Browse aliases must project the canonical FileHub bucket/path before legacy fallbacks';

  ASSERT NOT EXISTS (
    SELECT 1
    FROM public.files_index fi
    LEFT JOIN public.filehub_file_versions fv ON fv.id = fi.canonical_version_id
    WHERE fi.source IN ('task_brief', 'submission')
      AND fi.canonical_file_id IS NOT NULL
      AND (fv.id IS NULL OR fv.file_id IS DISTINCT FROM fi.canonical_file_id)
  ), 'task/submission Browse aliases must preserve file-to-version identity';

  ASSERT position('origin IN (''workspace'',''deliverable'')' IN v_def) > 0
     AND position('fn_project_accessible(fi.project_id)' IN v_def) > 0,
    'Browse must route both project origins through the shared project ACL';
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
CREATE TEMP TABLE filehub_project_browse_check_ctx (company_id uuid, project_id uuid, owner_subject uuid, denied_subject uuid);
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
  v_workspace_file uuid;
  v_workspace_version uuid;
  v_former_member_file uuid;
BEGIN
  SELECT company_id, id INTO v_company, v_owner
  FROM public.users WHERE is_owner AND company_id IS NOT NULL AND deleted_at IS NULL LIMIT 1;
  IF v_company IS NULL OR v_owner IS NULL THEN
    RAISE EXCEPTION 'CHECK FAILED: need an existing same-company owner for the ACL fixture';
  END IF;
  v_denied := gen_random_uuid();
  INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    VALUES(v_denied,'authenticated','authenticated',format('check-%s@test.invalid',v_denied),'{}'::jsonb,'{}'::jsonb,now(),now());
  INSERT INTO public.users(id,company_id,email,is_owner,is_active)
    VALUES(v_denied,v_company,format('check-%s@test.invalid',v_denied),false,true);
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
  INSERT INTO public.filehub_files(company_id,uploaded_by,storage_path,original_name,mime_type,size_bytes,visibility,folder_id,project_id)
    VALUES(v_company,v_owner,'chk-filehub-browse/workspace.bin','workspace.bin','application/octet-stream',1,'project',v_workspace,v_project)
    RETURNING id INTO v_workspace_file;
  INSERT INTO public.filehub_file_versions(file_id,company_id,version_no,storage_path,bucket,original_name,size_bytes,mime_type,created_by)
    VALUES(v_workspace_file,v_company,1,'chk-filehub-browse/workspace.bin','filehub-files','workspace.bin',1,'application/octet-stream',v_owner)
    RETURNING id INTO v_workspace_version;
  UPDATE public.filehub_files SET current_version_id=v_workspace_version WHERE id=v_workspace_file;
  INSERT INTO public.filehub_files(company_id,uploaded_by,storage_path,original_name,mime_type,size_bytes,visibility,folder_id,project_id)
    VALUES(v_company,v_denied,'chk-filehub-browse/former-member.bin','former-member.bin','application/octet-stream',1,'project',v_workspace,v_project)
    RETURNING id INTO v_former_member_file;
  INSERT INTO public.filehub_file_versions(file_id,company_id,version_no,storage_path,bucket,original_name,size_bytes,mime_type,created_by)
    VALUES(v_former_member_file,v_company,1,'chk-filehub-browse/former-member.bin','filehub-files','former-member.bin',1,'application/octet-stream',v_denied);
  INSERT INTO filehub_project_browse_check_ctx(company_id,project_id,owner_subject,denied_subject)
    VALUES(v_company,v_project,v_owner,v_denied);
  PERFORM set_config('check.former_member_file', v_former_member_file::text, true);
END $$;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  v_project uuid;
  v_company uuid;
  v_owner uuid;
  v_denied uuid;
  v_result jsonb;
  v_workspace_count integer;
  v_deliverable_count integer;
BEGIN
  SELECT company_id,project_id,owner_subject,denied_subject INTO v_company,v_project,v_owner,v_denied
  FROM filehub_project_browse_check_ctx;
  PERFORM set_config('request.jwt.claim.sub',v_owner::text,true);
  IF NOT public.fn_project_accessible(v_project) THEN
    RAISE EXCEPTION 'CHECK FAILED: owner fixture must pass fn_project_accessible';
  END IF;
  v_result := public.rpc_filehub_browse(
    p_project_id := v_project,
    p_origins := ARRAY['workspace','deliverable']::text[],
    p_limit := 200
  );
  SELECT count(*) FILTER (WHERE item->>'origin'='workspace'),
         count(*) FILTER (WHERE item->>'origin'='deliverable')
  INTO v_workspace_count,v_deliverable_count
  FROM jsonb_array_elements(v_result->'items') item;
  IF v_workspace_count < 1 OR v_deliverable_count < 1 THEN
    RAISE EXCEPTION 'CHECK FAILED: owner Browse must return both project origins (workspace %, deliverable %)',
      v_workspace_count,v_deliverable_count;
  END IF;

  -- The same valid project is now queried as a real same-company subject with
  -- no role, assignment, or project.view_all permission.
  PERFORM set_config('request.jwt.claim.sub',v_denied::text,true);
  PERFORM set_config('request.jwt.claims',json_build_object('sub',v_denied::text,'role','authenticated')::text,true);
  IF auth.uid() IS DISTINCT FROM v_denied THEN
    RAISE EXCEPTION 'CHECK FAILED: JWT subject did not resolve to denied fixture identity';
  END IF;
  IF public.my_company_id() IS DISTINCT FROM v_company THEN
    RAISE EXCEPTION 'CHECK FAILED: negative subject did not resolve to the fixture company';
  END IF;
  IF public.fn_project_accessible(v_project) THEN
    RAISE EXCEPTION 'CHECK FAILED: fixture actor unexpectedly passes fn_project_accessible';
  END IF;
  IF public.filehub_file_accessible(current_setting('check.former_member_file')::uuid) THEN
    RAISE EXCEPTION 'CHECK FAILED: former project member retained FileHub access through uploader ownership';
  END IF;
  IF EXISTS (SELECT 1 FROM public.filehub_files WHERE id=current_setting('check.former_member_file')::uuid) THEN
    RAISE EXCEPTION 'CHECK FAILED: table RLS retained FileHub access through uploader ownership';
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
