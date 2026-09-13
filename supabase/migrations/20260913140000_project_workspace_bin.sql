-- Project workspace Bin: restore only deleted descendants of the project's
-- editable workspace. Standing folders and sealed deliverables are excluded by
-- the workspace-root ancestry query.
CREATE OR REPLACE FUNCTION public.rpc_project_workspace_bin(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_root uuid;
  v_company uuid;
BEGIN
  SELECT workspace_folder_id, company_id
  INTO v_root, v_company
  FROM public.projects
  WHERE id = p_project_id AND deleted_at IS NULL
    AND public.fn_project_accessible(id);
  IF NOT FOUND OR NOT public.has_permission('filehub:view') THEN
    RAISE EXCEPTION 'Project not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'folders', COALESCE((
      WITH RECURSIVE workspace_tree AS (
        SELECT f.id, f.parent_id, f.name, f.project_id, f.project_root_kind,
               f.deleted_at, f.created_at
        FROM public.filehub_folders f
        WHERE f.id = v_root AND f.company_id = v_company
          AND f.scope = 'project' AND f.project_id = p_project_id
          AND f.project_root_kind = 'workspace' AND f.deleted_at IS NULL
        UNION ALL
        SELECT f.id, f.parent_id, f.name, f.project_id, f.project_root_kind,
               f.deleted_at, f.created_at
        FROM public.filehub_folders f
        JOIN workspace_tree p ON p.id = f.parent_id
        WHERE f.company_id = v_company AND f.project_id = p_project_id
          AND f.scope = 'project' AND f.project_root_kind IS NULL
      )
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'parent_id', parent_id,
        'project_id', project_id, 'project_root_kind', project_root_kind,
        'deleted_at', deleted_at, 'created_at', created_at
      ) ORDER BY deleted_at DESC)
      FROM workspace_tree
      WHERE deleted_at IS NOT NULL
        AND deleted_at > now() - interval '15 days'
    ), '[]'::jsonb),
    'files', COALESCE((
      WITH RECURSIVE workspace_tree AS (
        SELECT id, parent_id
        FROM public.filehub_folders
        WHERE id = v_root AND company_id = v_company
          AND scope = 'project' AND project_id = p_project_id
          AND project_root_kind = 'workspace' AND deleted_at IS NULL
        UNION ALL
        SELECT f.id, f.parent_id
        FROM public.filehub_folders f
        JOIN workspace_tree p ON p.id = f.parent_id
        WHERE f.company_id = v_company AND f.project_id = p_project_id
          AND f.scope = 'project' AND f.project_root_kind IS NULL
      )
      SELECT jsonb_agg(jsonb_build_object(
        'id', f.id, 'name', f.original_name, 'folder_id', f.folder_id,
        'project_id', f.project_id, 'mime_type', f.mime_type,
        'size_bytes', f.size_bytes, 'bucket', f.bucket,
        'storage_path', f.storage_path, 'deleted_at', f.deleted_at,
        'created_at', f.created_at
      ) ORDER BY f.deleted_at DESC)
      FROM public.filehub_files f
      WHERE f.company_id = v_company AND f.project_id = p_project_id
        AND f.visibility = 'project' AND f.deleted_at IS NOT NULL
        AND f.deleted_at > now() - interval '15 days'
        AND EXISTS (SELECT 1 FROM workspace_tree t WHERE t.id = f.folder_id)
    ), '[]'::jsonb)
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_project_workspace_bin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_project_workspace_bin(uuid) TO authenticated;
