-- 20260622_filehub_broadcast_hide_fix.sql
-- Fix: hiding a broadcast file silently no-opped.
--
-- filehub_recipients rows are only ever created for visibility='direct'
-- uploads (see rpc_filehub_upload_commit) — broadcast access is granted by
-- company-wide visibility, not a per-recipient row. rpc_filehub_recipient_hide
-- required an existing row, so calling it on a broadcast file you didn't
-- upload always raised "not a recipient" — and the new bulk "Delete" action
-- (which calls hideFile for any file you don't own) swallows that error
-- client-side, so it silently did nothing on the Broadcast tab. Separately,
-- even if a hide row existed, rpc_filehub_list's broadcast branch never
-- checked archived_at, so the file wouldn't have disappeared anyway.
--
-- Fix: rpc_filehub_recipient_hide now creates a recipient row on demand for
-- a broadcast file you can see but didn't upload (purely to carry your own
-- hide state — it grants no extra access; visibility is still decided by
-- filehub_file_accessible / rpc_filehub_list's own predicate). rpc_filehub_list
-- now excludes archived broadcast rows the same way it already does for inbox.

CREATE OR REPLACE FUNCTION public.rpc_filehub_recipient_hide(p_file_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    UPDATE public.filehub_recipients
    SET archived_at = now()
    WHERE file_id = p_file_id AND user_id = v_user_id AND archived_at IS NULL;

    IF FOUND THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.filehub_recipients WHERE file_id = p_file_id AND user_id = v_user_id
    ) THEN
        RAISE EXCEPTION 'You are not a recipient of this file, or it is already hidden.';
    END IF;

    -- No recipient row at all — true for every broadcast (and group) file.
    -- Create one on demand so non-uploaders can hide it from their own view.
    IF public.filehub_file_accessible(p_file_id)
       AND NOT EXISTS (SELECT 1 FROM public.filehub_files WHERE id = p_file_id AND uploaded_by = v_user_id)
    THEN
        INSERT INTO public.filehub_recipients (file_id, user_id, archived_at)
        VALUES (p_file_id, v_user_id, now());
        RETURN;
    END IF;

    RAISE EXCEPTION 'You are not a recipient of this file, or it is already hidden.';
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_filehub_list(
    p_mode      TEXT,
    p_search    TEXT DEFAULT NULL,
    p_folder_id UUID DEFAULT NULL,
    p_tag       TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_rows       JSONB;
    v_search     TEXT := NULLIF(trim(coalesce(p_search,'')), '');
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to view File Hub.';
    END IF;
    IF p_mode NOT IN ('inbox','sent','broadcast') THEN
        RAISE EXCEPTION 'Invalid mode: %', p_mode;
    END IF;

    SELECT COALESCE(jsonb_agg(row_payload ORDER BY created_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
        SELECT
            f.created_at,
            jsonb_build_object(
                'id',             f.id,
                'original_name',  f.original_name,
                'mime_type',      f.mime_type,
                'size_bytes',     f.size_bytes,
                'content_hash',   f.content_hash,
                'caption',        f.caption,
                'visibility',     f.visibility,
                'storage_path',   f.storage_path,
                'bucket',         f.bucket,
                'tags',           f.tags,
                'created_at',     f.created_at,
                'current_version_id', f.current_version_id,
                'version_count',  (SELECT count(*) FROM public.filehub_file_versions v WHERE v.file_id = f.id),
                'is_stale_restore', COALESCE((
                    SELECT v.version_no < (SELECT MAX(v2.version_no) FROM public.filehub_file_versions v2 WHERE v2.file_id = f.id)
                    FROM public.filehub_file_versions v
                    WHERE v.id = f.current_version_id
                ), false),
                'folder', CASE WHEN f.folder_id IS NULL THEN NULL ELSE
                    jsonb_build_object('id', fo.id, 'name', fo.name) END,
                'uploader', jsonb_build_object(
                    'id',         u.id,
                    'full_name',  u.full_name,
                    'avatar_url', u.avatar_url
                ),
                'recipient_state', CASE
                    WHEN p_mode = 'inbox' THEN jsonb_build_object(
                        'read_at',     r.read_at,
                        'archived_at', r.archived_at
                    )
                    ELSE NULL
                END,
                'recipients', CASE
                    WHEN p_mode = 'sent' THEN COALESCE((
                        SELECT jsonb_agg(jsonb_build_object(
                            'user_id',    ru.id,
                            'full_name',  ru.full_name,
                            'avatar_url', ru.avatar_url,
                            'read_at',    rr.read_at
                        ))
                        FROM public.filehub_recipients rr
                        JOIN public.users ru ON ru.id = rr.user_id
                        WHERE rr.file_id = f.id
                    ), '[]'::jsonb)
                    ELSE NULL
                END,
                'recipient_count', (
                    SELECT COUNT(*) FROM public.filehub_recipients rc WHERE rc.file_id = f.id
                )
            ) AS row_payload
        FROM public.filehub_files f
        LEFT JOIN public.filehub_folders fo ON fo.id = f.folder_id
        LEFT JOIN public.users u            ON u.id  = f.uploaded_by
        LEFT JOIN public.filehub_recipients r
            ON r.file_id = f.id AND r.user_id = v_user_id
        WHERE f.deleted_at IS NULL
          AND f.company_id = v_company_id
          AND (
              (p_mode = 'inbox'     AND f.visibility = 'direct' AND r.user_id IS NOT NULL AND r.archived_at IS NULL)
              OR
              (p_mode = 'sent'      AND f.uploaded_by = v_user_id AND f.visibility = 'direct')
              OR
              (p_mode = 'broadcast' AND f.visibility = 'broadcast' AND r.archived_at IS NULL)
          )
          AND (p_folder_id IS NULL OR f.folder_id = p_folder_id)
          AND (p_tag       IS NULL OR p_tag = ANY (f.tags))
          AND (
              v_search IS NULL
              OR f.original_name ILIKE '%' || v_search || '%'
              OR f.caption       ILIKE '%' || v_search || '%'
              OR EXISTS (SELECT 1 FROM unnest(f.tags) t WHERE t ILIKE '%' || v_search || '%')
          )
    ) src;

    RETURN v_rows;
END;
$$;
