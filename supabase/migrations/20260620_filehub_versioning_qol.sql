-- 20260620_filehub_versioning_qol.sql
-- FileHub Version Control — QOL additions on top of Phase 1 (20260617).
--   * Stale-restore detection: current version (superseded_at IS NULL) can be
--     older than the highest version_no ever recorded, if an old version was
--     restored after a newer one existed. Surfaced as `is_stale_restore`.
--   * Pin: a non-current version can be marked `pinned` to exempt it from the
--     30-day purge clock indefinitely. Orthogonal to superseded_at/current —
--     replace/restore never touch it.
--   * Replace notifications: rpc_filehub_replace_file now emits
--     'filehub.file_replaced' events, mirroring the upload_commit pattern.
--
-- Strictly additive: ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE (same
-- signatures throughout except the brand-new pin RPC), and a guarded
-- notification_rules seed. No destructive changes.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 2.1 SCHEMA: pinned flag
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.filehub_file_versions
    ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT false;

-- ────────────────────────────────────────────────────────────────────────────
-- 2.2 file_versions — add pinned + is_stale_restore to each version row
-- ────────────────────────────────────────────────────────────────────────────
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
    FROM public.filehub_file_versions v, maxno
    LEFT JOIN public.users u ON u.id = v.created_by
    WHERE v.file_id = p_file_id;

    RETURN v_rows;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2.3 replace_file — emit 'filehub.file_replaced' notification events
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_replace_file(
    p_target_id    UUID,
    p_storage_path TEXT,
    p_size_bytes   BIGINT,
    p_content_hash TEXT,
    p_mime_type    TEXT,
    p_caption      TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_file       public.filehub_files%ROWTYPE;
    v_next_no    INT;
    v_version_id UUID;
    v_rid        UUID;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;
    IF p_storage_path IS NULL OR length(trim(p_storage_path)) = 0 THEN
        RAISE EXCEPTION 'Storage path is required.';
    END IF;
    IF p_size_bytes > 524288000 THEN
        RAISE EXCEPTION 'File exceeds 500 MB limit.';
    END IF;

    SELECT * INTO v_file
    FROM public.filehub_files
    WHERE id = p_target_id AND company_id = v_company_id AND deleted_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'File not found.';
    END IF;

    -- Permission checks per visibility scope.
    IF v_file.visibility = 'group' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.filehub_group_members
            WHERE group_id = v_file.group_id AND user_id = v_user_id
        ) THEN
            RAISE EXCEPTION 'You are not a member of this group.';
        END IF;
    ELSIF v_file.visibility = 'broadcast' THEN
        IF NOT public.has_permission('filehub:broadcast') THEN
            RAISE EXCEPTION 'You do not have permission to replace broadcast files.';
        END IF;
    ELSIF v_file.visibility = 'direct' THEN
        IF v_file.uploaded_by <> v_user_id THEN
            RAISE EXCEPTION 'Only the owner can replace a direct file.';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported visibility: %', v_file.visibility;
    END IF;

    -- Next version number for this file.
    SELECT COALESCE(MAX(version_no), 0) + 1 INTO v_next_no
    FROM public.filehub_file_versions WHERE file_id = p_target_id;

    -- Supersede the currently-current version.
    UPDATE public.filehub_file_versions
    SET superseded_at = now()
    WHERE file_id = p_target_id AND superseded_at IS NULL;

    -- Insert the new current version. Keep original_name = live file's current
    -- name so the lineage name stays stable.
    INSERT INTO public.filehub_file_versions (
        file_id, company_id, version_no, storage_path, bucket,
        original_name, size_bytes, mime_type, content_hash, created_by, superseded_at
    ) VALUES (
        p_target_id, v_company_id, v_next_no, p_storage_path, 'filehub-files',
        v_file.original_name, p_size_bytes, p_mime_type, p_content_hash, v_user_id, NULL
    ) RETURNING id INTO v_version_id;

    -- Sync denormalized live-row fields to the new version.
    UPDATE public.filehub_files
    SET current_version_id = v_version_id,
        storage_path       = p_storage_path,
        size_bytes         = p_size_bytes,
        mime_type          = p_mime_type,
        content_hash       = p_content_hash,
        caption            = COALESCE(NULLIF(trim(coalesce(p_caption, '')), ''), caption),
        updated_at         = now(),
        updated_by         = v_user_id
    WHERE id = p_target_id;

    -- Notify the file's existing audience that it changed.
    IF v_file.visibility = 'direct' THEN
        FOR v_rid IN SELECT user_id FROM public.filehub_recipients WHERE file_id = p_target_id LOOP
            IF v_rid <> v_user_id THEN
                PERFORM public.fn_emit_notification_event(
                    'filehub.file_replaced', 'filehub_file', p_target_id, v_user_id,
                    jsonb_build_object(
                        'file_id',           p_target_id,
                        'file_name',         v_file.original_name,
                        'version_no',        v_next_no,
                        'visibility',        'direct',
                        'recipient_user_id', v_rid,
                        'company_id',        v_company_id
                    )
                );
            END IF;
        END LOOP;
    ELSIF v_file.visibility = 'broadcast' THEN
        PERFORM public.fn_emit_notification_event(
            'filehub.file_replaced', 'filehub_file', p_target_id, v_user_id,
            jsonb_build_object(
                'file_id',    p_target_id,
                'file_name',  v_file.original_name,
                'version_no', v_next_no,
                'visibility', 'broadcast',
                'company_id', v_company_id::TEXT
            )
        );
    ELSIF v_file.visibility = 'group' THEN
        PERFORM public.fn_emit_notification_event(
            'filehub.file_replaced', 'filehub_file', p_target_id, v_user_id,
            jsonb_build_object(
                'file_id',    p_target_id,
                'file_name',  v_file.original_name,
                'version_no', v_next_no,
                'visibility', 'group',
                'group_id',   v_file.group_id::TEXT,
                'company_id', v_company_id::TEXT
            )
        );
    END IF;

    RETURN v_version_id;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2.4 New RPC: pin_version — exempt a version from the 30-day purge
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_pin_version(
    p_version_id UUID,
    p_pinned     BOOLEAN
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_version    public.filehub_file_versions%ROWTYPE;
    v_file       public.filehub_files%ROWTYPE;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;

    SELECT * INTO v_version
    FROM public.filehub_file_versions
    WHERE id = p_version_id AND company_id = v_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Version not found.';
    END IF;

    SELECT * INTO v_file
    FROM public.filehub_files
    WHERE id = v_version.file_id AND company_id = v_company_id AND deleted_at IS NULL;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'File not found.';
    END IF;

    -- Same permission checks as replace_file / restore_version.
    IF v_file.visibility = 'group' THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.filehub_group_members
            WHERE group_id = v_file.group_id AND user_id = v_user_id
        ) THEN
            RAISE EXCEPTION 'You are not a member of this group.';
        END IF;
    ELSIF v_file.visibility = 'broadcast' THEN
        IF NOT public.has_permission('filehub:broadcast') THEN
            RAISE EXCEPTION 'You do not have permission to pin versions of broadcast files.';
        END IF;
    ELSIF v_file.visibility = 'direct' THEN
        IF v_file.uploaded_by <> v_user_id THEN
            RAISE EXCEPTION 'Only the owner can pin versions of a direct file.';
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported visibility: %', v_file.visibility;
    END IF;

    UPDATE public.filehub_file_versions SET pinned = p_pinned WHERE id = p_version_id;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2.5 list RPCs — add is_stale_restore (current_version_id's version_no <
--     the highest recorded version_no for the file)
-- ────────────────────────────────────────────────────────────────────────────
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
                'group_id',       f.group_id,
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

