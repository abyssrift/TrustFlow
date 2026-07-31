-- 20260730_filehub_share_permission.sql
-- Bug: share links were hard-locked to the file's uploader / the folder's
-- creator, with no privilege override at all. A manager who can plainly SEE a
-- channel file could not share it, and an owner could not revoke a link someone
-- else had minted — which makes the feature close to useless in a team.
--
-- Fix: two granular permissions, layered on top of "can you already access it".
--
--   filehub:share           — share ANY file/folder you can already access.
--                             Never widens read access: the accessibility check
--                             runs first, so this only removes the
--                             "must be the uploader" clause.
--   filehub:share_override  — everything above, PLUS see and revoke share links
--                             created by other people. The admin/owner escape
--                             hatch for killing a leaked link.
--
-- Revoking SOMEONE ELSE'S outward link is deliberately gated to the override
-- permission, not plain filehub:share: minting your own link and destroying a
-- colleague's are different-sized actions. Plain share-holders still see other
-- people's links on a file they can share (otherwise the "reuse the active
-- link" path in ShareFile.tsx mints duplicates), they just can't revoke them.
--
-- Access is layered, never bypassed: filehub_file_accessible() (20260727) is
-- reused verbatim as the floor, so a share permission can never leak a file the
-- holder couldn't already open. filehub:share_override does NOT bypass that
-- floor either — it only unlocks other people's LINKS on things you can access.
-- (Owners get everything via has_permission()'s is_owner clause already.)

-- ── 1. Permissions ───────────────────────────────────────────────────────────
INSERT INTO public.permissions (key, label, description, category) VALUES
    ('filehub:share', 'Share Any Accessible File',
     'Create public expiring share links for any file or folder you can already access — not just ones you uploaded yourself. Does not grant access to anything new.',
     'filehub'),
    ('filehub:share_override', 'Manage All Share Links',
     'See and revoke share links created by other people, on any file or folder you can access. Includes normal sharing.',
     'filehub')
ON CONFLICT (key) DO UPDATE
    SET label = EXCLUDED.label, description = EXCLUDED.description, category = EXCLUDED.category;

-- Seed: sharing outward is a publish action, so Personnel is deliberately left
-- out — a company that wants it can tick the box on a custom role. Revoking
-- other people's links stays with Owner + Admin.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r, public.permissions p
WHERE r.is_system = true
  AND ( (p.key = 'filehub:share'          AND r.name IN ('Owner', 'Admin', 'Manager'))
     OR (p.key = 'filehub:share_override' AND r.name IN ('Owner', 'Admin')) )
ON CONFLICT DO NOTHING;

-- ── 2. Access helpers ────────────────────────────────────────────────────────
-- Folders had no accessibility predicate at all (filehub_folders RLS is just
-- company_id + not-deleted), so one is needed to keep folder sharing from being
-- looser than file sharing. Mirrors filehub_file_accessible's scope logic:
-- a 'direct' folder is private to its creator, 'broadcast' is company-wide,
-- 'group' follows channel membership (or the channel-override permissions).
CREATE OR REPLACE FUNCTION public.filehub_folder_accessible(p_folder_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.filehub_folders fo
        WHERE fo.id = p_folder_id
          AND fo.deleted_at IS NULL
          AND fo.company_id = public.my_company_id()
          AND (
              fo.created_by = auth.uid()
              OR fo.scope = 'broadcast'
              OR (fo.scope = 'group' AND fo.group_id IS NOT NULL AND (
                     EXISTS (
                         SELECT 1 FROM public.filehub_group_members gm
                         WHERE gm.group_id = fo.group_id AND gm.user_id = auth.uid()
                     )
                     OR public.has_permission('filehub:group_override')
                     OR public.has_permission('filehub:group_override_manage')
                 ))
          )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.filehub_folder_accessible(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.filehub_folder_accessible(UUID) TO authenticated;

-- Accessible AND (mine OR privileged). One place, so the create RPCs, the list
-- RPCs and the UI flag can never drift apart.
CREATE OR REPLACE FUNCTION public.filehub_can_share_file(p_file_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.filehub_file_accessible(p_file_id)
       AND (
           EXISTS (
               SELECT 1 FROM public.filehub_files f
               WHERE f.id = p_file_id AND f.uploaded_by = auth.uid()
           )
           OR public.has_permission('filehub:share')
           OR public.has_permission('filehub:share_override')
       );
$$;

REVOKE EXECUTE ON FUNCTION public.filehub_can_share_file(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.filehub_can_share_file(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.filehub_can_share_folder(p_folder_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
    SELECT public.filehub_folder_accessible(p_folder_id)
       AND (
           EXISTS (
               SELECT 1 FROM public.filehub_folders fo
               WHERE fo.id = p_folder_id AND fo.created_by = auth.uid()
           )
           OR public.has_permission('filehub:share')
           OR public.has_permission('filehub:share_override')
       );
$$;

REVOKE EXECUTE ON FUNCTION public.filehub_can_share_folder(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.filehub_can_share_folder(UUID) TO authenticated;

-- ── 3. Create RPCs: uploader/creator clause -> the helper ────────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_share_link_create(p_file_id UUID, p_expires_in_hours INT DEFAULT 168)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_token      TEXT;
    v_expires_at TIMESTAMPTZ;
    v_id         UUID;
BEGIN
    IF p_expires_in_hours NOT BETWEEN 1 AND 720 THEN
        RAISE EXCEPTION 'Expiry must be between 1 hour and 30 days.';
    END IF;

    IF NOT public.filehub_file_accessible(p_file_id) THEN
        RAISE EXCEPTION 'File not found.';
    END IF;
    IF NOT public.filehub_can_share_file(p_file_id) THEN
        RAISE EXCEPTION 'You can view this file but not share it. Sharing files you did not upload needs the "Share Any Accessible File" permission.';
    END IF;

    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    v_expires_at := now() + (p_expires_in_hours || ' hours')::interval;

    INSERT INTO public.filehub_share_links (file_id, company_id, token, created_by, expires_at)
    VALUES (p_file_id, v_company_id, v_token, v_user_id, v_expires_at)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires_at);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_share_link_create(UUID, INT) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_share_link_create(p_folder_id UUID, p_expires_in_hours INT DEFAULT 168)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_token      TEXT;
    v_expires_at TIMESTAMPTZ;
    v_id         UUID;
BEGIN
    IF p_expires_in_hours NOT BETWEEN 1 AND 720 THEN
        RAISE EXCEPTION 'Expiry must be between 1 hour and 30 days.';
    END IF;

    IF NOT public.filehub_folder_accessible(p_folder_id) THEN
        RAISE EXCEPTION 'Folder not found.';
    END IF;
    IF NOT public.filehub_can_share_folder(p_folder_id) THEN
        RAISE EXCEPTION 'You can view this folder but not share it. Sharing folders you did not create needs the "Share Any Accessible File" permission.';
    END IF;

    v_token := encode(extensions.gen_random_bytes(24), 'hex');
    v_expires_at := now() + (p_expires_in_hours || ' hours')::interval;

    INSERT INTO public.filehub_share_links (folder_id, company_id, token, created_by, expires_at)
    VALUES (p_folder_id, v_company_id, v_token, v_user_id, v_expires_at)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires_at);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_share_link_create(UUID, INT) TO authenticated;

-- ── 4. Revoke: creator, or the override permission ───────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_share_link_revoke(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_link public.filehub_share_links%ROWTYPE;
BEGIN
    SELECT * INTO v_link FROM public.filehub_share_links
    WHERE id = p_id AND company_id = public.my_company_id();

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Share link not found.';
    END IF;
    IF v_link.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'Share link already revoked.';
    END IF;

    -- Revoking your own link never needs a permission. Killing someone else's
    -- does — and still only on a target you can actually reach.
    IF v_link.created_by <> auth.uid() THEN
        IF NOT public.has_permission('filehub:share_override') THEN
            RAISE EXCEPTION 'Only the person who created this link can revoke it. Revoking other people''s links needs the "Manage All Share Links" permission.';
        END IF;
        -- CASE, not COALESCE: these predicates return false (never NULL) for a
        -- NULL id, so COALESCE would answer with the wrong target's result.
        -- A link has exactly one target (filehub_share_links_one_target).
        IF NOT (CASE WHEN v_link.file_id IS NOT NULL
                     THEN public.filehub_file_accessible(v_link.file_id)
                     ELSE public.filehub_folder_accessible(v_link.folder_id)
                END) THEN
            RAISE EXCEPTION 'Share link not found.';
        END IF;
    END IF;

    UPDATE public.filehub_share_links SET revoked_at = now() WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_share_link_revoke(UUID) TO authenticated;

-- ── 5. List RPCs: everyone's links on a target you can share ─────────────────
-- Why not creator-only: ShareFile.tsx reuses the first ACTIVE link instead of
-- minting a new one. Blind to other people's links, two privileged users each
-- mint their own for the same file and revoking one leaves the other live.
-- created_by/creator_name/can_revoke are returned so the UI can label whose
-- link it is and hide Revoke when the caller isn't allowed to.
-- Return type changes, so DROP first (CREATE OR REPLACE cannot alter it).
DROP FUNCTION IF EXISTS public.rpc_filehub_share_link_list(UUID);
CREATE FUNCTION public.rpc_filehub_share_link_list(p_file_id UUID)
RETURNS TABLE (
    id UUID, token TEXT, created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ, view_count INT, last_viewed_at TIMESTAMPTZ,
    created_by UUID, creator_name TEXT, can_revoke BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT sl.id, sl.token, sl.created_at, sl.expires_at, sl.revoked_at,
           sl.view_count, sl.last_viewed_at, sl.created_by, u.full_name,
           (sl.created_by = auth.uid() OR public.has_permission('filehub:share_override'))
    FROM public.filehub_share_links sl
    LEFT JOIN public.users u ON u.id = sl.created_by
    WHERE sl.file_id = p_file_id
      AND (sl.created_by = auth.uid() OR public.filehub_can_share_file(p_file_id))
    ORDER BY sl.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_share_link_list(UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.rpc_filehub_folder_share_link_list(UUID);
CREATE FUNCTION public.rpc_filehub_folder_share_link_list(p_folder_id UUID)
RETURNS TABLE (
    id UUID, token TEXT, created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ, view_count INT, last_viewed_at TIMESTAMPTZ,
    created_by UUID, creator_name TEXT, can_revoke BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT sl.id, sl.token, sl.created_at, sl.expires_at, sl.revoked_at,
           sl.view_count, sl.last_viewed_at, sl.created_by, u.full_name,
           (sl.created_by = auth.uid() OR public.has_permission('filehub:share_override'))
    FROM public.filehub_share_links sl
    LEFT JOIN public.users u ON u.id = sl.created_by
    WHERE sl.folder_id = p_folder_id
      AND (sl.created_by = auth.uid() OR public.filehub_can_share_folder(p_folder_id))
    ORDER BY sl.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_share_link_list(UUID) TO authenticated;

-- ── 6. Table RLS: match the RPCs ─────────────────────────────────────────────
-- All real reads go through the SECURITY DEFINER RPCs above; this only matters
-- for a direct table select, but leaving it creator-only would contradict them.
DROP POLICY IF EXISTS "filehub_share_links_select_own" ON public.filehub_share_links;
CREATE POLICY "filehub_share_links_select_own" ON public.filehub_share_links
    FOR SELECT USING (
        created_by = auth.uid()
        OR (company_id = public.my_company_id() AND public.has_permission('filehub:share_override'))
    );

-- ── 7. Channel roster exposes who can share ──────────────────────────────────
-- can_share is permission metadata about OTHER people, so it's only populated
-- for a caller who is already trusted with it (role.manage, channel admin, or
-- the channel-override-manage permission). Everyone else gets NULL and the UI
-- renders nothing. fn_user_has_permission has no is_owner clause, so OR it in.
CREATE OR REPLACE FUNCTION public.rpc_filehub_group_members(p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id  UUID := auth.uid();
    v_rows     JSONB;
    v_may_see  BOOLEAN;
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

    v_may_see := public.has_permission('role.manage')
              OR public.has_permission('filehub:group_override_manage')
              OR EXISTS (
                     SELECT 1 FROM public.filehub_group_members
                     WHERE group_id = p_group_id AND user_id = v_user_id AND role = 'admin'
                 );

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id',        u.id,
        'full_name', u.full_name,
        'avatar_url',u.avatar_url,
        'role',      gm.role,
        'joined_at', gm.joined_at,
        'can_share', CASE WHEN v_may_see THEN
                         COALESCE(u.is_owner, false)
                         OR public.fn_user_has_permission(u.id, 'filehub:share')
                         OR public.fn_user_has_permission(u.id, 'filehub:share_override')
                     ELSE NULL END
    ) ORDER BY gm.role DESC, gm.joined_at), '[]'::jsonb)
    INTO v_rows
    FROM public.filehub_group_members gm
    JOIN public.users u ON u.id = gm.user_id
    WHERE gm.group_id = p_group_id;

    RETURN v_rows;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_members(uuid) TO authenticated;

-- ── Self-check ───────────────────────────────────────────────────────────────
-- Runs as postgres (no auth.uid()), so it asserts the WIRING, not a user's
-- answer: the permissions exist, the seed landed, and every gate resolves.
DO $$
DECLARE
    v_n INT;
BEGIN
    SELECT count(*) INTO v_n FROM public.permissions
    WHERE key IN ('filehub:share', 'filehub:share_override');
    ASSERT v_n = 2, 'both share permissions must exist';

    -- Owner+Admin+Manager on share, Owner+Admin on override = 5 grants.
    SELECT count(*) INTO v_n
    FROM public.role_permissions rp
    JOIN public.permissions p ON p.id = rp.permission_id
    JOIN public.roles r ON r.id = rp.role_id
    WHERE p.key IN ('filehub:share', 'filehub:share_override') AND r.is_system;
    ASSERT v_n = 5, format('expected 5 system-role grants, found %s', v_n);

    -- Every gate must be callable and total (NULL id -> false, never an error).
    ASSERT public.filehub_folder_accessible(NULL) = false, 'folder_accessible(NULL)';
    ASSERT public.filehub_can_share_file(NULL)    = false, 'can_share_file(NULL)';
    ASSERT public.filehub_can_share_folder(NULL)  = false, 'can_share_folder(NULL)';
END $$;
