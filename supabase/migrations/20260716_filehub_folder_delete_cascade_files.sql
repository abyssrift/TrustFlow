-- 20260716_filehub_folder_delete_cascade_files.sql
-- Deleting a folder soft-deleted only the folder subtree; the files inside
-- stayed live but pointed at hidden folders — invisible in browsing, yet
-- still matching duplicate/name-conflict checks and still holding storage.
-- (That's how 353 files got stranded in the KSA Templates channel today.)
-- Now: folder delete soft-deletes its files with the SAME timestamp, and
-- folder restore brings back exactly the files that delete took with it
-- (files binned individually beforehand keep their own clock and stay put).
--
-- Also restores the `deleted_at IS NULL` guard on the parent check in
-- rpc_filehub_folder_create — 20260716_filehub_folder_create_idempotent
-- was written from the pre-soft-delete version and dropped it.

-- ── folder_create: re-add deleted-parent guard (keeps get-or-create) ────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_create(
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
    v_name       TEXT := trim(p_name);
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
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Parent folder does not exist in this scope.';
    END IF;

    SELECT id INTO v_id
    FROM public.filehub_folders
    WHERE company_id = v_company_id
      AND parent_id IS NOT DISTINCT FROM p_parent_id
      AND scope = p_scope
      AND group_id IS NOT DISTINCT FROM p_group_id
      AND name = v_name
      AND deleted_at IS NULL;

    IF v_id IS NOT NULL THEN
        RETURN v_id;
    END IF;

    INSERT INTO public.filehub_folders (company_id, name, created_by, parent_id, scope, group_id)
    VALUES (v_company_id, v_name, v_user_id, p_parent_id, p_scope, p_group_id)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

-- ── folder_delete: subtree + its files share one deleted_at ─────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_delete(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_now        TIMESTAMPTZ := now();
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE id = p_id AND company_id = v_company_id AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Folder not found.';
    END IF;

    WITH RECURSIVE subtree AS (
        SELECT id FROM public.filehub_folders WHERE id = p_id
        UNION ALL
        SELECT f.id FROM public.filehub_folders f JOIN subtree s ON f.parent_id = s.id
    )
    UPDATE public.filehub_files
    SET deleted_at = v_now
    WHERE folder_id IN (SELECT id FROM subtree)
      AND company_id = v_company_id
      AND deleted_at IS NULL;

    WITH RECURSIVE subtree AS (
        SELECT id FROM public.filehub_folders WHERE id = p_id
        UNION ALL
        SELECT f.id FROM public.filehub_folders f JOIN subtree s ON f.parent_id = s.id
    )
    UPDATE public.filehub_folders
    SET deleted_at = v_now
    WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL;
END;
$$;

-- ── folder_restore: bring back the files that THIS delete binned ────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_restore(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
    v_deleted_at TIMESTAMPTZ;
BEGIN
    SELECT deleted_at INTO v_deleted_at
    FROM public.filehub_folders
    WHERE id = p_id AND company_id = v_company_id
      AND deleted_at IS NOT NULL AND deleted_at > now() - interval '15 days';
    IF v_deleted_at IS NULL THEN
        RAISE EXCEPTION 'Folder not found in Bin, or the 15-day restore window has expired.';
    END IF;

    -- Files first (matched by the shared timestamp — files binned
    -- individually before the folder delete keep their own deleted_at
    -- and stay in the Bin).
    WITH RECURSIVE subtree AS (
        SELECT id FROM public.filehub_folders WHERE id = p_id
        UNION ALL
        SELECT f.id FROM public.filehub_folders f JOIN subtree s ON f.parent_id = s.id
    )
    UPDATE public.filehub_files
    SET deleted_at = NULL
    WHERE folder_id IN (SELECT id FROM subtree)
      AND company_id = v_company_id
      AND deleted_at = v_deleted_at;

    WITH RECURSIVE subtree AS (
        SELECT id FROM public.filehub_folders WHERE id = p_id
        UNION ALL
        SELECT f.id FROM public.filehub_folders f JOIN subtree s ON f.parent_id = s.id
    )
    UPDATE public.filehub_folders
    SET deleted_at = NULL
    WHERE id IN (SELECT id FROM subtree)
      AND deleted_at IS NOT NULL
      AND deleted_at > now() - interval '15 days';
END;
$$;
