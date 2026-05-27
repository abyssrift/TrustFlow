-- 20260527_filehub_phase3_notifications.sql
-- File Hub Phase 3: QOL + Notification Engine Integration
--
-- 1. rpc_filehub_unread_count — lightweight badge RPC
-- 2. rpc_filehub_upload_commit — emits notification events on file send
-- 3. Seed default notification rules for filehub events

-- ─── 1. UNREAD COUNT RPC ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rpc_filehub_unread_count()
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COUNT(*)::INT
  FROM   public.filehub_recipients r
  JOIN   public.filehub_files f ON f.id = r.file_id
  WHERE  r.user_id  = auth.uid()
    AND  r.read_at  IS NULL
    AND  f.deleted_at IS NULL;
$$;

-- ─── 2. UPLOAD COMMIT WITH NOTIFICATION EVENTS ───────────────────────────────
-- Drop the 12-param version to replace it with notification logic.
DROP FUNCTION IF EXISTS public.rpc_filehub_upload_commit(TEXT,TEXT,UUID[],UUID,TEXT[],TEXT,TEXT,TEXT,BIGINT,TEXT,UUID,UUID);

CREATE OR REPLACE FUNCTION public.rpc_filehub_upload_commit(
    p_storage_path     TEXT,
    p_visibility       TEXT,
    p_recipient_ids    UUID[]  DEFAULT '{}',
    p_folder_id        UUID    DEFAULT NULL,
    p_tags             TEXT[]  DEFAULT '{}',
    p_caption          TEXT    DEFAULT NULL,
    p_original_name    TEXT    DEFAULT NULL,
    p_mime_type        TEXT    DEFAULT NULL,
    p_size_bytes       BIGINT  DEFAULT 0,
    p_content_hash     TEXT    DEFAULT NULL,
    p_replaces_file_id UUID    DEFAULT NULL,
    p_group_id         UUID    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_file_id    UUID;
    v_clean_tags TEXT[];
    v_rid        UUID;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;
    IF p_visibility NOT IN ('direct', 'broadcast', 'group') THEN
        RAISE EXCEPTION 'Invalid visibility: %', p_visibility;
    END IF;
    IF p_visibility = 'broadcast' AND NOT public.has_permission('filehub:broadcast') THEN
        RAISE EXCEPTION 'You do not have permission to broadcast files.';
    END IF;
    IF p_visibility = 'direct' AND (p_recipient_ids IS NULL OR cardinality(p_recipient_ids) = 0) THEN
        RAISE EXCEPTION 'Direct sends require at least one recipient.';
    END IF;
    IF p_visibility = 'group' THEN
        IF p_group_id IS NULL THEN
            RAISE EXCEPTION 'Group uploads require a group_id.';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.filehub_group_members
            WHERE group_id = p_group_id AND user_id = v_user_id
        ) THEN
            RAISE EXCEPTION 'You are not a member of this group.';
        END IF;
        IF NOT EXISTS (
            SELECT 1 FROM public.filehub_groups
            WHERE id = p_group_id AND company_id = v_company_id
        ) THEN
            RAISE EXCEPTION 'Group not found.';
        END IF;
    END IF;
    IF p_size_bytes > 524288000 THEN
        RAISE EXCEPTION 'File exceeds 500 MB limit.';
    END IF;
    IF p_original_name IS NULL OR length(trim(p_original_name)) = 0 THEN
        RAISE EXCEPTION 'Original filename is required.';
    END IF;
    IF p_storage_path IS NULL OR length(trim(p_storage_path)) = 0 THEN
        RAISE EXCEPTION 'Storage path is required.';
    END IF;
    IF p_folder_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.filehub_folders WHERE id = p_folder_id AND company_id = v_company_id
    ) THEN
        RAISE EXCEPTION 'Folder does not exist in this company.';
    END IF;
    IF p_visibility = 'direct' AND EXISTS (
        SELECT 1 FROM unnest(p_recipient_ids) rid
        WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = rid AND u.company_id = v_company_id)
    ) THEN
        RAISE EXCEPTION 'One or more recipients are not members of your company.';
    END IF;

    SELECT COALESCE(array_agg(DISTINCT lower(trim(t))) FILTER (WHERE length(trim(t)) > 0), '{}')
    INTO v_clean_tags FROM unnest(COALESCE(p_tags, '{}')) AS t;

    INSERT INTO public.filehub_files (
        company_id, uploaded_by, storage_path, bucket, original_name, mime_type,
        size_bytes, content_hash, caption, visibility, folder_id, tags, replaces_file_id, group_id
    ) VALUES (
        v_company_id, v_user_id, p_storage_path, 'filehub-files', p_original_name, p_mime_type,
        p_size_bytes, p_content_hash, NULLIF(trim(coalesce(p_caption, '')), ''),
        p_visibility, p_folder_id, v_clean_tags, p_replaces_file_id,
        CASE WHEN p_visibility = 'group' THEN p_group_id ELSE NULL END
    ) RETURNING id INTO v_file_id;

    -- ── Recipients + notifications ────────────────────────────────────
    IF p_visibility = 'direct' THEN
        INSERT INTO public.filehub_recipients (file_id, user_id)
        SELECT v_file_id, rid FROM unnest(p_recipient_ids) AS rid
        WHERE rid <> v_user_id
        ON CONFLICT DO NOTHING;

        -- One notification event per recipient so each gets their own push/email
        FOREACH v_rid IN ARRAY p_recipient_ids LOOP
            IF v_rid <> v_user_id THEN
                PERFORM public.fn_emit_notification_event(
                    'filehub.file_received',
                    'filehub_file',
                    v_file_id,
                    v_user_id,
                    jsonb_build_object(
                        'file_id',           v_file_id,
                        'file_name',         p_original_name,
                        'recipient_user_id', v_rid,
                        'company_id',        v_company_id
                    )
                );
            END IF;
        END LOOP;
    END IF;

    IF p_visibility = 'broadcast' THEN
        -- Single event; Edge Function resolves all company members via
        -- the 'company_filehub_members' recipient strategy.
        PERFORM public.fn_emit_notification_event(
            'filehub.broadcast_posted',
            'filehub_file',
            v_file_id,
            v_user_id,
            jsonb_build_object(
                'file_id',   v_file_id,
                'file_name', p_original_name,
                'company_id', v_company_id::TEXT
            )
        );
    END IF;

    IF p_visibility = 'group' AND p_group_id IS NOT NULL THEN
        -- Single event; Edge Function resolves group members via
        -- the 'filehub_group_members' recipient strategy.
        PERFORM public.fn_emit_notification_event(
            'filehub.group_file_shared',
            'filehub_file',
            v_file_id,
            v_user_id,
            jsonb_build_object(
                'file_id',   v_file_id,
                'file_name', p_original_name,
                'group_id',  p_group_id::TEXT,
                'company_id', v_company_id::TEXT
            )
        );
    END IF;

    RETURN v_file_id;