-- ────────────────────────────────────────────────────────────────────────────
-- 2.6 notification_rules seed for filehub.file_replaced
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
    v_creator UUID;
BEGIN
    SELECT id INTO v_creator FROM public.users ORDER BY created_at LIMIT 1;
    IF v_creator IS NULL THEN RETURN; END IF;

    INSERT INTO public.notification_rules
        (name, description, event_type, conditions, recipient_strategies, recipient_config, is_active, created_by)
    SELECT
        'File Replaced (Direct)',
        'Notify the recipient when a directly-shared file is replaced.',
        'filehub.file_replaced',
        '{"visibility":"direct"}'::JSONB,
        ARRAY['payload_user'],
        '{"payload_field": "recipient_user_id"}'::JSONB,
        TRUE,
        v_creator
    WHERE NOT EXISTS (
        SELECT 1 FROM public.notification_rules
        WHERE event_type = 'filehub.file_replaced' AND conditions->>'visibility' = 'direct'
    );

    INSERT INTO public.notification_rules
        (name, description, event_type, conditions, recipient_strategies, recipient_config, is_active, created_by)
    SELECT
        'File Replaced (Broadcast)',
        'Notify all company members when a broadcast file is replaced.',
        'filehub.file_replaced',
        '{"visibility":"broadcast"}'::JSONB,
        ARRAY['company_filehub_members'],
        '{}'::JSONB,
        TRUE,
        v_creator
    WHERE NOT EXISTS (
        SELECT 1 FROM public.notification_rules
        WHERE event_type = 'filehub.file_replaced' AND conditions->>'visibility' = 'broadcast'
    );

    INSERT INTO public.notification_rules
        (name, description, event_type, conditions, recipient_strategies, recipient_config, is_active, created_by)
    SELECT
        'File Replaced (Group)',
        'Notify group members when a group file is replaced.',
        'filehub.file_replaced',
        '{"visibility":"group"}'::JSONB,
        ARRAY['filehub_group_members'],
        '{}'::JSONB,
        TRUE,
        v_creator
    WHERE NOT EXISTS (
        SELECT 1 FROM public.notification_rules
        WHERE event_type = 'filehub.file_replaced' AND conditions->>'visibility' = 'group'
    );
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- GRANTS
-- ────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.rpc_filehub_replace_file(UUID,TEXT,BIGINT,TEXT,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_file_versions(UUID)                          TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_list(TEXT,TEXT,UUID,TEXT)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_list_files(UUID,TEXT,TEXT)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_pin_version(UUID,BOOLEAN)                    TO authenticated;

COMMIT;
