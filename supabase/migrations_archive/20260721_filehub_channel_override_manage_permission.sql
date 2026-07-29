-- 20260721_filehub_channel_override_manage_permission.sql
-- Splits channel override into two granular tiers so they can be assigned
-- independently via the Role editor:
--   filehub:group_override         — browse/view any channel (read-only; shipped earlier today)
--   filehub:group_override_manage  — full channel-admin equivalent: upload,
--                                     add members, remove/kick members —
--                                     exactly as if they held the channel's
--                                     'admin' role. Implies view access too.
--
-- Still never inserts a filehub_group_members row for the overriding user —
-- they act with admin authority without being counted as a member, so
-- regular members don't see them in the roster unless someone explicitly
-- adds them (rpc_filehub_group_add_member). Their name does become visible
-- via ordinary side effects of acting (e.g. as a file's uploader, or via
-- audit trail) — that's inherent to actually performing admin actions, not
-- silent presence, so it's intentionally not suppressed.

UPDATE public.permissions
SET label = 'Browse Any Channel (View Only)'
WHERE key = 'filehub:group_override';

INSERT INTO public.permissions (key, label, description, category) VALUES
    ('filehub:group_override_manage', 'Manage Any Channel (Full Admin)', 'Act as an admin in any FileHub channel in the company without being a member: upload files, add members, and remove/kick members. Includes view access.', 'filehub')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.is_system = true
  AND r.name IN ('Owner', 'Admin', 'Manager')
  AND p.key = 'filehub:group_override_manage'
ON CONFLICT DO NOTHING;

-- ─── RLS: manage tier also satisfies every view-tier check ──────────────────

DROP POLICY IF EXISTS "filehub_groups_select_members" ON public.filehub_groups;
CREATE POLICY "filehub_groups_select_members" ON public.filehub_groups
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.filehub_group_members gm
            WHERE gm.group_id = filehub_groups.id AND gm.user_id = auth.uid()
        )
        OR (
            company_id = public.my_company_id()
            AND (public.has_permission('filehub:group_override') OR public.has_permission('filehub:group_override_manage'))
        )
    );

DROP POLICY IF EXISTS "filehub_group_members_select" ON public.filehub_group_members;
CREATE POLICY "filehub_group_members_select" ON public.filehub_group_members
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.filehub_group_members gm2
            WHERE gm2.group_id = filehub_group_members.group_id AND gm2.user_id = auth.uid()
        )
        OR (
            (public.has_permission('filehub:group_override') OR public.has_permission('filehub:group_override_manage'))
            AND EXISTS (
                SELECT 1 FROM public.filehub_groups g
                WHERE g.id = filehub_group_members.group_id AND g.company_id = public.my_company_id()
            )
        )
    );

DROP POLICY IF EXISTS "filehub_files_select_visibility" ON public.filehub_files;
CREATE POLICY "filehub_files_select_visibility" ON public.filehub_files
    FOR SELECT USING (
        deleted_at IS NULL
        AND company_id = public.my_company_id()
        AND (
            uploaded_by = auth.uid()
            OR visibility = 'broadcast'
            OR (visibility = 'direct' AND EXISTS (
                SELECT 1 FROM public.filehub_recipients r
                WHERE r.file_id = filehub_files.id AND r.user_id = auth.uid()
            ))
            OR (visibility = 'group' AND group_id IS NOT NULL AND EXISTS (
                SELECT 1 FROM public.filehub_group_members gm
                WHERE gm.group_id = filehub_files.group_id AND gm.user_id = auth.uid()
            ))
            OR (visibility = 'group' AND group_id IS NOT NULL AND (
                public.has_permission('filehub:group_override') OR public.has_permission('filehub:group_override_manage')
            ))
        )
    );

-- ─── RPCs: manage tier also satisfies the view-tier RPCs ─────────────────────

