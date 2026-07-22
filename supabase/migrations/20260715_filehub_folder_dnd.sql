-- 20260715_filehub_folder_dnd.sql
-- Explorer-style drag-and-drop: move a file into a folder, move a folder
-- under a different parent.

-- Move a file into a folder (or to root with p_folder_id = NULL).
-- Restricted to the uploader, same ownership rule as rpc_filehub_delete —
-- folder_id is a shared/global property of the file (visible to every
-- recipient), not a personal per-viewer tag, so only the owner may change it.
CREATE OR REPLACE FUNCTION public.rpc_filehub_file_move(p_file_id UUID, p_folder_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
BEGIN
    IF p_folder_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.filehub_folders WHERE id = p_folder_id AND company_id = v_company_id
    ) THEN
        RAISE EXCEPTION 'Folder does not exist in this company.';
    END IF;

    UPDATE public.filehub_files
    SET folder_id = p_folder_id
    WHERE id = p_file_id AND uploaded_by = v_user_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'File not found or you are not the uploader.';
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_file_move(UUID, UUID) TO authenticated;

-- Move a folder under a different parent (or to root with p_new_parent_id = NULL).
-- Company-wide like rename/delete (folders aren't individually owned).
-- Rejects moving a folder into itself or into one of its own descendants.
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_move(p_id UUID, p_new_parent_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_name       TEXT;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;

    IF p_id = p_new_parent_id THEN
        RAISE EXCEPTION 'A folder cannot be moved into itself.';
    END IF;

    SELECT name INTO v_name FROM public.filehub_folders WHERE id = p_id AND company_id = v_company_id;
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'Folder not found.';
    END IF;

    IF p_new_parent_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.filehub_folders WHERE id = p_new_parent_id AND company_id = v_company_id) THEN
            RAISE EXCEPTION 'Destination folder not found.';
        END IF;

        IF EXISTS (
            WITH RECURSIVE descendants AS (
                SELECT id FROM public.filehub_folders WHERE parent_id = p_id
                UNION ALL
                SELECT f.id FROM public.filehub_folders f JOIN descendants d ON f.parent_id = d.id
            )
            SELECT 1 FROM descendants WHERE id = p_new_parent_id
        ) THEN
            RAISE EXCEPTION 'Cannot move a folder into its own subfolder.';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE company_id = v_company_id
          AND id <> p_id
          AND name = v_name
          AND parent_id IS NOT DISTINCT FROM p_new_parent_id
    ) THEN
        RAISE EXCEPTION 'A folder named "%" already exists there.', v_name;
    END IF;

    UPDATE public.filehub_folders SET parent_id = p_new_parent_id WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_move(UUID, UUID) TO authenticated;
