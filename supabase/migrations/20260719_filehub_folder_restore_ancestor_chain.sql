-- 20260719_filehub_folder_restore_ancestor_chain.sql
-- FileHub Bin: restoring a nested folder orphans it if ITS OWN parent folder
-- is also still in the Bin.
--
-- Same root pattern as 20260719_filehub_restore_ancestor_folders.sql (which
-- fixed the file-restore path) but never applied to the folder-restore path
-- itself. Reproduced: folder A contains folder B; delete A (cascades to B in
-- one batch, correct). Restore ONLY B (not A) from the Bin: B's own
-- deleted_at clears, but A — B's parent_id — stays soft-deleted. Since
-- filehub_folders' SELECT RLS is `deleted_at IS NULL`, A is invisible to
-- every query, so B (parent_id = A) can never be navigated to: not at the
-- root (its parent_id isn't NULL) and not under A (A doesn't exist to browse
-- into). B is "restored" but permanently unreachable until A also happens to
-- be restored, exactly like the file case.
--
-- Fix: after restoring the folder's own subtree, walk UP p_id's parent chain
-- and restore any ancestor that is still soft-deleted, mirroring the file
-- fix. Only ancestors of the specific folder being restored are touched —
-- siblings and unrelated deleted folders are untouched.
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_restore(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_deleted_at TIMESTAMPTZ;
    v_parent_id  UUID;
BEGIN
    SELECT deleted_at, parent_id INTO v_deleted_at, v_parent_id
    FROM public.filehub_folders
    WHERE id = p_id AND company_id = v_company_id
      AND deleted_at IS NOT NULL AND deleted_at > now() - interval '15 days';
    IF v_deleted_at IS NULL THEN
        RAISE EXCEPTION 'Folder not found in Bin, or the 15-day restore window has expired.';
    END IF;

    WITH RECURSIVE subtree AS (
        SELECT id FROM public.filehub_folders WHERE id = p_id
        UNION ALL
        SELECT f.id FROM public.filehub_folders f JOIN subtree s ON f.parent_id = s.id
    )
    UPDATE public.filehub_files
    SET deleted_at = NULL
    WHERE folder_id IN (SELECT id FROM subtree)
      AND company_id = v_company_id
      AND deleted_at = v_deleted_at;

    WITH RECURSIVE subtree AS (
        SELECT id FROM public.filehub_folders WHERE id = p_id
        UNION ALL
        SELECT f.id FROM public.filehub_folders f JOIN subtree s ON f.parent_id = s.id
    )
    UPDATE public.filehub_folders
    SET deleted_at = NULL
    WHERE id IN (SELECT id FROM subtree)
      AND deleted_at = v_deleted_at;

    -- CHANGED: restore any still-deleted ancestor chain above p_id so the
    -- just-restored folder is actually reachable again.
    IF v_parent_id IS NOT NULL THEN
        WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM public.filehub_folders
            WHERE id = v_parent_id AND company_id = v_company_id
            UNION ALL
            SELECT f.id, f.parent_id FROM public.filehub_folders f
            JOIN ancestors a ON f.id = a.parent_id
            WHERE f.company_id = v_company_id
        )
        UPDATE public.filehub_folders
        SET deleted_at = NULL
        WHERE id IN (SELECT id FROM ancestors) AND deleted_at IS NOT NULL;
    END IF;
END;
$function$;
