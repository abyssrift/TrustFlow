-- 20260721_filehub_channel_rename_delete.sql
-- FileHub channels (filehub_groups) had no rename/delete RPC at all — only
-- create. Adds both, gated the same way as rpc_filehub_group_remove_member:
-- a real channel admin, OR a filehub:group_override_manage holder acting as
-- a virtual admin on a channel they don't belong to.
--
-- Delete soft-deletes the channel's files and folders first (same
-- deleted_at pattern as rpc_filehub_folder_delete) before hard-deleting the
-- filehub_groups row. Without that, filehub_files.group_id's
-- ON DELETE SET NULL would silently orphan live files pointing at a channel
-- that no longer exists — the exact bug 20260716_filehub_folder_delete_
-- cascade_files.sql fixed for folders ("353 files got stranded"). Group
-- members cascade automatically via the existing FK.

CREATE OR REPLACE FUNCTION public.rpc_filehub_group_rename(
    p_group_id UUID,
    p_name     TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id     UUID := auth.uid();
    v_company_id  UUID := public.my_company_id();
    v_caller_role TEXT;
    v_is_override BOOLEAN := false;
    v_name        TEXT := trim(p_name);
BEGIN
    IF v_name IS NULL OR length(v_name) = 0 THEN
        RAISE EXCEPTION 'Channel name is required.';
    END IF;

    SELECT role INTO v_caller_role FROM public.filehub_group_members
    WHERE group_id = p_group_id AND user_id = v_user_id;

    IF v_caller_role IS NULL THEN
        v_is_override := public.has_permission('filehub:group_override_manage')
            AND EXISTS (SELECT 1 FROM public.filehub_groups g WHERE g.id = p_group_id AND g.company_id = v_company_id);
    END IF;

    IF v_caller_role IS DISTINCT FROM 'admin' AND NOT v_is_override THEN
        RAISE EXCEPTION 'Only channel admins can rename this channel.';
    END IF;

    UPDATE public.filehub_groups SET name = v_name WHERE id = p_group_id AND company_id = v_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Channel not found.';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_filehub_group_delete(p_group_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_user_id     UUID := auth.uid();
    v_company_id  UUID := public.my_company_id();
    v_caller_role TEXT;
    v_is_override BOOLEAN := false;
    v_now         TIMESTAMPTZ := now();
BEGIN
    SELECT role INTO v_caller_role FROM public.filehub_group_members
    WHERE group_id = p_group_id AND user_id = v_user_id;

    IF v_caller_role IS NULL THEN
        v_is_override := public.has_permission('filehub:group_override_manage')
            AND EXISTS (SELECT 1 FROM public.filehub_groups g WHERE g.id = p_group_id AND g.company_id = v_company_id);
    END IF;

    IF v_caller_role IS DISTINCT FROM 'admin' AND NOT v_is_override THEN
        RAISE EXCEPTION 'Only channel admins can delete this channel.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.filehub_groups WHERE id = p_group_id AND company_id = v_company_id) THEN
        RAISE EXCEPTION 'Channel not found.';
    END IF;

    UPDATE public.filehub_files
    SET deleted_at = v_now
    WHERE group_id = p_group_id AND company_id = v_company_id AND deleted_at IS NULL;

    UPDATE public.filehub_folders
    SET deleted_at = v_now
    WHERE group_id = p_group_id AND company_id = v_company_id AND deleted_at IS NULL;

    DELETE FROM public.filehub_groups WHERE id = p_group_id AND company_id = v_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_rename(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_filehub_group_delete(UUID)       TO authenticated;