CREATE OR REPLACE FUNCTION public.rpc_filehub_group_list(p_override BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id    UUID := auth.uid();
    v_company_id UUID := public.my_company_id();
    v_use_override BOOLEAN := p_override AND (
        public.has_permission('filehub:group_override') OR public.has_permission('filehub:group_override_manage')
    );
    v_rows       JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;

    SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
            'id',           g.id,
            'name',         g.name,
            'description',  g.description,
            'avatar_color', g.avatar_color,
            'my_role',      gm_me.role,
            'is_override',  gm_me.role IS NULL,
            'member_count', (SELECT COUNT(*) FROM public.filehub_group_members gmc WHERE gmc.group_id = g.id),
            'members', (
                SELECT COALESCE(jsonb_agg(jsonb_build_object(
                    'id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url
                )), '[]'::jsonb)
                FROM (
                    SELECT gml.user_id FROM public.filehub_group_members gml
                    WHERE gml.group_id = g.id ORDER BY gml.joined_at LIMIT 4
                ) sub JOIN public.users u ON u.id = sub.user_id
            ),
            'file_count',    (SELECT COUNT(*) FROM public.filehub_files f WHERE f.group_id = g.id AND f.deleted_at IS NULL),
            'last_activity', (SELECT MAX(f.created_at) FROM public.filehub_files f WHERE f.group_id = g.id AND f.deleted_at IS NULL)
        )
        ORDER BY (SELECT MAX(fa.created_at) FROM public.filehub_files fa WHERE fa.group_id = g.id AND fa.deleted_at IS NULL) DESC NULLS LAST, g.name
    ), '[]'::jsonb)
    INTO v_rows
    FROM public.filehub_groups g
    LEFT JOIN public.filehub_group_members gm_me ON gm_me.group_id = g.id AND gm_me.user_id = v_user_id
    WHERE g.company_id = v_company_id
      AND (gm_me.user_id IS NOT NULL OR v_use_override);

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

CREATE OR REPLACE FUNCTION public.rpc_filehub_group_members(p_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_rows    JSONB;
BEGIN
    IF NOT (
        EXISTS (SELECT 1 FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id = v_user_id)
        OR (
            (public.has_permission('filehub:group_override') OR public.has_permission('filehub:group_override_manage'))
            AND EXISTS (SELECT 1 FROM public.filehub_groups g WHERE g.id = p_group_id AND g.company_id = public.my_company_id())
        )
    ) THEN
        RAISE EXCEPTION 'You are not a member of this group.';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id',        u.id,
        'full_name', u.full_name,
        'avatar_url',u.avatar_url,
        'role',      gm.role,
        'joined_at', gm.joined_at
    ) ORDER BY gm.role DESC, gm.joined_at), '[]'::jsonb)
    INTO v_rows
    FROM public.filehub_group_members gm
    JOIN public.users u ON u.id = gm.user_id
    WHERE gm.group_id = p_group_id;

    RETURN v_rows;
END;
$$;

-- ─── RPCs: manage-tier write access (upload / add member / remove member) ────

