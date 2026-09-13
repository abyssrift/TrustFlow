-- Issue #420 / Package 1B: project workspace RPCs and mutation security.
-- Additive: legacy FileHub signatures remain available for direct/broadcast/
-- group callers; project calls use explicit project-aware trailing arguments.

CREATE OR REPLACE FUNCTION public.fn_project_mutation_accessible(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.fn_project_accessible(p_project_id)
     AND (public.has_permission('project.edit')
          OR EXISTS (SELECT 1 FROM public.projects p
                     WHERE p.id = p_project_id AND p.owner_id = auth.uid()))
     AND public.has_permission('filehub:view');
$$;
REVOKE EXECUTE ON FUNCTION public.fn_project_mutation_accessible(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fn_project_mutation_accessible(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_project_workspace_descendant(p_folder_id UUID, p_project_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH RECURSIVE chain AS (
    SELECT f.id,f.parent_id,f.project_id,f.scope,f.project_root_kind,f.deleted_at
    FROM public.filehub_folders f WHERE f.id=p_folder_id
    UNION ALL
    SELECT f.id,f.parent_id,f.project_id,f.scope,f.project_root_kind,f.deleted_at
    FROM public.filehub_folders f JOIN chain c ON f.id=c.parent_id
  )
  SELECT EXISTS (SELECT 1 FROM chain WHERE id=p_folder_id AND project_id=p_project_id AND scope='project')
     AND EXISTS (SELECT 1 FROM chain WHERE project_id=p_project_id AND scope='project' AND project_root_kind='workspace' AND parent_id IS NULL AND deleted_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM chain WHERE project_root_kind='deliverable');
$$;
REVOKE EXECUTE ON FUNCTION public.fn_project_workspace_descendant(UUID,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.fn_project_workspace_descendant(UUID,UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_project_ensure_workspace_folder(p_project_id UUID)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_project public.projects%ROWTYPE; v_id UUID;
BEGIN
  SELECT * INTO v_project FROM public.projects WHERE id=p_project_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND OR NOT public.has_permission('filehub:view') OR NOT public.fn_project_accessible(p_project_id) THEN
    RAISE EXCEPTION 'Project not found.';
  END IF;
  IF NOT (public.has_permission('project.edit') OR v_project.owner_id = auth.uid()) THEN RAISE EXCEPTION 'Project not found.'; END IF;
  IF v_project.workspace_folder_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.filehub_folders f
      WHERE f.id=v_project.workspace_folder_id AND f.company_id=v_project.company_id
        AND f.project_id=p_project_id AND f.scope='project' AND f.parent_id IS NULL
        AND f.project_root_kind='workspace' AND f.deleted_at IS NULL) THEN
      RETURN v_project.workspace_folder_id;
    END IF;
    IF EXISTS (SELECT 1 FROM public.filehub_folders f WHERE f.id=v_project.workspace_folder_id AND f.deleted_at IS NOT NULL) THEN
      RAISE EXCEPTION 'workspace_deleted';
    END IF;
  END IF;
  INSERT INTO public.filehub_folders(company_id,name,created_by,parent_id,scope,project_id,project_root_kind)
  VALUES(v_project.company_id,left(v_project.name,70) || ' Workspace',auth.uid(),NULL,'project',p_project_id,'workspace')
  ON CONFLICT (project_id, project_root_kind) WHERE scope='project' AND parent_id IS NULL AND project_root_kind IS NOT NULL AND deleted_at IS NULL
  DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.filehub_folders WHERE project_id=p_project_id AND project_root_kind='workspace' AND deleted_at IS NULL;
  END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'workspace_deleted'; END IF;
  UPDATE public.projects SET workspace_folder_id=v_id WHERE id=p_project_id;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_project_ensure_workspace_folder(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_project_ensure_workspace_folder(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_project_files(p_project_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_project RECORD; v_workspace JSONB := jsonb_build_object('root',NULL,'folders','[]'::jsonb,'files','[]'::jsonb,'capabilities',jsonb_build_object('view',true,'create',false,'rename',false,'move',false,'delete',false,'restore',false)); v_root JSONB;
BEGIN
  IF NOT public.has_permission('project.view') OR NOT public.has_permission('filehub:view') THEN RAISE EXCEPTION 'Insufficient permissions to view projects.'; END IF;
  SELECT p.*,c.name client_name,c.standing_folder_id INTO v_project FROM public.projects p LEFT JOIN public.clients c ON c.id=p.client_id AND c.deleted_at IS NULL WHERE p.id=p_project_id AND p.deleted_at IS NULL AND public.fn_project_accessible(p.id);
  IF NOT FOUND THEN RAISE EXCEPTION 'Project not found.'; END IF;
  IF v_project.workspace_folder_id IS NOT NULL THEN
    WITH RECURSIVE workspace_tree AS (
      SELECT r.id,r.parent_id,r.name,r.company_id,r.created_by,r.scope,r.project_id,r.project_root_kind,r.deleted_at,r.created_at
      FROM public.filehub_folders r
      WHERE r.id=v_project.workspace_folder_id AND r.company_id=v_project.company_id
        AND r.project_id=p_project_id AND r.scope='project' AND r.parent_id IS NULL
        AND r.project_root_kind='workspace' AND r.deleted_at IS NULL
      UNION ALL
      SELECT f.id,f.parent_id,f.name,f.company_id,f.created_by,f.scope,f.project_id,f.project_root_kind,f.deleted_at,f.created_at
      FROM public.filehub_folders f
      JOIN workspace_tree parent ON parent.id=f.parent_id
      WHERE f.project_id=p_project_id AND f.scope='project' AND f.project_root_kind IS NULL AND f.deleted_at IS NULL
    )
    SELECT jsonb_build_object('id',r.id,'name',r.name,'project_id',r.project_id,'project_root_kind',r.project_root_kind,'scope',r.scope,'deleted_at',r.deleted_at,
      'version_ids',COALESCE((SELECT jsonb_agg(DISTINCT fv.id) FROM public.filehub_files f JOIN public.filehub_file_versions fv ON fv.file_id=f.id WHERE f.folder_id=r.id),'[]'::jsonb),
      'activity_ids',COALESCE((SELECT jsonb_agg(DISTINCT a.id) FROM public.filehub_activity a JOIN public.filehub_files f ON f.id=a.file_id WHERE f.folder_id=r.id),'[]'::jsonb)) INTO v_root
    FROM public.filehub_folders r WHERE r.id=v_project.workspace_folder_id;
    WITH RECURSIVE workspace_tree AS (
      SELECT r.id,r.parent_id,r.name,r.company_id,r.created_by,r.scope,r.project_id,r.project_root_kind,r.deleted_at,r.created_at
      FROM public.filehub_folders r
      WHERE r.id=v_project.workspace_folder_id AND r.company_id=v_project.company_id
        AND r.project_id=p_project_id AND r.scope='project' AND r.parent_id IS NULL
        AND r.project_root_kind='workspace' AND r.deleted_at IS NULL
      UNION ALL
      SELECT f.id,f.parent_id,f.name,f.company_id,f.created_by,f.scope,f.project_id,f.project_root_kind,f.deleted_at,f.created_at
      FROM public.filehub_folders f
      JOIN workspace_tree parent ON parent.id=f.parent_id
      WHERE f.project_id=p_project_id AND f.scope='project' AND f.project_root_kind IS NULL AND f.deleted_at IS NULL
    )
    SELECT jsonb_build_object(
      'root',v_root,
      'folders',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.parent_id NULLS FIRST,t.name) FROM workspace_tree t),'[]'::jsonb),
      'files',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.original_name,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'bucket',f.bucket,'storage_path',f.storage_path,'folder_id',f.folder_id,'project_id',f.project_id,'current_version_id',f.current_version_id,'tags',f.tags,'created_at',f.created_at,'updated_at',f.updated_at,'activity_ids',COALESCE((SELECT jsonb_agg(a.id) FROM public.filehub_activity a WHERE a.file_id=f.id),'[]'::jsonb)) ORDER BY f.created_at DESC) FROM public.filehub_files f WHERE f.project_id=p_project_id AND f.visibility='project' AND f.deleted_at IS NULL AND EXISTS (SELECT 1 FROM workspace_tree t WHERE t.id=f.folder_id)),'[]'::jsonb),
      'capabilities',jsonb_build_object('view',true,'create',public.fn_project_mutation_accessible(p_project_id),'rename',public.fn_project_mutation_accessible(p_project_id),'move',public.fn_project_mutation_accessible(p_project_id),'delete',public.fn_project_mutation_accessible(p_project_id),'restore',public.fn_project_mutation_accessible(p_project_id))) INTO v_workspace;
  END IF;
  RETURN jsonb_build_object('deliverable_folder_id',v_project.deliverable_folder_id,'deliverable_files',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.original_name,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'bucket',f.bucket,'storage_path',f.storage_path,'created_at',f.created_at) ORDER BY f.created_at DESC) FROM public.filehub_files f WHERE f.folder_id=v_project.deliverable_folder_id AND f.deleted_at IS NULL),'[]'::jsonb),'deliverable_versions',CASE WHEN v_project.deliverable_folder_id IS NULL THEN '[]'::jsonb ELSE public.rpc_filehub_folder_versions(v_project.deliverable_folder_id) END,'client_id',v_project.client_id,'client_name',v_project.client_name,'standing_folder_id',v_project.standing_folder_id,'standing_files',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.original_name,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'bucket',f.bucket,'storage_path',f.storage_path,'created_at',f.created_at) ORDER BY f.created_at DESC) FROM public.filehub_files f WHERE f.folder_id=v_project.standing_folder_id AND f.deleted_at IS NULL),'[]'::jsonb),'workspace',v_workspace);
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_project_files(UUID) FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION public.rpc_project_files(UUID) TO authenticated;

