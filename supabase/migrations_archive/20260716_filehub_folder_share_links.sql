-- 20260716_filehub_folder_share_links.sql
-- Extends the FileHub share-link system (see 20260715_filehub_share_links.sql)
-- so a whole FOLDER can be shared with one public, expiring link — same model
-- as file links: creating/revoking/listing needs an authenticated session and
-- folder ownership (created_by), while turning a token into downloadable bytes
-- is done ONLY by the filehub-share-resolve Edge Function under the service role.
--
-- The existing filehub_share_links table is reused: a link points at EXACTLY
-- one of file_id / folder_id (enforced by a check constraint). The revoke RPC
-- (rpc_filehub_share_link_revoke) already keys off the link id + created_by, so
-- it works for folder links unchanged — only create + list need folder variants.

-- ── 1. Make the table hold either a file OR a folder ─────────────────────────
ALTER TABLE public.filehub_share_links
    ALTER COLUMN file_id DROP NOT NULL;

ALTER TABLE public.filehub_share_links
    ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES public.filehub_folders(id) ON DELETE CASCADE;

-- Exactly one target. (Named constraint so it's droppable/inspectable later.)
ALTER TABLE public.filehub_share_links
    DROP CONSTRAINT IF EXISTS filehub_share_links_one_target;
ALTER TABLE public.filehub_share_links
    ADD CONSTRAINT filehub_share_links_one_target
    CHECK ((file_id IS NOT NULL)::int + (folder_id IS NOT NULL)::int = 1);

CREATE INDEX IF NOT EXISTS idx_filehub_share_links_folder ON public.filehub_share_links(folder_id);

-- ── 2. Create a folder share link ────────────────────────────────────────────
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

    -- Only the folder's creator can share it (mirrors the uploader rule on files).
    IF NOT EXISTS (
        SELECT 1 FROM public.filehub_folders
        WHERE id = p_folder_id AND company_id = v_company_id AND created_by = v_user_id
          AND deleted_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Folder not found or you are not its owner.';
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

-- ── 3. List a folder's share links ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_filehub_folder_share_link_list(p_folder_id UUID)
RETURNS TABLE (
    id UUID, token TEXT, created_at TIMESTAMPTZ, expires_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ, view_count INT, last_viewed_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id, token, created_at, expires_at, revoked_at, view_count, last_viewed_at
    FROM public.filehub_share_links
    WHERE folder_id = p_folder_id AND created_by = auth.uid()
    ORDER BY created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_filehub_folder_share_link_list(UUID) TO authenticated;