-- Upload: group-visibility branch now also accepts manage-tier override.
-- Body is otherwise identical to the live rpc_filehub_upload_commit (quota
-- checks, dedupe, versioning, rel_dir folder creation) — only the group
-- membership check changed.
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
    p_group_id         UUID    DEFAULT NULL,
    p_rel_dir          TEXT    DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id     UUID   := public.my_company_id();
    v_user_id        UUID   := auth.uid();
    v_file_id        UUID;
    v_version_id     UUID;
    v_clean_tags     TEXT[];
    v_final_name     TEXT;
    v_size_limit     BIGINT;
    v_storage_limit  BIGINT;
    v_storage_used   BIGINT;
    v_target_folder  UUID   := p_folder_id;
    v_scope          TEXT;
    v_folder_group   UUID;
    v_parent         UUID;
    v_child          UUID;
    v_seg            TEXT;
    v_lock_key       BIGINT;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to use File Hub.';
    END IF;

    PERFORM public._rate_limit('file_upload', 1000);

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
        IF NOT (
            EXISTS (
                SELECT 1 FROM public.filehub_group_members
                WHERE group_id = p_group_id AND user_id = v_user_id
            )
            OR public.has_permission('filehub:group_override_manage')
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

    v_size_limit := public._company_file_size_limit(v_company_id);
    IF v_size_limit <> -1 AND p_size_bytes > v_size_limit THEN
        RAISE EXCEPTION 'File too large for your plan (% MB limit). Upgrade to upload larger files.',
            round(v_size_limit::numeric / 1048576);
    END IF;

    v_storage_limit := public._company_storage_limit(v_company_id);
    IF v_storage_limit <> -1 THEN
        SELECT COALESCE(storage_used_bytes, 0) INTO v_storage_used
        FROM public.company_billing WHERE company_id = v_company_id FOR UPDATE;
        IF (COALESCE(v_storage_used, 0) + p_size_bytes) > v_storage_limit THEN
            RAISE EXCEPTION 'Storage quota exceeded (% MB of % MB used). Upgrade your plan to add more storage.',
                round(COALESCE(v_storage_used, 0)::numeric / 1048576),
                round(v_storage_limit::numeric / 1048576);
        END IF;
    END IF;

    IF p_original_name IS NULL OR length(trim(p_original_name)) = 0 THEN
        RAISE EXCEPTION 'Original filename is required.';
    END IF;
    IF p_storage_path IS NULL OR length(trim(p_storage_path)) = 0 THEN
        RAISE EXCEPTION 'Storage path is required.';
    END IF;
    IF p_folder_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE id = p_folder_id AND company_id = v_company_id AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Folder does not exist in this company.';
    END IF;

    IF p_rel_dir IS NOT NULL AND length(trim(p_rel_dir)) > 0
       AND p_folder_id IS NOT NULL
       AND NOT EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE id = p_folder_id
          AND company_id = v_company_id
          AND scope = p_visibility
          AND group_id IS NOT DISTINCT FROM (CASE WHEN p_visibility = 'group' THEN p_group_id ELSE NULL END)
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Target folder does not exist in this scope.';
    END IF;
    IF p_visibility = 'direct' AND EXISTS (
        SELECT 1 FROM unnest(p_recipient_ids) rid
        WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = rid AND u.company_id = v_company_id)
    ) THEN
        RAISE EXCEPTION 'One or more recipients are not members of your company.';
    END IF;

    IF p_rel_dir IS NOT NULL AND length(trim(p_rel_dir)) > 0 THEN
        v_scope        := p_visibility;
        v_folder_group := CASE WHEN v_scope = 'group' THEN p_group_id ELSE NULL END;
        v_parent       := p_folder_id;
        FOREACH v_seg IN ARRAY regexp_split_to_array(trim(p_rel_dir), '/') LOOP
            v_seg := trim(v_seg);
            CONTINUE WHEN length(v_seg) = 0;

            SELECT id INTO v_child
            FROM public.filehub_folders
            WHERE company_id = v_company_id
              AND parent_id IS NOT DISTINCT FROM v_parent
              AND scope = v_scope
              AND group_id IS NOT DISTINCT FROM v_folder_group
              AND name = v_seg
              AND deleted_at IS NULL;

            IF v_child IS NULL THEN
                INSERT INTO public.filehub_folders (company_id, name, created_by, parent_id, scope, group_id)
                VALUES (v_company_id, v_seg, v_user_id, v_parent, v_scope, v_folder_group)
                ON CONFLICT DO NOTHING
                RETURNING id INTO v_child;

                IF v_child IS NULL THEN
                    SELECT id INTO v_child
                    FROM public.filehub_folders
                    WHERE company_id = v_company_id
                      AND parent_id IS NOT DISTINCT FROM v_parent
                      AND scope = v_scope
                      AND group_id IS NOT DISTINCT FROM v_folder_group
                      AND name = v_seg
                      AND deleted_at IS NULL;
                END IF;

                IF v_child IS NULL THEN
                    RAISE EXCEPTION 'Cannot create folder "%" here — a folder with that name already exists at this level.', v_seg;
                END IF;
            END IF;

            v_parent := v_child;
        END LOOP;
        v_target_folder := v_parent;
    END IF;

    SELECT COALESCE(array_agg(DISTINCT lower(trim(t))) FILTER (WHERE length(trim(t)) > 0), '{}')
    INTO v_clean_tags FROM unnest(COALESCE(p_tags, '{}')) AS t;

    v_lock_key := hashtextextended(
        v_company_id::text
          || '|' || p_visibility
          || '|' || COALESCE((CASE WHEN p_visibility = 'group'  THEN p_group_id END)::text, '-')
          || '|' || COALESCE((CASE WHEN p_visibility = 'direct' THEN v_user_id  END)::text, '-')
          || '|' || COALESCE(v_target_folder::text, '-'),
        0
    );
    PERFORM pg_advisory_xact_lock(v_lock_key);

    v_final_name := public.filehub_dedupe_name(
        p_original_name, p_visibility, p_group_id, v_target_folder
    );

    INSERT INTO public.filehub_files (
        company_id, uploaded_by, storage_path, bucket, original_name, mime_type,
        size_bytes, content_hash, caption, visibility, folder_id, tags, replaces_file_id, group_id,
        updated_at, updated_by
    ) VALUES (
        v_company_id, v_user_id, p_storage_path, 'filehub-files', v_final_name, p_mime_type,
        p_size_bytes, p_content_hash, NULLIF(trim(coalesce(p_caption, '')), ''),
        p_visibility, v_target_folder, v_clean_tags, p_replaces_file_id,
        CASE WHEN p_visibility = 'group' THEN p_group_id ELSE NULL END,
        now(), v_user_id
    ) RETURNING id INTO v_file_id;

    INSERT INTO public.filehub_file_versions (
        file_id, company_id, version_no, storage_path, bucket,
        original_name, size_bytes, mime_type, content_hash, created_by, superseded_at
    ) VALUES (
        v_file_id, v_company_id, 1, p_storage_path, 'filehub-files',
        v_final_name, p_size_bytes, p_mime_type, p_content_hash, v_user_id, NULL
    ) RETURNING id INTO v_version_id;

    UPDATE public.filehub_files SET current_version_id = v_version_id WHERE id = v_file_id;

    IF p_visibility = 'direct' THEN
        INSERT INTO public.filehub_recipients (file_id, user_id)
        SELECT v_file_id, rid FROM unnest(p_recipient_ids) AS rid
        WHERE rid <> v_user_id
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_file_id;
END;
$$;

