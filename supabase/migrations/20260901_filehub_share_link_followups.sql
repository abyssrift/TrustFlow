-- 20260901_filehub_share_link_followups.sql
-- Three of the four follow-ups from #37 (share-link feature):
--
--   1) Download-permission toggle on a share link. Enforced server-side by
--      filehub-share-resolve (never minting a signed URL for a download-off
--      link), not by hiding a button client-side.
--   2) filehub-share-resolve's folder branch now recurses into nested
--      subfolders instead of only listing files directly inside the shared
--      folder (Edge Function change, no schema needed for that half).
--   3) filehub_activity gains a folder target -- mirrors the file_id/folder_id
--      one-of pattern already used by filehub_share_links (20260716) -- so
--      creating a share link can be logged as a 'share' activity event on
--      the shared file OR folder.
--
-- Ask #2 from the issue ("share several files/folders to multiple people in
-- one action") is deliberately NOT in this migration -- see the issue thread.
-- There is no recipient concept anywhere in FileHub sharing today and picking
-- a data model for one needs a product decision, not a guess.

-- ── 1. Download-permission toggle ────────────────────────────────────────────
ALTER TABLE public.filehub_share_links
    ADD COLUMN IF NOT EXISTS download_allowed BOOLEAN NOT NULL DEFAULT true;

-- Arg count changes (2 -> 3) on the two CREATE rpcs below, so the old
-- overloads must go first -- otherwise PostgREST sees two candidates for a
-- 2-arg call and refuses to pick one (the same class of bug fixed by
-- 20260819_filehub_dedupe_name_overload_fix).
DROP FUNCTION IF EXISTS public.rpc_filehub_share_link_create(UUID, INT);
CREATE FUNCTION public.rpc_filehub_share_link_create(
    p_file_id UUID,
    p_expires_in_hours INT DEFAULT 168,
    p_download_allowed BOOLEAN DEFAULT true
)
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
    v_download   BOOLEAN := COALESCE(p_download_allowed, true);
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

    INSERT INTO public.filehub_share_links (file_id, company_id, token, created_by, expires_at, download_allowed)
    VALUES (p_file_id, v_company_id, v_token, v_user_id, v_expires_at, v_download)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires_at, 'download_allowed', v_download);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_share_link_create(UUID, INT, BOOLEAN) TO authenticated;

DROP FUNCTION IF EXISTS public.rpc_filehub_folder_share_link_create(UUID, INT);
CREATE FUNCTION public.rpc_filehub_folder_share_link_create(
    p_folder_id UUID,
    p_expires_in_hours INT DEFAULT 168,
    p_download_allowed BOOLEAN DEFAULT true
)
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
    v_download   BOOLEAN := COALESCE(p_download_allowed, true);
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

    INSERT INTO public.filehub_share_links (folder_id, company_id, token, created_by, expires_at, download_allowed)
    VALUES (p_folder_id, v_company_id, v_token, v_user_id, v_expires_at, v_download)
    RETURNING id INTO v_id;

    RETURN jsonb_build_object('id', v_id, 'token', v_token, 'expires_at', v_expires_at, 'download_allowed', v_download);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_share_link_create(UUID, INT, BOOLEAN) TO authenticated;

-- List rpcs: add download_allowed to the returned row. Return type changes,
-- so DROP first (CREATE OR REPLACE cannot alter output columns).
DROP FUNCTION IF EXISTS public.rpc_filehub_share_link_list(UUID);
CREATE FUNCTION public.rpc_filehub_share_link_list(p_file_id UUID)
RETURNS TABLE (
    id UUID, token TEXT, created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ, view_count INT, last_viewed_at TIMESTAMPTZ,
    created_by UUID, creator_name TEXT, can_revoke BOOLEAN, download_allowed BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT sl.id, sl.token, sl.created_at, sl.expires_at, sl.revoked_at,
           sl.view_count, sl.last_viewed_at, sl.created_by, u.full_name,
           (sl.created_by = auth.uid() OR public.has_permission('filehub:share_override')),
           sl.download_allowed
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
    created_by UUID, creator_name TEXT, can_revoke BOOLEAN, download_allowed BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT sl.id, sl.token, sl.created_at, sl.expires_at, sl.revoked_at,
           sl.view_count, sl.last_viewed_at, sl.created_by, u.full_name,
           (sl.created_by = auth.uid() OR public.has_permission('filehub:share_override')),
           sl.download_allowed
    FROM public.filehub_share_links sl
    LEFT JOIN public.users u ON u.id = sl.created_by
    WHERE sl.folder_id = p_folder_id
      AND (sl.created_by = auth.uid() OR public.filehub_can_share_folder(p_folder_id))
    ORDER BY sl.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_share_link_list(UUID) TO authenticated;

-- ── 2. filehub_activity gets a folder target ─────────────────────────────────
-- Same one-of pattern as filehub_share_links (20260716_filehub_folder_share_links).
ALTER TABLE public.filehub_activity
    ALTER COLUMN file_id DROP NOT NULL;

ALTER TABLE public.filehub_activity
    ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.filehub_folders(id) ON DELETE CASCADE;

ALTER TABLE public.filehub_activity
    DROP CONSTRAINT IF EXISTS filehub_activity_one_target;
ALTER TABLE public.filehub_activity
    ADD CONSTRAINT filehub_activity_one_target
    CHECK ((file_id IS NOT NULL)::int + (folder_id IS NOT NULL)::int = 1);

CREATE INDEX IF NOT EXISTS filehub_activity_folder_id_idx
    ON public.filehub_activity(folder_id, created_at DESC);

-- rpc_filehub_log_activity gains an optional folder target. Arg count changes
-- (3 -> 4), so drop the old signature first (same overload hazard as above).
DROP FUNCTION IF EXISTS public.rpc_filehub_log_activity(UUID, TEXT, JSONB);
CREATE FUNCTION public.rpc_filehub_log_activity(
    p_file_id UUID DEFAULT NULL,
    p_action TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT NULL,
    p_folder_id UUID DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    -- Exactly one of file/folder, and an action, or silently do nothing --
    -- this rpc has always swallowed bad calls (EXCEPTION WHEN OTHERS below)
    -- rather than surface plumbing errors into the FileHub UI.
    IF p_action IS NULL OR (p_file_id IS NULL) = (p_folder_id IS NULL) THEN
        RETURN;
    END IF;

    INSERT INTO public.filehub_activity (company_id, file_id, folder_id, user_id, action, metadata)
    VALUES (public.my_company_id(), p_file_id, p_folder_id, auth.uid(), p_action, p_metadata);
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_log_activity(UUID, TEXT, JSONB, UUID) TO authenticated;

-- ── Self-check ───────────────────────────────────────────────────────────────
DO $$
DECLARE v_bad INT;
BEGIN
    SELECT count(*) INTO v_bad FROM public.filehub_activity
    WHERE (file_id IS NOT NULL)::int + (folder_id IS NOT NULL)::int <> 1;
    ASSERT v_bad = 0, format('%s filehub_activity rows violate the one-target constraint', v_bad);
END $$;
