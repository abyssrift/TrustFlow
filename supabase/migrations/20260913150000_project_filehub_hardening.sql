-- Issue #423 / deployment hardening for #420-#422.
--
-- This migration is intentionally additive.  The earlier workspace/RPC
-- migrations may already be applied in an environment, so security and
-- lifecycle corrections live here as well as in the source definitions.

-- Root pointers and folder roots remain protected when this migration is
-- applied after the original contract migration.
CREATE OR REPLACE FUNCTION public.fn_projects_workspace_folder_contract()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_folder public.filehub_folders%ROWTYPE;
BEGIN
  IF NEW.workspace_folder_id IS NOT NULL THEN
    SELECT * INTO v_folder FROM public.filehub_folders WHERE id = NEW.workspace_folder_id;
    IF NOT FOUND
       OR v_folder.company_id IS DISTINCT FROM NEW.company_id
       OR v_folder.project_id IS DISTINCT FROM NEW.id
       OR v_folder.scope IS DISTINCT FROM 'project'
       OR v_folder.parent_id IS NOT NULL
       OR v_folder.project_root_kind IS DISTINCT FROM 'workspace'
       OR v_folder.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'workspace_folder_id must reference a live same-company project workspace root';
    END IF;
  END IF;

  IF NEW.deliverable_folder_id IS NOT NULL THEN
    SELECT * INTO v_folder FROM public.filehub_folders WHERE id = NEW.deliverable_folder_id;
    IF NOT FOUND
       OR v_folder.company_id IS DISTINCT FROM NEW.company_id
       OR v_folder.project_id IS DISTINCT FROM NEW.id
       OR v_folder.scope IS DISTINCT FROM 'project'
       OR v_folder.parent_id IS NOT NULL
       OR v_folder.project_root_kind IS DISTINCT FROM 'deliverable'
       OR v_folder.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'deliverable_folder_id must reference a live same-company project deliverable root';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_workspace_folder_contract ON public.projects;
CREATE CONSTRAINT TRIGGER trg_projects_workspace_folder_contract
AFTER INSERT OR UPDATE ON public.projects
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION public.fn_projects_workspace_folder_contract();

