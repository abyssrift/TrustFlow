-- 20260527_filehub_fix_storage_insert_and_group_files.sql
--
-- Fix 1: Storage INSERT policy hung when evaluating public.has_permission()
--   in the Storage engine context (same cross-schema limitation as the SELECT fix).
--   Replace with a simple path-based company check. Permission enforcement is
--   already handled by rpc_filehub_upload_commit (SECURITY DEFINER).
--
-- Fix 2: rpc_filehub_group_list_files had "missing FROM-clause entry for table f"
--   because the outer jsonb_agg referenced the inner alias f.created_at.
--   Changed to ORDER BY created_at (unqualified, resolves from the subquery select list).

-- ── Fix 1: Storage INSERT policy ─────────────────────────────────────────────

DROP POLICY IF EXISTS "filehub_storage_insert" ON storage.objects;

CREATE POLICY "filehub_storage_insert" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'filehub-files'
        AND auth.uid() IS NOT NULL
        AND split_part(name, '/', 1) = public.my_company_id()::text
    );

-- ── Fix 2: rpc_filehub_group_list_files ORDER BY ─────────────────────────────

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
                'id',              f.id,
                'original_name',   f.original_name,
                'mime_type',       f.mime_type,
                'size_bytes',      f.size_bytes,
                'content_hash',    f.content_hash,
                'caption',         f.caption,
                'visibility',      f.visibility,
                'storage_path',    f.storage_path,
                'bucket',          f.bucket,
                'tags',            f.tags,
                'created_at',      f.created_at,
                'uploaded_by',     f.uploaded_by,
                'group_id',        f.group_id,
                'folder_id',       f.folder_id,
                'folder',          CASE WHEN f.folder_id IS NULL THEN NULL ELSE
                                     jsonb_build_object('id', fo.id, 'name', fo.name) END,
                'uploader',        jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url),
                'recipient_state', NULL::jsonb,
                'recipients',      NULL::jsonb,
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
