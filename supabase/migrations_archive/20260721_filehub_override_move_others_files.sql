-- 20260721_filehub_override_move_others_files.sql
-- rpc_filehub_file_move (drag-and-drop between folders) required
-- uploaded_by = caller unconditionally — even a real channel admin couldn't
-- drag a teammate's file into another folder. filehub:group_override_manage
-- holders hit this too while browsing a channel via override: they could
-- upload and kick, but not reorganize files they didn't personally upload.
--
-- Scoped narrowly to visibility='group' files, matching what the override
-- permission is actually about (channels) — direct/broadcast files are
-- untouched, still owner-only.

CREATE OR REPLACE FUNCTION public.rpc_filehub_file_move(p_file_id UUID, p_folder_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id     UUID := public.my_company_id();
    v_user_id        UUID := auth.uid();
    v_visibility     TEXT;
    v_group_id       UUID;
    v_uploaded_by    UUID;
    v_expected_scope TEXT;
BEGIN
    SELECT visibility, group_id, uploaded_by INTO v_visibility, v_group_id, v_uploaded_by
    FROM public.filehub_files
    WHERE id = p_file_id AND company_id = v_company_id AND deleted_at IS NULL;

    IF v_visibility IS NULL THEN
        RAISE EXCEPTION 'File not found or you are not the uploader.';
    END IF;

    IF NOT (
        v_uploaded_by = v_user_id
        OR (v_visibility = 'group' AND public.has_permission('filehub:group_override_manage'))
    ) THEN
        RAISE EXCEPTION 'File not found or you are not the uploader.';
    END IF;

    v_expected_scope := CASE WHEN v_visibility = 'group' THEN 'group' WHEN v_visibility = 'broadcast' THEN 'broadcast' ELSE 'direct' END;

    IF p_folder_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE id = p_folder_id AND company_id = v_company_id
          AND scope = v_expected_scope
          AND group_id IS NOT DISTINCT FROM v_group_id
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Folder does not belong to this file''s context.';
    END IF;

    UPDATE public.filehub_files
    SET folder_id = p_folder_id
    WHERE id = p_file_id AND company_id = v_company_id AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_file_move(UUID, UUID) TO authenticated;