-- Add member: manage-tier override can invite into any channel, same as a
-- real member could (any member — not just admins — can invite today).
CREATE OR REPLACE FUNCTION public.rpc_filehub_group_add_member(
    p_group_id UUID,
    p_user_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
BEGIN
    IF NOT (
        EXISTS (SELECT 1 FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id = v_user_id)
        OR public.has_permission('filehub:group_override_manage')
    ) THEN RAISE EXCEPTION 'You are not a member of this group.'; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.filehub_groups WHERE id = p_group_id AND company_id = v_company_id
    ) THEN RAISE EXCEPTION 'Group not found.'; END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.users WHERE id = p_user_id AND company_id = v_company_id
    ) THEN RAISE EXCEPTION 'User is not a member of your company.'; END IF;

    INSERT INTO public.filehub_group_members (group_id, user_id, role, added_by)
    VALUES (p_group_id, p_user_id, 'member', v_user_id)
    ON CONFLICT DO NOTHING;
END;
$$;

-- Remove member: manage-tier override acts as a virtual channel admin — can
-- kick anyone (including real admins), same authority a real admin member
-- has. The last-admin self-leave guard only makes sense for an actual
-- membership row, so it's untouched (an override caller never matches
-- p_user_id = v_user_id off a real row, since they have none).
CREATE OR REPLACE FUNCTION public.rpc_filehub_group_remove_member(
    p_group_id UUID,
    p_user_id  UUID
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id     UUID := auth.uid();
    v_caller_role TEXT;
    v_is_override BOOLEAN := false;
BEGIN
    SELECT role INTO v_caller_role FROM public.filehub_group_members
    WHERE group_id = p_group_id AND user_id = v_user_id;

    IF v_caller_role IS NULL THEN
        v_is_override := public.has_permission('filehub:group_override_manage')
            AND EXISTS (SELECT 1 FROM public.filehub_groups g WHERE g.id = p_group_id AND g.company_id = public.my_company_id());
        IF NOT v_is_override THEN
            RAISE EXCEPTION 'You are not a member of this group.';
        END IF;
    END IF;

    IF p_user_id <> v_user_id AND v_caller_role IS DISTINCT FROM 'admin' AND NOT v_is_override THEN
        RAISE EXCEPTION 'Only group admins can remove other members.';
    END IF;

    IF p_user_id = v_user_id AND v_caller_role = 'admin'
       AND NOT EXISTS (SELECT 1 FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id <> p_user_id AND role = 'admin')
       AND EXISTS     (SELECT 1 FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id <> p_user_id)
    THEN
        RAISE EXCEPTION 'You are the only admin. Promote another member before leaving.';
    END IF;

    DELETE FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_list(BOOLEAN)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_list_files(UUID,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_members(UUID)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_upload_commit(TEXT,TEXT,UUID[],UUID,TEXT[],TEXT,TEXT,TEXT,BIGINT,TEXT,UUID,UUID,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_add_member(UUID,UUID)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_remove_member(UUID,UUID)  TO authenticated;
