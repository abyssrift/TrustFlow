-- 20260721_filehub_channel_override_permission.sql
-- New granular permission letting Owner/Admin/Manager open any FileHub
-- channel (filehub_groups) without being a member. Mirrors
-- 20260719_filehub_bin_empty_permission.sql's seeding pattern.
--
-- Override access is read-only (list channel + its files + roster) and
-- never inserts a filehub_group_members row for the overriding user, so
-- regular members never see them in the roster/member stack — the only way
-- an overriding user becomes visible to a channel is an explicit invite via
-- rpc_filehub_group_add_member. The client additionally gates this behind a
-- UI toggle (default off) so a permission holder's own channel list stays
-- unchanged unless they deliberately switch into "browse all channels" mode.

INSERT INTO public.permissions (key, label, description, category) VALUES
    ('filehub:group_override', 'Override Channel Access', 'Open and view any FileHub channel in the company without being a member. Does not add you to the channel roster or allow uploading unless you are explicitly invited.', 'filehub')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.is_system = true
  AND r.name IN ('Owner', 'Admin', 'Manager')
  AND p.key = 'filehub:group_override'
ON CONFLICT DO NOTHING;

-- ─── RLS: let override holders SELECT any company channel/roster/group-file ──

DROP POLICY IF EXISTS "filehub_groups_select_members" ON public.filehub_groups;
CREATE POLICY "filehub_groups_select_members" ON public.filehub_groups
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.filehub_group_members gm
            WHERE gm.group_id = filehub_groups.id AND gm.user_id = auth.uid()
        )
        OR (company_id = public.my_company_id() AND public.has_permission('filehub:group_override'))
    );

DROP POLICY IF EXISTS "filehub_group_members_select" ON public.filehub_group_members;
CREATE POLICY "filehub_group_members_select" ON public.filehub_group_members
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.filehub_group_members gm2
            WHERE gm2.group_id = filehub_group_members.group_id AND gm2.user_id = auth.uid()
        )
        OR (
            public.has_permission('filehub:group_override')
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
            OR (visibility = 'group' AND group_id IS NOT NULL AND public.has_permission('filehub:group_override'))
        )
    );

-- ─── RPCs ──────────────────────────────────────────────────────────────────

-- List channels: p_override=true (only meaningful with the permission) also
-- returns channels the caller isn't a member of, flagged is_override=true.
-- Old signature took zero args; CREATE OR REPLACE with an added default param
-- would overload rather than replace it, leaving both defined and ambiguous
-- for a zero-arg call. Drop it explicitly first.
DROP FUNCTION IF EXISTS public.rpc_filehub_group_list();
CREATE OR REPLACE FUNCTION public.rpc_filehub_group_list(p_override BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id    UUID := auth.uid();
    v_company_id UUID := public.my_company_id();
    v_use_override BOOLEAN := p_override AND public.has_permission('filehub:group_override');
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

-- List files in a channel: override holders may browse without membership.
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

-- Roster lookup: override holders may view membership without being members.
-- They still never appear IN the roster themselves (no row is inserted for
-- them) — this is only about read access, not implicit joining.
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
            public.has_permission('filehub:group_override')
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

GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_list(BOOLEAN)       TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_list_files(UUID,TEXT,TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_members(UUID)       TO authenticated;