-- Project-aware folder creation. Replace the old exact-arity function so
-- PostgREST has one unambiguous callable signature while existing four-argument
-- callers continue to use the trailing default.
DROP FUNCTION IF EXISTS public.rpc_filehub_folder_create(TEXT, UUID, TEXT, UUID);
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_create(p_name TEXT,p_parent_id UUID DEFAULT NULL,p_scope TEXT DEFAULT 'direct',p_group_id UUID DEFAULT NULL,p_project_id UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID; v_company UUID:=public.my_company_id(); v_user UUID:=auth.uid(); v_name TEXT:=trim(p_name);
BEGIN
  IF p_project_id IS NULL THEN
    IF NOT public.has_permission('filehub:view') THEN RAISE EXCEPTION 'Insufficient permissions.'; END IF;
    IF p_scope NOT IN ('direct','broadcast','group') THEN RAISE EXCEPTION 'Invalid folder scope.'; END IF;
    IF (p_scope = 'group') <> (p_group_id IS NOT NULL) THEN
      RAISE EXCEPTION 'Channel folders require a group; other scopes must not have one.';
    END IF;
    IF p_group_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.filehub_groups WHERE id=p_group_id AND company_id=v_company
    ) THEN RAISE EXCEPTION 'Channel not found in this company.'; END IF;
    IF p_parent_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.filehub_folders
      WHERE id=p_parent_id AND company_id=v_company AND scope=p_scope
        AND group_id IS NOT DISTINCT FROM p_group_id AND deleted_at IS NULL
    ) THEN RAISE EXCEPTION 'Parent folder does not exist in this scope.'; END IF;
    SELECT id INTO v_id FROM public.filehub_folders
    WHERE company_id=v_company AND name=v_name
      AND parent_id IS NOT DISTINCT FROM p_parent_id AND scope=p_scope
      AND group_id IS NOT DISTINCT FROM p_group_id AND deleted_at IS NULL;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    INSERT INTO public.filehub_folders(company_id,name,created_by,parent_id,scope,group_id)
    VALUES(v_company,v_name,v_user,p_parent_id,p_scope,p_group_id)
    ON CONFLICT DO NOTHING RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM public.filehub_folders
      WHERE company_id=v_company AND name=v_name
        AND parent_id IS NOT DISTINCT FROM p_parent_id AND scope=p_scope
        AND group_id IS NOT DISTINCT FROM p_group_id AND deleted_at IS NULL;
    END IF;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Cannot create folder "%" here.',v_name; END IF;
    RETURN v_id;
  END IF;

  IF NOT public.fn_project_mutation_accessible(p_project_id) THEN RAISE EXCEPTION 'Project not found.'; END IF;
  IF p_scope <> 'project' THEN RAISE EXCEPTION 'Project folders require project scope.'; END IF;
  IF p_parent_id IS NULL OR NOT public.fn_project_workspace_descendant(p_parent_id,p_project_id) THEN
    RAISE EXCEPTION 'Workspace parent not found.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.filehub_folders
    WHERE id=p_parent_id AND company_id=v_company AND scope='project'
      AND project_id=p_project_id AND deleted_at IS NULL)
  THEN RAISE EXCEPTION 'Workspace parent not found.'; END IF;
  SELECT id INTO v_id FROM public.filehub_folders
  WHERE company_id=v_company AND name=v_name AND parent_id=p_parent_id
    AND scope='project' AND project_id=p_project_id AND deleted_at IS NULL;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.filehub_folders(company_id,name,created_by,parent_id,scope,project_id)
  VALUES(v_company,v_name,v_user,p_parent_id,'project',p_project_id)
  ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.filehub_folders
    WHERE company_id=v_company AND name=v_name AND parent_id=p_parent_id
      AND scope='project' AND project_id=p_project_id AND deleted_at IS NULL;
  END IF;
  IF v_id IS NULL THEN RAISE EXCEPTION 'Cannot create workspace folder "%" here.',v_name; END IF;
  RETURN v_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_filehub_folder_create(TEXT,UUID,TEXT,UUID,UUID) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_create(TEXT,UUID,TEXT,UUID,UUID) TO authenticated;

