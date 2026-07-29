-- 20260622_filehub_bin.sql
-- FileHub Bin — list + restore RPCs.
--
-- No new columns: "trashed" already means one of two existing states:
--   * deleted_at IS NOT NULL on filehub_files   (uploader deleted their own file)
--   * archived_at IS NOT NULL on filehub_recipients (recipient hid it from their inbox)
-- Both already fall out of rpc_filehub_list immediately. This adds a 15-day
-- window during which either action is listed in a "Bin" and reversible via
-- rpc_filehub_restore. After 15 days the row simply stops appearing here;
-- actual storage/DB purge of owner-deleted files is handled by the
-- purge-filehub-bin Edge Function (see 20260622_filehub_bin_purge_schedule.sql).
-- Hidden-only files are never purged — hiding never destroys data, there is
-- nothing to clean up beyond no longer listing it.

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

        -- Files I hid from my inbox (someone else's file)
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
    ) src;

    RETURN v_rows;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_filehub_restore(p_file_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    UPDATE public.filehub_files
    SET deleted_at = NULL
    WHERE id = p_file_id
      AND uploaded_by = v_user_id
      AND deleted_at IS NOT NULL
      AND deleted_at > now() - interval '15 days';

    IF FOUND THEN
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_bin_list()       TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_restore(UUID)     TO authenticated;
