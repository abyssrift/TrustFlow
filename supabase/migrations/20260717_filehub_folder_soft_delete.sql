-- 20260717_filehub_folder_soft_delete.sql
-- FileHub folders were the only thing in File Hub that got hard-deleted with
-- no recovery window — files already have a 15-day Bin (deleted_at, see
-- 20260622_filehub_bin.sql). This brings folders in line with that pattern.
--
-- Folders can nest (20260715_filehub_folder_hierarchy.sql), so delete/restore
-- both cascade through the whole subtree via a recursive CTE — deleting a
-- folder sends its entire branch to the Bin together, and restoring it brings
-- the branch back together. Files inside are left untouched (folder_id keeps
-- pointing at the now-hidden folder); they only fall back to unfiled once the
-- folder is actually purged after 15 days, exactly like before.
--
-- Folders are a shared company resource (no per-uploader ownership model,
-- unlike files), so the Bin entry for a deleted folder is visible to the
-- whole company, not just whoever deleted it — matching the existing
-- company-wide SELECT policy on filehub_folders.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. SCHEMA
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.filehub_folders
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. RLS — deleted folders stop showing up in normal browsing
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "filehub_folders_select_company" ON public.filehub_folders;
CREATE POLICY "filehub_folders_select_company" ON public.filehub_folders
    FOR SELECT USING (company_id = public.my_company_id() AND deleted_at IS NULL);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. UNIQUE INDEXES — a deleted folder's name must be reusable immediately,
--    not blocked until the 15-day Bin window expires.
-- ────────────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_filehub_folders_unique_root;
DROP INDEX IF EXISTS idx_filehub_folders_unique_child;

