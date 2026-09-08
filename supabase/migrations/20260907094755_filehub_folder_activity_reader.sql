-- Folder activity reader for the FileHub detail surfaces (#334).
-- Keep the access gate in the RPC: SECURITY DEFINER bypasses table RLS.
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_activity(p_folder_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rows JSONB;
BEGIN
    IF auth.uid() IS NULL
       OR public.my_company_id() IS NULL
       OR NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;
    IF NOT public.filehub_folder_accessible(p_folder_id) THEN
        RETURN '[]'::jsonb;
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id',         a.id,
            'action',     a.action,
            'metadata',   a.metadata,
            'created_at', a.created_at,
            'user',       jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url)
        ) ORDER BY a.created_at DESC
    ), '[]'::jsonb)
    INTO v_rows
    FROM public.filehub_activity a
    JOIN public.users u ON u.id = a.user_id
    WHERE a.folder_id = p_folder_id
      AND a.file_id IS NULL
      AND a.company_id = public.my_company_id();
    RETURN v_rows;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_filehub_folder_activity(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_activity(UUID) TO authenticated;
