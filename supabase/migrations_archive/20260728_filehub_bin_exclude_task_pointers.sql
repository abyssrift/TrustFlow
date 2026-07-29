-- FileHub unification (#151/#152 follow-up): task-file pointers are soft-deleted
-- (deleted_at) by the delete-sync triggers only to HIDE them from recents /
-- browse / analytics — their real lifecycle (bytes + restore) is owned by the
-- task, not FileHub. So they must sit OUTSIDE FileHub's Bin: never listed as a
-- restorable Bin entry, never independently restored (that would re-create a
-- live pointer over a still-deleted source — a reverse ghost), and never purged
-- by the Bin cron (which would hard-delete the pointer row + wipe its activity
-- history and NULL the task's link). This adds the `visibility <> 'task'`
-- exclusion to the two Bin RPCs; the purge edge function is guarded separately.

-- ── rpc_filehub_bin_list: drop task pointers from the "files I deleted" branch ─
-- (the hidden/inbox branch joins filehub_recipients and the third branch is
--  folders — task pointers appear in neither, so only branch 1 needs the guard.)
CREATE OR REPLACE FUNCTION public.rpc_filehub_bin_list()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id    UUID := auth.uid();
    v_company_id UUID := public.my_company_id();
    v_rows       JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to view File Hub.';
    END IF;

    SELECT COALESCE(jsonb_agg(row_payload ORDER BY trashed_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
        -- Files I deleted myself (I'm the uploader)
        SELECT
            f.deleted_at AS trashed_at,
            jsonb_build_object(
                'id',            f.id,
                'item_type',     'file',
                'original_name', f.original_name,
                'mime_type',     f.mime_type,
                'size_bytes',    f.size_bytes,
                'caption',       f.caption,
                'visibility',    f.visibility,
                'storage_path',  f.storage_path,
                'bucket',        f.bucket,
                'tags',          f.tags,
                'created_at',    f.created_at,
                'folder',        CASE WHEN f.folder_id IS NULL THEN NULL ELSE
                                    jsonb_build_object('id', fo.id, 'name', fo.name) END,
                'uploader',      jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url),
                'trash_type',    'deleted',
                'trashed_at',    f.deleted_at,
                'expires_at',    f.deleted_at + interval '15 days'
            ) AS row_payload
        FROM public.filehub_files f
        LEFT JOIN public.filehub_folders fo ON fo.id = f.folder_id
        LEFT JOIN public.users u            ON u.id  = f.uploaded_by
        WHERE f.company_id   = v_company_id
          AND f.uploaded_by  = v_user_id
          AND f.deleted_at IS NOT NULL
          AND f.deleted_at  > now() - interval '15 days'
          AND f.visibility <> 'task'

        UNION ALL

        -- Files I hid from my inbox (someone else's file)
        SELECT
            r.archived_at AS trashed_at,
            jsonb_build_object(
                'id',            f.id,
                'item_type',     'file',
                'original_name', f.original_name,
                'mime_type',     f.mime_type,
                'size_bytes',    f.size_bytes,
                'caption',       f.caption,
                'visibility',    f.visibility,
                'storage_path',  f.storage_path,
                'bucket',        f.bucket,
                'tags',          f.tags,
                'created_at',    f.created_at,
                'folder',        CASE WHEN f.folder_id IS NULL THEN NULL ELSE
                                    jsonb_build_object('id', fo.id, 'name', fo.name) END,
                'uploader',      jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url),
                'trash_type',    'hidden',
                'trashed_at',    r.archived_at,
                'expires_at',    r.archived_at + interval '15 days'
            ) AS row_payload
        FROM public.filehub_recipients r
        JOIN public.filehub_files f         ON f.id = r.file_id
        LEFT JOIN public.filehub_folders fo ON fo.id = f.folder_id
        LEFT JOIN public.users u            ON u.id  = f.uploaded_by
        WHERE r.user_id = v_user_id
          AND r.archived_at IS NOT NULL
          AND r.archived_at  > now() - interval '15 days'
          AND f.company_id  = v_company_id

        UNION ALL

        -- Folders deleted by anyone in the company (shared resource — not
        -- scoped to whoever deleted it, matching the pre-existing company-wide
        -- SELECT policy on filehub_folders)
        SELECT
            fo.deleted_at AS trashed_at,
            jsonb_build_object(
                'id',            fo.id,
                'item_type',     'folder',
                'original_name', fo.name,
                'mime_type',     NULL,
                'size_bytes',    0,
                'caption',       NULL,
                'visibility',    NULL,
                'storage_path',  NULL,
                'bucket',        NULL,
                'tags',          '{}'::text[],
                'created_at',    fo.created_at,
                'folder',        CASE WHEN fo.parent_id IS NULL THEN NULL ELSE
                                    jsonb_build_object('id', p.id, 'name', p.name) END,
                'uploader',      jsonb_build_object('id', cu.id, 'full_name', cu.full_name, 'avatar_url', cu.avatar_url),
                'trash_type',    'deleted',
                'trashed_at',    fo.deleted_at,
                'expires_at',    fo.deleted_at + interval '15 days'
            ) AS row_payload
        FROM public.filehub_folders fo
        LEFT JOIN public.filehub_folders p ON p.id = fo.parent_id
        LEFT JOIN public.users cu          ON cu.id = fo.created_by
        WHERE fo.company_id = v_company_id
          AND fo.deleted_at IS NOT NULL
          AND fo.deleted_at > now() - interval '15 days'
    ) src;

    RETURN v_rows;
END;
$$;

-- ── rpc_filehub_restore: refuse to restore a task pointer directly ────────────
-- (belt-and-suspenders now that bin_list hides them; the recipients branch is
--  naturally task-free so it's left unchanged.)
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
      AND visibility <> 'task'
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