CREATE UNIQUE INDEX idx_filehub_folders_unique_root
    ON public.filehub_folders(company_id, scope, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid), name)
    WHERE parent_id IS NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX idx_filehub_folders_unique_child
    ON public.filehub_folders(company_id, parent_id, name)
    WHERE parent_id IS NOT NULL AND deleted_at IS NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. rpc_filehub_folder_delete — now soft-deletes the folder + entire subtree
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_delete(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
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
    UPDATE public.filehub_folders
    SET deleted_at = now()
    WHERE id IN (SELECT id FROM subtree) AND deleted_at IS NULL;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. rpc_filehub_folder_restore — restores the folder + subtree, 15-day window
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_restore(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID := public.my_company_id();
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE id = p_id AND company_id = v_company_id
          AND deleted_at IS NOT NULL AND deleted_at > now() - interval '15 days'
    ) THEN
        RAISE EXCEPTION 'Folder not found in Bin, or the 15-day restore window has expired.';
    END IF;

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

GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_restore(UUID) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. rpc_filehub_bin_list — folders join the same Bin listing, tagged via
--    'item_type' (also backfilled onto the two existing file branches so the
--    client can rely on it uniformly instead of "absence means file").
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_bin_list()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id    UUID := auth.uid();
    v_company_id UUID := public.my_company_id();
    v_rows       JSONB;
BEGIN
    IF NOT public.has_permission('filehub:view') THEN
        RAISE EXCEPTION 'Insufficient permissions to view File Hub.';
    END IF;

    SELECT COALESCE(jsonb_agg(row_payload ORDER BY trashed_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM (
        -- Files I deleted myself (I'm the uploader)
        SELECT
            f.deleted_at AS trashed_at,
            jsonb_build_object(
                'id',            f.id,
                'item_type',     'file',
                'original_name', f.original_name,
                'mime_type',     f.mime_type,
                'size_bytes',    f.size_bytes,
                'caption',       f.caption,
                'visibility',    f.visibility,
                'storage_path',  f.storage_path,
                'bucket',        f.bucket,
                'tags',          f.tags,
                'created_at',    f.created_at,
                'folder',        CASE WHEN f.folder_id IS NULL THEN NULL ELSE
                                    jsonb_build_object('id', fo.id, 'name', fo.name) END,
                'uploader',      jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url),
                'trash_type',    'deleted',
                'trashed_at',    f.deleted_at,
                'expires_at',    f.deleted_at + interval '15 days'
            ) AS row_payload
        FROM public.filehub_files f
        LEFT JOIN public.filehub_folders fo ON fo.id = f.folder_id
        LEFT JOIN public.users u            ON u.id  = f.uploaded_by
        WHERE f.company_id   = v_company_id
          AND f.uploaded_by  = v_user_id
          AND f.deleted_at IS NOT NULL
          AND f.deleted_at  > now() - interval '15 days'

        UNION ALL

        -- Files I hid from my inbox (someone else's file)
        SELECT
            r.archived_at AS trashed_at,
            jsonb_build_object(
                'id',            f.id,
                'item_type',     'file',
                'original_name', f.original_name,
                'mime_type',     f.mime_type,
                'size_bytes',    f.size_bytes,
                'caption',       f.caption,
                'visibility',    f.visibility,
                'storage_path',  f.storage_path,
                'bucket',        f.bucket,
                'tags',          f.tags,
                'created_at',    f.created_at,
                'folder',        CASE WHEN f.folder_id IS NULL THEN NULL ELSE
                                    jsonb_build_object('id', fo.id, 'name', fo.name) END,
                'uploader',      jsonb_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url),
                'trash_type',    'hidden',
                'trashed_at',    r.archived_at,
                'expires_at',    r.archived_at + interval '15 days'
            ) AS row_payload
        FROM public.filehub_recipients r
        JOIN public.filehub_files f         ON f.id = r.file_id
        LEFT JOIN public.filehub_folders fo ON fo.id = f.folder_id
        LEFT JOIN public.users u            ON u.id  = f.uploaded_by
        WHERE r.user_id = v_user_id
          AND r.archived_at IS NOT NULL
          AND r.archived_at  > now() - interval '15 days'
          AND f.company_id  = v_company_id

        UNION ALL

        -- Folders deleted by anyone in the company (shared resource — not
        -- scoped to whoever deleted it, matching the pre-existing company-wide
        -- SELECT policy on filehub_folders)
        SELECT
            fo.deleted_at AS trashed_at,
            jsonb_build_object(
                'id',            fo.id,
                'item_type',     'folder',
                'original_name', fo.name,
                'mime_type',     NULL,
                'size_bytes',    0,
                'caption',       NULL,
                'visibility',    NULL,
                'storage_path',  NULL,
                'bucket',        NULL,
                'tags',          '{}'::text[],
                'created_at',    fo.created_at,
                'folder',        CASE WHEN fo.parent_id IS NULL THEN NULL ELSE
                                    jsonb_build_object('id', p.id, 'name', p.name) END,
                'uploader',      jsonb_build_object('id', cu.id, 'full_name', cu.full_name, 'avatar_url', cu.avatar_url),
                'trash_type',    'deleted',
                'trashed_at',    fo.deleted_at,
                'expires_at',    fo.deleted_at + interval '15 days'
            ) AS row_payload
        FROM public.filehub_folders fo
        LEFT JOIN public.filehub_folders p ON p.id = fo.parent_id
        LEFT JOIN public.users cu          ON cu.id = fo.created_by
        WHERE fo.company_id = v_company_id
          AND fo.deleted_at IS NOT NULL
          AND fo.deleted_at > now() - interval '15 days'
    ) src;

    RETURN v_rows;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Guard the other folder RPCs against operating through a deleted folder
-- ────────────────────────────────────────────────────────────────────────────
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

    INSERT INTO public.filehub_folders (company_id, name, created_by, parent_id, scope, group_id)
    VALUES (v_company_id, trim(p_name), v_user_id, p_parent_id, p_scope, p_group_id)
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

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
    FROM public.filehub_folders WHERE id = p_id AND company_id = v_company_id AND deleted_at IS NULL;
    IF v_name IS NULL THEN
        RAISE EXCEPTION 'Folder not found.';
    END IF;

    IF p_new_parent_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.filehub_folders
            WHERE id = p_new_parent_id AND company_id = v_company_id
              AND scope = v_scope AND group_id IS NOT DISTINCT FROM v_group_id
              AND deleted_at IS NULL
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
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'A folder named "%" already exists there.', v_name;
    END IF;

    UPDATE public.filehub_folders SET parent_id = p_new_parent_id WHERE id = p_id;
END;
$$;

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
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Folder does not belong to this file''s context.';
    END IF;

    UPDATE public.filehub_files
    SET folder_id = p_folder_id
    WHERE id = p_file_id AND uploaded_by = v_user_id AND deleted_at IS NULL;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Purge — folders have no storage bytes, so a plain SQL delete (no Edge
--    Function round-trip) is enough. FK ON DELETE CASCADE (parent_id) takes
--    care of any still-deleted descendants in the same statement, and
--    filehub_files.folder_id ON DELETE SET NULL still fires for any files
--    left inside, exactly as it did under the old hard-delete.
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_invoke_purge_filehub_bin()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_url    TEXT := 'https://wbvgufqfgbvbinjrdzlg.supabase.co/functions/v1/purge-filehub-bin';
  v_secret TEXT := '';
BEGIN
  DELETE FROM public.filehub_folders
  WHERE deleted_at IS NOT NULL
    AND deleted_at < now() - interval '15 days';

  BEGIN
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'purge_filehub_bin_secret'
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := '';
  END;

  PERFORM net.http_post(
    url     := v_url,
    body    := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || COALESCE(v_secret, '')
    ),
    timeout_milliseconds := 30000
  );
END;
$function$;