CREATE OR REPLACE FUNCTION public.fn_filehub_folders_project_ancestry_contract()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE v_parent public.filehub_folders%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.project_root_kind IS NOT NULL AND (
    NEW.company_id IS DISTINCT FROM OLD.company_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.scope IS DISTINCT FROM OLD.scope
    OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
    OR NEW.project_root_kind IS DISTINCT FROM OLD.project_root_kind
    OR (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at AND NEW.deleted_at IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'project roots cannot be moved, nested, repurposed, or deleted';
  END IF;
  IF NEW.scope = 'project' AND NEW.parent_id IS NULL AND NEW.project_root_kind IS NULL THEN
    RAISE EXCEPTION 'project roots must be classified as workspace or deliverable';
  END IF;
  IF NEW.scope = 'project' AND NEW.parent_id IS NOT NULL THEN
    IF NEW.project_root_kind IS NOT NULL THEN
      RAISE EXCEPTION 'nested project folders cannot have a project root kind';
    END IF;
    SELECT * INTO v_parent FROM public.filehub_folders WHERE id = NEW.parent_id;
    IF NOT FOUND OR v_parent.scope IS DISTINCT FROM 'project'
       OR v_parent.project_id IS DISTINCT FROM NEW.project_id
       OR v_parent.company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'project folder ancestry must remain within the same company and project';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_filehub_folders_project_ancestry_contract ON public.filehub_folders;
CREATE TRIGGER trg_filehub_folders_project_ancestry_contract
BEFORE INSERT OR UPDATE OF company_id, project_id, scope, parent_id, project_root_kind, deleted_at
ON public.filehub_folders FOR EACH ROW
EXECUTE FUNCTION public.fn_filehub_folders_project_ancestry_contract();

-- Deliverables are created by trusted harvest workflows, not by direct
-- client calls.  SECURITY DEFINER callers retain their internal capability.
REVOKE EXECUTE ON FUNCTION public.fn_project_ensure_deliverable_folder(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_project_ensure_deliverable_folder(uuid)
  TO service_role;

-- The project read RPC must enforce both project visibility and FileHub
-- visibility; this definition also repairs the already-applied function.
CREATE OR REPLACE FUNCTION public.rpc_project_files(p_project_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE v_project RECORD; v_workspace JSONB := jsonb_build_object('root',NULL,'folders','[]'::jsonb,'files','[]'::jsonb,'capabilities',jsonb_build_object('view',true,'create',false,'rename',false,'move',false,'delete',false,'restore',false)); v_root JSONB;
BEGIN
  IF NOT public.has_permission('project.view') OR NOT public.has_permission('filehub:view') THEN RAISE EXCEPTION 'Insufficient permissions to view projects.'; END IF;
  SELECT p.*,c.name client_name,c.standing_folder_id INTO v_project
  FROM public.projects p
  LEFT JOIN public.clients c ON c.id=p.client_id AND c.deleted_at IS NULL
  WHERE p.id=p_project_id AND p.deleted_at IS NULL AND public.fn_project_accessible(p.id);
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
      FROM public.filehub_folders f JOIN workspace_tree parent ON parent.id=f.parent_id
      WHERE f.company_id=v_project.company_id AND f.project_id=p_project_id AND f.scope='project'
        AND f.project_root_kind IS NULL AND f.deleted_at IS NULL
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
      FROM public.filehub_folders f JOIN workspace_tree parent ON parent.id=f.parent_id
      WHERE f.company_id=v_project.company_id AND f.project_id=p_project_id AND f.scope='project'
        AND f.project_root_kind IS NULL AND f.deleted_at IS NULL
    )
    SELECT jsonb_build_object(
      'root',v_root,
      'folders',COALESCE((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.parent_id NULLS FIRST,t.name) FROM workspace_tree t),'[]'::jsonb),
      'files',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.original_name,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'bucket',f.bucket,'storage_path',f.storage_path,'folder_id',f.folder_id,'project_id',f.project_id,'current_version_id',f.current_version_id,'tags',f.tags,'created_at',f.created_at,'updated_at',f.updated_at,'activity_ids',COALESCE((SELECT jsonb_agg(a.id) FROM public.filehub_activity a WHERE a.file_id=f.id),'[]'::jsonb)) ORDER BY f.created_at DESC) FROM public.filehub_files f WHERE f.company_id=v_project.company_id AND f.project_id=p_project_id AND f.visibility='project' AND f.deleted_at IS NULL AND EXISTS (SELECT 1 FROM workspace_tree t WHERE t.id=f.folder_id)),'[]'::jsonb),
      'capabilities',jsonb_build_object('view',true,'create',public.fn_project_mutation_accessible(p_project_id),'rename',public.fn_project_mutation_accessible(p_project_id),'move',public.fn_project_mutation_accessible(p_project_id),'delete',public.fn_project_mutation_accessible(p_project_id),'restore',public.fn_project_mutation_accessible(p_project_id))) INTO v_workspace;
  END IF;
  RETURN jsonb_build_object('deliverable_folder_id',v_project.deliverable_folder_id,'deliverable_files',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.original_name,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'bucket',f.bucket,'storage_path',f.storage_path,'created_at',f.created_at) ORDER BY f.created_at DESC) FROM public.filehub_files f WHERE f.company_id=v_project.company_id AND f.folder_id=v_project.deliverable_folder_id AND f.deleted_at IS NULL),'[]'::jsonb),'deliverable_versions',CASE WHEN v_project.deliverable_folder_id IS NULL THEN '[]'::jsonb ELSE public.rpc_filehub_folder_versions(v_project.deliverable_folder_id) END,'client_id',v_project.client_id,'client_name',v_project.client_name,'standing_folder_id',v_project.standing_folder_id,'standing_files',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',f.id,'name',f.original_name,'mime_type',f.mime_type,'size_bytes',f.size_bytes,'bucket',f.bucket,'storage_path',f.storage_path,'created_at',f.created_at) ORDER BY f.created_at DESC) FROM public.filehub_files f WHERE f.company_id=v_project.company_id AND f.folder_id=v_project.standing_folder_id AND f.deleted_at IS NULL),'[]'::jsonb),'workspace',v_workspace);
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_project_files(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_project_files(UUID) TO authenticated;

-- Recreate the project-aware folder creation contract as well.  This covers
-- databases where the earlier RPC migration has already been recorded but
-- its function body was never deployed with the rest of the hardening.
DROP FUNCTION IF EXISTS public.rpc_filehub_folder_create(TEXT, UUID, TEXT, UUID);
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_create(
  p_name TEXT,
  p_parent_id UUID DEFAULT NULL,
  p_scope TEXT DEFAULT 'direct',
  p_group_id UUID DEFAULT NULL,
  p_project_id UUID DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_id UUID;
  v_company UUID := public.my_company_id();
  v_user UUID := auth.uid();
  v_name TEXT := trim(p_name);
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
  IF NOT EXISTS (
    SELECT 1 FROM public.filehub_folders
    WHERE id=p_parent_id AND company_id=v_company AND scope='project'
      AND project_id=p_project_id AND deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'Workspace parent not found.'; END IF;
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
REVOKE EXECUTE ON FUNCTION public.rpc_filehub_folder_create(TEXT,UUID,TEXT,UUID,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_create(TEXT,UUID,TEXT,UUID,UUID) TO authenticated;

-- Preserve the established folder hierarchy semantics for already-applied
-- RPCs: tenant/scope guards and exact timestamp file cascades.
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_move(p_id UUID,p_new_parent_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.filehub_folders%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.filehub_folders WHERE id=p_id AND company_id=public.my_company_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Folder not found.'; END IF;
  IF a.project_root_kind IS NOT NULL THEN RAISE EXCEPTION 'Project roots cannot be moved or nested.'; END IF;
  IF a.scope='project' THEN
    IF NOT public.fn_project_mutation_accessible(a.project_id) OR NOT public.fn_project_workspace_descendant(a.id,a.project_id) THEN RAISE EXCEPTION 'Sealed project folders cannot be moved.'; END IF;
    IF p_new_parent_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.filehub_folders WHERE id=p_new_parent_id AND company_id=a.company_id AND scope='project' AND project_id=a.project_id AND group_id IS NOT DISTINCT FROM a.group_id AND deleted_at IS NULL) OR NOT public.fn_project_workspace_descendant(p_new_parent_id,a.project_id) THEN RAISE EXCEPTION 'Workspace destination not found.'; END IF;
  ELSE
    IF NOT public.has_permission('filehub:view') THEN RAISE EXCEPTION 'Insufficient permissions.'; END IF;
    IF p_new_parent_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.filehub_folders WHERE id=p_new_parent_id AND company_id=a.company_id AND scope=a.scope AND group_id IS NOT DISTINCT FROM a.group_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Parent folder does not exist in this scope.'; END IF;
  END IF;
  IF p_new_parent_id=p_id OR EXISTS(WITH RECURSIVE d AS (SELECT id FROM public.filehub_folders WHERE parent_id=p_id AND company_id=a.company_id UNION ALL SELECT f.id FROM public.filehub_folders f JOIN d ON f.parent_id=d.id WHERE f.company_id=a.company_id) SELECT 1 FROM d WHERE id=p_new_parent_id) THEN RAISE EXCEPTION 'Cannot move a folder into its own subfolder.'; END IF;
  UPDATE public.filehub_folders SET parent_id=p_new_parent_id WHERE id=p_id AND company_id=a.company_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_filehub_folder_move(UUID,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_move(UUID,UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_filehub_file_move(p_file_id UUID,p_folder_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.filehub_files%ROWTYPE;
BEGIN
  SELECT * INTO f FROM public.filehub_files
  WHERE id=p_file_id AND company_id=public.my_company_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'File not found.'; END IF;
  IF f.visibility='project' THEN
    IF NOT public.fn_project_mutation_accessible(f.project_id) THEN RAISE EXCEPTION 'Project not found.'; END IF;
    IF f.folder_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.filehub_folders x WHERE x.id=f.folder_id AND x.company_id=f.company_id AND x.deleted_at IS NULL)
       OR NOT public.fn_project_workspace_descendant(f.folder_id,f.project_id)
    THEN RAISE EXCEPTION 'Sealed project files cannot be moved.'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.filehub_folders
      WHERE id=p_folder_id AND company_id=f.company_id AND deleted_at IS NULL
        AND scope='project' AND project_id=f.project_id
    ) OR NOT public.fn_project_workspace_descendant(p_folder_id,f.project_id)
    THEN RAISE EXCEPTION 'Workspace destination not found.'; END IF;
  ELSE
    IF f.uploaded_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'File not found or you are not the uploader.'; END IF;
    IF p_folder_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.filehub_folders x
      WHERE x.id=p_folder_id AND x.company_id=f.company_id
        AND x.scope=CASE WHEN f.visibility='group' THEN 'group' WHEN f.visibility='broadcast' THEN 'broadcast' ELSE 'direct' END
        AND x.group_id IS NOT DISTINCT FROM f.group_id AND x.deleted_at IS NULL
    ) THEN RAISE EXCEPTION 'Folder does not belong to this file''s context.'; END IF;
  END IF;
  UPDATE public.filehub_files SET folder_id=p_folder_id,updated_at=now(),updated_by=auth.uid()
  WHERE id=p_file_id AND company_id=f.company_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_filehub_file_move(UUID,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_file_move(UUID,UUID) TO authenticated;

-- Keep the legacy two-argument rename call shape while requiring the project
-- context for workspace folders.
DROP FUNCTION IF EXISTS public.rpc_filehub_folder_rename(UUID,TEXT);
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_rename(
  p_id UUID,
  p_name TEXT,
  p_project_id UUID DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.filehub_folders%ROWTYPE;
BEGIN
  SELECT * INTO f FROM public.filehub_folders
  WHERE id=p_id AND company_id=public.my_company_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Folder not found.'; END IF;
  IF f.scope='project' THEN
    IF p_project_id IS DISTINCT FROM f.project_id
       OR NOT public.fn_project_mutation_accessible(f.project_id)
       OR f.project_root_kind IS NOT NULL
       OR NOT public.fn_project_workspace_descendant(f.id,f.project_id)
    THEN RAISE EXCEPTION 'Project folder cannot be renamed.'; END IF;
  ELSIF NOT public.has_permission('filehub:view') THEN
    RAISE EXCEPTION 'Insufficient permissions.';
  END IF;
  UPDATE public.filehub_folders SET name=trim(p_name)
  WHERE id=p_id AND company_id=f.company_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_filehub_folder_rename(UUID,TEXT,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_rename(UUID,TEXT,UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_delete(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.filehub_folders%ROWTYPE; v_deleted_at TIMESTAMPTZ:=now();
BEGIN
  SELECT * INTO f FROM public.filehub_folders WHERE id=p_id AND company_id=public.my_company_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Folder not found.'; END IF;
  IF f.scope='project' THEN
    IF f.project_root_kind IS NOT NULL THEN RAISE EXCEPTION 'Project roots cannot be deleted.'; END IF;
    IF NOT public.fn_project_mutation_accessible(f.project_id) OR NOT public.fn_project_workspace_descendant(f.id,f.project_id) THEN RAISE EXCEPTION 'Sealed project folders cannot be deleted.'; END IF;
  ELSIF NOT public.has_permission('filehub:view') THEN RAISE EXCEPTION 'Insufficient permissions.'; END IF;
  WITH RECURSIVE d AS (SELECT id FROM public.filehub_folders WHERE id=p_id AND company_id=f.company_id UNION ALL SELECT x.id FROM public.filehub_folders x JOIN d ON x.parent_id=d.id WHERE x.company_id=f.company_id)
  UPDATE public.filehub_files SET deleted_at=v_deleted_at WHERE company_id=f.company_id AND folder_id IN (SELECT id FROM d) AND deleted_at IS NULL;
  WITH RECURSIVE d AS (SELECT id FROM public.filehub_folders WHERE id=p_id AND company_id=f.company_id UNION ALL SELECT x.id FROM public.filehub_folders x JOIN d ON x.parent_id=d.id WHERE x.company_id=f.company_id)
  UPDATE public.filehub_folders SET deleted_at=v_deleted_at WHERE company_id=f.company_id AND id IN (SELECT id FROM d) AND deleted_at IS NULL;
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_filehub_folder_delete(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_delete(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_restore(p_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.filehub_folders%ROWTYPE; v_deleted_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO f FROM public.filehub_folders WHERE id=p_id AND company_id=public.my_company_id() AND deleted_at IS NOT NULL AND deleted_at > now()-interval '15 days';
  IF NOT FOUND THEN RAISE EXCEPTION 'Folder not found in Bin, or the 15-day restore window has expired.'; END IF;
  IF f.scope='project' THEN
    IF f.project_root_kind IS NOT NULL OR NOT public.fn_project_mutation_accessible(f.project_id) OR NOT public.fn_project_workspace_descendant(f.id,f.project_id) THEN RAISE EXCEPTION 'Project folder is sealed or inaccessible.'; END IF;
  ELSIF NOT public.has_permission('filehub:view') THEN RAISE EXCEPTION 'Insufficient permissions.'; END IF;
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
  WITH RECURSIVE d AS (SELECT id FROM public.filehub_folders WHERE id=p_id AND company_id=f.company_id UNION ALL SELECT x.id FROM public.filehub_folders x JOIN d ON x.parent_id=d.id WHERE x.company_id=f.company_id)
  UPDATE public.filehub_files SET deleted_at=NULL WHERE company_id=f.company_id AND folder_id IN (SELECT id FROM d) AND deleted_at=v_deleted_at;
  WITH RECURSIVE d AS (SELECT id FROM public.filehub_folders WHERE id=p_id AND company_id=f.company_id UNION ALL SELECT x.id FROM public.filehub_folders x JOIN d ON x.parent_id=d.id WHERE x.company_id=f.company_id)
  UPDATE public.filehub_folders SET deleted_at=NULL WHERE company_id=f.company_id AND id IN (SELECT id FROM d) AND deleted_at=v_deleted_at;
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_filehub_folder_restore(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_restore(UUID) TO authenticated;

-- Repair the original project upload function's return type in databases that
-- already have the UUID-only version.  Drop the old exact signature first so
-- this remains safe when the earlier migration has already been applied.
DROP FUNCTION IF EXISTS public.rpc_project_filehub_upload_commit(UUID,TEXT,TEXT,UUID[],UUID,TEXT[],TEXT,TEXT,TEXT,BIGINT,TEXT,UUID,UUID,TEXT,UUID);
CREATE OR REPLACE FUNCTION public.rpc_project_filehub_upload_commit(p_project_id UUID,p_storage_path TEXT,p_visibility TEXT,p_recipient_ids UUID[] DEFAULT '{}',p_folder_id UUID DEFAULT NULL,p_tags TEXT[] DEFAULT '{}',p_caption TEXT DEFAULT NULL,p_original_name TEXT DEFAULT NULL,p_mime_type TEXT DEFAULT NULL,p_size_bytes BIGINT DEFAULT 0,p_content_hash TEXT DEFAULT NULL,p_replaces_file_id UUID DEFAULT NULL,p_group_id UUID DEFAULT NULL,p_rel_dir TEXT DEFAULT NULL,p_batch_id UUID DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id UUID; v_ver UUID; v_company UUID:=public.my_company_id(); v_user UUID:=auth.uid(); v_name TEXT; v_size_limit BIGINT; v_storage_limit BIGINT; v_storage_used BIGINT; v_lock_key BIGINT;
BEGIN
  IF p_visibility<>'project' OR NOT public.fn_project_mutation_accessible(p_project_id) THEN RAISE EXCEPTION 'Project not found.'; END IF;
  IF COALESCE(array_length(p_recipient_ids,1),0)>0 OR p_group_id IS NOT NULL THEN RAISE EXCEPTION 'Project uploads cannot target recipients or groups.'; END IF;
  PERFORM public._rate_limit('file_upload',1000);
  v_size_limit:=public._company_file_size_limit(v_company); IF v_size_limit<>-1 AND p_size_bytes>v_size_limit THEN RAISE EXCEPTION 'File too large for your plan (% MB limit). Upgrade your plan to upload larger files.',round(v_size_limit::numeric/1048576); END IF;
  v_storage_limit:=public._company_storage_limit(v_company); IF v_storage_limit<>-1 THEN SELECT COALESCE(storage_used_bytes,0) INTO v_storage_used FROM public.company_billing WHERE company_id=v_company FOR UPDATE; IF COALESCE(v_storage_used,0)+p_size_bytes>v_storage_limit THEN RAISE EXCEPTION 'Storage quota exceeded (% MB of % MB used). Upgrade your plan.',round(COALESCE(v_storage_used,0)::numeric/1048576),round(v_storage_limit::numeric/1048576); END IF; END IF;
  IF p_original_name IS NULL OR length(trim(p_original_name))=0 THEN RAISE EXCEPTION 'Original filename is required.'; END IF;
  IF p_storage_path IS NULL OR length(trim(p_storage_path))=0 THEN RAISE EXCEPTION 'Storage path is required.'; END IF;
  IF p_rel_dir IS NOT NULL AND length(trim(p_rel_dir))>0 THEN RAISE EXCEPTION 'Project upload p_rel_dir is unsupported; create workspace folders explicitly.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.filehub_folders WHERE id=p_folder_id AND company_id=v_company AND scope='project' AND project_id=p_project_id AND deleted_at IS NULL) OR NOT public.fn_project_workspace_descendant(p_folder_id,p_project_id) THEN RAISE EXCEPTION 'Workspace destination not found.'; END IF;
  IF p_replaces_file_id IS NOT NULL THEN RAISE EXCEPTION 'Project replacement must use rpc_filehub_replace_file.'; END IF;
  v_lock_key:=hashtextextended(v_company::text||'|project|'||p_project_id::text||'|'||p_folder_id::text,0); PERFORM pg_advisory_xact_lock(v_lock_key);
  v_name:=public.filehub_dedupe_name(p_original_name,'project',NULL,p_folder_id);
  INSERT INTO public.filehub_files(company_id,uploaded_by,storage_path,bucket,original_name,mime_type,size_bytes,content_hash,caption,visibility,folder_id,tags,project_id,updated_at,updated_by)
  VALUES(v_company,v_user,p_storage_path,'filehub-files',v_name,p_mime_type,p_size_bytes,p_content_hash,NULLIF(trim(COALESCE(p_caption,'')),''),'project',p_folder_id,COALESCE(p_tags,'{}'),p_project_id,now(),v_user)
  RETURNING id INTO v_id;
  INSERT INTO public.filehub_file_versions(file_id,company_id,version_no,storage_path,bucket,original_name,size_bytes,mime_type,content_hash,created_by,superseded_at,batch_id)
  VALUES(v_id,v_company,1,p_storage_path,'filehub-files',v_name,p_size_bytes,p_mime_type,p_content_hash,v_user,NULL,p_batch_id)
  RETURNING id INTO v_ver;
  UPDATE public.filehub_files SET current_version_id=v_ver WHERE id=v_id AND company_id=v_company;
  RETURN jsonb_build_object('fileId',v_id,'fileVersionId',v_ver,'versionId',v_ver);
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_project_filehub_upload_commit(UUID,TEXT,TEXT,UUID[],UUID,TEXT[],TEXT,TEXT,TEXT,BIGINT,TEXT,UUID,UUID,TEXT,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_project_filehub_upload_commit(UUID,TEXT,TEXT,UUID[],UUID,TEXT[],TEXT,TEXT,TEXT,BIGINT,TEXT,UUID,UUID,TEXT,UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_filehub_delete(p_file_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.filehub_files%ROWTYPE;
BEGIN
  SELECT * INTO f FROM public.filehub_files
  WHERE id=p_file_id AND company_id=public.my_company_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'File not found.'; END IF;
  IF f.visibility='project' THEN
    IF NOT public.fn_project_mutation_accessible(f.project_id) THEN RAISE EXCEPTION 'Project not found.'; END IF;
    IF f.folder_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.filehub_folders x WHERE x.id=f.folder_id AND x.company_id=f.company_id AND x.deleted_at IS NULL)
       OR NOT public.fn_project_workspace_descendant(f.folder_id,f.project_id)
    THEN RAISE EXCEPTION 'Deliverable files are sealed.'; END IF;
  ELSE
    IF f.uploaded_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'File not found or you are not the uploader.'; END IF;
  END IF;
  UPDATE public.filehub_files SET deleted_at=now(),updated_at=now(),updated_by=auth.uid()
  WHERE id=p_file_id AND company_id=f.company_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_filehub_delete(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_delete(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_filehub_restore(p_file_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.filehub_files%ROWTYPE;
BEGIN
  SELECT * INTO f FROM public.filehub_files
  WHERE id=p_file_id AND company_id=public.my_company_id()
    AND deleted_at IS NOT NULL AND deleted_at > now()-interval '15 days';
  IF NOT FOUND THEN RAISE EXCEPTION 'File not found in Bin, or the 15-day restore window has expired.'; END IF;
  IF f.visibility='project' THEN
    IF NOT public.fn_project_mutation_accessible(f.project_id)
       OR f.folder_id IS NULL
       OR NOT EXISTS (SELECT 1 FROM public.filehub_folders x WHERE x.id=f.folder_id AND x.company_id=f.company_id AND x.deleted_at IS NULL)
       OR NOT public.fn_project_workspace_descendant(f.folder_id,f.project_id)
    THEN RAISE EXCEPTION 'Project file is sealed or inaccessible.'; END IF;
  ELSE
    IF f.uploaded_by IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'File not found in Bin, or the 15-day restore window has expired.'; END IF;
  END IF;
  UPDATE public.filehub_files SET deleted_at=NULL,updated_at=now(),updated_by=auth.uid()
  WHERE id=p_file_id AND company_id=f.company_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_filehub_restore(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_restore(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_project_filehub_restore_version(p_project_id UUID,p_version_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v public.filehub_file_versions%ROWTYPE; f public.filehub_files%ROWTYPE; uid UUID:=auth.uid();
BEGIN
  SELECT * INTO v FROM public.filehub_file_versions WHERE id=p_version_id AND company_id=public.my_company_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Version not found.'; END IF;
  SELECT * INTO f FROM public.filehub_files WHERE id=v.file_id AND company_id=public.my_company_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'File not found.'; END IF;
  IF f.visibility<>'project' OR p_project_id IS DISTINCT FROM f.project_id
     OR NOT public.fn_project_mutation_accessible(f.project_id)
     OR f.folder_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.filehub_folders x WHERE x.id=f.folder_id AND x.company_id=f.company_id AND x.deleted_at IS NULL)
     OR NOT public.fn_project_workspace_descendant(f.folder_id,f.project_id)
  THEN RAISE EXCEPTION 'Project file is sealed or inaccessible.'; END IF;
  IF v.superseded_at IS NULL THEN RETURN; END IF;
  UPDATE public.filehub_file_versions SET superseded_at=now()
  WHERE file_id=f.id AND company_id=f.company_id AND superseded_at IS NULL AND id<>v.id;
  UPDATE public.filehub_file_versions SET superseded_at=NULL WHERE id=v.id AND company_id=f.company_id;
  UPDATE public.filehub_files SET current_version_id=v.id,storage_path=v.storage_path,
    original_name=v.original_name,size_bytes=v.size_bytes,mime_type=v.mime_type,
    content_hash=v.content_hash,updated_at=now(),updated_by=uid
  WHERE id=f.id AND company_id=f.company_id;
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_project_filehub_restore_version(UUID,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_project_filehub_restore_version(UUID,UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_project_filehub_replace_file(
  p_project_id UUID,p_target_id UUID,p_storage_path TEXT,p_size_bytes BIGINT,
  p_content_hash TEXT,p_mime_type TEXT,p_caption TEXT DEFAULT NULL,p_batch_id UUID DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.filehub_files%ROWTYPE; n INT; vid UUID;
BEGIN
  SELECT * INTO f FROM public.filehub_files
  WHERE id=p_target_id AND company_id=public.my_company_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'File not found.'; END IF;
  IF f.visibility<>'project' OR p_project_id IS DISTINCT FROM f.project_id
     OR NOT public.fn_project_mutation_accessible(f.project_id)
     OR f.folder_id IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.filehub_folders x WHERE x.id=f.folder_id AND x.company_id=f.company_id AND x.deleted_at IS NULL)
     OR NOT public.fn_project_workspace_descendant(f.folder_id,f.project_id)
  THEN RAISE EXCEPTION 'Project file is sealed or inaccessible.'; END IF;
  UPDATE public.filehub_file_versions SET superseded_at=now()
  WHERE file_id=f.id AND company_id=f.company_id AND superseded_at IS NULL;
  SELECT COALESCE(MAX(version_no),0)+1 INTO n FROM public.filehub_file_versions WHERE file_id=f.id;
  INSERT INTO public.filehub_file_versions(file_id,company_id,version_no,storage_path,bucket,original_name,size_bytes,mime_type,content_hash,created_by,superseded_at,batch_id)
  VALUES(f.id,f.company_id,n,p_storage_path,'filehub-files',f.original_name,p_size_bytes,p_mime_type,p_content_hash,auth.uid(),NULL,p_batch_id)
  RETURNING id INTO vid;
  UPDATE public.filehub_files SET current_version_id=vid,storage_path=p_storage_path,size_bytes=p_size_bytes,
    mime_type=p_mime_type,content_hash=p_content_hash,
    caption=COALESCE(NULLIF(trim(COALESCE(p_caption,'')),''),caption),updated_at=now(),updated_by=auth.uid()
  WHERE id=f.id AND company_id=f.company_id;
  RETURN vid;
END; $$;
REVOKE EXECUTE ON FUNCTION public.rpc_project_filehub_replace_file(UUID,UUID,TEXT,BIGINT,TEXT,TEXT,TEXT,UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_project_filehub_replace_file(UUID,UUID,TEXT,BIGINT,TEXT,TEXT,TEXT,UUID) TO authenticated;

-- Company scope repair for task brief creation in already-applied databases.
CREATE OR REPLACE FUNCTION public.rpc_add_task_attachments(p_task_id uuid, p_attachments jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE t record; item jsonb; new_id uuid; v jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  SELECT created_by, manager_id, company_id INTO t FROM public.tasks
  WHERE id = p_task_id AND company_id = public.my_company_id() AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'task not found' USING ERRCODE='P0002'; END IF;
  IF t.created_by <> auth.uid() AND (t.manager_id IS NULL OR t.manager_id <> auth.uid()) AND NOT public.has_permission('tasks.manage') THEN RAISE EXCEPTION 'permission denied' USING ERRCODE='42501'; END IF;
  FOR item IN SELECT * FROM jsonb_array_elements(p_attachments) LOOP
    INSERT INTO public.task_attachments(task_id,company_id,uploaded_by,file_name,file_url,file_size,mime_type,category,storage_path,filehub_file_id,filehub_file_version_id)
    VALUES(p_task_id,t.company_id,auth.uid(),item->>'file_name',item->>'file_url',(item->>'file_size')::bigint,item->>'mime_type',item->>'category',item->>'storage_path',NULLIF(item->>'filehub_file_id','')::uuid,NULLIF(item->>'filehub_file_version_id','')::uuid)
    RETURNING id INTO new_id;
    INSERT INTO public.task_attachment_versions(attachment_id,company_id,version_no,storage_path,file_name,file_size,mime_type,created_by,filehub_file_version_id)
    SELECT new_id,t.company_id,1,a.storage_path,a.file_name,a.file_size,a.mime_type,auth.uid(),a.filehub_file_version_id FROM public.task_attachments a WHERE a.id=new_id AND a.company_id=t.company_id;
    UPDATE public.task_attachments ta SET current_version_id=v.id FROM public.task_attachment_versions v WHERE v.attachment_id=new_id AND v.version_no=1 AND ta.id=new_id AND ta.company_id=t.company_id;
    v:=v||jsonb_build_object('id',new_id);
  END LOOP;
  RETURN v;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.rpc_add_task_attachments(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_add_task_attachments(uuid,jsonb) TO authenticated;

-- Explicit task/submission FileHub pointers are authoritative.  Re-derive all
-- denormalized legacy metadata from the immutable version so callers cannot
-- pair one FileHub identity with another object's storage path.
CREATE OR REPLACE FUNCTION public.filehub_link_task_file()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bucket text;
  v_task_id uuid;
  v_uploader uuid;
  v_existing uuid;
  v_final_name text;
  v_version_id uuid;
  v_storage_path text;
  v_original_name text;
  v_size bigint;
  v_mime_type text;
BEGIN
  IF NEW.filehub_file_version_id IS NOT NULL AND NEW.filehub_file_id IS NULL THEN
    RAISE EXCEPTION 'FileHub version pointers require a FileHub file pointer';
  END IF;
  IF NEW.filehub_file_id IS NOT NULL THEN
    IF TG_TABLE_NAME='task_attachments' THEN
      v_task_id := NEW.task_id;
    ELSE
      SELECT task_id INTO v_task_id FROM public.task_submissions WHERE id=NEW.submission_id;
    END IF;
    SELECT f.current_version_id INTO v_version_id
    FROM public.filehub_files f
    WHERE f.id=NEW.filehub_file_id AND f.company_id=NEW.company_id
      AND f.visibility='task' AND f.task_id=v_task_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'FileHub pointer does not belong to this company/task'; END IF;
    v_version_id:=COALESCE(NEW.filehub_file_version_id,v_version_id);
    SELECT v.storage_path,v.bucket,v.original_name,v.size_bytes,v.mime_type
    INTO v_storage_path,v_bucket,v_original_name,v_size,v_mime_type
    FROM public.filehub_file_versions v
    WHERE v.id=v_version_id AND v.file_id=NEW.filehub_file_id AND v.company_id=NEW.company_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'FileHub version pointer does not belong to the FileHub file'; END IF;
    NEW.filehub_file_version_id:=v_version_id;
    NEW.storage_path:=v_storage_path;
    NEW.file_url:=v_storage_path;
    NEW.file_name:=v_original_name;
    NEW.file_size:=v_size;
    NEW.mime_type:=v_mime_type;
    RETURN NEW;
  END IF;
  IF NEW.storage_path IS NULL THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME='task_attachments' THEN
    v_bucket:='task-attachments';
    v_task_id:=NEW.task_id;
    v_uploader:=COALESCE(NEW.uploaded_by,(SELECT created_by FROM public.tasks WHERE id=NEW.task_id));
  ELSE
    v_bucket:='submission-attachments';
    SELECT s.task_id,COALESCE(NEW.uploaded_by,s.submitted_by)
    INTO v_task_id,v_uploader FROM public.task_submissions s WHERE s.id=NEW.submission_id;
  END IF;
  IF v_uploader IS NULL OR v_task_id IS NULL THEN
    RAISE WARNING 'filehub_link_task_file: could not resolve task/uploader for % row %',TG_TABLE_NAME,NEW.id;
    RETURN NEW;
  END IF;
  PERFORM public.filehub_advisory_lock(NEW.company_id::text||'|task|'||v_task_id::text);
  SELECT id,current_version_id INTO v_existing,v_version_id
  FROM public.filehub_files
  WHERE company_id=NEW.company_id AND bucket=v_bucket AND storage_path=NEW.storage_path AND visibility='task'
  LIMIT 1;
  IF v_existing IS NULL THEN
    v_final_name:=public.filehub_dedupe_name(NEW.file_name,'task',NULL,NULL,v_task_id);
    INSERT INTO public.filehub_files(company_id,uploaded_by,storage_path,bucket,original_name,mime_type,size_bytes,visibility,task_id,created_at)
    VALUES(NEW.company_id,v_uploader,NEW.storage_path,v_bucket,v_final_name,NEW.mime_type,COALESCE(NEW.file_size,0),'task',v_task_id,COALESCE(NEW.created_at,now()))
    RETURNING id INTO v_existing;
    INSERT INTO public.filehub_file_versions(file_id,company_id,version_no,storage_path,bucket,original_name,size_bytes,mime_type,created_by)
    VALUES(v_existing,NEW.company_id,1,NEW.storage_path,v_bucket,v_final_name,COALESCE(NEW.file_size,0),NEW.mime_type,v_uploader)
    RETURNING id INTO v_version_id;
    UPDATE public.filehub_files SET current_version_id=v_version_id WHERE id=v_existing;
  END IF;
  NEW.filehub_file_id:=v_existing;
  NEW.filehub_file_version_id:=COALESCE(v_version_id,(SELECT current_version_id FROM public.filehub_files WHERE id=v_existing));
  RETURN NEW;
END;
$$;

-- The convergence migration introduced these SECURITY DEFINER RPCs; make the
-- deployed ACL explicit for environments that recorded that migration first.
REVOKE EXECUTE ON FUNCTION public.rpc_task_filehub_upload_commit(uuid,text,text,text,bigint,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_task_filehub_upload_commit(uuid,text,text,text,bigint,text,text,uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_task_filehub_replace_file(uuid,uuid,text,bigint,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_task_filehub_replace_file(uuid,uuid,text,bigint,text,text,text,uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_task_attachment_filehub_replace(uuid,uuid,text,text,bigint,text,text,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_task_attachment_filehub_replace(uuid,uuid,text,text,bigint,text,text,text,uuid) TO authenticated;

-- Physical-byte ownership claims.  Edge workers claim a path before storage
-- removal; all FileHub/legacy pointer writers reject a live claim.  Claims
-- expire so a crashed worker cannot strand future uploads indefinitely.
CREATE TABLE IF NOT EXISTS public.filehub_purge_claims (
  bucket text NOT NULL,
  storage_path text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (bucket, storage_path)
);
REVOKE ALL ON TABLE public.filehub_purge_claims FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rpc_filehub_purge_claim_target(
  p_bucket text,
  p_storage_path text,
  p_file_id uuid DEFAULT NULL,
  p_version_id uuid DEFAULT NULL,
  p_task_attachment_version_id uuid DEFAULT NULL,
  p_task_attachment_id uuid DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_bucket text := COALESCE(p_bucket,'filehub-files');
  v_rows integer;
BEGIN
  IF p_storage_path IS NULL OR length(trim(p_storage_path))=0 THEN RETURN false; END IF;

  -- The claim and every writer trigger use the same transaction-scoped
  -- advisory lock.  A path is therefore either observed as live before the
  -- claim, or blocked by the claim before the writer can commit.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_bucket||'|'||p_storage_path,0));
  IF v_bucket IN ('task-attachments','submission-attachments') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('filehub-files'||'|'||p_storage_path,0));
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.filehub_files f
    WHERE f.bucket=v_bucket AND f.storage_path=p_storage_path
      AND (p_version_id IS NOT NULL OR p_file_id IS NULL OR f.id<>p_file_id)
  ) OR EXISTS (
    SELECT 1 FROM public.filehub_file_versions v
    JOIN public.filehub_files f ON f.id=v.file_id
    WHERE v.bucket=v_bucket AND v.storage_path=p_storage_path
      AND (
        p_file_id IS NULL
        OR (p_version_id IS NULL AND v.file_id<>p_file_id)
        OR (p_version_id IS NOT NULL AND (v.file_id<>p_file_id OR v.id<>p_version_id))
      )
  ) OR (
    v_bucket='task-attachments' AND EXISTS (
      SELECT 1 FROM public.task_attachments a
      WHERE a.deleted_at IS NULL AND a.storage_path=p_storage_path
        AND (p_task_attachment_id IS NULL OR a.id<>p_task_attachment_id)
    )
  ) OR (
    v_bucket='task-attachments' AND EXISTS (
      SELECT 1 FROM public.task_attachment_versions av
      JOIN public.task_attachments a ON a.id=av.attachment_id
      WHERE av.bucket=v_bucket AND av.storage_path=p_storage_path
        AND (p_task_attachment_id IS NULL OR av.attachment_id<>p_task_attachment_id)
        AND (p_task_attachment_version_id IS NULL OR av.id<>p_task_attachment_version_id)
    )
  ) OR (
    v_bucket='submission-attachments' AND EXISTS (
      SELECT 1 FROM public.submission_attachments a
      WHERE a.storage_path=p_storage_path
    )
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO public.filehub_purge_claims(bucket,storage_path,claimed_at,expires_at)
  VALUES (v_bucket,p_storage_path,now(),now()+interval '10 minutes')
  ON CONFLICT (bucket,storage_path) DO UPDATE
    SET claimed_at=EXCLUDED.claimed_at, expires_at=EXCLUDED.expires_at
    WHERE public.filehub_purge_claims.expires_at <= now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- Keep the original two-argument service-worker contract available for
-- callers that do not need to identify their purge target.
CREATE OR REPLACE FUNCTION public.rpc_filehub_purge_claim(p_bucket text, p_storage_path text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT public.rpc_filehub_purge_claim_target(p_bucket,p_storage_path);
$$;

CREATE OR REPLACE FUNCTION public.rpc_filehub_purge_release(p_bucket text, p_storage_path text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  DELETE FROM public.filehub_purge_claims
  WHERE bucket=COALESCE(p_bucket,'filehub-files') AND storage_path=p_storage_path;
$$;

-- Delete one non-project leaf folder atomically. The row lock conflicts with
-- the FK's KEY SHARE lock during a concurrent child insert, so the child
-- check and hard delete cannot be separated by a race that would cascade into
-- a not-yet-eligible descendant.
CREATE OR REPLACE FUNCTION public.rpc_filehub_purge_folder_leaf(
  p_folder_id uuid,
  p_cutoff timestamptz,
  p_company_id uuid DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_company_id uuid;
BEGIN
  IF p_folder_id IS NULL THEN RETURN false; END IF;

  SELECT f.company_id INTO v_company_id
  FROM public.filehub_folders f
  WHERE f.id=p_folder_id
    AND f.deleted_at IS NOT NULL
    AND f.deleted_at < COALESCE(p_cutoff,now())
    AND f.project_id IS NULL
  FOR UPDATE;

  IF NOT FOUND OR (p_company_id IS NOT NULL AND v_company_id IS DISTINCT FROM p_company_id) THEN
    RETURN false;
  END IF;

  IF EXISTS (SELECT 1 FROM public.filehub_folders c WHERE c.parent_id=p_folder_id) THEN
    RETURN false;
  END IF;

  DELETE FROM public.filehub_folders f
  WHERE f.id=p_folder_id
    AND f.deleted_at IS NOT NULL
    AND f.deleted_at < COALESCE(p_cutoff,now())
    AND f.project_id IS NULL
    AND (p_company_id IS NULL OR f.company_id=p_company_id)
    AND NOT EXISTS (SELECT 1 FROM public.filehub_folders c WHERE c.parent_id=f.id);
  RETURN FOUND;
END;
$$;

-- Select only leaf candidates in the database before invoking the locked
-- single-folder delete. This prevents an arbitrary first page of parent rows
-- from starving eligible leaves later in the retention set.
CREATE OR REPLACE FUNCTION public.rpc_filehub_purge_folder_leaf_batch(
  p_cutoff timestamptz,
  p_company_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 200
)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_deleted integer := 0;
  v_folder_id uuid;
BEGIN
  FOR v_folder_id IN
    SELECT f.id
    FROM public.filehub_folders f
    WHERE f.deleted_at IS NOT NULL
      AND f.deleted_at < COALESCE(p_cutoff,now())
      AND f.project_id IS NULL
      AND (p_company_id IS NULL OR f.company_id=p_company_id)
      AND NOT EXISTS (SELECT 1 FROM public.filehub_folders c WHERE c.parent_id=f.id)
    ORDER BY f.deleted_at, f.id
    LIMIT LEAST(GREATEST(COALESCE(p_limit,200),1),1000)
  LOOP
    IF public.rpc_filehub_purge_folder_leaf(v_folder_id,p_cutoff,p_company_id) THEN
      v_deleted := v_deleted + 1;
    END IF;
  END LOOP;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_filehub_storage_path_claimed(p_bucket text, p_storage_path text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.filehub_purge_claims
    WHERE bucket=COALESCE(p_bucket,'filehub-files') AND storage_path=p_storage_path AND expires_at>now()
  );
$$;

CREATE OR REPLACE FUNCTION public.fn_filehub_purge_claim_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_bucket text; v_path text;
BEGIN
  IF TG_TABLE_NAME='filehub_files' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(NEW.bucket,'filehub-files')||'|'||NEW.storage_path,0));
    IF TG_OP='UPDATE' AND OLD.storage_path IS DISTINCT FROM NEW.storage_path THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(OLD.bucket,'filehub-files')||'|'||OLD.storage_path,0));
    END IF;
    IF TG_OP='UPDATE' AND NEW.deleted_at IS NOT NULL
       AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
       AND NEW.storage_path IS NOT DISTINCT FROM OLD.storage_path
       AND NEW.current_version_id IS NOT DISTINCT FROM OLD.current_version_id THEN
      RETURN NEW;
    END IF;
    IF public.fn_filehub_storage_path_claimed(NEW.bucket,NEW.storage_path) THEN RAISE EXCEPTION 'filehub storage path is being purged'; END IF;
  ELSIF TG_TABLE_NAME='filehub_file_versions' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(NEW.bucket,'filehub-files')||'|'||NEW.storage_path,0));
    IF TG_OP='UPDATE' AND OLD.storage_path IS DISTINCT FROM NEW.storage_path THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(COALESCE(OLD.bucket,'filehub-files')||'|'||OLD.storage_path,0));
    END IF;
    IF public.fn_filehub_storage_path_claimed(NEW.bucket,NEW.storage_path) THEN RAISE EXCEPTION 'filehub storage path is being purged'; END IF;
  ELSE
    IF NEW.storage_path IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtextextended('task-attachments'||'|'||NEW.storage_path,0));
      PERFORM pg_advisory_xact_lock(hashtextextended('submission-attachments'||'|'||NEW.storage_path,0));
      PERFORM pg_advisory_xact_lock(hashtextextended('filehub-files'||'|'||NEW.storage_path,0));
    END IF;
    IF NEW.storage_path IS NOT NULL AND EXISTS (SELECT 1 FROM public.filehub_purge_claims WHERE storage_path=NEW.storage_path AND expires_at>now()) THEN RAISE EXCEPTION 'filehub storage path is being purged'; END IF;
    IF NEW.filehub_file_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.filehub_files f WHERE f.id=NEW.filehub_file_id AND public.fn_filehub_storage_path_claimed(f.bucket,f.storage_path)) THEN RAISE EXCEPTION 'filehub file is being purged'; END IF;
    IF NEW.filehub_file_version_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.filehub_file_versions v WHERE v.id=NEW.filehub_file_version_id AND public.fn_filehub_storage_path_claimed(v.bucket,v.storage_path)) THEN RAISE EXCEPTION 'filehub version is being purged'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_filehub_files_purge_claim_guard ON public.filehub_files;
CREATE TRIGGER trg_filehub_files_purge_claim_guard BEFORE INSERT OR UPDATE OF bucket,storage_path,deleted_at,current_version_id ON public.filehub_files FOR EACH ROW EXECUTE FUNCTION public.fn_filehub_purge_claim_guard();
DROP TRIGGER IF EXISTS trg_filehub_versions_purge_claim_guard ON public.filehub_file_versions;
CREATE TRIGGER trg_filehub_versions_purge_claim_guard BEFORE INSERT OR UPDATE ON public.filehub_file_versions FOR EACH ROW EXECUTE FUNCTION public.fn_filehub_purge_claim_guard();
DROP TRIGGER IF EXISTS trg_task_attachments_purge_claim_guard ON public.task_attachments;
CREATE TRIGGER trg_task_attachments_purge_claim_guard BEFORE INSERT OR UPDATE ON public.task_attachments FOR EACH ROW EXECUTE FUNCTION public.fn_filehub_purge_claim_guard();
DROP TRIGGER IF EXISTS trg_task_attachment_versions_purge_claim_guard ON public.task_attachment_versions;
CREATE TRIGGER trg_task_attachment_versions_purge_claim_guard BEFORE INSERT OR UPDATE ON public.task_attachment_versions FOR EACH ROW EXECUTE FUNCTION public.fn_filehub_purge_claim_guard();
DROP TRIGGER IF EXISTS trg_submission_attachments_purge_claim_guard ON public.submission_attachments;
CREATE TRIGGER trg_submission_attachments_purge_claim_guard BEFORE INSERT OR UPDATE ON public.submission_attachments FOR EACH ROW EXECUTE FUNCTION public.fn_filehub_purge_claim_guard();

REVOKE ALL ON FUNCTION public.rpc_filehub_purge_claim(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_purge_claim(text,text) TO service_role;
REVOKE ALL ON FUNCTION public.rpc_filehub_purge_claim_target(text,text,uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_purge_claim_target(text,text,uuid,uuid,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.rpc_filehub_purge_release(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_purge_release(text,text) TO service_role;
REVOKE ALL ON FUNCTION public.rpc_filehub_purge_folder_leaf(uuid,timestamptz,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_purge_folder_leaf(uuid,timestamptz,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.rpc_filehub_purge_folder_leaf_batch(timestamptz,uuid,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_purge_folder_leaf_batch(timestamptz,uuid,integer) TO service_role;
REVOKE ALL ON FUNCTION public.fn_filehub_storage_path_claimed(text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.fn_filehub_purge_claim_guard() FROM PUBLIC,anon,authenticated;

-- These converged mutators are SECURITY DEFINER and must remain session-only.
REVOKE EXECUTE ON FUNCTION public.rpc_replace_task_attachment(uuid,text,text,bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_replace_task_attachment(uuid,text,text,bigint,text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_edit_submission(uuid,text,uuid[],jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rpc_edit_submission(uuid,text,uuid[],jsonb) TO authenticated;
