-- 20260716_filehub_folder_scoping.sql
-- Folders stop being one global company-wide tree. Each folder now belongs to
-- exactly one scope:
--   'direct'    — shared by Inbox + Sent, since they're the same underlying
--                 files viewed from opposite ends (sender vs recipient).
--   'broadcast' — company-wide broadcasts, its own tree.
--   'group'     — one independent tree per channel (group_id required).
-- filehub_folders had zero rows at migration time, so there is no existing
-- data to backfill/reclassify.

ALTER TABLE public.filehub_folders
    ADD COLUMN scope TEXT NOT NULL DEFAULT 'direct' CHECK (scope IN ('direct', 'broadcast', 'group')),
    ADD COLUMN group_id UUID REFERENCES public.filehub_groups(id) ON DELETE CASCADE;

ALTER TABLE public.filehub_folders
    ADD CONSTRAINT filehub_folders_group_scope_chk CHECK ((scope = 'group') = (group_id IS NOT NULL));

CREATE INDEX idx_filehub_folders_group ON public.filehub_folders(group_id) WHERE group_id IS NOT NULL;

-- Old uniqueness didn't know about scope; a folder named "Reports" now needs
-- to be reusable independently in Direct, Broadcast, and every channel.
DROP INDEX IF EXISTS idx_filehub_folders_unique_root;
DROP INDEX IF EXISTS idx_filehub_folders_unique_child;

CREATE UNIQUE INDEX idx_filehub_folders_unique_root
    ON public.filehub_folders(company_id, scope, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid), name)
    WHERE parent_id IS NULL;
CREATE UNIQUE INDEX idx_filehub_folders_unique_child
    ON public.filehub_folders(company_id, parent_id, name)
    WHERE parent_id IS NOT NULL;

-- rpc_filehub_folder_create: gains p_scope / p_group_id, validates the
-- channel exists and belongs to this company, and rejects reparenting under
-- a folder from a different scope (a channel's tree can't graft onto Direct's).
DROP FUNCTION IF EXISTS public.rpc_filehub_folder_create(TEXT, UUID);

CREATE FUNCTION public.rpc_filehub_folder_create(
    p_name TEXT,
    p_parent_id UUID DEFAULT NULL,
    p_scope TEXT DEFAULT 'direct',
    p_group_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_id         UUID;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;

    IF p_scope NOT IN ('direct', 'broadcast', 'group') THEN
        RAISE EXCEPTION 'Invalid folder scope.';
    END IF;

    IF (p_scope = 'group') <> (p_group_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Channel folders require a group; other scopes must not have one.';
    END IF;

    IF p_group_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.filehub_groups WHERE id = p_group_id AND company_id = v_company_id
    ) THEN
        RAISE EXCEPTION 'Channel not found in this company.';
    END IF;

    IF p_parent_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE id = p_parent_id AND company_id = v_company_id
          AND scope = p_scope AND group_id IS NOT DISTINCT FROM p_group_id
    ) THEN
        RAISE EXCEPTION 'Parent folder does not exist in this scope.';
    END IF;

    INSERT INTO public.filehub_folders (company_id, name, created_by, parent_id, scope, group_id)
    VALUES (v_company_id, trim(p_name), v_user_id, p_parent_id, p_scope, p_group_id)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_create(TEXT, UUID, TEXT, UUID) TO authenticated;

-- rpc_filehub_folder_move: a folder can be reparented within its own scope
-- only — the destination must share the same scope + group_id.
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_move(p_id UUID, p_new_parent_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_name       TEXT;
    v_scope      TEXT;
    v_group_id   UUID;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions.';
    END IF;

    IF p_id = p_new_parent_id THEN
        RAISE EXCEPTION 'A folder cannot be moved into itself.';
    END IF;

    SELECT name, scope, group_id INTO v_name, v_scope, v_group_id
    FROM public.filehub_folders WHERE id = p_id AND company_id = v_company_id;
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'Folder not found.';
    END IF;

    IF p_new_parent_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.filehub_folders
            WHERE id = p_new_parent_id AND company_id = v_company_id
              AND scope = v_scope AND group_id IS NOT DISTINCT FROM v_group_id
        ) THEN
            RAISE EXCEPTION 'Destination folder not found in this scope.';
        END IF;

        IF EXISTS (
            WITH RECURSIVE descendants AS (
                SELECT id FROM public.filehub_folders WHERE parent_id = p_id
                UNION ALL
                SELECT f.id FROM public.filehub_folders f JOIN descendants d ON f.parent_id = d.id
            )
            SELECT 1 FROM descendants WHERE id = p_new_parent_id
        ) THEN
            RAISE EXCEPTION 'Cannot move a folder into its own subfolder.';
        END IF;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE company_id = v_company_id
          AND id <> p_id
          AND name = v_name
          AND parent_id IS NOT DISTINCT FROM p_new_parent_id
    ) THEN
        RAISE EXCEPTION 'A folder named "%" already exists there.', v_name;
    END IF;

    UPDATE public.filehub_folders SET parent_id = p_new_parent_id WHERE id = p_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_move(UUID, UUID) TO authenticated;

-- rpc_filehub_file_move: the target folder must match the file's own context
-- — Direct files only into 'direct' folders, broadcasts only into
-- 'broadcast' folders, and a channel's files only into that SAME channel's
-- folders. This is the actual enforcement point; the client only ever offers
-- the matching subset, but the RPC is what makes cross-scope filing impossible.
CREATE OR REPLACE FUNCTION public.rpc_filehub_file_move(p_file_id UUID, p_folder_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_user_id    UUID := auth.uid();
    v_visibility TEXT;
    v_group_id   UUID;
    v_expected_scope TEXT;
BEGIN
    SELECT visibility, group_id INTO v_visibility, v_group_id
    FROM public.filehub_files
    WHERE id = p_file_id AND uploaded_by = v_user_id AND deleted_at IS NULL;

    IF v_visibility IS NULL THEN
        RAISE EXCEPTION 'File not found or you are not the uploader.';
    END IF;

    v_expected_scope := CASE WHEN v_visibility = 'group' THEN 'group' WHEN v_visibility = 'broadcast' THEN 'broadcast' ELSE 'direct' END;

    IF p_folder_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE id = p_folder_id AND company_id = v_company_id
          AND scope = v_expected_scope
          AND group_id IS NOT DISTINCT FROM v_group_id
    ) THEN
        RAISE EXCEPTION 'Folder does not belong to this file''s context.';
    END IF;

    UPDATE public.filehub_files
    SET folder_id = p_folder_id
    WHERE id = p_file_id AND uploaded_by = v_user_id AND deleted_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_file_move(UUID, UUID) TO authenticated;