-- Keep the two-argument call shape, adding a project-root safety layer.
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_move(p_id UUID,p_new_parent_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.filehub_folders%ROWTYPE;
BEGIN
 SELECT * INTO a FROM public.filehub_folders WHERE id=p_id AND company_id=public.my_company_id() AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Folder not found.'; END IF;
 IF a.project_root_kind IS NOT NULL THEN RAISE EXCEPTION 'Project roots cannot be moved or nested.'; END IF;
 IF a.scope='project' THEN
   IF NOT public.fn_project_mutation_accessible(a.project_id) THEN RAISE EXCEPTION 'Project not found.'; END IF;
   IF NOT public.fn_project_workspace_descendant(a.id,a.project_id) THEN RAISE EXCEPTION 'Sealed project folders cannot be moved.'; END IF;
   IF p_new_parent_id IS NULL THEN RAISE EXCEPTION 'Workspace folders must remain under the workspace root.'; END IF;
   IF NOT EXISTS (SELECT 1 FROM public.filehub_folders
     WHERE id=p_new_parent_id AND company_id=public.my_company_id()
       AND scope=a.scope AND group_id IS NOT DISTINCT FROM a.group_id AND deleted_at IS NULL)
      OR NOT public.fn_project_workspace_descendant(p_new_parent_id,a.project_id)
   THEN RAISE EXCEPTION 'Workspace destination not found.'; END IF;
 ELSE
   IF NOT public.has_permission('filehub:view') THEN RAISE EXCEPTION 'Insufficient permissions.'; END IF;
 END IF;
 IF p_new_parent_id=p_id OR EXISTS(WITH RECURSIVE d AS (SELECT id FROM public.filehub_folders WHERE parent_id=p_id AND company_id=public.my_company_id() UNION ALL SELECT f.id FROM public.filehub_folders f JOIN d ON f.parent_id=d.id WHERE f.company_id=public.my_company_id()) SELECT 1 FROM d WHERE id=p_new_parent_id) THEN RAISE EXCEPTION 'Cannot move a folder into its own subfolder.'; END IF;
 UPDATE public.filehub_folders SET parent_id=p_new_parent_id WHERE id=p_id AND company_id=public.my_company_id();
END; $$;

CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_delete(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.filehub_folders%ROWTYPE; v_deleted_at TIMESTAMPTZ:=now();
BEGIN
 SELECT * INTO f FROM public.filehub_folders WHERE id=p_id AND company_id=public.my_company_id() AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Folder not found.'; END IF;
 IF f.scope='project' THEN
   IF f.project_root_kind IS NOT NULL THEN RAISE EXCEPTION 'Project roots cannot be deleted.'; END IF;
   IF NOT public.fn_project_mutation_accessible(f.project_id) THEN RAISE EXCEPTION 'Project not found.'; END IF;
   IF NOT public.fn_project_workspace_descendant(f.id,f.project_id) THEN RAISE EXCEPTION 'Sealed project folders cannot be deleted.'; END IF;
 ELSIF NOT public.has_permission('filehub:view') THEN RAISE EXCEPTION 'Insufficient permissions.';
 END IF;
 WITH RECURSIVE d AS (SELECT id FROM public.filehub_folders WHERE id=p_id AND company_id=public.my_company_id() UNION ALL SELECT x.id FROM public.filehub_folders x JOIN d ON x.parent_id=d.id WHERE x.company_id=public.my_company_id())
 UPDATE public.filehub_files SET deleted_at=v_deleted_at WHERE company_id=public.my_company_id() AND folder_id IN (SELECT id FROM d) AND deleted_at IS NULL;
 WITH RECURSIVE d AS (SELECT id FROM public.filehub_folders WHERE id=p_id AND company_id=public.my_company_id() UNION ALL SELECT x.id FROM public.filehub_folders x JOIN d ON x.parent_id=d.id WHERE x.company_id=public.my_company_id())
 UPDATE public.filehub_folders SET deleted_at=v_deleted_at WHERE company_id=public.my_company_id() AND id IN (SELECT id FROM d) AND deleted_at IS NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_restore(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.filehub_folders%ROWTYPE; v_deleted_at TIMESTAMPTZ;
BEGIN
 SELECT * INTO f FROM public.filehub_folders WHERE id=p_id AND company_id=public.my_company_id() AND deleted_at IS NOT NULL AND deleted_at > now()-interval '15 days';
 IF NOT FOUND THEN RAISE EXCEPTION 'Folder not found in Bin, or the 15-day restore window has expired.'; END IF;
  IF f.scope='project' THEN
    IF f.project_root_kind IS NOT NULL OR NOT public.fn_project_mutation_accessible(f.project_id) OR NOT public.fn_project_workspace_descendant(f.id,f.project_id) THEN RAISE EXCEPTION 'Project folder is sealed or inaccessible.'; END IF;
  ELSIF NOT public.has_permission('filehub:view') THEN RAISE EXCEPTION 'Insufficient permissions.';
  END IF;
  v_deleted_at:=f.deleted_at;
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id,parent_id,deleted_at FROM public.filehub_folders WHERE id=p_id AND company_id=f.company_id
      UNION ALL
      SELECT parent.id,parent.parent_id,parent.deleted_at
      FROM public.filehub_folders parent JOIN ancestors child ON parent.id=child.parent_id
      WHERE parent.company_id=f.company_id
    )
    SELECT 1 FROM ancestors WHERE id<>p_id AND deleted_at IS NOT NULL AND deleted_at IS DISTINCT FROM v_deleted_at
  ) THEN
    RAISE EXCEPTION 'Parent folder is in Bin under a different deletion event; restore it first.';
  END IF;
  WITH RECURSIVE ancestors AS (
    SELECT id,parent_id FROM public.filehub_folders WHERE id=p_id AND company_id=f.company_id
    UNION ALL
    SELECT parent.id,parent.parent_id
    FROM public.filehub_folders parent JOIN ancestors child ON parent.id=child.parent_id
    WHERE parent.company_id=f.company_id
  )
  UPDATE public.filehub_folders SET deleted_at=NULL
  WHERE company_id=f.company_id AND id IN (SELECT id FROM ancestors) AND deleted_at=v_deleted_at;
  WITH RECURSIVE d AS (SELECT id FROM public.filehub_folders WHERE id=p_id AND company_id=public.my_company_id() UNION ALL SELECT x.id FROM public.filehub_folders x JOIN d ON x.parent_id=d.id WHERE x.company_id=public.my_company_id())
  UPDATE public.filehub_files SET deleted_at=NULL WHERE company_id=public.my_company_id() AND folder_id IN (SELECT id FROM d) AND deleted_at=v_deleted_at;
  WITH RECURSIVE d AS (SELECT id FROM public.filehub_folders WHERE id=p_id AND company_id=public.my_company_id() UNION ALL SELECT x.id FROM public.filehub_folders x JOIN d ON x.parent_id=d.id WHERE x.company_id=public.my_company_id())
  UPDATE public.filehub_folders SET deleted_at=NULL WHERE company_id=public.my_company_id() AND id IN (SELECT id FROM d) AND deleted_at=v_deleted_at;
END; $$;

CREATE OR REPLACE FUNCTION public.rpc_filehub_file_move(p_file_id UUID,p_folder_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.filehub_files%ROWTYPE;
BEGIN
 SELECT * INTO f FROM public.filehub_files WHERE id=p_file_id AND company_id=public.my_company_id() AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'File not found.'; END IF;
 IF f.visibility='project' THEN
   IF NOT public.fn_project_mutation_accessible(f.project_id) THEN RAISE EXCEPTION 'Project not found.'; END IF;
   IF f.folder_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.filehub_folders x WHERE x.id=f.folder_id AND x.deleted_at IS NULL) OR NOT public.fn_project_workspace_descendant(f.folder_id,f.project_id) THEN RAISE EXCEPTION 'Sealed project files cannot be moved.'; END IF;
   IF NOT EXISTS (SELECT 1 FROM public.filehub_folders
     WHERE id=p_folder_id AND company_id=public.my_company_id() AND deleted_at IS NULL AND scope='project' AND project_id=f.project_id)
      OR NOT public.fn_project_workspace_descendant(p_folder_id,f.project_id)
   THEN RAISE EXCEPTION 'Workspace destination not found.'; END IF;
 ELSE
   IF f.uploaded_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'File not found or you are not the uploader.'; END IF;
   IF p_folder_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.filehub_folders x WHERE x.id=p_folder_id AND x.company_id=f.company_id AND x.scope=CASE WHEN f.visibility='group' THEN 'group' WHEN f.visibility='broadcast' THEN 'broadcast' ELSE 'direct' END AND x.group_id IS NOT DISTINCT FROM f.group_id AND x.deleted_at IS NULL) THEN RAISE EXCEPTION 'Folder does not belong to this file''s context.'; END IF;
 END IF;
 UPDATE public.filehub_files SET folder_id=p_folder_id,updated_at=now(),updated_by=auth.uid() WHERE id=p_file_id AND company_id=public.my_company_id();
