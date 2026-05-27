-- Fix: add uploaded_by to JSONB responses of rpc_filehub_list and rpc_filehub_group_list_files
-- The TypeScript FileHubFile type requires uploaded_by as a top-level field; isOwner checks depend on it.
-- Also fixes recipients to use 'id' key (consistent with FileHubFile type) instead of 'user_id'.

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
                'uploaded_by',    f.uploaded_by,
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
                            'id',         ru.id,
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
              (p_mode = 'broadcast' AND f.visibility = 'broadcast')
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

CREATE OR REPLACE FUNCTION public.rpc_filehub_group_list_files(
    p_group_id UUID,
    p_search   TEXT DEFAULT NULL,
    p_tag      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id    UUID := auth.uid();
    v_company_id UUID := public.my_company_id();
    v_search     TEXT := NULLIF(trim(coalesce(p_search, '')), '');
    v_rows       JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id = v_user_id
    ) THEN
        RAISE EXCEPTION 'You are not a member of this group.';
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
                'uploaded_by',    f.uploaded_by,
                'group_id',       f.group_id,
                'folder',         CASE WHEN f.folder_id IS NULL THEN NULL ELSE
                                    jsonb_build_object('id', fo.id, 'name', fo.name) END,
                'uploader',       jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url),
                'recipient_state', NULL::jsonb,
                'recipients',     NULL::jsonb,
                'recipient_count', 0
            ) AS row_payload
        FROM public.filehub_files f
        LEFT JOIN public.filehub_folders fo ON fo.id = f.folder_id
        JOIN public.users u ON u.id = f.uploaded_by
        WHERE f.deleted_at IS NULL
          AND f.group_id = p_group_id
          AND f.visibility = 'group'
          AND f.company_id = v_company_id
          AND (v_search IS NULL
               OR f.original_name ILIKE '%' || v_search || '%'
               OR f.caption       ILIKE '%' || v_search || '%'
               OR EXISTS (SELECT 1 FROM unnest(f.tags) t WHERE t ILIKE '%' || v_search || '%'))
          AND (p_tag IS NULL OR p_tag = ANY(f.tags))
    ) src;

    RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_list(TEXT, TEXT, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_list_files(UUID, TEXT, TEXT) TO authenticated;
