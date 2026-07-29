-- 20260716_filehub_group_name_conflict_folder_scoped.sql
-- rpc_filehub_check_name_conflict scoped 'direct' and 'broadcast' matches to
-- the destination folder, but the 'group' (channel) branch only matched on
-- group_id — so any file sharing a name anywhere in the channel was flagged
-- as "already exists here", even when the existing copy lives in a different
-- folder. Bring group in line with the other two visibilities.

CREATE OR REPLACE FUNCTION public.rpc_filehub_check_name_conflict(
    p_name       TEXT,
    p_visibility TEXT,
    p_group_id   UUID DEFAULT NULL,
    p_folder_id  UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_row        JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;
    IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
        RETURN NULL;
    END IF;

    SELECT jsonb_build_object(
        'id',            f.id,
        'original_name', f.original_name,
        'uploader_name', u.full_name,
        'size_bytes',    f.size_bytes,
        'created_at',    f.created_at
    )
    INTO v_row
    FROM public.filehub_files f
    LEFT JOIN public.users u ON u.id = f.uploaded_by
    WHERE f.deleted_at IS NULL
      AND f.company_id = v_company_id
      AND lower(trim(f.original_name)) = lower(trim(p_name))
      AND (
          (p_visibility = 'group'     AND f.visibility = 'group'
               AND f.group_id = p_group_id
               AND f.folder_id IS NOT DISTINCT FROM p_folder_id)
          OR (p_visibility = 'broadcast' AND f.visibility = 'broadcast'
               AND f.folder_id IS NOT DISTINCT FROM p_folder_id)
          OR (p_visibility = 'direct'    AND f.visibility = 'direct'
               AND f.uploaded_by = v_user_id
               AND f.folder_id IS NOT DISTINCT FROM p_folder_id)
      )
    ORDER BY f.created_at DESC
    LIMIT 1;

    RETURN v_row;  -- NULL if no conflict
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_check_name_conflict(TEXT,TEXT,UUID,UUID) TO authenticated;
