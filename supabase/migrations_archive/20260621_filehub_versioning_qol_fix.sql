-- 20260621_filehub_versioning_qol_fix.sql
-- Fix rpc_filehub_file_versions: the FROM clause mixed a comma-join (v, maxno)
-- with an explicit LEFT JOIN (... LEFT JOIN users u ON u.id = v.created_by).
-- Postgres parses "A, B LEFT JOIN C ON cond" as "A CROSS JOIN (B LEFT JOIN C
-- ON cond)", so the join condition for B/C cannot reference A — raising
-- "invalid reference to FROM-clause entry for table v" (42P01) at call time.
-- Fix: join v and maxno explicitly first, then LEFT JOIN users on top, so v
-- is in scope for the users join condition.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_filehub_file_versions(p_file_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_rows JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;
    IF NOT public.filehub_file_accessible(p_file_id) THEN
        RAISE EXCEPTION 'File not found or not accessible.';
    END IF;

    WITH maxno AS (
        SELECT COALESCE(MAX(version_no), 0) AS max_no
        FROM public.filehub_file_versions WHERE file_id = p_file_id
    )
    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id',               v.id,
            'version_no',       v.version_no,
            'original_name',    v.original_name,
            'size_bytes',       v.size_bytes,
            'mime_type',        v.mime_type,
            'storage_path',     v.storage_path,
            'bucket',           v.bucket,
            'created_at',       v.created_at,
            'superseded_at',    v.superseded_at,
            'is_current',       (v.superseded_at IS NULL),
            'pinned',           v.pinned,
            'is_stale_restore', (v.superseded_at IS NULL AND v.version_no < maxno.max_no),
            'expires_at',       CASE WHEN v.superseded_at IS NULL THEN NULL
                                      ELSE v.superseded_at + interval '30 days' END,
            'uploader',         jsonb_build_object(
                                    'id',         u.id,
                                    'full_name',  u.full_name,
                                    'avatar_url', u.avatar_url
                                 )
        ) ORDER BY v.version_no DESC
    ), '[]'::jsonb)
    INTO v_rows
    FROM public.filehub_file_versions v
    CROSS JOIN maxno
    LEFT JOIN public.users u ON u.id = v.created_by
    WHERE v.file_id = p_file_id;

    RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_file_versions(UUID) TO authenticated;

COMMIT;
