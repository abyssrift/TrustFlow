-- 20260716_filehub_folder_create_idempotent.sql
-- rpc_filehub_folder_create always inserted a new row. The client
-- (ensureFolderTree) only calls it when its own locally-loaded folder list
-- doesn't already have a match, so retrying a folder-upload (double-click,
-- stale state after a slow batch, two tabs) against a tree that already
-- exists server-side spawned a full duplicate tree instead of reusing it —
-- this is exactly how the KSA Templates channel ended up with 3 duplicate
-- "KSA" trees today. Make the RPC itself a get-or-create: if a live folder
-- with the same name already sits at that exact parent+scope+group, return
-- its id instead of inserting a duplicate.

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

GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_create(TEXT, UUID, TEXT, UUID) TO authenticated;
