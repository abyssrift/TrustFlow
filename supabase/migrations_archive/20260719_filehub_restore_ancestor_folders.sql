-- 20260719_filehub_restore_ancestor_folders.sql
-- FileHub Bin: restoring a single file orphans it if its parent folder is
-- also in the Bin.
--
-- rpc_filehub_folder_delete cascades a folder delete down through every file
-- in the subtree (correct — see 20260716_filehub_folder_delete_cascade_files.sql).
-- But rpc_filehub_restore, used when the Bin's per-FILE "Restore" button is
-- clicked, only ever cleared that one file's deleted_at/archived_at — it never
-- checked whether the file's folder_id still points at a folder that is
-- itself soft-deleted.
--
-- filehub_folders' SELECT RLS policy is `company_id = my_company_id() AND
-- deleted_at IS NULL`, so a soft-deleted folder is invisible to every query —
-- it drops out of the folder tree entirely. The Bin lists a cascade-deleted
-- folder AND every file inside it as flat, independently-restorable rows, so
-- restoring one nested file without also restoring its containing folder
-- leaves that file with deleted_at = NULL but a folder_id pointing at a
-- folder RLS says doesn't exist: it vanishes from the Bin (no longer
-- deleted) and is unreachable everywhere else in FileHub (its folder isn't
-- navigable), until someone happens to restore that folder too — or it
-- permanently orphans if the folder's own Bin entry expires past 15 days and
-- gets purged first.
--
-- Fix: after a file (or a hidden/archived recipient copy) is restored, walk
-- up its folder_id's parent chain and restore any ancestor folder that is
-- still soft-deleted, so the file is always reachable again immediately.
-- This never touches sibling files/folders that are still legitimately
-- deleted — only the ancestor chain of the specific file being restored.
CREATE OR REPLACE FUNCTION public.rpc_filehub_restore(p_file_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_user_id    UUID := auth.uid();
    v_company_id UUID := public.my_company_id();
    v_folder_id  UUID;
BEGIN
    UPDATE public.filehub_files
    SET deleted_at = NULL
    WHERE id = p_file_id
      AND uploaded_by = v_user_id
      AND deleted_at IS NOT NULL
      AND deleted_at > now() - interval '15 days'
    RETURNING folder_id INTO v_folder_id;

    IF FOUND THEN
        IF v_folder_id IS NOT NULL THEN
            WITH RECURSIVE ancestors AS (
                SELECT id, parent_id FROM public.filehub_folders
                WHERE id = v_folder_id AND company_id = v_company_id
                UNION ALL
                SELECT f.id, f.parent_id FROM public.filehub_folders f
                JOIN ancestors a ON f.id = a.parent_id
                WHERE f.company_id = v_company_id
            )
            UPDATE public.filehub_folders
            SET deleted_at = NULL
            WHERE id IN (SELECT id FROM ancestors) AND deleted_at IS NOT NULL;
        END IF;
        RETURN;
    END IF;

    UPDATE public.filehub_recipients
    SET archived_at = NULL
    WHERE file_id = p_file_id
      AND user_id = v_user_id
      AND archived_at IS NOT NULL
      AND archived_at > now() - interval '15 days';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'File not found in Bin, or the 15-day restore window has expired.';
    END IF;

    SELECT folder_id INTO v_folder_id FROM public.filehub_files WHERE id = p_file_id;
    IF v_folder_id IS NOT NULL THEN
        WITH RECURSIVE ancestors AS (
            SELECT id, parent_id FROM public.filehub_folders
            WHERE id = v_folder_id AND company_id = v_company_id
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
