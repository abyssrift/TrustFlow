-- 20260719_filehub_folder_restore_batch_scoping.sql
-- FileHub Bin: restoring a folder resurrects unrelated, independently-deleted
-- descendant folders.
--
-- rpc_filehub_folder_restore's file-restore branch correctly scopes to the
-- exact cascade batch via `deleted_at = v_deleted_at` — only files deleted in
-- the SAME delete action as the folder being restored come back. The
-- folder-restore branch right below it never got the same treatment: it
-- matches any descendant folder with `deleted_at IS NOT NULL AND deleted_at
-- > now() - interval '15 days'`, i.e. ANY currently-deleted subfolder in the
-- subtree, regardless of when or why it was deleted.
--
-- Reproduced: folder B (nested under A) deleted independently on its own
-- (cascading to its own file). 4 days later, A is deleted separately (the
-- real cascade in rpc_filehub_folder_delete correctly skips B and its file,
-- since they're already deleted). Restoring ONLY A from the Bin: A comes
-- back (correct), B ALSO comes back (wrong — a 4-day-old, unrelated delete
-- the user never asked to undo), but B's file stays deleted because its
-- timestamp doesn't match A's restore batch. Net result: B reappears as an
-- empty ghost folder and an unrelated delete is silently reversed.
--
-- Fix: scope the folder-restore branch to `deleted_at = v_deleted_at`, same
-- as the file branch — only descendant folders deleted in the exact same
-- batch as the folder being restored come back with it. An independently
-- deleted descendant stays in its own Bin entry, restorable on its own.
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_restore(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_deleted_at TIMESTAMPTZ;
BEGIN
    SELECT deleted_at INTO v_deleted_at
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
END;
$function$;
