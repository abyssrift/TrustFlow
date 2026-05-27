-- 20260527_filehub_groups.sql
-- File Hub Phase 2: Group Folders
-- Adds WhatsApp-style shared group spaces where multiple members can upload
-- and share files that persist in the group for all members to access.

-- ─── 1. PERMISSION ───────────────────────────────────────────────────────────
INSERT INTO public.permissions (key, label, category) VALUES
    ('filehub:groups', 'Create and Manage Groups', 'filehub')
ON CONFLICT (key) DO NOTHING;

-- ─── 2. TABLES ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.filehub_groups (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id   UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    name         TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
    description  TEXT CHECK (description IS NULL OR length(description) <= 300),
    avatar_color TEXT NOT NULL DEFAULT '#6366f1',
    created_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_filehub_groups_company ON public.filehub_groups(company_id);

CREATE TABLE IF NOT EXISTS public.filehub_group_members (
    group_id  UUID NOT NULL REFERENCES public.filehub_groups(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    added_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_filehub_group_members_user  ON public.filehub_group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_filehub_group_members_group ON public.filehub_group_members(group_id);

-- Add group_id FK to files
ALTER TABLE public.filehub_files
    ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.filehub_groups(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_filehub_files_group
    ON public.filehub_files(group_id) WHERE deleted_at IS NULL AND group_id IS NOT NULL;

-- Extend visibility to include 'group'
ALTER TABLE public.filehub_files DROP CONSTRAINT IF EXISTS filehub_files_visibility_check;
ALTER TABLE public.filehub_files ADD CONSTRAINT filehub_files_visibility_check
    CHECK (visibility IN ('direct', 'broadcast', 'group'));

-- ─── 3. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.filehub_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.filehub_group_members ENABLE ROW LEVEL SECURITY;

-- Groups: only visible to members of that group
CREATE POLICY "filehub_groups_select_members" ON public.filehub_groups
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.filehub_group_members gm
            WHERE gm.group_id = filehub_groups.id AND gm.user_id = auth.uid()
        )
    );

-- Group members: visible to fellow members
CREATE POLICY "filehub_group_members_select" ON public.filehub_group_members
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.filehub_group_members gm2
            WHERE gm2.group_id = filehub_group_members.group_id AND gm2.user_id = auth.uid()
        )
    );

-- Update the files SELECT policy to include group visibility
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
        )
    );

-- ─── 4. RPCs ─────────────────────────────────────────────────────────────────

-- 4a. Updated upload_commit: adds p_group_id parameter
-- Must DROP the old function first (different signature = new overload in PG)
DROP FUNCTION IF EXISTS public.rpc_filehub_upload_commit(TEXT,TEXT,UUID[],UUID,TEXT[],TEXT,TEXT,TEXT,BIGINT,TEXT,UUID);

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

    IF p_visibility = 'direct' THEN
        INSERT INTO public.filehub_recipients (file_id, user_id)
        SELECT v_file_id, rid FROM unnest(p_recipient_ids) AS rid
        WHERE rid <> v_user_id
        ON CONFLICT DO NOTHING;
    END IF;

    RETURN v_file_id;
END;
$$;

-- 4b. Create a group
CREATE OR REPLACE FUNCTION public.rpc_filehub_group_create(
    p_name         TEXT,
    p_description  TEXT   DEFAULT NULL,
    p_avatar_color TEXT   DEFAULT '#6366f1',
    p_member_ids   UUID[] DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_group_id   UUID;
    v_mid        UUID;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;
    IF p_name IS NULL OR length(trim(p_name)) = 0 THEN
        RAISE EXCEPTION 'Group name is required.';
    END IF;

    INSERT INTO public.filehub_groups (company_id, name, description, avatar_color, created_by)
    VALUES (v_company_id, trim(p_name), NULLIF(trim(coalesce(p_description,'')), ''), p_avatar_color, v_user_id)
    RETURNING id INTO v_group_id;

    INSERT INTO public.filehub_group_members (group_id, user_id, role, added_by)
    VALUES (v_group_id, v_user_id, 'admin', v_user_id);

    FOREACH v_mid IN ARRAY COALESCE(p_member_ids, '{}') LOOP
        IF v_mid <> v_user_id AND EXISTS (
            SELECT 1 FROM public.users WHERE id = v_mid AND company_id = v_company_id
        ) THEN
            INSERT INTO public.filehub_group_members (group_id, user_id, role, added_by)
            VALUES (v_group_id, v_mid, 'member', v_user_id)
            ON CONFLICT DO NOTHING;
        END IF;
    END LOOP;

    RETURN v_group_id;
END;
$$;

-- 4c. List groups the current user belongs to (with member stacks and counts)
CREATE OR REPLACE FUNCTION public.rpc_filehub_group_list()
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id    UUID := auth.uid();
    v_company_id UUID := public.my_company_id();
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
    JOIN public.filehub_group_members gm_me ON gm_me.group_id = g.id AND gm_me.user_id = v_user_id
    WHERE g.company_id = v_company_id;

    RETURN v_rows;
END;
$$;

-- 4d. List files in a specific group (same shape as rpc_filehub_list)
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

-- 4e. Get full member list for a group (for the management sheet)
CREATE OR REPLACE FUNCTION public.rpc_filehub_group_members(p_group_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_rows    JSONB;
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id = v_user_id
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

-- 4f. Add a member (any current member can invite company colleagues)
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
    IF NOT EXISTS (
        SELECT 1 FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id = v_user_id
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

-- 4g. Remove a member (admin removes anyone; member can only leave themselves)
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
BEGIN
    SELECT role INTO v_caller_role FROM public.filehub_group_members
    WHERE group_id = p_group_id AND user_id = v_user_id;

    IF v_caller_role IS NULL THEN
        RAISE EXCEPTION 'You are not a member of this group.';
    END IF;
    IF p_user_id <> v_user_id AND v_caller_role <> 'admin' THEN
        RAISE EXCEPTION 'Only group admins can remove other members.';
    END IF;
    -- Last admin guard: can't leave if you're sole admin and others remain
    IF p_user_id = v_user_id AND v_caller_role = 'admin'
       AND NOT EXISTS (SELECT 1 FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id <> p_user_id AND role = 'admin')
       AND EXISTS     (SELECT 1 FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id <> p_user_id)
    THEN
        RAISE EXCEPTION 'You are the only admin. Promote another member before leaving.';
    END IF;

    DELETE FROM public.filehub_group_members WHERE group_id = p_group_id AND user_id = p_user_id;
END;
$$;

-- ─── 5. GRANTS ───────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.rpc_filehub_upload_commit(TEXT,TEXT,UUID[],UUID,TEXT[],TEXT,TEXT,TEXT,BIGINT,TEXT,UUID,UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_create(TEXT,TEXT,TEXT,UUID[])                                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_list()                                                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_list_files(UUID,TEXT,TEXT)                                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_members(UUID)                                                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_add_member(UUID,UUID)                                                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_remove_member(UUID,UUID)                                                   TO authenticated;
