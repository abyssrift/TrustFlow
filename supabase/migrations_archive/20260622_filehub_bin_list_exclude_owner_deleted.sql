-- 20260622_filehub_bin_list_exclude_owner_deleted.sql
-- Fix: a file a recipient hid, which the owner *also* separately hard-deleted,
-- showed up in the recipient's Bin as "restorable" — but restoring it only
-- clears their own archived_at; the file stays invisible because
-- rpc_filehub_list still requires f.deleted_at IS NULL. Restore would silently
-- have no visible effect. Exclude owner-deleted files from the "hidden" branch
-- so the Bin never offers a restore that can't actually bring the file back.

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
        SELECT
            f.deleted_at AS trashed_at,
            jsonb_build_object(
                'id',            f.id,
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

        UNION ALL

        -- Files I hid from my inbox (someone else's file) — excludes files the
        -- uploader has independently hard-deleted, since restoring my own hide
        -- state can't bring those back (rpc_filehub_list still hides them).
        SELECT
            r.archived_at AS trashed_at,
            jsonb_build_object(
                'id',            f.id,
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
          AND f.deleted_at IS NULL
    ) src;

    RETURN v_rows;
END;
$$;
