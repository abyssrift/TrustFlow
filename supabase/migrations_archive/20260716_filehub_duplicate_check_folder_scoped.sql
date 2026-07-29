-- 20260716_filehub_duplicate_check_folder_scoped.sql
-- Duplicate detection was company-wide: uploading the same file into two
-- different folders (e.g. a cert filed under both a task subfolder and its
-- parent) flagged it as a dupe even though the user wants both copies to
-- exist. Scope the check to the destination folder only, so it fires only
-- when the same content is uploaded twice into the SAME folder.

DROP FUNCTION IF EXISTS public.rpc_filehub_check_duplicate(TEXT);

CREATE FUNCTION public.rpc_filehub_check_duplicate(p_content_hash TEXT, p_folder_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_rows JSONB;
BEGIN
    IF p_content_hash IS NULL OR length(p_content_hash) = 0 THEN
        RETURN '[]'::jsonb;
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id',            f.id,
        'original_name', f.original_name,
        'size_bytes',    f.size_bytes,
        'created_at',    f.created_at,
        'uploader_name', u.full_name
    )), '[]'::jsonb)
    INTO v_rows
    FROM public.filehub_files f
    LEFT JOIN public.users u ON u.id = f.uploaded_by
    WHERE f.company_id = v_company_id
      AND f.content_hash = p_content_hash
      AND f.folder_id IS NOT DISTINCT FROM p_folder_id
      AND f.deleted_at IS NULL
    LIMIT 5;
    RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_check_duplicate(TEXT, UUID) TO authenticated;