END;
$$;

-- ─── 3. SEED DEFAULT NOTIFICATION RULES ──────────────────────────────────────
-- Uses the first user in the company as rule owner (idempotent, skips if rules
-- for these event types already exist).
DO $$
DECLARE
    v_creator UUID;
BEGIN
    SELECT id INTO v_creator FROM public.users ORDER BY created_at LIMIT 1;
    IF v_creator IS NULL THEN RETURN; END IF;

    -- filehub.file_received → notify the specific recipient via payload_user strategy
    INSERT INTO public.notification_rules
        (name, description, event_type, conditions, recipient_strategies, recipient_config, is_active, created_by)
    SELECT
        'File Received',
        'Notify a user when a file is directly shared with them.',
        'filehub.file_received',
        '{}'::JSONB,
        ARRAY['payload_user'],
        '{"payload_field": "recipient_user_id"}'::JSONB,
        TRUE,
        v_creator
    WHERE NOT EXISTS (
        SELECT 1 FROM public.notification_rules WHERE event_type = 'filehub.file_received'
    );

    -- filehub.broadcast_posted → notify all company File Hub members
    INSERT INTO public.notification_rules
        (name, description, event_type, conditions, recipient_strategies, recipient_config, is_active, created_by)
    SELECT
        'Broadcast File Posted',
        'Notify all company members when a file is broadcast to the whole company.',
        'filehub.broadcast_posted',
        '{}'::JSONB,
        ARRAY['company_filehub_members'],
        '{}'::JSONB,
        TRUE,
        v_creator
    WHERE NOT EXISTS (
        SELECT 1 FROM public.notification_rules WHERE event_type = 'filehub.broadcast_posted'
    );

    -- filehub.group_file_shared → notify group members
    INSERT INTO public.notification_rules
        (name, description, event_type, conditions, recipient_strategies, recipient_config, is_active, created_by)
    SELECT
        'Group File Shared',
        'Notify group members when a file is shared to their group.',
        'filehub.group_file_shared',
        '{}'::JSONB,
        ARRAY['filehub_group_members'],
        '{}'::JSONB,
        TRUE,
        v_creator
    WHERE NOT EXISTS (
        SELECT 1 FROM public.notification_rules WHERE event_type = 'filehub.group_file_shared'
    );
END $$;
