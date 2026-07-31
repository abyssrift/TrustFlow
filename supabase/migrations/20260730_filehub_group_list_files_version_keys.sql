-- 20260730_filehub_group_list_files_version_keys.sql
-- Bug: channel (group) files that HAD been replaced showed no Versions tab.
--
-- Both detail panes gate the tab on the list payload, not on the DB:
--     _filehub_desktop.tsx:1978  /  _filehub_adaptive.tsx:203
--     const hasVersionHistory = !!(file?.version_count && file.version_count > 1);
-- rpc_filehub_group_list_files stopped returning 'version_count', so it was
-- always undefined -> tab hidden on web AND mobile, even though the versions
-- existed (verified: both files in the replaced folder had version_no 1 and 2,
-- v1 superseded, current pointer on v2 — the replace worked perfectly).
--
-- How it broke: 20260721_filehub_channel_override_permission.sql and
-- 20260721_filehub_channel_override_manage_permission.sql each CREATE OR
-- REPLACEd this function from a body predating 20260718, silently dropping
-- three keys added earlier plus the archived-file filter:
--   * version_count      (20260622) -> Versions tab never appears
--   * current_version_id (20260622) -> restored-to-older-version state lost
--   * is_stale_restore   (20260622) -> "not the latest version" badge lost
--   * the filehub_recipients archived_at join (20260622) -> files a user hid
--     in a channel came back
-- This is the THIRD time recreating this function from a stale body has
-- dropped payload keys (see 20260718 for the folder_id round). Restoring all
-- four here.
--
-- ponytail: the payload is hand-copied between this RPC and rpc_filehub_list,
-- which is exactly why keys keep getting lost. Upgrade path if it regresses a
-- fourth time: extract the shared key set into one
-- filehub_file_core_payload(filehub_files) helper and have both list RPCs call
-- it, merging their visibility-specific keys with `||`. Not done now because
-- rpc_filehub_list feeds inbox/sent/broadcast and a refactor there is a much
-- bigger blast radius than the bug being fixed.
--
-- BEFORE YOU CREATE OR REPLACE THIS FUNCTION AGAIN: copy the body from THIS
-- migration (the newest one), not from an older one, and keep every key below.
-- Only the returned JSON changes here; no schema or permission changes.

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
    IF NOT (
        EXISTS (SELECT 1 FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id = v_user_id)
        OR public.has_permission('filehub:group_override')
        OR public.has_permission('filehub:group_override_manage')
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
                'group_id',       f.group_id,
                'folder_id',      f.folder_id,
                'current_version_id', f.current_version_id,
                'version_count',  (SELECT count(*) FROM public.filehub_file_versions v WHERE v.file_id = f.id),
                'is_stale_restore', COALESCE((
                    SELECT v.version_no < (SELECT MAX(v2.version_no) FROM public.filehub_file_versions v2 WHERE v2.file_id = f.id)
                    FROM public.filehub_file_versions v
                    WHERE v.id = f.current_version_id
                ), false),
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
        -- Group files have no recipient rows unless a member hid one, so the
        -- LEFT JOIN + IS NULL below is the "not hidden by me" filter (20260622).
        LEFT JOIN public.filehub_recipients r
            ON r.file_id = f.id AND r.user_id = v_user_id
        WHERE f.deleted_at IS NULL
          AND f.group_id = p_group_id
          AND f.visibility = 'group'
          AND f.company_id = v_company_id
          AND r.archived_at IS NULL
          AND (v_search IS NULL
               OR f.original_name ILIKE '%' || v_search || '%'
               OR f.caption       ILIKE '%' || v_search || '%'
               OR EXISTS (SELECT 1 FROM unnest(f.tags) t WHERE t ILIKE '%' || v_search || '%'))
          AND (p_tag IS NULL OR p_tag = ANY(f.tags))
    ) src;

    RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_list_files(UUID, TEXT, TEXT) TO authenticated;

-- Self-check: the payload keys the UI reads must all be present. Fails loudly
-- at apply time if a key was dropped again, instead of silently hiding a tab.
DO $$
DECLARE
    v_def TEXT := pg_get_functiondef('public.rpc_filehub_group_list_files(UUID,TEXT,TEXT)'::regprocedure);
    v_key TEXT;
BEGIN
    FOREACH v_key IN ARRAY ARRAY[
        'folder_id', 'version_count', 'current_version_id', 'is_stale_restore', 'archived_at'
    ] LOOP
        IF position(v_key IN v_def) = 0 THEN
            RAISE EXCEPTION 'rpc_filehub_group_list_files is missing "%" — see this migration''s header.', v_key;
        END IF;
    END LOOP;
END $$;
