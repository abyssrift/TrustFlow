-- 20260719_filehub_list_folder_root_scoping_fix.sql
-- Fixes #62: FileHub Sent/Inbox ignore folder nesting.
--
-- rpc_filehub_list filtered on `(p_folder_id IS NULL OR f.folder_id = p_folder_id)`.
-- When browsing the root (p_folder_id = NULL, "show me the top level"), that
-- first clause is always true, so the filter matched EVERY file in EVERY
-- folder at EVERY depth — the root listing was really "all direct/sent files,
-- flattened", not "files with no folder". Every other filehub RPC
-- (filehub_dedupe_name, rpc_filehub_check_name_conflict, rpc_filehub_folder_create)
-- already uses the NULL-safe `IS NOT DISTINCT FROM` comparison for this exact
-- case; this one was missed. The client's folder-tree panel already scopes
-- subfolders correctly by parent_id, which is why only the file list — not the
-- folder tree — appeared to ignore hierarchy.
--
-- Body is otherwise verbatim from 20260622_filehub_broadcast_hide_fix.sql.
CREATE OR REPLACE FUNCTION public.rpc_filehub_list(p_mode text, p_search text DEFAULT NULL::text, p_folder_id uuid DEFAULT NULL::uuid, p_tag text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
          -- CHANGED: NULL-safe comparison so p_folder_id = NULL means "root
          -- level only" (folder_id IS NULL), matching every other filehub RPC,
          -- instead of "no filter" (which matched files at any depth). An
          -- active search still ignores folder scope and matches company-wide
          -- (unchanged from before — the client never resets the selected
          -- folder when searching, so this keeps "search everywhere" working
          -- rather than silently narrowing it to whatever folder is open).
          AND (v_search IS NOT NULL OR f.folder_id IS NOT DISTINCT FROM p_folder_id)
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
$function$;