END; $$;

-- Project-aware rename uses a trailing default so existing two-argument callers remain valid.
DROP FUNCTION IF EXISTS public.rpc_filehub_folder_rename(UUID,TEXT);
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_rename(p_id UUID,p_name TEXT,p_project_id UUID DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.filehub_folders%ROWTYPE;
BEGIN SELECT * INTO f FROM public.filehub_folders WHERE id=p_id AND company_id=public.my_company_id() AND deleted_at IS NULL; IF NOT FOUND THEN RAISE EXCEPTION 'Folder not found.'; END IF; IF f.scope='project' THEN IF p_project_id IS DISTINCT FROM f.project_id OR NOT public.fn_project_mutation_accessible(f.project_id) OR f.project_root_kind IS NOT NULL OR NOT public.fn_project_workspace_descendant(f.id,f.project_id) THEN RAISE EXCEPTION 'Project folder cannot be renamed.'; END IF; ELSIF NOT public.has_permission('filehub:view') THEN RAISE EXCEPTION 'Insufficient permissions.'; END IF; UPDATE public.filehub_folders SET name=trim(p_name) WHERE id=p_id AND company_id=public.my_company_id(); END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_filehub_folder_rename(UUID,TEXT,UUID) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_rename(UUID,TEXT,UUID) TO authenticated;

-- Project-aware commit wrapper. Keep the established 14-argument FileHub
-- commit untouched so existing clients cannot hit an ambiguous overload.
-- Project uploads use an explicit project-first RPC and still create the same
-- FileHub file/version records in the same bucket and transaction.
DROP FUNCTION IF EXISTS public.rpc_project_filehub_upload_commit(UUID,TEXT,TEXT,UUID[],UUID,TEXT[],TEXT,TEXT,TEXT,BIGINT,TEXT,UUID,UUID,TEXT,UUID);
CREATE OR REPLACE FUNCTION public.rpc_project_filehub_upload_commit(p_project_id UUID,p_storage_path TEXT,p_visibility TEXT,p_recipient_ids UUID[] DEFAULT '{}',p_folder_id UUID DEFAULT NULL,p_tags TEXT[] DEFAULT '{}',p_caption TEXT DEFAULT NULL,p_original_name TEXT DEFAULT NULL,p_mime_type TEXT DEFAULT NULL,p_size_bytes BIGINT DEFAULT 0,p_content_hash TEXT DEFAULT NULL,p_replaces_file_id UUID DEFAULT NULL,p_group_id UUID DEFAULT NULL,p_rel_dir TEXT DEFAULT NULL,p_batch_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID; v_ver UUID; v_company UUID:=public.my_company_id(); v_user UUID:=auth.uid(); v_name TEXT; v_size_limit BIGINT; v_storage_limit BIGINT; v_storage_used BIGINT; v_lock_key BIGINT;
BEGIN
 IF p_visibility<>'project' OR NOT public.fn_project_mutation_accessible(p_project_id) THEN RAISE EXCEPTION 'Project not found.'; END IF;
 IF COALESCE(array_length(p_recipient_ids, 1), 0) > 0 OR p_group_id IS NOT NULL THEN RAISE EXCEPTION 'Project uploads cannot target recipients or groups.'; END IF;
 PERFORM public._rate_limit('file_upload',1000);
 v_size_limit:=public._company_file_size_limit(v_company); IF v_size_limit<>-1 AND p_size_bytes>v_size_limit THEN RAISE EXCEPTION 'File too large for your plan (% MB limit). Upgrade your plan to upload larger files.',round(v_size_limit::numeric/1048576); END IF;
 v_storage_limit:=public._company_storage_limit(v_company); IF v_storage_limit<>-1 THEN SELECT COALESCE(storage_used_bytes,0) INTO v_storage_used FROM public.company_billing WHERE company_id=v_company FOR UPDATE; IF COALESCE(v_storage_used,0)+p_size_bytes>v_storage_limit THEN RAISE EXCEPTION 'Storage quota exceeded (% MB of % MB used). Upgrade your plan.',round(COALESCE(v_storage_used,0)::numeric/1048576),round(v_storage_limit::numeric/1048576); END IF; END IF;
 IF p_original_name IS NULL OR length(trim(p_original_name))=0 THEN RAISE EXCEPTION 'Original filename is required.'; END IF;
 IF p_storage_path IS NULL OR length(trim(p_storage_path))=0 THEN RAISE EXCEPTION 'Storage path is required.'; END IF;
 IF p_rel_dir IS NOT NULL AND length(trim(p_rel_dir)) > 0 THEN RAISE EXCEPTION 'Project upload p_rel_dir is unsupported; create workspace folders explicitly.'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.filehub_folders WHERE id=p_folder_id AND company_id=v_company AND scope='project' AND project_id=p_project_id AND deleted_at IS NULL)
    OR NOT public.fn_project_workspace_descendant(p_folder_id,p_project_id) THEN RAISE EXCEPTION 'Workspace destination not found.'; END IF;
 IF p_replaces_file_id IS NOT NULL THEN RAISE EXCEPTION 'Project replacement must use rpc_filehub_replace_file.'; END IF;
 v_lock_key:=hashtextextended(v_company::text||'|project|'||p_project_id::text||'|'||p_folder_id::text,0); PERFORM pg_advisory_xact_lock(v_lock_key);
 v_name:=public.filehub_dedupe_name(p_original_name,'project',NULL,p_folder_id);
 INSERT INTO public.filehub_files(company_id,uploaded_by,storage_path,bucket,original_name,mime_type,size_bytes,content_hash,caption,visibility,folder_id,tags,project_id,updated_at,updated_by) VALUES(v_company,v_user,p_storage_path,'filehub-files',v_name,p_mime_type,p_size_bytes,p_content_hash,NULLIF(trim(coalesce(p_caption,'')),''),'project',p_folder_id,COALESCE(p_tags,'{}'),p_project_id,now(),v_user) RETURNING id INTO v_id;
 INSERT INTO public.filehub_file_versions(file_id,company_id,version_no,storage_path,bucket,original_name,size_bytes,mime_type,content_hash,created_by,superseded_at,batch_id) VALUES(v_id,v_company,1,p_storage_path,'filehub-files',v_name,p_size_bytes,p_mime_type,p_content_hash,v_user,NULL,p_batch_id) RETURNING id INTO v_ver;
 UPDATE public.filehub_files SET current_version_id=v_ver WHERE id=v_id;
 RETURN jsonb_build_object('fileId',v_id,'fileVersionId',v_ver,'versionId',v_ver);
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_project_filehub_upload_commit(UUID,TEXT,TEXT,UUID[],UUID,TEXT[],TEXT,TEXT,TEXT,BIGINT,TEXT,UUID,UUID,TEXT,UUID) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.rpc_project_filehub_upload_commit(UUID,TEXT,TEXT,UUID[],UUID,TEXT[],TEXT,TEXT,TEXT,BIGINT,TEXT,UUID,UUID,TEXT,UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_filehub_delete(p_file_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.filehub_files%ROWTYPE;
BEGIN
  SELECT * INTO f FROM public.filehub_files WHERE id=p_file_id AND company_id=public.my_company_id() AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'File not found.'; END IF;
 IF f.visibility='project' THEN
   IF NOT public.fn_project_mutation_accessible(f.project_id) THEN RAISE EXCEPTION 'Project not found.'; END IF;
   IF f.folder_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.filehub_folders x WHERE x.id=f.folder_id AND x.deleted_at IS NULL) OR NOT public.fn_project_workspace_descendant(f.folder_id,f.project_id) THEN RAISE EXCEPTION 'Deliverable files are sealed.'; END IF;
 ELSE
   IF f.uploaded_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'File not found or you are not the uploader.'; END IF;
 END IF;
  UPDATE public.filehub_files SET deleted_at=now(),updated_at=now(),updated_by=auth.uid() WHERE id=p_file_id AND company_id=public.my_company_id();
END; $$;

CREATE OR REPLACE FUNCTION public.rpc_filehub_restore(p_file_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.filehub_files%ROWTYPE;
BEGIN
  SELECT * INTO f FROM public.filehub_files WHERE id=p_file_id AND company_id=public.my_company_id() AND deleted_at IS NOT NULL AND deleted_at > now()-interval '15 days';
 IF NOT FOUND THEN RAISE EXCEPTION 'File not found in Bin, or the 15-day restore window has expired.'; END IF;
 IF f.visibility='project' THEN
   IF NOT public.fn_project_mutation_accessible(f.project_id) OR f.folder_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.filehub_folders x WHERE x.id=f.folder_id AND x.deleted_at IS NULL) OR NOT public.fn_project_workspace_descendant(f.folder_id,f.project_id) THEN RAISE EXCEPTION 'Project file is sealed or inaccessible.'; END IF;
 ELSE
   IF f.uploaded_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'File not found in Bin, or the 15-day restore window has expired.'; END IF;
 END IF;
  UPDATE public.filehub_files SET deleted_at=NULL,updated_at=now(),updated_by=auth.uid() WHERE id=p_file_id AND company_id=public.my_company_id();
END; $$;

CREATE OR REPLACE FUNCTION public.rpc_project_filehub_restore_version(p_project_id UUID,p_version_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.filehub_file_versions%ROWTYPE; f public.filehub_files%ROWTYPE; uid UUID:=auth.uid();
BEGIN
  SELECT * INTO v FROM public.filehub_file_versions WHERE id=p_version_id AND company_id=public.my_company_id();
 IF NOT FOUND THEN RAISE EXCEPTION 'Version not found.'; END IF;
  SELECT * INTO f FROM public.filehub_files WHERE id=v.file_id AND company_id=public.my_company_id() AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'File not found.'; END IF;
 IF f.visibility<>'project' OR p_project_id IS DISTINCT FROM f.project_id OR NOT public.fn_project_mutation_accessible(f.project_id) OR f.folder_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.filehub_folders x WHERE x.id=f.folder_id AND x.deleted_at IS NULL) OR NOT public.fn_project_workspace_descendant(f.folder_id,f.project_id) THEN RAISE EXCEPTION 'Project file is sealed or inaccessible.'; END IF;
 IF v.superseded_at IS NULL THEN RETURN; END IF;
  UPDATE public.filehub_file_versions SET superseded_at=now() WHERE file_id=f.id AND company_id=f.company_id AND superseded_at IS NULL AND id<>v.id;
  UPDATE public.filehub_file_versions SET superseded_at=NULL WHERE id=v.id AND company_id=f.company_id;
  UPDATE public.filehub_files SET current_version_id=v.id,storage_path=v.storage_path,original_name=v.original_name,size_bytes=v.size_bytes,mime_type=v.mime_type,content_hash=v.content_hash,updated_at=now(),updated_by=uid WHERE id=f.id AND company_id=f.company_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_project_filehub_restore_version(UUID,UUID) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.rpc_project_filehub_restore_version(UUID,UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_project_filehub_replace_file(p_project_id UUID,p_target_id UUID,p_storage_path TEXT,p_size_bytes BIGINT,p_content_hash TEXT,p_mime_type TEXT,p_caption TEXT DEFAULT NULL,p_batch_id UUID DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.filehub_files%ROWTYPE; n INT; vid UUID;
BEGIN
  SELECT * INTO f FROM public.filehub_files WHERE id=p_target_id AND company_id=public.my_company_id() AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'File not found.'; END IF;
 IF f.visibility<>'project' OR p_project_id IS DISTINCT FROM f.project_id OR NOT public.fn_project_mutation_accessible(f.project_id) OR f.folder_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.filehub_folders x WHERE x.id=f.folder_id AND x.deleted_at IS NULL) OR NOT public.fn_project_workspace_descendant(f.folder_id,f.project_id) THEN RAISE EXCEPTION 'Project file is sealed or inaccessible.'; END IF;
  UPDATE public.filehub_file_versions SET superseded_at=now() WHERE file_id=f.id AND company_id=f.company_id AND superseded_at IS NULL;
 SELECT COALESCE(MAX(version_no),0)+1 INTO n FROM public.filehub_file_versions WHERE file_id=f.id;
 INSERT INTO public.filehub_file_versions(file_id,company_id,version_no,storage_path,bucket,original_name,size_bytes,mime_type,content_hash,created_by,superseded_at,batch_id) VALUES(f.id,f.company_id,n,p_storage_path,'filehub-files',f.original_name,p_size_bytes,p_mime_type,p_content_hash,auth.uid(),NULL,p_batch_id) RETURNING id INTO vid;
  UPDATE public.filehub_files SET current_version_id=vid,storage_path=p_storage_path,size_bytes=p_size_bytes,mime_type=p_mime_type,content_hash=p_content_hash,caption=COALESCE(NULLIF(trim(coalesce(p_caption,'')),''),caption),updated_at=now(),updated_by=auth.uid() WHERE id=f.id AND company_id=f.company_id;
 RETURN vid;
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_project_filehub_replace_file(UUID,UUID,TEXT,BIGINT,TEXT,TEXT,TEXT,UUID) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION public.rpc_project_filehub_replace_file(UUID,UUID,TEXT,BIGINT,TEXT,TEXT,TEXT,UUID) TO authenticated;
